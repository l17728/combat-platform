import { Router } from "express";
import type { Repository, DashboardSummary } from "@combat/shared";
import { listConflictRows } from "./conflicts.js";

// §2.3 canonical 状态 enum partitioned into open/resolved.
// Invariant: open + resolved == total ONLY when every ticket's 状态 falls in
// one of these sets — a future non-canonical or empty 状态 contributes to
// `tickets.total` but to neither open nor resolved.
const OPEN = new Set(["待响应", "处理中", "进行中"]);
const RESOLVED = new Set(["已解决", "已关闭"]);

export function makeDashboardRouter(repo: Repository): Router {
  const r = Router();
  r.get("/dashboard", (_req, res) => {
    const tks = repo.queryNodes("attackTicket");
    const byStatus: Record<string, number> = {};
    let open = 0, resolved = 0;
    for (const t of tks) {
      const s = String(t.properties["状态"] ?? "").trim();
      if (!s) continue; // skip blank 状态: don't pollute byStatus with a "" key
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (OPEN.has(s)) open++;
      else if (RESOLVED.has(s)) resolved++;
    }
    // contributions.total = raw node count (schema marks 贡献人 required, so
    // validateNode keeps blank-贡献人 records out); topContributors aggregates
    // by non-empty 贡献人 — these are different measures by design.
    const cs = repo.queryNodes("contribution");
    const cc = new Map<string, number>();
    for (const c of cs) {
      const p = String(c.properties["贡献人"] ?? "").trim();
      if (p) cc.set(p, (cc.get(p) ?? 0) + 1);
    }
    const topContributors = [...cc.entries()]
      .map(([贡献人, count]) => ({ 贡献人, count }))
      .sort((a, b) => b.count - a.count || (a.贡献人 < b.贡献人 ? -1 : a.贡献人 > b.贡献人 ? 1 : 0))
      .slice(0, 5);
    // §36: conflicts (count + top reasons) — reuse derived edge listing
    const cflRows = listConflictRows(repo);
    const reasonSet = new Set<string>();
    for (const r of cflRows) reasonSet.add(r.reason);
    const conflicts = { count: cflRows.length, topReasons: [...reasonSet].slice(0, 5) };

    // §36: today aggregate — progress entries today + distinct ticket count
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    let progressEntries = 0;
    const touched = new Set<string>();
    for (const p of repo.listAllProgress()) {
      const at = new Date(p.updatedAt);
      if (at >= today && at < tomorrow) { progressEntries++; touched.add(p.ownerId); }
    }
    const todaySection = { progressEntries, ticketsTouched: touched.size };

    // §36: recent activity — top 5 attackTickets by updatedAt desc
    const recentActivity = tks.slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, 5)
      .map(t => ({
        ticketId: t.id,
        标题: String(t.properties["标题"] ?? t.properties["攻关单号"] ?? t.id),
        状态: String(t.properties["状态"] ?? ""),
        lastChangedAt: t.updatedAt,
      }));

    const summary: DashboardSummary = {
      tickets: { total: tks.length, byStatus, open, resolved },
      contributions: { total: cs.length, topContributors },
      proposalsPending: repo.listProposals({ status: "待审批" }).length,
      conflicts,
      today: todaySection,
      recentActivity,
    };
    res.json(summary);
  });
  return r;
}
