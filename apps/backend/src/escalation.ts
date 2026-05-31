import { Router } from "express";
import type { Repository, EscalationConfig, EscalationScanResult } from "@combat/shared";
import { log } from "./logger.js";
import { createNotificationSafe, type NotificationsRepo } from "./notifications.js";

const ACTIVE = new Set(["待响应", "处理中", "进行中"]);
const DEFAULT_CONFIG: EscalationConfig = {
  rules: [
    { 事件级别: "P1", slaHours: 2, 上升角色: "运维Leader" },
    { 事件级别: "P2", slaHours: 8, 上升角色: "运维Leader" },
    { 事件级别: "P3", slaHours: 24, 上升角色: "值班接口人" },
    { 事件级别: "P4A", slaHours: 4, 上升角色: "值班接口人" },
  ],
};

async function readConfig(repo: Repository): Promise<EscalationConfig> {
  const raw = await repo.getSetting("escalation");
  if (!raw) return DEFAULT_CONFIG;
  try {
    return JSON.parse(raw) as EscalationConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * §48: scan active attackTickets; for any whose age exceeds its 事件级别 SLA and
 * which has not been escalated yet (no prior ESCALATE audit), record an ESCALATE
 * audit + an ESCALATED_TO edge to the current owner (if resolvable). Idempotent
 * via the audit check — re-scanning does not double-escalate.
 */
export async function scanEscalation(
  repo: Repository,
  notifications?: NotificationsRepo
): Promise<EscalationScanResult> {
  const cfg = await readConfig(repo);
  const byLevel = new Map(cfg.rules.map((r) => [r.事件级别, r]));
  const now = Date.now();
  let overdue = 0,
    escalated = 0;
  // Preload to avoid N+1 inside the loop
  const escalatedIds = new Set((await repo.listAuditLog({ action: "ESCALATE" })).map((a) => a.entityId));
  const allRefEdges = await repo.queryEdges({ edgeType: "REF" });
  for (const t of await repo.queryNodes("attackTicket")) {
    const status = String(t.properties["状态"] ?? "");
    if (!ACTIVE.has(status)) continue;
    const lvl = String(t.properties["事件级别"] ?? "").trim();
    const rule = byLevel.get(lvl);
    if (!rule) continue;
    const ageMs = now - new Date(t.createdAt).getTime();
    if (ageMs <= rule.slaHours * 3600 * 1000) continue;
    overdue++;
    const already = escalatedIds.has(t.id);
    if (already) continue;
    // resolve current owner person via REF edge (field 当前处理人) for the ESCALATED_TO edge
    const ownerRef = allRefEdges
      .filter((e) => e.sourceId === t.id)
      .find((e) => String(e.properties["field"]) === "当前处理人");
    if (ownerRef)
      await repo.createEdge(
        "ESCALATED_TO",
        t.id,
        ownerRef.targetId,
        { level: lvl, 上升角色: rule.上升角色, at: new Date().toISOString() },
        "system"
      );
    await repo.logAudit({
      action: "ESCALATE",
      entityType: "node",
      entityId: t.id,
      changes: {
        事件级别: lvl,
        slaHours: rule.slaHours,
        上升角色: rule.上升角色,
        ageHours: Math.round(ageMs / 3600000),
      },
      actor: "system",
    });
    log.warn("escalation.triggered", { ticketId: t.id, 上升角色: rule.上升角色 });
    if (notifications) {
      const title = String(t.properties["标题"] ?? t.id.slice(0, 8));
      const owner = String(t.properties["当前处理人"] ?? "").trim();
      const creator = String(t.properties["创建人"] ?? "").trim();
      const recipients = new Set<string>();
      if (owner) recipients.add(owner);
      if (creator) recipients.add(creator);
      // 兜底:无可识别接收人时,推送给 admin 收件箱(避免逾期通知静默丢失)
      if (recipients.size === 0) recipients.add("admin");
      for (const userId of recipients) {
        await createNotificationSafe(notifications, {
          userId,
          kind: "escalation",
          title: `攻关单已超期升级 (${lvl})`,
          body: `「${title}」已超过 ${rule.slaHours}h SLA,升级至「${rule.上升角色}」`,
          link: `/attack/${t.id}`,
          sourceEntityId: t.id,
        });
      }
    }
    escalated++;
  }
  log.info("escalation.scan.done", { escalated });
  return { overdue, escalated };
}

export function makeEscalationRouter(repo: Repository, notifications?: NotificationsRepo): Router {
  const r = Router();
  r.get("/escalation/config", async (_req, res) => res.json(await readConfig(repo)));
  r.put("/escalation/config", async (req, res) => {
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : null;
    if (!rules) return res.status(400).json({ error: "rules 数组必填" });
    await repo.setSetting("escalation", JSON.stringify({ rules }), (req as any).user?.username ?? "api");
    res.json(await readConfig(repo));
  });
  r.post("/escalation/scan", async (_req, res) => res.json(await scanEscalation(repo, notifications)));
  return r;
}
