export type FieldType = "string" | "number" | "date" | "datetime" | "enum" | "ref" | "sequence";

export interface FieldSchema {
  name: string;
  type: FieldType;
  label: string;
  required?: boolean;
  enumValues?: string[];
  refType?: string;
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
