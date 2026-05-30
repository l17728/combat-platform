import { Router } from "express";
import type { Repository, DailyReport, DailyReportSection, DailyReportPublishResult, ProgressLog } from "@combat/shared";
import { localDateOf, localToday } from "./date-util.js";
import { log } from "./logger.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayUTC = () => localToday();

/** §51.1: tickets with progress on `date` (Asia/Shanghai calendar day) get
 *  日报发布数量 +1, audited. Returns counts. */
async function publishDailyReport(repo: Repository, date: string, actor: string): Promise<DailyReportPublishResult> {
  let ticketsTouched = 0;
  const allProgress = await repo.listAllProgress();
  const progressByOwner = new Map<string, ProgressLog[]>();
  for (const p of allProgress) {
    let arr = progressByOwner.get(p.ownerId);
    if (!arr) { arr = []; progressByOwner.set(p.ownerId, arr); }
    arr.push(p);
  }
  for (const t of await repo.queryNodes("attackTicket")) {
    const hasProgress = (progressByOwner.get(t.id) ?? []).some(p => localDateOf(p.updatedAt) === date);
    if (!hasProgress) continue;
    ticketsTouched++;
    const cur = Number(t.properties["日报发布数量"] ?? 0) || 0;
    await repo.updateNode(t.id, { 日报发布数量: cur + 1 }, actor);
    await repo.logAudit({ action: "DAILY_REPORT_PUBLISH", entityType: "node", entityId: t.id,
      changes: { date, 日报发布数量: cur + 1 }, actor });
  }
  log.info("daily_report.publish", { date, ticketsTouched, published: ticketsTouched });
  return { date, ticketsTouched, published: ticketsTouched };
}

export function makeDailyReportRouter(repo: Repository): Router {
  const r = Router();

  r.post("/daily-report/publish", async (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const raw = String(first(req.query.date) ?? "");
    const date = ISO_DATE.test(raw) ? raw : todayUTC();
    res.json(await publishDailyReport(repo, date, "api"));
  });
  r.get("/daily-report", async (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const raw = String(first(req.query.date) ?? "");
    const date = ISO_DATE.test(raw) ? raw : todayUTC();
    const tickets = await repo.queryNodes("attackTicket");
    const allProgress = await repo.listAllProgress();
    const progressByOwner = new Map<string, ProgressLog[]>();
    for (const p of allProgress) {
      let arr = progressByOwner.get(p.ownerId);
      if (!arr) { arr = []; progressByOwner.set(p.ownerId, arr); }
      arr.push(p);
    }
    const sections: DailyReportSection[] = [];
    for (const t of tickets) {
      const todays = (progressByOwner.get(t.id) ?? [])
        .filter(p => localDateOf(p.updatedAt) === date)
        .sort((a, b) => a.seqNo - b.seqNo);
      if (todays.length === 0) continue;
      const last = todays[todays.length - 1];
      sections.push({
        ticketId: t.id,
        标题: String(t.properties["标题"] ?? t.id),
        latestStatus: String(last.statusSnapshot ?? t.properties["状态"] ?? ""),
        entries: todays.map(p => ({
          seqNo: p.seqNo, statusSnapshot: String(p.statusSnapshot ?? ""),
          content: p.content, updatedBy: p.updatedBy, at: p.updatedAt,
        })),
      });
    }
    const openByStatus: Record<string, number> = {};
    for (const t of tickets) {
      const s = String(t.properties["状态"] ?? "").trim();
      if (s) openByStatus[s] = (openByStatus[s] ?? 0) + 1;
    }
    const out: DailyReport = {
      date, sections,
      summary: {
        ticketsTouched: sections.length,
        entriesTotal: sections.reduce((a, s) => a + s.entries.length, 0),
        openByStatus,
      },
    };
    res.json(out);
  });
  return r;
}
