import type { Repository, RelatedItem, CoAnchoredItem, ExpandedItem } from "@combat/shared";

export async function buildRelated(
  repo: Repository,
  id: string
): Promise<{
  outgoing: RelatedItem[];
  incoming: RelatedItem[];
  coAnchored: CoAnchoredItem[];
}> {
  const isRel = (t: string) => t === "REF" || t === "ANCHORED_TO";
  const outgoingEdges = (await repo.queryEdges({ sourceId: id })).filter((e) => isRel(e.edgeType));
  const outgoing: RelatedItem[] = [];
  for (const e of outgoingEdges) {
    const node = await repo.getNode(e.targetId);
    if (node)
      outgoing.push({
        field: String(e.properties["field"] ?? ""),
        concept: String(e.properties["concept"] ?? ""),
        node,
      });
  }
  const incomingEdges = (await repo.queryEdges({ targetId: id })).filter((e) => isRel(e.edgeType));
  const incoming: RelatedItem[] = [];
  for (const e of incomingEdges) {
    const node = await repo.getNode(e.sourceId);
    if (node)
      incoming.push({
        field: String(e.properties["field"] ?? ""),
        concept: String(e.properties["concept"] ?? ""),
        node,
      });
  }
  const coAnchored: CoAnchoredItem[] = [];
  for (const e of await repo.queryEdges({ sourceId: id, edgeType: "ANCHORED_TO" })) {
    const anchor = await repo.getNode(e.targetId);
    if (!anchor) continue;
    for (const back of await repo.queryEdges({ targetId: anchor.id, edgeType: "ANCHORED_TO" })) {
      if (back.sourceId === id) continue;
      const peer = await repo.getNode(back.sourceId);
      if (peer)
        coAnchored.push({
          anchorKind: String(e.properties["anchorKind"] ?? ""),
          anchorKey: String(anchor.properties["key"] ?? ""),
          node: peer,
        });
    }
  }
  return { outgoing, incoming, coAnchored };
}

// §32 depth-N BFS over REF + ANCHORED_TO edges (out/in + cross-anchor).
// Anchor nodes are traversed transparently (visited to find the other side
// but NOT emitted into expanded — only business nodes are user-facing).
// Each node visited at the shortest path (BFS); root never appears.
export async function buildExpanded(repo: Repository, rootId: string, maxDepth: number): Promise<ExpandedItem[]> {
  const out: ExpandedItem[] = [];
  if (maxDepth <= 0) return out;
  const visited = new Set<string>([rootId]);
  // Use a single FIFO; element = {id, depth, isAnchor} — anchors don't enter expanded
  // but their fan-out IS traversed (counts as 1 hop from the side that pointed in).
  type Q = { id: string; depth: number };
  const queue: Q[] = [{ id: rootId, depth: 0 }];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;
    // outgoing REF + ANCHORED_TO → target node
    for (const e of await repo.queryEdges({ sourceId: cur.id })) {
      if (e.edgeType !== "REF" && e.edgeType !== "ANCHORED_TO") continue;
      if (visited.has(e.targetId)) continue;
      const target = await repo.getNode(e.targetId);
      if (!target) continue;
      visited.add(target.id);
      const nextDepth = cur.depth + 1;
      // anchors are transparent: traverse through them but do NOT emit
      if (e.edgeType !== "ANCHORED_TO") {
        out.push({
          node: target,
          depth: nextDepth,
          viaEdgeType: e.edgeType,
          viaField: String(e.properties["field"] ?? ""),
          parentId: cur.id,
        });
      }
      // either way, queue for further expansion if depth budget remains
      if (nextDepth < maxDepth) queue.push({ id: target.id, depth: nextDepth });
    }
    // incoming REF + ANCHORED_TO → source node
    for (const e of await repo.queryEdges({ targetId: cur.id })) {
      if (e.edgeType !== "REF" && e.edgeType !== "ANCHORED_TO") continue;
      if (visited.has(e.sourceId)) continue;
      const source = await repo.getNode(e.sourceId);
      if (!source) continue;
      visited.add(source.id);
      const nextDepth = cur.depth + 1;
      out.push({
        node: source,
        depth: nextDepth,
        viaEdgeType: e.edgeType,
        viaField: String(e.properties["field"] ?? ""),
        parentId: cur.id,
      });
      if (nextDepth < maxDepth) queue.push({ id: source.id, depth: nextDepth });
    }
  }
  return out;
}
