import { Router } from "express";
import type { Repository } from "@combat/shared";

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const out = repo.queryEdges({ sourceId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), node: repo.getNode(e.targetId) }))
      .filter(x => x.node);
    const inc = repo.queryEdges({ targetId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), node: repo.getNode(e.sourceId) }))
      .filter(x => x.node);
    res.json({ outgoing: out, incoming: inc });
  });
  return r;
}
