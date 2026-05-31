import type { Repository, MergePreview } from "@combat/shared";
import { syncConflicts } from "./conflicts.js";
import { log } from "./logger.js";

// Read-only computation of what mergePerson(fromId → toId) would do: which
// fields get unioned onto `to`, and how many edges migrate (excluding from↔to).
export async function previewMerge(repo: Repository, fromId: string, toId: string): Promise<MergePreview> {
  const from = await repo.getNode(fromId),
    to = await repo.getNode(toId);
  if (!from || !to) throw new Error("预览失败：节点不存在");
  const unionedFields: string[] = [];
  for (const [k, v] of Object.entries(from.properties)) {
    if (v === undefined || v === "") continue;
    if (to.properties[k] === undefined || to.properties[k] === "") unionedFields.push(k);
  }
  let edgesToMigrate = 0;
  for (const e of await repo.queryEdges({ sourceId: fromId })) if (e.targetId !== toId) edgesToMigrate++;
  for (const e of await repo.queryEdges({ targetId: fromId })) if (e.sourceId !== toId) edgesToMigrate++;
  return { from, to, unionedFields, edgesToMigrate };
}

// Phase-1 assumption (same as registry.applyFieldOp / PRD §13): single-process
// synchronous better-sqlite3 — this sequence + the caller's updateProposalStatus
// run to completion without interleaving, so the merge+decide pair is effectively
// atomic. Revisit (wrap in one tx) under async/multi-process.
export async function mergePerson(repo: Repository, fromId: string, toId: string, actor: string): Promise<void> {
  if (fromId === toId) return;
  const dup = await repo.getNode(fromId),
    canon = await repo.getNode(toId);
  if (!dup || !canon) throw new Error("合并失败：节点不存在");
  log.info("merge.start", { fromId, toId, actor });
  let migrated = 0;
  const unioned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dup.properties))
    if (canon.properties[k] === undefined || canon.properties[k] === "") unioned[k] = v;
  if (Object.keys(unioned).length) await repo.updateNode(toId, unioned, actor);
  // H2 fix: re-point from's edges onto `to`, but DEDUP — skip creating an edge
  // that `to` already has (same edgeType + peer + field), so repeated merges or
  // shared references don't pile up duplicate edges. (Person merge only touches
  // incoming REF/ASSIGNED_TO/ESCALATED_TO/RELATES_TO; re-pointing is correct —
  // re-deriving would wrongly re-create the deleted person from stale name strings.)
  const sig = (edgeType: string, peer: string, field: unknown) => `${edgeType}|${peer}|${String(field ?? "")}`;
  const existing = new Set<string>();
  for (const e of await repo.queryEdges({ sourceId: toId }))
    existing.add(sig(e.edgeType, e.targetId, e.properties["field"]));
  for (const e of await repo.queryEdges({ targetId: toId }))
    existing.add(sig(e.edgeType, e.sourceId, e.properties["field"]));
  for (const e of await repo.queryEdges({ sourceId: fromId })) {
    if (e.targetId === toId) continue; // avoid self-loop
    const s = sig(e.edgeType, e.targetId, e.properties["field"]);
    if (existing.has(s)) continue;
    existing.add(s);
    await repo.createEdge(e.edgeType, toId, e.targetId, e.properties, actor);
    migrated++;
  }
  for (const e of await repo.queryEdges({ targetId: fromId })) {
    if (e.sourceId === toId) continue;
    const s = sig(e.edgeType, e.sourceId, e.properties["field"]);
    if (existing.has(s)) continue;
    existing.add(s);
    await repo.createEdge(e.edgeType, e.sourceId, toId, e.properties, actor);
    migrated++;
  }
  await repo.deleteNode(fromId, actor);
  // recompute conflict edges in case a re-pointed REF changed an owner grouping
  await syncConflicts(repo);
  // PRD §2.2: merge is a first-class audited business event (records the
  // actual surviving target — also the trace for a 修正-corrected target).
  await repo.logAudit({
    action: "MERGE",
    entityType: "node",
    entityId: toId,
    changes: { fromId, toId, unioned },
    actor,
  });
  log.info("merge.done", { fromId, toId, edgesMigrated: migrated, fieldsUnioned: Object.keys(unioned).length });
}
