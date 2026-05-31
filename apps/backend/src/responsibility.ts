import { Router } from "express";
import type { Repository, EscalationConfig } from "@combat/shared";
import { log } from "./logger.js";

const DEFAULT_CONFIG: EscalationConfig = {
  rules: [
    { 事件级别: "P1", slaHours: 2, 上升角色: "运维Leader" },
    { 事件级别: "P2", slaHours: 8, 上升角色: "运维Leader" },
    { 事件级别: "P3", slaHours: 24, 上升角色: "值班接口人" },
    { 事件级别: "P4A", slaHours: 4, 上升角色: "值班接口人" },
  ],
};

async function readEscalationConfig(repo: Repository): Promise<EscalationConfig> {
  const raw = await repo.getSetting("escalation");
  if (!raw) return DEFAULT_CONFIG;
  try {
    return JSON.parse(raw) as EscalationConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Convert a string to a safe Mermaid node ID: replace spaces and special chars with underscores */
function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9一-鿿]/g, "_");
}

/** Escape a string for safe embedding in Mermaid node labels and edge labels */
function mermaidLabel(s: string): string {
  return String(s).replace(/"/g, "'").replace(/[[\]]/g, "");
}

/** Truncate a title to max length for readability */
function truncate(s: string, max = 20): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export interface ResponsibilityDiagram {
  mermaid: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Build the responsibility matrix Mermaid diagram.
 *
 * Shows three types of relationships:
 * 1. Escalation flow from config rules: 事件级别 → 上升角色 with SLA label
 * 2. Person assignments: ASSIGNED_TO / ESCALATED_TO edges → person handles ticket
 * 3. Conflict relationships: CONFLICTS_WITH edges shown as dashed lines
 */
export async function buildResponsibilityDiagram(repo: Repository): Promise<ResponsibilityDiagram> {
  const lines: string[] = ["flowchart TD"];
  const nodeIds = new Set<string>();
  let edgeCount = 0;

  // ── 1. Escalation config rules ──────────────────────────────────────────────
  const cfg = await readEscalationConfig(repo);
  for (const rule of cfg.rules) {
    const levelId = safeId(rule.事件级别);
    const roleId = safeId(rule.上升角色);
    const label = mermaidLabel(`SLA ${rule.slaHours}h → ${rule.上升角色}`);
    lines.push(
      `  ${levelId}["${mermaidLabel(rule.事件级别)} 事件"] -->|"${label}"| ${roleId}["${mermaidLabel(rule.上升角色)}"]`
    );
    nodeIds.add(levelId);
    nodeIds.add(roleId);
    edgeCount++;
  }

  // ── 2. Person assignments: ASSIGNED_TO + ESCALATED_TO edges ─────────────────
  //    Group by person to keep the diagram readable (aggregate, not enumerate all)
  const assignedEdges = [
    ...(await repo.queryEdges({ edgeType: "ASSIGNED_TO" })),
    ...(await repo.queryEdges({ edgeType: "ESCALATED_TO" })),
  ];

  // Preload all persons and attackTickets to avoid N+1 getNode calls
  const nodeMap = new Map<string, import("@combat/shared").GraphNode>();
  for (const n of [...(await repo.queryNodes("person")), ...(await repo.queryNodes("attackTicket"))]) {
    nodeMap.set(n.id, n);
  }

  // Map personId → Set of ticketIds
  const personToTickets = new Map<string, Set<string>>();
  for (const edge of assignedEdges) {
    const existing = personToTickets.get(edge.targetId) ?? new Set<string>();
    existing.add(edge.sourceId);
    personToTickets.set(edge.targetId, existing);
  }

  for (const [personId, ticketIds] of personToTickets) {
    const person = nodeMap.get(personId);
    if (!person) continue;
    const personName = String(person.properties["姓名"] ?? person.properties["名称"] ?? truncate(personId, 8));
    const personNodeId = safeId("person_" + personId);
    if (!nodeIds.has(personNodeId)) {
      lines.push(`  ${personNodeId}(["👤 ${mermaidLabel(personName)}"])`);
      nodeIds.add(personNodeId);
    }

    // Show at most 5 tickets per person to keep diagram readable
    const ticketArr = [...ticketIds].slice(0, 5);
    for (const ticketId of ticketArr) {
      const ticket = nodeMap.get(ticketId);
      if (!ticket) continue;
      const title = truncate(String(ticket.properties["标题"] ?? ticket.properties["名称"] ?? ticketId), 20);
      const ticketNodeId = safeId("ticket_" + ticketId);
      if (!nodeIds.has(ticketNodeId)) {
        lines.push(`  ${ticketNodeId}["${mermaidLabel(title)}"]`);
        nodeIds.add(ticketNodeId);
      }
      lines.push(`  ${personNodeId} --- |"负责"| ${ticketNodeId}`);
      edgeCount++;
    }
    // If more than 5, show a summary node
    if (ticketIds.size > 5) {
      const moreId = safeId("more_" + personId);
      lines.push(`  ${moreId}["...等共${mermaidLabel(String(ticketIds.size))}个任务"]`);
      lines.push(`  ${personNodeId} --- |"负责"| ${moreId}`);
      nodeIds.add(moreId);
      edgeCount++;
    }
  }

  // ── 3. CONFLICTS_WITH edges (dashed lines) ───────────────────────────────────
  const conflictEdges = await repo.queryEdges({ edgeType: "CONFLICTS_WITH" });
  for (const edge of conflictEdges) {
    const srcTicket = nodeMap.get(edge.sourceId);
    const tgtTicket = nodeMap.get(edge.targetId);
    if (!srcTicket || !tgtTicket) continue;

    const srcTitle = truncate(
      String(srcTicket.properties["标题"] ?? srcTicket.properties["名称"] ?? edge.sourceId),
      20
    );
    const tgtTitle = truncate(
      String(tgtTicket.properties["标题"] ?? tgtTicket.properties["名称"] ?? edge.targetId),
      20
    );

    const srcId = safeId("ticket_" + edge.sourceId);
    const tgtId = safeId("ticket_" + edge.targetId);

    if (!nodeIds.has(srcId)) {
      lines.push(`  ${srcId}["${mermaidLabel(srcTitle)}"]`);
      nodeIds.add(srcId);
    }
    if (!nodeIds.has(tgtId)) {
      lines.push(`  ${tgtId}["${mermaidLabel(tgtTitle)}"]`);
      nodeIds.add(tgtId);
    }
    lines.push(`  ${srcId} -.->|"冲突"| ${tgtId}`);
    edgeCount++;
  }

  const nodeCount = nodeIds.size;
  const mermaid = lines.join("\n");

  log.info("responsibility.diagram", { nodeCount, edgeCount });

  return { mermaid, nodeCount, edgeCount };
}

export function makeResponsibilityRouter(repo: Repository): Router {
  const r = Router();

  r.get("/responsibility/diagram", async (_req, res) => {
    const result = await buildResponsibilityDiagram(repo);
    res.json(result);
  });

  return r;
}
