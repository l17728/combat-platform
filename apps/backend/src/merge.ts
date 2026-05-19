import type { Repository } from "@combat/shared";

// Phase-1 assumption (same as registry.applyFieldOp / PRD §13): single-process
// synchronous better-sqlite3 — this sequence + the caller's updateProposalStatus
// run to completion without interleaving, so the merge+decide pair is effectively
// atomic. Revisit (wrap in one tx) under async/multi-process.
export function mergePerson(repo: Repository, fromId: string, toId: string, actor: string): void {
  if (fromId === toId) return;
  const dup = repo.getNode(fromId), canon = repo.getNode(toId);
  if (!dup || !canon) throw new Error("合并失败：节点不存在");
  const unioned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dup.properties))
    if (canon.properties[k] === undefined || canon.properties[k] === "") unioned[k] = v;
  if (Object.keys(unioned).length) repo.updateNode(toId, unioned, actor);
  // skip a direct from↔to edge so the re-point can't create a toId→toId self-loop
  for (const e of repo.queryEdges({ sourceId: fromId }))
    if (e.targetId !== toId) repo.createEdge(e.edgeType, toId, e.targetId, e.properties, actor);
  for (const e of repo.queryEdges({ targetId: fromId }))
    if (e.sourceId !== toId) repo.createEdge(e.edgeType, e.sourceId, toId, e.properties, actor);
  repo.deleteNode(fromId, actor);
  // PRD §2.2: merge is a first-class audited business event (records the
  // actual surviving target — also the trace for a 修正-corrected target).
  repo.logAudit({ action: "MERGE", entityType: "node", entityId: toId,
    changes: { fromId, toId, unioned }, actor });
}
