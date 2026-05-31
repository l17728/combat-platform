import { Router } from "express";
import type { Repository, SchemaRegistry, Role } from "@combat/shared";
import { PRIVILEGED_ROLES } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";
import { log } from "./logger.js";
import { syncConflicts } from "./conflicts.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";
import { verifyAuth } from "./auth.js";

/**
 * 节点保存后异步触发后台扫描任务（fire-and-forget）。
 * 仅对 attackTicket 变更调用，不阻塞 API 响应，失败只写日志。
 * scanAndCreateReminders 同时需要 registry，一并触发。
 *
 * conflicts 走 30s 防抖:全量重建 O(N + k²) 且每条边写 audit_log,连续 10 次保存
 * = 10 次全量重建 = 数万次 INSERT。debounce 把窗口内多次保存合并成 1 次扫描,
 * audit 写放大降低 10-100×。escalation/reminders 仍走 setImmediate(开销小)。
 */
const CONFLICTS_DEBOUNCE_MS = 30_000;
let conflictsDebounceTimer: NodeJS.Timeout | null = null;
let conflictsDebounceRepo: Repository | null = null;

function scheduleConflictsSync(repo: Repository): void {
  conflictsDebounceRepo = repo;
  if (conflictsDebounceTimer) clearTimeout(conflictsDebounceTimer);
  conflictsDebounceTimer = setTimeout(async () => {
    conflictsDebounceTimer = null;
    const r = conflictsDebounceRepo;
    conflictsDebounceRepo = null;
    if (!r) return;
    try {
      await syncConflicts(r);
      log.info("post_save.conflicts.debounced_run");
    } catch (e) {
      log.warn("post_save.conflicts.fail", { error: (e as Error).message });
    }
  }, CONFLICTS_DEBOUNCE_MS);
  conflictsDebounceTimer.unref?.();
}

/** Test helper: flush pending debounced conflict scan immediately. Not used in prod. */
export async function __flushConflictsDebounceForTest(): Promise<void> {
  if (conflictsDebounceTimer) {
    clearTimeout(conflictsDebounceTimer);
    conflictsDebounceTimer = null;
    const r = conflictsDebounceRepo;
    conflictsDebounceRepo = null;
    if (r) {
      try {
        await syncConflicts(r);
      } catch {
        /* swallow */
      }
    }
  }
}

function triggerPostSaveJobs(repo: Repository, registry: SchemaRegistry): void {
  // Skip in test environment to avoid interfering with tests that explicitly
  // call scan endpoints (scans are idempotent — auto-trigger would consume the
  // first run, making the explicit test call return 0).
  if (process.env.NODE_ENV === "test") return;
  scheduleConflictsSync(repo);
  setImmediate(async () => {
    try {
      await scanEscalation(repo);
    } catch (e) {
      log.warn("post_save.escalation.fail", { error: (e as Error).message });
    }
    try {
      await scanAndCreateReminders(repo, registry);
    } catch (e) {
      log.warn("post_save.reminders.fail", { error: (e as Error).message });
    }
  });
}

// 私密攻关单访问判定:成员(姓名)/创建人(用户名)/私密授权人(姓名)/私密授权组(经邮件→人员)。
// 仅当 attackTicket.私密 === '是' 时调用。
async function canAccessPrivateAttackTicket(
  repo: Repository,
  node: { properties: Record<string, unknown> },
  user: { username?: string; displayName?: string }
): Promise<boolean> {
  const p = node.properties as Record<string, unknown>;
  const username = user.username || "";
  const displayName = user.displayName || "";
  // 创建人 (存的是 username)
  if (String(p["创建人"] ?? "") === username && username) return true;
  // 成员列表 (姓名)
  const memberRaw = p["成员列表"];
  if (typeof memberRaw === "string" && memberRaw.trim()) {
    try {
      const arr = JSON.parse(memberRaw);
      if (Array.isArray(arr)) {
        for (const m of arr) {
          const n = String(m?.["姓名"] ?? "").trim();
          if (n && (n === displayName || n === username)) return true;
        }
      }
    } catch {
      /* fall through */
    }
  }
  // 私密授权人 (姓名数组,JSON)
  const authRaw = p["私密授权人"];
  if (typeof authRaw === "string" && authRaw.trim()) {
    try {
      const arr = JSON.parse(authRaw);
      if (Array.isArray(arr)) {
        for (const n of arr) {
          const s = String(n).trim();
          if (s && (s === displayName || s === username)) return true;
        }
      }
    } catch {
      /* fall through */
    }
  }
  // 私密授权组 (组名数组,JSON):展开为邮箱 → 人员姓名 → 比对 displayName/username
  const groupRaw = p["私密授权组"];
  if (typeof groupRaw === "string" && groupRaw.trim()) {
    try {
      const groups = JSON.parse(groupRaw);
      if (Array.isArray(groups) && groups.length > 0) {
        for (const groupName of groups) {
          // v2.2 P1 §2: SQL 下推 emailGroup.组名 + person.邮箱 等值查找,走 json_extract 索引
          const gNodes = await repo.queryNodesByProperty("emailGroup", "组名", String(groupName));
          for (const g of gNodes) {
            const emails = String(g.properties?.["成员邮箱"] ?? "")
              .split(/[,，;；]/)
              .map((s) => s.trim())
              .filter(Boolean);
            for (const email of emails) {
              const persons = await repo.queryNodesByProperty("person", "邮箱", email);
              for (const person of persons) {
                const n = String(person.properties?.["姓名"] ?? "").trim();
                if (n && (n === displayName || n === username)) return true;
              }
            }
          }
        }
      }
    } catch {
      /* fall through */
    }
  }
  return false;
}

