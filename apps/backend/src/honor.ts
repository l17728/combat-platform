import { Router } from "express";
import type { Repository } from "@combat/shared";

// Unknown/blank level (incl. schema-optional omission) defaults to 普通-equivalent weight 1.
const WEIGHT: Record<string, number> = { 普通: 1, 关键: 3, 核心: 8 };

export function makeHonorRouter(repo: Repository): Router {
  const r = Router();

  r.get("/honor/leaderboard", async (req, res) => {
    const period = typeof req.query.period === "string" ? req.query.period : "";
    const groupBy = typeof req.query.groupBy === "string" ? req.query.groupBy : "";
    const rows = (await repo.queryNodes("contribution")).filter(
      (c) => !period || String(c.properties["周期"] ?? "") === period
    );

    // §51.4: team aggregation — resolve each contributor name to their person's 团队.
    if (groupBy === "team") {
      const teamByName = new Map<string, string>();
      for (const p of await repo.queryNodes("person")) {
        const name = String(p.properties["姓名"] ?? p.properties["name"] ?? "");
        if (name) teamByName.set(name, String(p.properties["团队"] ?? "").trim());
      }
      const byTeam: Record<string, { team: string; score: number; 贡献数: number }> = {};
      for (const c of rows) {
        const person = String(c.properties["贡献人"] ?? "");
        if (!person) continue;
        const team = teamByName.get(person) || "未分组";
        const level = String(c.properties["贡献等级"] ?? "");
        const e = (byTeam[team] ??= { team, score: 0, 贡献数: 0 });
        e.贡献数 += 1;
        e.score += WEIGHT[level] ?? 1;
      }
      return res.json(Object.values(byTeam).sort((a, b) => b.score - a.score));
    }

    const by: Record<
      string,
      { 贡献人: string; score: number; 贡献数: number; byLevel: Record<string, number>; byType: Record<string, number> }
    > = {};
    for (const c of rows) {
      const person = String(c.properties["贡献人"] ?? "");
      if (!person) continue;
      const level = String(c.properties["贡献等级"] ?? "");
      const type = String(c.properties["贡献类型"] ?? "");
      const e = (by[person] ??= { 贡献人: person, score: 0, 贡献数: 0, byLevel: {}, byType: {} });
      e.贡献数 += 1;
      e.score += WEIGHT[level] ?? 1;
      if (level) e.byLevel[level] = (e.byLevel[level] ?? 0) + 1;
      if (type) e.byType[type] = (e.byType[type] ?? 0) + 1;
    }
    res.json(Object.values(by).sort((a, b) => b.score - a.score));
  });

  r.get("/honor/person/:name", async (req, res) => {
    const name = req.params.name;
    const contributions = (await repo.queryNodes("contribution")).filter(
      (c) => String(c.properties["贡献人"] ?? "") === name
    );
    // Preload all CONTRIBUTED_TO edges to avoid N+1
    const edgeMap = new Map<string, string>();
    for (const e of await repo.queryEdges({ edgeType: "CONTRIBUTED_TO" })) {
      if (!edgeMap.has(e.sourceId)) edgeMap.set(e.sourceId, e.targetId);
    }
    const list = contributions.map((c) => ({
      contribution: c,
      attackTicketId: edgeMap.get(c.id) ?? null,
    }));
    res.json({ 贡献人: name, contributions: list });
  });

  return r;
}
