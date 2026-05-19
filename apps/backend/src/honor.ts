import { Router } from "express";
import type { Repository } from "@combat/shared";

// Unknown/blank level (incl. schema-optional omission) defaults to 普通-equivalent weight 1.
const WEIGHT: Record<string, number> = { 普通: 1, 关键: 3, 核心: 8 };

export function makeHonorRouter(repo: Repository): Router {
  const r = Router();

  r.get("/honor/leaderboard", (req, res) => {
    const period = typeof req.query.period === "string" ? req.query.period : "";
    const rows = repo.queryNodes("contribution")
      .filter(c => !period || String(c.properties["周期"] ?? "") === period);
    const by: Record<string, { 贡献人: string; score: number; 贡献数: number;
      byLevel: Record<string, number>; byType: Record<string, number> }> = {};
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

  r.get("/honor/person/:name", (req, res) => {
    const name = req.params.name;
    const list = repo.queryNodes("contribution")
      .filter(c => String(c.properties["贡献人"] ?? "") === name)
      .map(c => ({
        contribution: c,
        attackTicketId: repo.queryEdges({ sourceId: c.id, edgeType: "CONTRIBUTED_TO" })[0]?.targetId ?? null,
      }));
    res.json({ 贡献人: name, contributions: list });
  });

  return r;
}
