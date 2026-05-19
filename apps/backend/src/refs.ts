import type { Repository, SchemaRegistry, GraphNode } from "@combat/shared";

export function syncRefEdges(
  repo: Repository, registry: SchemaRegistry, node: GraphNode,
  body: Record<string, unknown>, actor: string,
): void {
  const schema = registry.getNodeSchema(node.nodeType);
  if (!schema) return;
  repo.deleteEdges({ sourceId: node.id, edgeType: "REF" }, actor);
  for (const f of schema.fields) {
    if (f.type !== "ref" || !f.refType) continue;
    const raw = body[f.id];
    const v = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!v) continue;
    const candidates = repo.queryNodes(f.refType);
    const idKeys = registry.getNodeSchema(f.refType)?.identityKeys ?? [];
    let target = candidates.find(n => idKeys.some(k => String(n.properties[k] ?? "") === v))
      ?? candidates.find(n => String(n.properties["name"] ?? "") === v);
    if (!target) target = repo.createNode(f.refType, { name: v }, actor);
    repo.createEdge("REF", node.id, target.id, { field: f.id, refType: f.refType }, actor);
  }
}
