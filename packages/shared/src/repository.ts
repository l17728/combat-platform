import type {
  GraphNode,
  GraphEdge,
  ProgressLog,
  RelationProposal,
  RelationProposalStatus,
  Reminder,
  ReminderStatus,
  AuditLogEntry,
} from "./types.js";
import type { SchemaRegistry } from "./registry.js";

export type NodeFilter = Record<string, unknown>;

export interface Repository {
  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): Promise<GraphNode>;
  getNode(id: string): Promise<GraphNode | null>;
  updateNode(id: string, patch: Record<string, unknown>, actor: string): Promise<GraphNode>;
  queryNodes(nodeType: string, filter?: NodeFilter): Promise<GraphNode[]>;
  /**
   * v2.2 P1 §1: SQL-pushdown 单键等值过滤。Repository 实现走 JSON 路径函数
   *   - SQLite: `json_extract(properties, '$.<key>') = ?`
   *   - Postgres: `properties->>'<key>' = ?` (走 GIN)
   * 用于消除 `queryNodes(nt, {key: v})` 后 N 次 JSON.parse + 应用层 filter 的 O(N) 浪费。
   * 等值 key/value 必须为字符串(其他类型走 queryNodes 兼容)。
   */
  queryNodesByProperty(nodeType: string, key: string, value: string): Promise<GraphNode[]>;
  createEdge(
    edgeType: string,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown>,
    actor: string
  ): Promise<GraphEdge>;
  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): Promise<GraphEdge[]>;
  /** Supply at least one filter field — an empty opts matches and deletes ALL edges. */
  deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): Promise<void>;
  deleteEdgeById(id: string, actor: string): Promise<boolean>;
  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): Promise<ProgressLog>;
  listProgress(ownerId: string): Promise<ProgressLog[]>;
  listAllProgress(): Promise<ProgressLog[]>;
  deleteNode(id: string, actor: string): Promise<void>;
  logAudit(entry: {
    action: string;
    entityType: string;
    entityId: string;
    changes: unknown;
    actor: string;
  }): Promise<void>;
  listAuditLog(filter: {
    action?: string;
    entityType?: string;
    entityId?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, actor: string): Promise<void>;
  createProposal(
    p: Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">,
    actor: string
  ): Promise<RelationProposal>;
  listProposals(opts?: { status?: RelationProposalStatus }): Promise<RelationProposal[]>;
  getProposal(id: string): Promise<RelationProposal | undefined>;
  updateProposalStatus(
    id: string,
    status: RelationProposalStatus,
    decidedBy: string,
    actor: string
  ): Promise<RelationProposal>;
  createReminder(
    p: Omit<Reminder, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">,
    actor: string
  ): Promise<Reminder>;
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
