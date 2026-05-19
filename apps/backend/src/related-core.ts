import type { Repository, RelatedItem, CoAnchoredItem } from "@combat/shared";

export function buildRelated(repo: Repository, id: string): {
  outgoing: RelatedItem[]; incoming: RelatedItem[]; coAnchored: CoAnchoredItem[];
} {
  const isRel = (t: string) => t === "REF" || t === "ANCHORED_TO";
  const outgoing = repo.queryEdges({ sourceId: id }).filter(e => isRel(e.edgeType))
    .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.targetId) }))
    .filter((x): x is RelatedItem => !!x.node);
  const incoming = repo.queryEdges({ targetId: id }).filter(e => isRel(e.edgeType))
    .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.sourceId) }))
    .filter((x): x is RelatedItem => !!x.node);
  const coAnchored: CoAnchoredItem[] = [];
  for (const e of repo.queryEdges({ sourceId: id, edgeType: "ANCHORED_TO" })) {
    const anchor = repo.getNode(e.targetId);
    if (!anchor) continue;
    for (const back of repo.queryEdges({ targetId: anchor.id, edgeType: "ANCHORED_TO" })) {
      if (back.sourceId === id) continue;
      const peer = repo.getNode(back.sourceId);
      if (peer) coAnchored.push({ anchorKind: String(e.properties["anchorKind"] ?? ""),
        anchorKey: String(anchor.properties["key"] ?? ""), node: peer });
    }
  }
  return { outgoing, incoming, coAnchored };
}
