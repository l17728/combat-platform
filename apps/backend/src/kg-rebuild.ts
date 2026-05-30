import { Router } from "express";
import type { Repository, SchemaRegistry, RebuildKGResult } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";
import { syncConflicts } from "./conflicts.js";
import { log } from "./logger.js";

const DERIVED_EDGE_TYPES = ["REF", "ANCHORED_TO", "CONFLICTS_WITH", "OVERLAPS_WITH"] as const;

/**
 * §34: Wipe all derived edges and rebuild them from authoritative structured data
 * (nodes + properties + schema registry). The structured model is the single source
 * of truth; the KG is derived and fully rebuildable — call this after schema drift,
 * manual DB edits, or migration recovery to converge.
 */
export async function rebuildKG(repo: Repository, registry: SchemaRegistry): Promise<RebuildKGResult> {
  const t0 = Date.now();
  const actor = "system:rebuild-kg";
  log.info("kg.rebuild.start", {});

  for (const edgeType of DERIVED_EDGE_TYPES) {
    await repo.deleteEdges({ edgeType }, actor);
  }

  // Anchor nodes (questionTicket / 问题单号 / etc.) are created on the fly by
  // syncAnchorEdges. They are themselves business nodes of their nodeType, so
  // syncRefEdges/syncAnchorEdges iterating only "real" nodeTypes is enough —
  // the anchor nodes' own properties never carry ref/anchor fields, so they're
  // a no-op even if visited.
  const nodeTypes = registry.getConfig().nodeTypes.map(n => n.nodeType);
  for (const nt of nodeTypes) {
    for (const node of await repo.queryNodes(nt)) {
      await syncRefEdges(repo, registry, node, node.properties, actor);
      await syncAnchorEdges(repo, registry, node, node.properties, actor);
    }
  }

  const { conflicts, overlaps } = await syncConflicts(repo);

  // M1 fix: reclaim orphan anchor nodes — created on demand by syncAnchorEdges;
  // after rebuild any anchor with no ANCHORED_TO inbound edge is garbage that would
  // otherwise pollute queries / full-text search / dashboard.
  const anchorKinds = new Set<string>();
  for (const ns of registry.getConfig().nodeTypes)
    for (const f of ns.fields) if (f.anchor) anchorKinds.add(f.anchor);
  for (const kind of anchorKinds)
    for (const anchor of await repo.queryNodes(kind))
      if ((await repo.queryEdges({ targetId: anchor.id, edgeType: "ANCHORED_TO" })).length === 0)
        await repo.deleteNode(anchor.id, actor);

  const result = {
    refEdges: (await repo.queryEdges({ edgeType: "REF" })).length,
    anchorEdges: (await repo.queryEdges({ edgeType: "ANCHORED_TO" })).length,
    conflicts,
    overlaps,
    durationMs: Date.now() - t0,
  };
  log.info("kg.rebuild.done", result);
  return result;
}

export function makeKGRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/kg/rebuild", async (_req, res) => {
    try {
      res.json(await rebuildKG(repo, registry));
    } catch (e) {
      log.error("kg.rebuild.fail", { error: (e as Error).message });
      res.status(500).json({ error: `KG 重建失败：${(e as Error).message}` });
    }
  });
  return r;
}
