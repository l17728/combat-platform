import { Router } from "express";
import type { Repository, DashboardSummary } from "@combat/shared";

const OPEN = new Set(["待响应", "处理中", "进行中"]);
const RESOLVED = new Set(["已解决", "已关闭"]);

export function makeDashboardRouter(repo: Repository): Router {
  const r = Router();
  r.get("/dashboard", (_req, res) => {
    const tks = repo.queryNodes("attackTicket");
    const byStatus: Record<string, number> = {};
    let open = 0, resolved = 0;
    for (const t of tks) {
      const s = String(t.properties["状态"] ?? "");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (OPEN.has(s)) open++;
      else if (RESOLVED.has(s)) resolved++;
    }
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
    const summary: DashboardSummary = {
      tickets: { total: tks.length, byStatus, open, resolved },
      contributions: { total: cs.length, topContributors },
      proposalsPending: repo.listProposals({ status: "待审批" }).length,
    };
    res.json(summary);
  });
  return r;
}
