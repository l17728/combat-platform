import { Router } from "express";
import type { Repository, ConflictItem, ConflictEdgeType } from "@combat/shared";
import { buildRelated, buildExpanded } from "./related-core.js";
import { listManualLinks } from "./relations.js";

/**
 * §33: Collect outgoing CONFLICTS_WITH / OVERLAPS_WITH edges from a node.
 * Returned as ConflictItem[]; emitted into RelatedResult.conflicts only when non-empty
 * (1-hop response stays byte-identical when there are no conflict edges).
 */
async function buildConflicts(repo: Repository, id: string): Promise<ConflictItem[]> {
  const out: ConflictItem[] = [];
  for (const edgeType of ["CONFLICTS_WITH", "OVERLAPS_WITH"] as ConflictEdgeType[]) {
    for (const e of await repo.queryEdges({ sourceId: id, edgeType })) {
      const peer = await repo.getNode(e.targetId);
      if (!peer) continue;
      out.push({ edgeType, reason: String(e.properties["reason"] ?? ""), node: peer });
    }
  }
  return out;
}

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", async (req, res) => {
    const node = await repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const { outgoing, incoming, coAnchored } = await buildRelated(repo, id);
    // §32: parse ?depth=N (default 1, clamp to [1,5]); only emit `expanded` when >1
    // so depth=1 / absent responses stay byte-identical with prior behavior.
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const rawDepth = Number(first(req.query.depth));
    const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? Math.min(5, Math.floor(rawDepth)) : 1;
    const expanded = depth > 1 ? await buildExpanded(repo, id, depth) : undefined;
    // §33: conflict items — only emitted when present (back-compat).
    const conflictsRaw = await buildConflicts(repo, id);
    const conflicts = conflictsRaw.length > 0 ? conflictsRaw : undefined;
    // §52: manual ad-hoc annotated links (备注链接) — union piece, only when present.
    const mlRaw = await listManualLinks(repo, id);
    const manualLinks = mlRaw.length > 0 ? mlRaw : undefined;
    if (req.query.includeCandidates) {
      const proposals = (await repo.listProposals({ status: "待审批" })).filter(
        (p) => p.sourceNodeId === id || p.targetNodeId === id
      );
      const cand: {
        proposalId: string;
        relationType: string;
        confidence: number;
        rationale: string;
        node: NonNullable<Awaited<ReturnType<Repository["getNode"]>>>;
      }[] = [];
      for (const p of proposals) {
        const otherId = p.sourceNodeId === id ? p.targetNodeId : p.sourceNodeId;
        const peer = await repo.getNode(otherId);
        if (peer)
          cand.push({
            proposalId: p.id,
            relationType: p.relationType,
            confidence: p.confidence,
            rationale: p.rationale,
            node: peer,
          });
      }
      return res.json({
        outgoing,
        incoming,
        candidates: cand,
        coAnchored,
        ...(expanded ? { expanded } : {}),
        ...(conflicts ? { conflicts } : {}),
        ...(manualLinks ? { manualLinks } : {}),
      });
    }
    res.json({
      outgoing,
      incoming,
      coAnchored,
      ...(expanded ? { expanded } : {}),
      ...(conflicts ? { conflicts } : {}),
      ...(manualLinks ? { manualLinks } : {}),
    });
  });
  return r;
}
