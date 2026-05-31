import { Router } from "express";
import type { Repository, ConflictRow, ScanConflictsResult, ConflictEdgeType } from "@combat/shared";

const ACTIVE_STATUSES = new Set(["待响应", "处理中", "进行中"]);

/** Group attackTickets by trimmed non-empty property value. */
async function groupTicketsBy(
  repo: Repository,
  field: string,
  predicate: (props: Record<string, unknown>) => boolean = () => true
): Promise<Map<string, { id: string }[]>> {
  const out = new Map<string, { id: string }[]>();
  for (const n of await repo.queryNodes("attackTicket")) {
    if (!predicate(n.properties)) continue;
    const raw = n.properties[field];
    const key = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ id: n.id });
  }
  return out;
}

/** Two-way derived edge: A→B and B→A both written so RelatedPage on either end sees the peer. */
async function writeBidirectional(
  repo: Repository,
  edgeType: ConflictEdgeType,
  aId: string,
  bId: string,
  reason: string,
  actor: string
): Promise<void> {
  await repo.createEdge(edgeType, aId, bId, { reason }, actor);
  await repo.createEdge(edgeType, bId, aId, { reason }, actor);
}

/**
 * §33: Derive conflict / overlap edges from attackTickets.
 *   - Rule 1: same `当前处理人` with ≥2 active tickets → CONFLICTS_WITH (reason 含人员名)
 *   - Rule 2: same `问题单号` with ≥2 tickets → OVERLAPS_WITH (reason 含单号)
 * Old derived edges of these two types are wiped first (全量重建 / 幂等).
 * Return counts are UNDIRECTED PAIR counts (3 tickets same person → C(3,2)=3, not 6 directed edges).
 */
export async function syncConflicts(repo: Repository): Promise<ScanConflictsResult> {
  const actor = "system";
  await repo.deleteEdges({ edgeType: "CONFLICTS_WITH" }, actor);
  await repo.deleteEdges({ edgeType: "OVERLAPS_WITH" }, actor);

  let conflicts = 0;
  // Rule 1: same 当前处理人, active tickets only
  const byOwner = await groupTicketsBy(repo, "当前处理人", (p) => ACTIVE_STATUSES.has(String(p["状态"] ?? "")));
  for (const [owner, items] of byOwner) {
    if (items.length < 2) continue;
    const reason = `同负责人多并发：${owner}`;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        await writeBidirectional(repo, "CONFLICTS_WITH", items[i].id, items[j].id, reason, actor);
        conflicts++;
      }
    }
  }

  let overlaps = 0;
  // Rule 2: same 问题单号 (any status — overlap is about ticket dup, not currently-active)
  const byPB = await groupTicketsBy(repo, "问题单号");
  for (const [pb, items] of byPB) {
    if (items.length < 2) continue;
    const reason = `同问题单：${pb}`;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        await writeBidirectional(repo, "OVERLAPS_WITH", items[i].id, items[j].id, reason, actor);
        overlaps++;
      }
    }
  }

  return { conflicts, overlaps };
}

/**
 * Collect ConflictRow[] — undirected dedup: keep only edges where source.id < target.id.
 *
 * 可选 preloadedTickets:调用方(如 dashboard)若已扫过一遍 attackTicket,可直接复用
 * 避免重复全表扫描 + JSON.parse(每个 ticket properties 都 parse 一次)。
 */
export async function listConflictRows(
  repo: Repository,
  preloadedTickets?: import("@combat/shared").GraphNode[]
): Promise<ConflictRow[]> {
  const nodeMap = new Map<string, import("@combat/shared").GraphNode>();
  const tickets = preloadedTickets ?? (await repo.queryNodes("attackTicket"));
  for (const n of tickets) nodeMap.set(n.id, n);

  const out: ConflictRow[] = [];
  for (const edgeType of ["CONFLICTS_WITH", "OVERLAPS_WITH"] as ConflictEdgeType[]) {
    for (const e of await repo.queryEdges({ edgeType })) {
      if (e.sourceId >= e.targetId) continue; // undirected dedup
      const source = nodeMap.get(e.sourceId);
      const target = nodeMap.get(e.targetId);
      if (!source || !target) continue;
      out.push({ edgeType, reason: String(e.properties["reason"] ?? ""), source, target });
    }
  }
  return out;
}

export function makeConflictsRouter(repo: Repository): Router {
  const r = Router();
  r.post("/conflicts/scan", async (_req, res) => {
    res.json(await syncConflicts(repo));
  });
  r.get("/conflicts", async (_req, res) => {
    res.json(await listConflictRows(repo));
  });
  return r;
}
