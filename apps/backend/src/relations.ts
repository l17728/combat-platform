import { Router } from "express";
import type { Repository, ManualLinkView, GraphNode } from "@combat/shared";

const MANUAL_EDGE = "RELATES_TO";

// §52: list manual ad-hoc links touching a node (both directions), each mapped to
// the peer node + 备注 + optional source field. This is the union piece surfaced
// in /api/related alongside structured edges.
export async function listManualLinks(repo: Repository, nodeId: string): Promise<ManualLinkView[]> {
  const out: ManualLinkView[] = [];
  for (const e of await repo.queryEdges({ sourceId: nodeId, edgeType: MANUAL_EDGE })) {
    const node = await repo.getNode(e.targetId);
    if (node) out.push({ edgeId: e.id, direction: "out", sourceField: e.properties["sourceField"] ? String(e.properties["sourceField"]) : undefined, reason: String(e.properties["reason"] ?? ""), node });
  }
  for (const e of await repo.queryEdges({ targetId: nodeId, edgeType: MANUAL_EDGE })) {
    const node = await repo.getNode(e.sourceId);
    if (node) out.push({ edgeId: e.id, direction: "in", sourceField: e.properties["sourceField"] ? String(e.properties["sourceField"]) : undefined, reason: String(e.properties["reason"] ?? ""), node });
  }
  return out;
}

export function makeRelationsRouter(repo: Repository): Router {
  const r = Router();

  // create a manual annotated link between two specific records (任意语义, 不依赖 schema)
  r.post("/relations/manual", async (req, res) => {
    const sourceId = String(req.body?.sourceId ?? "");
    const targetId = String(req.body?.targetId ?? "");
    const reason = String(req.body?.reason ?? "").trim();
    const sourceField = req.body?.sourceField ? String(req.body.sourceField) : undefined;
    if (!sourceId || !targetId) return res.status(400).json({ error: "sourceId 与 targetId 必填" });
    if (sourceId === targetId) return res.status(400).json({ error: "不能关联自身" });
    const s: GraphNode | null = await repo.getNode(sourceId), t: GraphNode | null = await repo.getNode(targetId);
    if (!s || !t) return res.status(404).json({ error: "节点不存在" });
    const edge = await repo.createEdge(MANUAL_EDGE, sourceId, targetId, { reason, sourceField, manual: true }, "ui");
    res.status(201).json({ edgeId: edge.id, sourceId, targetId, sourceField, reason });
  });

  r.get("/relations/manual", async (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const nodeId = String(first(req.query.nodeId) ?? "");
    if (!nodeId) return res.status(400).json({ error: "nodeId 必填" });
    res.json(await listManualLinks(repo, nodeId));
  });

  r.delete("/relations/manual/:edgeId", async (req, res) => {
    const ok = await repo.deleteEdgeById(req.params.edgeId, "ui");
    if (!ok) return res.status(404).json({ error: "关联不存在" });
    res.json({ ok: true });
  });

  return r;
}
