import type { GraphNode, GraphEdge, ProgressLog, RelationProposal, RelationProposalStatus, Reminder, ReminderStatus, AuditLogEntry } from "./types.js";
import type { SchemaRegistry } from "./registry.js";

export type NodeFilter = Record<string, unknown>;

export interface Repository {
  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): Promise<GraphNode>;
  getNode(id: string): Promise<GraphNode | null>;
  updateNode(id: string, patch: Record<string, unknown>, actor: string): Promise<GraphNode>;
  queryNodes(nodeType: string, filter?: NodeFilter): Promise<GraphNode[]>;
  createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): Promise<GraphEdge>;
  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): Promise<GraphEdge[]>;
  /** Supply at least one filter field — an empty opts matches and deletes ALL edges. */
  deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): Promise<void>;
  deleteEdgeById(id: string, actor: string): Promise<boolean>;
  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): Promise<ProgressLog>;
  listProgress(ownerId: string): Promise<ProgressLog[]>;
  listAllProgress(): Promise<ProgressLog[]>;
  deleteNode(id: string, actor: string): Promise<void>;
  logAudit(entry: { action: string; entityType: string; entityId: string; changes: unknown; actor: string }): Promise<void>;
  listAuditLog(filter: { action?: string; entityType?: string; entityId?: string; limit?: number }): Promise<AuditLogEntry[]>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, actor: string): Promise<void>;
  createProposal(p: Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">, actor: string): Promise<RelationProposal>;
  listProposals(opts?: { status?: RelationProposalStatus }): Promise<RelationProposal[]>;
  getProposal(id: string): Promise<RelationProposal | undefined>;
  updateProposalStatus(id: string, status: RelationProposalStatus, decidedBy: string, actor: string): Promise<RelationProposal>;
  createReminder(p: Omit<Reminder, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">, actor: string): Promise<Reminder>;
  listReminders(opts?: { status?: ReminderStatus }): Promise<Reminder[]>;
  getReminder(id: string): Promise<Reminder | undefined>;
  updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Promise<Reminder>;
}

export interface ChannelAdapter {
  send(r: Reminder, actor: string): { sentAt: string };
}

export type ProposalDraft = Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">;
export interface RelationProposer {
  propose(repo: Repository, registry: SchemaRegistry): Promise<ProposalDraft[]>;
}
