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

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9一-鿿]/g, "_");
}

function mermaidLabel(s: string): string {
  return String(s).replace(/"/g, "'").replace(/[[\]]/g, "");
}

function truncate(s: string, max = 20): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

// ── Response types ─────────────────────────────────────────────

export interface EscalationRule {
  level: string;
  slaHours: number;
  role: string;
  ticketCount: number;
}

export interface PersonLoad {
  personId: string;
  name: string;
  assignedCount: number;
  escalatedCount: number;
  conflictCount: number;
}

export interface ConflictPair {
  ticketA: string;
  ticketAId: string;
  ticketB: string;
  ticketBId: string;
}

export interface ResponsibilityDiagram {
  mermaid: string;
  nodeCount: number;
  edgeCount: number;
  totalTickets: number;
  totalPersons: number;
  totalConflicts: number;
  escalationRules: EscalationRule[];
  personLoads: PersonLoad[];
  conflictTop: ConflictPair[];
}

// ── Build aggregated Mermaid diagram ───────────────────────────

export async function buildResponsibilityDiagram(repo: Repository): Promise<ResponsibilityDiagram> {
  const lines: string[] = ["flowchart TD"];
  const nodeIds = new Set<string>();
  let edgeCount = 0;

  // Preload nodes
  const nodeMap = new Map<string, import("@combat/shared").GraphNode>();
  for (const n of [...(await repo.queryNodes("person")), ...(await repo.queryNodes("attackTicket"))]) {
    nodeMap.set(n.id, n);
  }

  const allTickets = await repo.queryNodes("attackTicket");
  const totalTickets = allTickets.length;
  const allPersons = await repo.queryNodes("person");
  const totalPersons = allPersons.length;

  // ── 1. Escalation rules → aggregated by role ──────────────────
  const cfg = await readEscalationConfig(repo);
  const assignedEdges = await repo.queryEdges({ edgeType: "分配" });
  const escalatedEdges = await repo.queryEdges({ edgeType: "上报" });

  const personToTickets = new Map<string, Set<string>>();
  const personEscalated = new Map<string, Set<string>>();
  for (const edge of assignedEdges) {
    const s = personToTickets.get(edge.targetId) ?? new Set<string>();
    s.add(edge.sourceId);
    personToTickets.set(edge.targetId, s);
  }
  for (const edge of escalatedEdges) {
    const s = personEscalated.get(edge.targetId) ?? new Set<string>();
    s.add(edge.sourceId);
    personEscalated.set(edge.targetId, s);
  }

  // Group rules by role for compact diagram
  const roleToLevels = new Map<string, { level: string; sla: number }[]>();
  for (const rule of cfg.rules) {
    const arr = roleToLevels.get(rule.上升角色) ?? [];
    arr.push({ level: rule.事件级别, sla: rule.slaHours });
    roleToLevels.set(rule.上升角色, arr);
  }

  // Count tickets per role (by assignment)
  const roleToTicketCount = new Map<string, number>();
  for (const [personId, tickets] of personToTickets) {
    const person = nodeMap.get(personId);
    if (!person) continue;
    const personName = String(person.properties["姓名"] ?? person.properties["名称"] ?? "");
    for (const [role, levels] of roleToLevels) {
      if (personName.includes(role) || role.includes(personName)) {
        roleToTicketCount.set(role, (roleToTicketCount.get(role) ?? 0) + tickets.size);
      }
    }
  }

  // Draw escalation flow (compact: one node per role, one node per level group)
  for (const [role, levels] of roleToLevels) {
    const roleId = safeId("role_" + role);
    const roleTicketCount = [...personToTickets.entries()]
      .filter(([pid]) => {
        const p = nodeMap.get(pid);
        const name = p ? String(p.properties["姓名"] ?? p.properties["名称"] ?? "") : "";
        return name.includes(role) || role.includes(name);
      })
      .reduce((sum, [, ts]) => sum + ts.size, 0);

    const roleLabel = roleTicketCount > 0 ? `${mermaidLabel(role)} (${roleTicketCount}个任务)` : mermaidLabel(role);
    lines.push(`  ${roleId}["${roleLabel}"]`);
    nodeIds.add(roleId);

    for (const { level, sla } of levels) {
      const levelId = safeId("level_" + level);
      lines.push(`  ${levelId}{{"${mermaidLabel(level)} 事件<br/>SLA ${sla}h"}}`);
      lines.push(`  ${levelId} -->|"上升"| ${roleId}`);
      nodeIds.add(levelId);
      edgeCount++;
    }
  }

  // ── 2. Top persons by load (max 15) ───────────────────────────
  const personLoads: PersonLoad[] = [];
  const allInvolvedPersons = new Set([...personToTickets.keys(), ...personEscalated.keys()]);
  const sortedPersons = [...allInvolvedPersons]
    .map((personId) => ({
      personId,
      assigned: personToTickets.get(personId)?.size ?? 0,
      escalated: personEscalated.get(personId)?.size ?? 0,
    }))
    .sort((a, b) => (b.assigned + b.escalated) - (a.assigned + a.escalated))
    .slice(0, 15);

  for (const { personId, assigned, escalated } of sortedPersons) {
    const person = nodeMap.get(personId);
    if (!person) continue;
    const personName = String(person.properties["姓名"] ?? person.properties["名称"] ?? truncate(personId, 8));
    const total = assigned + escalated;
    lines.push(`  ${safeId("person_" + personId)}(["👤 ${mermaidLabel(personName)}<br/>${total}个任务"])`);
    nodeIds.add(safeId("person_" + personId));
    personLoads.push({
      personId,
      name: personName,
      assignedCount: assigned,
      escalatedCount: escalated,
      conflictCount: 0,
    });
  }

  // ── 3. Conflicts — aggregated, not per-edge ───────────────────
  const conflictEdges = await repo.queryEdges({ edgeType: "冲突" });
  const totalConflicts = conflictEdges.length;

  // Count conflicts per person
  const ticketToPerson = new Map<string, string>();
  for (const [personId, tickets] of personToTickets) {
    for (const tid of tickets) ticketToPerson.set(tid, personId);
  }

  const personConflictCount = new Map<string, number>();
  const seenPairs = new Set<string>();
  const conflictPairMap = new Map<string, number>();

  for (const edge of conflictEdges) {
    // Deduplicate: only count A→B, skip B→A
    const pairKey = [edge.sourceId, edge.targetId].sort().join("|");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const srcPerson = ticketToPerson.get(edge.sourceId);
    const tgtPerson = ticketToPerson.get(edge.targetId);
    if (srcPerson) personConflictCount.set(srcPerson, (personConflictCount.get(srcPerson) ?? 0) + 1);
    if (tgtPerson && tgtPerson !== srcPerson) personConflictCount.set(tgtPerson, (personConflictCount.get(tgtPerson) ?? 0) + 1);

    const srcTicket = nodeMap.get(edge.sourceId);
    const tgtTicket = nodeMap.get(edge.targetId);
    if (srcTicket && tgtTicket) {
      const srcTitle = truncate(String(srcTicket.properties["标题"] ?? srcTicket.properties["名称"] ?? edge.sourceId));
      const tgtTitle = truncate(String(tgtTicket.properties["标题"] ?? tgtTicket.properties["名称"] ?? edge.targetId));
      const key = [srcTitle, tgtTitle].sort().join(" ↔ ");
      conflictPairMap.set(key, (conflictPairMap.get(key) ?? 0) + 1);
    }
  }

  // Update personLoads with conflict counts
  for (const pl of personLoads) {
    pl.conflictCount = personConflictCount.get(pl.personId) ?? 0;
  }

  // Top 20 conflict pairs for the table
  const conflictTop: ConflictPair[] = [...conflictPairMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key]) => {
      const [a, b] = key.split(" ↔ ");
      return { ticketA: a, ticketAId: "", ticketB: b, ticketBId: "" };
    });

  // Add conflict summary to diagram if any
  if (totalConflicts > 0) {
    const uniqueConflicts = seenPairs.size;
    lines.push(`  conflicts["⚠ ${uniqueConflicts}组冲突关系"]`);
    lines.push(`  conflicts -.- style conflicts fill:#fff2f0,stroke:#ffccc7`);
    nodeIds.add("conflicts");
  }

  const nodeCount = nodeIds.size;
  const mermaid = lines.join("\n");

  // Build escalation rules summary
  const escalationRules: EscalationRule[] = cfg.rules.map((rule) => ({
    level: rule.事件级别,
    slaHours: rule.slaHours,
    role: rule.上升角色,
    ticketCount: roleToTicketCount.get(rule.上升角色) ?? 0,
  }));

  log.info("responsibility.diagram", { nodeCount, edgeCount, totalTickets, totalPersons, totalConflicts: seenPairs.size });

  return {
    mermaid,
    nodeCount,
    edgeCount,
    totalTickets,
    totalPersons,
    totalConflicts: seenPairs.size,
    escalationRules,
    personLoads,
    conflictTop,
  };
}

export function makeResponsibilityRouter(repo: Repository): Router {
  const r = Router();

  r.get("/responsibility/diagram", async (_req, res) => {
    const result = await buildResponsibilityDiagram(repo);
    res.json(result);
  });

  return r;
}
