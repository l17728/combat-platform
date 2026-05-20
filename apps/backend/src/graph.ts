import { Router } from "express";
import type { Repository, GraphSnapshot, GraphSnapshotNode, GraphSnapshotEdge, GraphNode } from "@combat/shared";

const VIZ_EDGE_TYPES = new Set(["REF", "ANCHORED_TO", "CONFLICTS_WITH", "OVERLAPS_WITH"]);

function labelOf(n: GraphNode): string {
  const p = n.properties;
  return String(p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"] ?? p["name"] ?? p["贡献人"] ?? p["key"] ?? n.id);
}

/**
 * §38: BFS snapshot for graph visualization. Walks REF / ANCHORED_TO /
 * CONFLICTS_WITH / OVERLAPS_WITH edges (out + in) up to `maxDepth` hops from
 * `rootId`. Nodes dedup by id; edges dedup by source+target+edgeType.
 * Result is centered on rootId so the UI can lay out concentric rings.
 */
export function buildSnapshot(repo: Repository, rootId: string, maxDepth: number): GraphSnapshot {
  const nodes = new Map<string, GraphSnapshotNode>();
  const edgeKey = (s: string, t: string, k: string) => `${s}->${t}:${k}`;
  const edges = new Map<string, GraphSnapshotEdge>();
  const root = repo.getNode(rootId);
  if (!root) return { rootId, nodes: [], edges: [] };
  nodes.set(root.id, { id: root.id, nodeType: root.nodeType, label: labelOf(root) });
  if (maxDepth <= 0) return { rootId, nodes: [...nodes.values()], edges: [] };

  type Q = { id: string; depth: number };
  const queue: Q[] = [{ id: root.id, depth: 0 }];
  const seen = new Set<string>([root.id]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;
    const out = repo.queryEdges({ sourceId: cur.id }).filter(e => VIZ_EDGE_TYPES.has(e.edgeType));
    const inc = repo.queryEdges({ targetId: cur.id }).filter(e => VIZ_EDGE_TYPES.has(e.edgeType));
    for (const e of out) {
      const peer = repo.getNode(e.targetId);
      if (!peer) continue;
      const key = edgeKey(cur.id, peer.id, e.edgeType);
      if (!edges.has(key)) edges.set(key, { source: cur.id, target: peer.id, edgeType: e.edgeType });
      if (!nodes.has(peer.id)) nodes.set(peer.id, { id: peer.id, nodeType: peer.nodeType, label: labelOf(peer) });
      if (!seen.has(peer.id)) { seen.add(peer.id); queue.push({ id: peer.id, depth: cur.depth + 1 }); }
    }
    for (const e of inc) {
      const peer = repo.getNode(e.sourceId);
      if (!peer) continue;
      const key = edgeKey(peer.id, cur.id, e.edgeType);
      if (!edges.has(key)) edges.set(key, { source: peer.id, target: cur.id, edgeType: e.edgeType });
      if (!nodes.has(peer.id)) nodes.set(peer.id, { id: peer.id, nodeType: peer.nodeType, label: labelOf(peer) });
      if (!seen.has(peer.id)) { seen.add(peer.id); queue.push({ id: peer.id, depth: cur.depth + 1 }); }
    }
  }
  return { rootId, nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function makeGraphRouter(repo: Repository): Router {
  const r = Router();
  r.get("/graph/snapshot/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const rawDepth = Number(first(req.query.depth));
    const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? Math.min(3, Math.floor(rawDepth)) : 1;
    res.json(buildSnapshot(repo, node.id, depth));
  });
  return r;
}
