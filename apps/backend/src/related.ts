import { Router } from "express";
import type { Repository } from "@combat/shared";
import { buildRelated, buildExpanded } from "./related-core.js";

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const { outgoing, incoming, coAnchored } = buildRelated(repo, id);
    // §32: parse ?depth=N (default 1, clamp to [1,5]); only emit `expanded` when >1
    // so depth=1 / absent responses stay byte-identical with prior behavior.
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const rawDepth = Number(first(req.query.depth));
    const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? Math.min(5, Math.floor(rawDepth)) : 1;
    const expanded = depth > 1 ? buildExpanded(repo, id, depth) : undefined;
    if (req.query.includeCandidates) {
      const cand = repo.listProposals({ status: "待审批" })
        .filter(p => p.sourceNodeId === id || p.targetNodeId === id)
        .map(p => {
          const otherId = p.sourceNodeId === id ? p.targetNodeId : p.sourceNodeId;
          return { proposalId: p.id, relationType: p.relationType,
            confidence: p.confidence, rationale: p.rationale, node: repo.getNode(otherId) };
        }).filter((x): x is typeof x & { node: NonNullable<typeof x.node> } => x.node != null);
      return res.json({ outgoing, incoming, candidates: cand, coAnchored,
        ...(expanded ? { expanded } : {}) });
    }
    res.json({ outgoing, incoming, coAnchored, ...(expanded ? { expanded } : {}) });
  });
  return r;
}
