import { Router } from "express";
import type { Repository, SchemaRegistry, GraphSnapshot, GraphSnapshotNode, GraphSnapshotEdge, GraphNode } from "@combat/shared";

const VIZ_EDGE_TYPES = new Set(["REF", "ANCHORED_TO", "CONFLICTS_WITH", "OVERLAPS_WITH"]);

function labelOf(n: GraphNode): string {
  const p = n.properties;
  // 贡献节点标签带类型后缀,避免与同名人员节点混淆(橘红「张三·实施」≠ 绿色人员「张三」)
  if (n.nodeType === "contribution") {
    const who = String(p["贡献人"] ?? "").trim();
    const tag = String(p["贡献类型"] ?? p["贡献等级"] ?? "").trim();
    if (who) return tag ? `${who}·${tag}` : `${who}(贡献)`;
  }
  return String(
    p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"] ?? p["姓名"] ?? p["name"] ?? p["贡献人"] ??
    p["组名"] ?? p["key"] ?? p["经验"] ?? p["问题说明"] ?? p["告警问题"] ?? p["事件标题"] ?? p["事项描述"] ?? n.id,
  );
}

/**
 * §38: BFS snapshot for graph visualization. Walks REF / ANCHORED_TO /
 * CONFLICTS_WITH / OVERLAPS_WITH edges (out + in) up to `maxDepth` hops from
 * `rootId`. Nodes dedup by id; edges dedup by source+target+edgeType.
 * Result is centered on rootId so the UI can lay out concentric rings.
 */
export async function buildSnapshot(repo: Repository, rootId: string, maxDepth: number): Promise<GraphSnapshot> {
  const nodes = new Map<string, GraphSnapshotNode>();
  const edgeKey = (s: string, t: string, k: string) => `${s}->${t}:${k}`;
  const edges = new Map<string, GraphSnapshotEdge>();
  const root = await repo.getNode(rootId);
  if (!root) return { rootId, nodes: [], edges: [] };
  nodes.set(root.id, { id: root.id, nodeType: root.nodeType, label: labelOf(root) });
  if (maxDepth <= 0) return { rootId, nodes: [...nodes.values()], edges: [] };

  type Q = { id: string; depth: number };
  const queue: Q[] = [{ id: root.id, depth: 0 }];
  const seen = new Set<string>([root.id]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;
    const out = (await repo.queryEdges({ sourceId: cur.id })).filter(e => VIZ_EDGE_TYPES.has(e.edgeType));
    const inc = (await repo.queryEdges({ targetId: cur.id })).filter(e => VIZ_EDGE_TYPES.has(e.edgeType));
    for (const e of out) {
      const peer = await repo.getNode(e.targetId);
      if (!peer) continue;
      const key = edgeKey(cur.id, peer.id, e.edgeType);
      if (!edges.has(key)) edges.set(key, { source: cur.id, target: peer.id, edgeType: e.edgeType });
      if (!nodes.has(peer.id)) nodes.set(peer.id, { id: peer.id, nodeType: peer.nodeType, label: labelOf(peer) });
      if (!seen.has(peer.id)) { seen.add(peer.id); queue.push({ id: peer.id, depth: cur.depth + 1 }); }
    }
    for (const e of inc) {
      const peer = await repo.getNode(e.sourceId);
      if (!peer) continue;
      const key = edgeKey(peer.id, cur.id, e.edgeType);
      if (!edges.has(key)) edges.set(key, { source: peer.id, target: cur.id, edgeType: e.edgeType });
      if (!nodes.has(peer.id)) nodes.set(peer.id, { id: peer.id, nodeType: peer.nodeType, label: labelOf(peer) });
      if (!seen.has(peer.id)) { seen.add(peer.id); queue.push({ id: peer.id, depth: cur.depth + 1 }); }
    }
  }
  return { rootId, nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * §KG: 全图/筛选视图 — 跨类型收集节点(可按 nodeType 列表 + 关键词过滤),
 * 再取这些节点之间的所有边。用于「知识图谱」可视化页面的整体视图;
 * 单节点的上钻/下钻仍复用 buildSnapshot(/graph/snapshot/:type/:id)。
 */
export async function buildGraph(
  repo: Repository,
  registry: SchemaRegistry,
  opts: { types?: string[]; q?: string; limit?: number },
): Promise<GraphSnapshot> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const types = opts.types?.length ? opts.types : registry.getConfig().nodeTypes.map(n => n.nodeType);
  const q = (opts.q ?? "").trim().toLowerCase();
  const nodes = new Map<string, GraphSnapshotNode>();
  for (const nt of types) {
    if (nodes.size >= limit) break;
    for (const n of await repo.queryNodes(nt)) {
      if (nodes.size >= limit) break;
      if (q) {
        const hay = Object.values(n.properties).map(v => String(v)).join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }
      nodes.set(n.id, { id: n.id, nodeType: n.nodeType, label: labelOf(n) });
    }
  }
  const ids = new Set(nodes.keys());
  const edges = new Map<string, GraphSnapshotEdge>();
  for (const id of ids) {
    for (const e of await repo.queryEdges({ sourceId: id })) {
      if (!ids.has(e.targetId)) continue;
      const key = `${e.sourceId}->${e.targetId}:${e.edgeType}`;
      if (!edges.has(key)) edges.set(key, { source: e.sourceId, target: e.targetId, edgeType: e.edgeType });
    }
  }
  return { rootId: "", nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function makeGraphRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.get("/graph/snapshot/:nodeType/:id", async (req, res) => {
    const node = await repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const rawDepth = Number(first(req.query.depth));
    const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? Math.min(3, Math.floor(rawDepth)) : 1;
    res.json(await buildSnapshot(repo, node.id, depth));
  });
  r.get("/kg/graph", async (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const types = req.query.types ? String(first(req.query.types)).split(",").map(s => s.trim()).filter(Boolean) : undefined;
    const q = req.query.q ? String(first(req.query.q)) : undefined;
    const limit = Number(first(req.query.limit)) || 500;
    res.json(await buildGraph(repo, registry, { types, q, limit }));
  });
  return r;
}
