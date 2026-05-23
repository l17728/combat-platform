import { Router } from "express";
import type { Repository, SchemaRegistry, Role } from "@combat/shared";
import { PRIVILEGED_ROLES } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";
import { log } from "./logger.js";
import { syncConflicts } from "./conflicts.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";

/**
 * 节点保存后异步触发后台扫描任务（fire-and-forget）。
 * 仅对 attackTicket 变更调用，不阻塞 API 响应，失败只写日志。
 * scanAndCreateReminders 同时需要 registry，一并触发。
 */
function triggerPostSaveJobs(repo: Repository, registry: SchemaRegistry): void {
  // Skip in test environment to avoid interfering with tests that explicitly
  // call scan endpoints (scans are idempotent — auto-trigger would consume the
  // first run, making the explicit test call return 0).
  if (process.env.NODE_ENV === "test") return;
  setImmediate(() => {
    try { syncConflicts(repo); } catch (e) { log.warn("post_save.conflicts.fail", { error: (e as Error).message }); }
    try { scanEscalation(repo); } catch (e) { log.warn("post_save.escalation.fail", { error: (e as Error).message }); }
    try { scanAndCreateReminders(repo, registry); } catch (e) { log.warn("post_save.reminders.fail", { error: (e as Error).message }); }
  });
}

// §50: gate 贡献等级 标定 to privileged roles. Absent X-Role header = trusted
// system access (CLI / import / tests) → allowed. Returns an error string to
// send as 403, or null when allowed.
function gradeGate(req: { headers: Record<string, unknown>; body: unknown }, nodeType: string): string | null {
  if (nodeType !== "contribution") return null;
  const grade = String((req.body as Record<string, unknown>)?.["贡献等级"] ?? "").trim();
  if (!grade) return null;
  const role = req.headers["x-role"];
  if (role === undefined) return null; // trusted (no role asserted)
  if (PRIVILEGED_ROLES.includes(String(role) as Role)) return null;
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
  r.patch("/schema/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(nodeType)) {
      return res.status(400).json({ error: "nodeType 格式非法" });
    }
    try {
      const s = registry.applyFieldOp(nodeType, req.body);
      repo.logAudit({ action: `SCHEMA_${req.body?.op}`, entityType: "schema",
        entityId: nodeType, changes: req.body, actor: "api" });
      log.info("schema.fieldOp", { nodeType, op: req.body?.op });
      res.json(s);
    } catch (e) {
      log.warn("schema.fieldOp.fail", { nodeType, error: (e as Error).message });
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    if (registry.getNodeSchema(nodeType)) {
      // Express parses repeated query params as arrays; queryNodes does strict === on
      // string property values, so collapse each param to its first scalar value.
      const filter: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) filter[k] = Array.isArray(v) ? String(v[0]) : String(v);
      return res.json(repo.queryNodes(nodeType, Object.keys(filter).length ? filter : undefined));
    }
    const single = repo.getNode(nodeType);
    return single ? res.json(single) : res.status(404).json({ error: "not found" });
  });

  r.post("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    const gate = gradeGate(req, nodeType);
    if (gate) return res.status(403).json({ error: gate });
    const v = registry.validateNode(nodeType, req.body);
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    const node = repo.createNode(nodeType, req.body, "api");
    log.info("node.create", { nodeType, id: node.id });
    if (nodeType === "contribution") {
      const ref = String(req.body?.["关联攻关单"] ?? "");
      if (ref) {
        const tickets = repo.queryNodes("attackTicket");
        const target = tickets.find(t => String(t.properties["攻关单号"] ?? "") === ref)
          ?? tickets.find(t => String(t.properties["标题"] ?? "") === ref);
        if (target) repo.createEdge("CONTRIBUTED_TO", node.id, target.id, {}, "api");
      }
    }
    syncRefEdges(repo, registry, node, req.body, "api");
    syncAnchorEdges(repo, registry, node, req.body, "api");
    if (nodeType === "attackTicket") triggerPostSaveJobs(repo, registry);
    res.status(201).json(node);
  });

  // Partial/merge update only (no-DDL JSON store): body keys are merged into
  // existing properties; field removal is intentionally unsupported in Phase 1.
  r.put("/nodes/:id", (req, res) => {
    const cur = repo.getNode(req.params.id);
    if (!cur) return res.status(404).json({ error: "not found" });
    const gate = gradeGate(req, cur.nodeType);
    if (gate) return res.status(403).json({ error: gate });
    const v = registry.validateNode(cur.nodeType, { ...cur.properties, ...req.body });
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    const updated = repo.updateNode(req.params.id, req.body, "api");
    log.info("node.update", { id: req.params.id, nodeType: cur.nodeType });
    syncRefEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");
    syncAnchorEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");
    if (cur.nodeType === "attackTicket") triggerPostSaveJobs(repo, registry);
    res.json(updated);
  });

  r.delete("/nodes/:id", (req, res) => {
    if (!repo.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    repo.deleteNode(req.params.id, "api");
    log.info("node.delete", { id: req.params.id });
    res.json({ ok: true });
  });

  r.get("/nodes/:id/progress", (req, res) => res.json(repo.listProgress(req.params.id)));
  r.post("/nodes/:id/progress", (req, res) => {
    const { content, statusSnapshot, actor } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });
    res.status(201).json(repo.appendProgress(req.params.id, content, statusSnapshot, actor ?? "api"));
  });

  // §41: atomic state transition — update 状态 + append a status-snapshotted
  // ProgressLog so every status change is traceable in the append-only series.
  r.post("/nodes/:id/transition", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    if (node.nodeType !== "attackTicket") return res.status(400).json({ error: "仅攻关单支持状态流转" });
    const toStatus = String(req.body?.toStatus ?? "").trim();
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const schema = registry.getNodeSchema(node.nodeType);
    const statusField = schema?.fields.find(f => f.id === "状态");
    const allowed = statusField?.enumValues ?? [];
    if (!toStatus || !allowed.includes(toStatus))
      return res.status(400).json({ error: `非法目标状态：${toStatus || "(空)"}` });
    const fromStatus = String(node.properties["状态"] ?? "");
    const updated = repo.updateNode(node.id, { 状态: toStatus }, "api");
    const content = `状态变更：${fromStatus || "(空)"}→${toStatus}` + (note ? `；${note}` : "");
    const progress = repo.appendProgress(node.id, content, toStatus, "api");
    log.info("node.transition", { id: node.id, toStatus });
    triggerPostSaveJobs(repo, registry);
    res.json({ node: updated, progress });
  });

  return r;
}
