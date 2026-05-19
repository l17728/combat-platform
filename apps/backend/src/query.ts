import { Router } from "express";
import type { Repository, SchemaRegistry, QueryHit } from "@combat/shared";
import { buildRelated } from "./related-core.js";

function summarize(p: Record<string, unknown>, id: string): string {
  // human-readable label: walk common identity keys across all configured
  // nodeTypes (attackTicket 标题/攻关单号, person name, contribution 贡献人,
  // releasePackage 版本号, weightFile 名称, anchor nodes key) → id fallback.
  return String(p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"]
    ?? p["name"] ?? p["贡献人"] ?? p["key"] ?? id);
}

export function makeQueryRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();

  r.get("/query/search", (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "q 必填" });
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const type = req.query.type ? String(first(req.query.type)) : undefined;
    const limit = Math.max(1, Math.min(200, Number(first(req.query.limit)) || 50));
    const needle = q.toLowerCase();
    const types = type ? [type] : registry.getConfig().nodeTypes.map(n => n.nodeType);
    const hits: (QueryHit & { _u: string })[] = [];
    for (const nt of types)
      for (const n of repo.queryNodes(nt)) {
        const hay = Object.values(n.properties).map(v => String(v)).join(" ").toLowerCase();
        let score = 0, i = hay.indexOf(needle);
        while (i !== -1) { score++; i = hay.indexOf(needle, i + needle.length); }
        if (score > 0) hits.push({ id: n.id, nodeType: n.nodeType,
          summary: summarize(n.properties, n.id), score, _u: n.updatedAt });
      }
    hits.sort((a, b) => b.score - a.score || (a._u < b._u ? 1 : a._u > b._u ? -1 : (a.id < b.id ? -1 : 1)));
    res.json(hits.slice(0, limit).map(({ _u, ...h }) => h));
  });

  r.get("/query/context/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    res.json({ node, related: buildRelated(repo, node.id), progress: repo.listProgress(node.id) });
  });

  return r;
}
