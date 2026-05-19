import type { Repository } from "@combat/shared";

export function mergePerson(repo: Repository, fromId: string, toId: string, actor: string): void {
  if (fromId === toId) return;
  const dup = repo.getNode(fromId), canon = repo.getNode(toId);
  if (!dup || !canon) throw new Error("merge: node not found");
  const unioned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dup.properties))
    if (canon.properties[k] === undefined || canon.properties[k] === "") unioned[k] = v;
  if (Object.keys(unioned).length) repo.updateNode(toId, unioned, actor);
  for (const e of repo.queryEdges({ sourceId: fromId }))
    repo.createEdge(e.edgeType, toId, e.targetId, e.properties, actor);
  for (const e of repo.queryEdges({ targetId: fromId }))
    repo.createEdge(e.edgeType, e.sourceId, toId, e.properties, actor);
  repo.deleteNode(fromId, actor);
}