// §50: gate 贡献等级 标定 to privileged roles. P0-3 修复:role 必须从 JWT payload 取,
// 严禁信任客户端可控的 X-Role 头(localStorage 写入,curl 可任意伪造)。
// - 缺失 Authorization (CLI / import / 测试 / COMBAT_NO_AUTH) → 信任
// - JWT 有效 + role ∈ PRIVILEGED_ROLES → 信任
// - 其他 → 403
function gradeGate(req: { headers: Record<string, unknown>; body: unknown }, nodeType: string): string | null {
  if (nodeType !== "contribution") return null;
  const grade = String((req.body as Record<string, unknown>)?.["贡献等级"] ?? "").trim();
  if (!grade) return null;
  if (process.env.COMBAT_NO_AUTH === "1") return null;
  const auth = (req.headers["authorization"] as string | undefined) ?? undefined;
  if (!auth) return null; // trusted CLI / 后端内部调用
  const payload = verifyAuth(req as { headers: Record<string, unknown> });
  if (!payload) return "未登录或 token 已过期";
  if (PRIVILEGED_ROLES.includes(payload.role as Role)) return null;
  return "仅 Leader 可标定贡献等级";
}

export function makeRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();

  r.get("/schema/:nodeType", (req, res) => {
    const s = registry.getNodeSchema(req.params.nodeType);
    return s ? res.json(s) : res.status(404).json({ error: "unknown nodeType" });
  });
  r.post("/schema/scan", (_req, res) => {
    try {
      registry.reload();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  r.patch("/schema/:nodeType", async (req, res) => {
    const { nodeType } = req.params;
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(nodeType)) {
      return res.status(400).json({ error: "nodeType 格式非法" });
    }
    try {
      const s = registry.applyFieldOp(nodeType, req.body);
      await repo.logAudit({
        action: `SCHEMA_${req.body?.op}`,
        entityType: "schema",
        entityId: nodeType,
        changes: req.body,
        actor: "api",
      });
      log.info("schema.fieldOp", { nodeType, op: req.body?.op });
      res.json(s);
    } catch (e) {
      log.warn("schema.fieldOp.fail", { nodeType, error: (e as Error).message });
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/nodes/:nodeType", async (req, res) => {
    const { nodeType } = req.params;
    if (registry.getNodeSchema(nodeType)) {
      // Express parses repeated query params as arrays; queryNodes does strict === on
      // string property values, so collapse each param to its first scalar value.
      const filter: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) filter[k] = Array.isArray(v) ? String(v[0]) : String(v);
      return res.json(await repo.queryNodes(nodeType, Object.keys(filter).length ? filter : undefined));
    }
    const single = await repo.getNode(nodeType);
    if (!single) return res.status(404).json({ error: "not found" });
    // 私密访问控制:攻关单 私密=是 → 仅 创建人 + 成员列表 + 私密授权人 + 私密授权组里的人可读
    if (single.nodeType === "attackTicket" && String(single.properties?.["私密"] ?? "") === "是") {
      const reqUser = (req as any).user as { username?: string; displayName?: string } | undefined;
      if (reqUser?.username && !(await canAccessPrivateAttackTicket(repo, single, reqUser))) {
        return res.status(403).json({ error: "私密攻关单,仅创建人/成员/授权人可访问" });
      }
    }
    return res.json(single);
  });

  r.post("/nodes/:nodeType", async (req, res) => {
    const { nodeType } = req.params;
    const gate = gradeGate(req, nodeType);
    if (gate) return res.status(403).json({ error: gate });
    // 攻关单注入「创建人」=当前登录用户;COMBAT_NO_AUTH 模式下退回 'admin',
    // 与 /auth/me 返回的默认管理员一致,便于 e2e 走删除路径。
    if (nodeType === "attackTicket" && !req.body?.["创建人"]) {
      const creator = (req as any).user?.username || "admin";
      req.body = { ...req.body, 创建人: creator };
    }
    const v = registry.validateNode(nodeType, req.body);
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    const node = await repo.createNode(nodeType, req.body, "api");
    log.info("node.create", { nodeType, id: node.id });
    if (nodeType === "contribution") {
      const ref = String(req.body?.["关联攻关单"] ?? "");
      if (ref) {
        const tickets = await repo.queryNodes("attackTicket");
        const target =
          tickets.find((t) => String(t.properties["攻关单号"] ?? "") === ref) ??
          tickets.find((t) => String(t.properties["标题"] ?? "") === ref);
        if (target) await repo.createEdge("CONTRIBUTED_TO", node.id, target.id, {}, "api");
      }
    }
    await syncRefEdges(repo, registry, node, req.body, "api");
    await syncAnchorEdges(repo, registry, node, req.body, "api");
    if (nodeType === "attackTicket") triggerPostSaveJobs(repo, registry);
    res.status(201).json(node);
  });

  // Partial/merge update only (no-DDL JSON store): body keys are merged into
  // existing properties; field removal is intentionally unsupported in Phase 1.
  r.put("/nodes/:id", async (req, res) => {
    const cur = await repo.getNode(req.params.id);
    if (!cur) return res.status(404).json({ error: "not found" });
    const gate = gradeGate(req, cur.nodeType);
    if (gate) return res.status(403).json({ error: gate });
    const v = registry.validateNode(cur.nodeType, { ...cur.properties, ...req.body });
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    const updated = await repo.updateNode(req.params.id, req.body, "api");
    log.info("node.update", { id: req.params.id, nodeType: cur.nodeType });
    await syncRefEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");
    await syncAnchorEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");
    if (cur.nodeType === "attackTicket") triggerPostSaveJobs(repo, registry);
    res.json(updated);
  });

  r.delete("/nodes/:id", async (req, res) => {
    const cur = await repo.getNode(req.params.id);
    if (!cur) return res.status(404).json({ error: "not found" });
    // 攻关单删除:仅创建人本人可删,管理员也不行。
    // 老数据无创建人 → 视为孤儿,UI 不显示删除;必要时管理员走 CLI/直连 DB 清理。
    // 无 req.user(test/CLI/COMBAT_NO_AUTH bypass):放行,保留既有行为;真实生产链路 authMiddleware 必然填充 req.user。
    const reqUser = (req as any).user?.username as string | undefined;
    if (cur.nodeType === "attackTicket" && reqUser) {
      const creator = String(cur.properties?.["创建人"] ?? "").trim();
      if (!creator || creator !== reqUser) {
        return res.status(403).json({ error: "仅创建人可删除该攻关单" });
      }
    }
    await repo.deleteNode(req.params.id, "api");
    log.info("node.delete", { id: req.params.id });
    res.json({ ok: true });
  });

  r.get("/nodes/:id/progress", async (req, res) => res.json(await repo.listProgress(req.params.id)));
  r.post("/nodes/:id/progress", async (req, res) => {
    const { content, statusSnapshot, actor } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });
    res.status(201).json(await repo.appendProgress(req.params.id, content, statusSnapshot, actor ?? "api"));
  });

  // §41: atomic state transition — update 状态 + append a status-snapshotted
  // ProgressLog so every status change is traceable in the append-only series.
  r.post("/nodes/:id/transition", async (req, res) => {
    const node = await repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    if (node.nodeType !== "attackTicket") return res.status(400).json({ error: "仅攻关单支持状态流转" });
    const toStatus = String(req.body?.toStatus ?? "").trim();
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const schema = registry.getNodeSchema(node.nodeType);
    const statusField = schema?.fields.find((f) => f.id === "状态");
    const allowed = statusField?.enumValues ?? [];
    if (!toStatus || !allowed.includes(toStatus))
      return res.status(400).json({ error: `非法目标状态：${toStatus || "(空)"}` });
    const fromStatus = String(node.properties["状态"] ?? "");
    const updated = await repo.updateNode(node.id, { 状态: toStatus }, "api");
    const content = `状态变更：${fromStatus || "(空)"}→${toStatus}` + (note ? `；${note}` : "");
    const progress = await repo.appendProgress(node.id, content, toStatus, "api");
    log.info("node.transition", { id: node.id, toStatus });
    triggerPostSaveJobs(repo, registry);
    res.json({ node: updated, progress });
  });

  return r;
}
