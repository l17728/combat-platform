import { Router } from "express";
import type { Repository, SchemaRegistry, ChannelAdapter } from "@combat/shared";
import { scanReminders } from "./rules.js";
import { StubChannelAdapter } from "./channel.js";
import { log } from "./logger.js";

const WINDOW_MS = 7 * 86400000;

/** Scan + create reminders with 7-day dedup window. Returns count created. Reused by jobs:tick. */
export function scanAndCreateReminders(repo: Repository, registry: SchemaRegistry): number {
  const now = Date.now();
  const recent = new Set(repo.listReminders()
    .filter(e => (now - Date.parse(e.createdAt)) <= WINDOW_MS)
    .map(e => `${e.kind}|${e.ticketId}|${e.recipientPersonId ?? ""}`));
  let created = 0;
  for (const d of scanReminders(repo, registry, now)) {
    const k = `${d.kind}|${d.ticketId}|${d.recipientPersonId ?? ""}`;
    if (recent.has(k)) continue;
    recent.add(k);
    repo.createReminder(d, "scan");
    created++;
  }
  log.info("reminders.scan.done", { created });
  return created;
}

export function makeRemindersRouter(repo: Repository, registry: SchemaRegistry,
                                    channel: ChannelAdapter = new StubChannelAdapter()): Router {
  const r = Router();

  r.post("/reminders/scan", (_req, res) => {
    res.json({ created: scanAndCreateReminders(repo, registry) });
  });

  r.get("/reminders", (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(repo.listReminders(status ? { status: status as any } : {}));
  });

  function decide(id: string, action: "send" | "ignore", decidedBy: string, res: any) {
    const p = repo.getReminder(id);
    if (!p) return res.status(404).json({ error: "reminder not found" });
    if (p.status !== "待发送") return res.status(409).json({ error: `已决策(${p.status})不可重复` });
    if (!decidedBy || typeof decidedBy !== "string")
      return res.status(400).json({ error: "decidedBy 必填" });
    if (action === "send") {
      channel.send(p, decidedBy);
      return res.json(repo.updateReminderStatus(p.id, "已发送", decidedBy, decidedBy));
    }
    return res.json(repo.updateReminderStatus(p.id, "已忽略", decidedBy, decidedBy));
  }

  r.post("/reminders/:id/send", (req, res) =>
    decide(req.params.id, "send", String(req.body?.decidedBy ?? ""), res));
  r.post("/reminders/:id/ignore", (req, res) =>
    decide(req.params.id, "ignore", String(req.body?.decidedBy ?? ""), res));

  return r;
}
