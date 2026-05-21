import type { GraphNode, GraphEdge, ProgressLog, RelationProposal, RelationProposalStatus, Reminder, ReminderStatus, AuditLogEntry } from "./types.js";
import type { SchemaRegistry } from "./registry.js";

export type NodeFilter = Record<string, unknown>;

export interface Repository {
  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): GraphNode;
  getNode(id: string): GraphNode | null;
  updateNode(id: string, patch: Record<string, unknown>, actor: string): GraphNode;
  queryNodes(nodeType: string, filter?: NodeFilter): GraphNode[];
  createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): GraphEdge;
  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): GraphEdge[];
  /** Supply at least one filter field — an empty opts matches and deletes ALL edges. */
  deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): void;
  deleteEdgeById(id: string, actor: string): boolean;
  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): ProgressLog;
  listProgress(ownerId: string): ProgressLog[];
  deleteNode(id: string, actor: string): void;
  logAudit(entry: { action: string; entityType: string; entityId: string; changes: unknown; actor: string }): void;
  listAuditLog(filter: { action?: string; entityType?: string; entityId?: string; limit?: number }): AuditLogEntry[];
  getSetting(key: string): string | null;
  setSetting(key: string, value: string, actor: string): void;
  createProposal(p: Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">, actor: string): RelationProposal;
  listProposals(opts?: { status?: RelationProposalStatus }): RelationProposal[];
  getProposal(id: string): RelationProposal | undefined;
  updateProposalStatus(id: string, status: RelationProposalStatus, decidedBy: string, actor: string): RelationProposal;
  createReminder(p: Omit<Reminder, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">, actor: string): Reminder;
  listReminders(opts?: { status?: ReminderStatus }): Reminder[];
  getReminder(id: string): Reminder | undefined;
  updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Reminder;
}

export interface ChannelAdapter {
  send(r: Reminder, actor: string): { sentAt: string };
}

export type ProposalDraft = Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">;
export interface RelationProposer {
  propose(repo: Repository, registry: SchemaRegistry): ProposalDraft[];
}
