import type { GraphNode, GraphEdge, ProgressLog } from "./types.js";

export type NodeFilter = Record<string, unknown>;

export interface Repository {
  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): GraphNode;
  getNode(id: string): GraphNode | null;
  updateNode(id: string, patch: Record<string, unknown>, actor: string): GraphNode;
  queryNodes(nodeType: string, filter?: NodeFilter): GraphNode[];
  createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): GraphEdge;
  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): GraphEdge[];
  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): ProgressLog;
  listProgress(ownerId: string): ProgressLog[];
  deleteNode(id: string, actor: string): void;
  logAudit(entry: { action: string; entityType: string; entityId: string; changes: unknown; actor: string }): void;
}
