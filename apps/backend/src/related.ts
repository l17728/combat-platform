import { Router } from "express";
import type { Repository } from "@combat/shared";
import { buildRelated } from "./related-core.js";

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const { outgoing, incoming, coAnchored } = buildRelated(repo, id);
    if (req.query.includeCandidates) {
      const cand = repo.listProposals({ status: "待审批" })
        .filter(p => p.sourceNodeId === id || p.targetNodeId === id)
        .map(p => {
          const otherId = p.sourceNodeId === id ? p.targetNodeId : p.sourceNodeId;
          return { proposalId: p.id, relationType: p.relationType,
            confidence: p.confidence, rationale: p.rationale, node: repo.getNode(otherId) };
        }).filter(x => x.node);
      return res.json({ outgoing, incoming, candidates: cand, coAnchored });
    }
    res.json({ outgoing, incoming, coAnchored });
  });
  return r;
}
