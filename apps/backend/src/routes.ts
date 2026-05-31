import { Router } from "express";
import type { Repository, SchemaRegistry, Role } from "@combat/shared";
import { PRIVILEGED_ROLES } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";
import { log } from "./logger.js";
import { verifyAuth } from "./auth.js";
import { canAccessPrivateAttackTicket, filterAccessibleTickets } from "./private-tickets.js";

/**
 * resilience(outbox): 业务路由用此接口把 KG 派生任务投递到 `kg_outbox` 表,
 * 取代旧的 `setImmediate(syncToKG)` fire-and-forget — 进程重启不丢任务,
 * 失败可重放(详见 kg-outbox.ts)。
 *
 * createApp 在挂载 makeRouter 前注入一个真实 enqueuer(写 SQLite/Postgres);
 * 测试/CLI 不传则 fallback 到 noop(老 setImmediate 路径已删除,任务被吞)。
 */
export interface OutboxEnqueuer {
  enqueue(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

/**
 * resilience(outbox): 节点保存后,把派生任务投递到 `kg_outbox` 表(durable queue),
 * 由后台 KgOutboxWorker 异步消费。比旧的 setImmediate fire-and-forget 更可靠:
 * 进程崩溃/重启不丢任务,失败可重放(`kg:outbox:replay`)。
 *
 * 投递三类事件:
 *   - attackTicket.saved (含 ticketId)  → worker 跑 syncConflictsForOne
 *   - attackTicket.escalation           → worker 跑 scanEscalation
 *   - attackTicket.reminders            → worker 跑 scanAndCreateReminders
 *
 * 老的 30s 防抖被去掉(worker 自身轮询节流;短时间多次保存会写多条 outbox,
 * 但每条 conflicts 是 syncConflictsForOne 增量算法,代价线性)。
 */
function triggerPostSaveJobs(outbox: OutboxEnqueuer | undefined, ticketId?: string): void {
  // Skip in test environment to avoid interfering with tests that explicitly
  // call scan endpoints (scans are idempotent — auto-trigger would consume the
  // first run, making the explicit test call return 0).
  if (process.env.NODE_ENV === "test") return;
  if (!outbox) return; // legacy path (no adapter in test app)
  void Promise.resolve()
    .then(async () => {
      await outbox.enqueue("attackTicket.saved", { ticketId });
      await outbox.enqueue("attackTicket.escalation", {});
      await outbox.enqueue("attackTicket.reminders", {});
    })
    .catch((e) => log.warn("post_save.outbox.enqueue_fail", { error: (e as Error).message }));
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

// P1 audit actor 强制取自 req.user:任何调用 repo 写操作的 actor 实参,
// 必须经此 helper 取值 — 不再硬编码 "api" 字符串(那是任传字符串伪造来源)。
// 仅 CLI / 内部测试 / COMBAT_NO_AUTH bypass 链路没有 req.user → 回退到 fallback。
// 用 unknown 入参 + 内部断言:Express Request 类型不含 user (中间件 (req as any).user 注入),
// 避免到处再写一遍类型断言;helper 内部一次 cast 即可。
export function actorOf(req: unknown, fallback = "api"): string {
  return (req as { user?: { username?: string } })?.user?.username || fallback;
}

export function makeRouter(repo: Repository, registry: SchemaRegistry, outbox?: OutboxEnqueuer): Router {
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
      await repo.logAudit(
        {
          action: `SCHEMA_${req.body?.op}`,
          entityType: "schema",
          entityId: nodeType,
          changes: req.body,
          actor: actorOf(req),
        },
        req as unknown as { user?: { username?: string } }
      );
      log.info("schema.fieldOp", { nodeType, op: req.body?.op });
      res.json(s);
    } catch (e) {
      log.warn("schema.fieldOp.fail", { nodeType, error: (e as Error).message });
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/nodes/:nodeType", async (req, res) => {
    const { nodeType } = req.params;
    const schema = registry.getNodeSchema(nodeType);
    if (schema) {
      // v2.7: virtual schemas (helpRequest/bugReport/proposal/reminder) are UI-only,
      // they MUST NOT be served via the generic node CRUD — their data lives in dedicated tables.
      if (schema.virtual) {
        return res.status(400).json({ error: `虚拟 schema (${nodeType}) 不支持通用节点 CRUD; 请改用其专用接口` });
      }
      // Express parses repeated query params as arrays; queryNodes does strict === on
      // string property values, so collapse each param to its first scalar value.
      const filter: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) filter[k] = Array.isArray(v) ? String(v[0]) : String(v);
      const nodes = await repo.queryNodes(nodeType, Object.keys(filter).length ? filter : undefined);
      // 私密攻关单全集过滤 (P1):list 也走与单条 GET 相同的访问控制,
      // 防止越权用户从列表里看到 私密=是 的标题/状态/创建人等元信息。
      if (nodeType === "attackTicket") {
        const reqUser = (req as any).user as { username?: string; displayName?: string } | undefined;
        return res.json(await filterAccessibleTickets(repo, nodes, reqUser));
      }
      return res.json(nodes);
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
    // v2.7: 虚拟 schema 拒绝 POST(数据存自己表里)
    const schemaForPost = registry.getNodeSchema(nodeType);
    if (schemaForPost?.virtual) {
      return res.status(400).json({ error: `虚拟 schema (${nodeType}) 不支持通用节点 CRUD; 请改用其专用接口` });
    }
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
    const actor = actorOf(req);
    const node = await repo.createNode(nodeType, req.body, actor);
    log.info("node.create", { nodeType, id: node.id, actor });
    if (nodeType === "contribution") {
      const ref = String(req.body?.["关联攻关单"] ?? "");
      if (ref) {
        const tickets = await repo.queryNodes("attackTicket");
        const target =
          tickets.find((t) => String(t.properties["攻关单号"] ?? "") === ref) ??
          tickets.find((t) => String(t.properties["标题"] ?? "") === ref);
        if (target) await repo.createEdge("CONTRIBUTED_TO", node.id, target.id, {}, actor);
      }
    }
    await syncRefEdges(repo, registry, node, req.body, actor);
    await syncAnchorEdges(repo, registry, node, req.body, actor);
    if (nodeType === "attackTicket") triggerPostSaveJobs(outbox, node.id);
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
    const actor = actorOf(req);
    const updated = await repo.updateNode(req.params.id, req.body, actor);
    log.info("node.update", { id: req.params.id, nodeType: cur.nodeType, actor });
    await syncRefEdges(repo, registry, updated, { ...cur.properties, ...req.body }, actor);
    await syncAnchorEdges(repo, registry, updated, { ...cur.properties, ...req.body }, actor);
    if (cur.nodeType === "attackTicket") triggerPostSaveJobs(outbox, req.params.id);
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
    const actor = actorOf(req);
    await repo.deleteNode(req.params.id, actor);
    log.info("node.delete", { id: req.params.id, actor });
    res.json({ ok: true });
  });

  r.get("/nodes/:id/progress", async (req, res) => res.json(await repo.listProgress(req.params.id)));
  r.post("/nodes/:id/progress", async (req, res) => {
    const { content, statusSnapshot } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });
    // body.actor 不再被信任(P1 防伪造);req.user 缺失才退回 "api"
    res.status(201).json(await repo.appendProgress(req.params.id, content, statusSnapshot, actorOf(req)));
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
    const actor = actorOf(req);
    const updated = await repo.updateNode(node.id, { 状态: toStatus }, actor);
    const content = `状态变更：${fromStatus || "(空)"}→${toStatus}` + (note ? `；${note}` : "");
    const progress = await repo.appendProgress(node.id, content, toStatus, actor);
    log.info("node.transition", { id: node.id, toStatus, actor });
    triggerPostSaveJobs(outbox, node.id);
    res.json({ node: updated, progress });
  });

  return r;
}
