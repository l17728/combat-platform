import { Router } from "express";
import type { Repository, SchemaRegistry, RebuildKGResult } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";
import { syncConflicts } from "./conflicts.js";

const DERIVED_EDGE_TYPES = ["REF", "ANCHORED_TO", "CONFLICTS_WITH", "OVERLAPS_WITH"] as const;

/**
 * §34: Wipe all derived edges and rebuild them from authoritative structured data
 * (nodes + properties + schema registry). The structured model is the single source
 * of truth; the KG is derived and fully rebuildable — call this after schema drift,
 * manual DB edits, or migration recovery to converge.
 */
export function rebuildKG(repo: Repository, registry: SchemaRegistry): RebuildKGResult {
  const t0 = Date.now();
  const actor = "system:rebuild-kg";

  for (const edgeType of DERIVED_EDGE_TYPES) {
    repo.deleteEdges({ edgeType }, actor);
  }

  // Anchor nodes (questionTicket / 问题单号 / etc.) are created on the fly by
  // syncAnchorEdges. They are themselves business nodes of their nodeType, so
  // syncRefEdges/syncAnchorEdges iterating only "real" nodeTypes is enough —
  // the anchor nodes' own properties never carry ref/anchor fields, so they're
  // a no-op even if visited.
  const nodeTypes = registry.getConfig().nodeTypes.map(n => n.nodeType);
  for (const nt of nodeTypes) {
    for (const node of repo.queryNodes(nt)) {
      syncRefEdges(repo, registry, node, node.properties, actor);
      syncAnchorEdges(repo, registry, node, node.properties, actor);
    }
  }

  const { conflicts, overlaps } = syncConflicts(repo);

  return {
    refEdges: repo.queryEdges({ edgeType: "REF" }).length,
    anchorEdges: repo.queryEdges({ edgeType: "ANCHORED_TO" }).length,
    conflicts,
    overlaps,
    durationMs: Date.now() - t0,
  };
}

export function makeKGRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/kg/rebuild", (_req, res) => {
    res.json(rebuildKG(repo, registry));
  });
  return r;
}
