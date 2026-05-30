import type { Repository, SchemaRegistry, GraphNode } from "@combat/shared";

export async function syncRefEdges(
  repo: Repository, registry: SchemaRegistry, node: GraphNode,
  body: Record<string, unknown>, actor: string,
): Promise<void> {
  const schema = registry.getNodeSchema(node.nodeType);
  if (!schema) return;
  await repo.deleteEdges({ sourceId: node.id, edgeType: "REF" }, actor);
  for (const f of schema.fields) {
    if (f.type !== "ref" || !f.refType) continue;
    const raw = body[f.id];
    const v = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!v) continue;
    const candidates = await repo.queryNodes(f.refType);
    const idKeys = registry.getNodeSchema(f.refType)?.identityKeys ?? [];
    const nameField = registry.getNodeSchema(f.refType)?.fields.find(pf => pf.required && pf.type === "string");
    const nameKey = nameField?.id ?? "name";
    let target = candidates.find(n => idKeys.some(k => String(n.properties[k] ?? "") === v))
      ?? candidates.find(n => String(n.properties[nameKey] ?? n.properties["姓名"] ?? n.properties["name"] ?? "") === v);
    if (!target) target = await repo.createNode(f.refType, { [nameKey]: v }, actor);
    await repo.createEdge("REF", node.id, target.id, { field: f.id, refType: f.refType, concept: f.concept }, actor);
  }
}
