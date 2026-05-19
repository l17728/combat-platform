import type { EntitySchemaConfig, NodeSchema, FieldType } from "./types.js";

export interface ValidationResult { ok: boolean; errors: string[]; }

export type FieldOp =
  | { op: "addField"; field: { name: string; type: FieldType; label: string; required?: boolean; enumValues?: string[] } }
  | { op: "renameLabel"; id: string; label: string }
  | { op: "editEnum"; id: string; enumValues: string[] }
  | { op: "retire"; id: string }
  | { op: "unretire"; id: string };

export interface SchemaRegistry {
  getConfig(): EntitySchemaConfig;
  getNodeSchema(nodeType: string): NodeSchema | undefined;
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult;
  reload(): void;
  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema;
}
