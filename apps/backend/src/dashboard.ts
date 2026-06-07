import { Router } from "express";
import type { Repository, DashboardSummary } from "@combat/shared";
import { listConflictRows } from "./conflicts.js";
import { filterAccessibleTickets } from "./private-tickets.js";

// §2.3 canonical 状态 enum partitioned into open/resolved.
// Invariant: open + resolved == total ONLY when every ticket's 状态 falls in
// one of these sets — a future non-canonical or empty 状态 contributes to
// `tickets.total` but to neither open nor resolved.
const OPEN = new Set(["待响应", "处理中", "进行中"]);
const RESOLVED = new Set(["已解决", "已关闭"]);

export function makeDashboardRouter(repo: Repository): Router {
  const r = Router();
  r.get("/dashboard", async (req, res) => {
    try {
      const reqUser = (req as any).user as { username?: string; displayName?: string } | undefined;
      const allTks = await repo.queryNodes("attackTicket");
      const tks = await filterAccessibleTickets(repo, allTks, reqUser);
      const byStatus: Record<string, number> = {};
      let open = 0,
        resolved = 0;
      const TOP_N = 5;
      const top: typeof tks = [];
      for (const t of tks) {
        const s = String(t.properties["状态"] ?? "").trim();
        if (s) {
          byStatus[s] = (byStatus[s] ?? 0) + 1;
          if (OPEN.has(s)) open++;
          else if (RESOLVED.has(s)) resolved++;
        }
        if (top.length < TOP_N) {
          top.push(t);
          if (top.length === TOP_N)
            top.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
        } else if (t.updatedAt > top[TOP_N - 1].updatedAt) {
          top[TOP_N - 1] = t;
          top.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
        }
      }
      const recentActivity = top.map((t) => ({
        ticketId: t.id,
        标题: String(t.properties["标题"] ?? t.properties["攻关单号"] ?? t.id),
        状态: String(t.properties["状态"] ?? ""),
        lastChangedAt: t.updatedAt,
      }));

      const cs = await repo.queryNodes("contribution");
      const cc = new Map<string, number>();
      for (const c of cs) {
        const p = String(c.properties["贡献人"] ?? "").trim();
        if (p) cc.set(p, (cc.get(p) ?? 0) + 1);
      }
      const topContributors = [...cc.entries()]
        .map(([贡献人, count]) => ({ 贡献人, count }))
        .sort((a, b) => b.count - a.count || (a.贡献人 < b.贡献人 ? -1 : a.贡献人 > b.贡献人 ? 1 : 0))
        .slice(0, 5);
      const cflRows = await listConflictRows(repo, tks);
      const reasonSet = new Set<string>();
      for (const r of cflRows) reasonSet.add(r.reason);
      const conflicts = { count: cflRows.length, topReasons: [...reasonSet].slice(0, 5) };

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      let progressEntries = 0;
      const touched = new Set<string>();
      for (const p of await repo.listAllProgress()) {
        const at = new Date(p.updatedAt);
        if (at >= today && at < tomorrow) {
          progressEntries++;
          touched.add(p.ownerId);
        }
      }
      const todaySection = { progressEntries, ticketsTouched: touched.size };

      let proposalsPending = 0;
      try {
        proposalsPending = (await repo.listProposals({ status: "待审批" })).length;
      } catch {
        // proposals 表可能缺少 tenant_id 列，降级为 0
      }

      const summary: DashboardSummary = {
        tickets: { total: tks.length, byStatus, open, resolved },
        contributions: { total: cs.length, topContributors },
        proposalsPending,
        conflicts,
        today: todaySection,
        recentActivity,
      };
      res.json(summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: `Dashboard 加载失败: ${msg}` });
    }
  });
  return r;
}
