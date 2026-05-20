import { Router } from "express";
import type { Repository, DailyReport, DailyReportSection } from "@combat/shared";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayUTC = () => new Date().toISOString().slice(0, 10);

export function makeDailyReportRouter(repo: Repository): Router {
  const r = Router();
  r.get("/daily-report", (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const raw = String(first(req.query.date) ?? "");
    const date = ISO_DATE.test(raw) ? raw : todayUTC();
    const tickets = repo.queryNodes("attackTicket");
    const sections: DailyReportSection[] = [];
    for (const t of tickets) {
      const todays = repo.listProgress(t.id)
        .filter(p => p.updatedAt.startsWith(date))
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
