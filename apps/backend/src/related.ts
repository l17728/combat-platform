import { Router } from "express";
import type { Repository } from "@combat/shared";

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const out = repo.queryEdges({ sourceId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.targetId) }))
      .filter(x => x.node);
    const inc = repo.queryEdges({ targetId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.sourceId) }))
      .filter(x => x.node);
    if (req.query.includeCandidates) {
      const cand = repo.listProposals({ status: "待审批" })
        .filter(p => p.sourceNodeId === id || p.targetNodeId === id)
        .map(p => {
          const otherId = p.sourceNodeId === id ? p.targetNodeId : p.sourceNodeId;
          return { proposalId: p.id, relationType: p.relationType,
            confidence: p.confidence, rationale: p.rationale, node: repo.getNode(otherId) };
        }).filter(x => x.node);
      return res.json({ outgoing: out, incoming: inc, candidates: cand });
    }
    res.json({ outgoing: out, incoming: inc });
  });
  return r;
}
