export type FieldType = "string" | "number" | "date" | "datetime" | "enum" | "ref" | "sequence";

export interface FieldSchema {
  id: string;
  name: string;
  type: FieldType;
  label: string;
  required?: boolean;
  enumValues?: string[];
  refType?: string;
  retired?: boolean;
  aliases?: string[];
  concept?: string;
  anchor?: string;
}
export interface NodeSchema {
  nodeType: string;
  label: string;
  fields: FieldSchema[];
  identityKeys: string[];
  derivedToKG: boolean;
}
export interface EdgeSchema { edgeType: string; from: string; to: string; }
export interface EntitySchemaConfig {
  version: number;
  nodeTypes: NodeSchema[];
  edgeTypes: EdgeSchema[];
}

export interface GraphNode {
  id: string;
  nodeType: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface GraphEdge {
  id: string;
  edgeType: string;
  sourceId: string;
  targetId: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface ProgressLog {
  id: string;
  ownerId: string;
  seqNo: number;
  content: string;
  statusSnapshot: string;
  updatedBy: string;
  updatedAt: string;
}
export interface QueryHit { id: string; nodeType: string; summary: string; score: number; }
export interface RelatedItem { field: string; concept: string; node: GraphNode; }
export interface CoAnchoredItem { anchorKind: string; anchorKey: string; node: GraphNode; }
export interface ExpandedItem {
  node: GraphNode; depth: number; viaEdgeType: string; viaField: string; parentId: string;
}
export type ConflictEdgeType = "CONFLICTS_WITH" | "OVERLAPS_WITH";
export interface ConflictItem { edgeType: ConflictEdgeType; reason: string; node: GraphNode; }
export interface ConflictRow { edgeType: ConflictEdgeType; reason: string; source: GraphNode; target: GraphNode; }
export interface ScanConflictsResult { conflicts: number; overlaps: number; }
export interface QueryContext {
  node: GraphNode;
  related: { outgoing: RelatedItem[]; incoming: RelatedItem[]; coAnchored: CoAnchoredItem[] };
  progress: ProgressLog[];
}
export interface HelperRecommendation { person: GraphNode; score: number; reasons: string[]; }
export interface DashboardSummary {
  tickets: { total: number; byStatus: Record<string, number>; open: number; resolved: number };
  contributions: { total: number; topContributors: { 贡献人: string; count: number }[] };
  proposalsPending: number;
}
export interface LeaderboardEntry {
  贡献人: string;
  score: number;
  贡献数: number;
  byLevel: Record<string, number>;
  byType: Record<string, number>;
}
export interface HonorContribution {
  contribution: GraphNode;
  attackTicketId: string | null;
}
export interface PersonHonor {
  贡献人: string;
  contributions: HonorContribution[];
}

export type RelationProposalStatus = "待审批" | "已通过" | "已拒绝";
export interface RelationProposal {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  confidence: number;
  proposerSource: string;
  rationale: string;
  status: RelationProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface DailyReportEntry {
  seqNo: number; statusSnapshot: string; content: string; updatedBy: string; at: string;
}
export interface DailyReportSection {
  ticketId: string; 标题: string; latestStatus: string; entries: DailyReportEntry[];
}
export interface DailyReport {
  date: string;
  sections: DailyReportSection[];
  summary: { ticketsTouched: number; entriesTotal: number; openByStatus: Record<string, number> };
}

export type ReminderStatus = "待发送" | "已发送" | "已忽略";
export type ReminderKind = "问题单跟催" | "FE Deadline 提醒" | "CCB 提醒";
export interface Reminder {
  id: string;
  kind: ReminderKind;
  ticketId: string;
  recipientPersonId?: string;
  recipientName: string;
  subject: string;
  body: string;
  status: ReminderStatus;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}
