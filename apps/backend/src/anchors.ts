import type { Repository, SchemaRegistry, GraphNode } from "@combat/shared";

export async function syncAnchorEdges(
  repo: Repository, registry: SchemaRegistry, node: GraphNode,
  body: Record<string, unknown>, actor: string,
): Promise<void> {
  const schema = registry.getNodeSchema(node.nodeType);
  if (!schema) return;
  await repo.deleteEdges({ sourceId: node.id, edgeType: "ANCHORED_TO" }, actor);
  // One shared atomic anchor per anchorKind per node: when several fields map to
  // the same kind, the later field in schema order wins (single ANCHORED_TO edge).
  const resolved = new Map<string, { value: string; field: string }>();
  for (const f of schema.fields) {
    if (!f.anchor) continue;
    const raw = body[f.id];
    const v = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!v) continue;
    resolved.set(f.anchor, { value: v, field: f.id });
  }
  for (const [kind, { value, field }] of resolved) {
    const existing = (await repo.queryNodes(kind)).find(n => String(n.properties["key"] ?? "") === value);
    const anchor = existing ?? await repo.createNode(kind, { key: value }, actor);
    await repo.createEdge("ANCHORED_TO", node.id, anchor.id, { anchorKind: kind, field }, actor);
  }
}
