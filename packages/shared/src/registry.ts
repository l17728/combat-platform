import type { EntitySchemaConfig, NodeSchema, FieldType } from "./types.js";

export interface ValidationResult { ok: boolean; errors: string[]; }

export type FieldOp =
  // addField: server derives the field id from name (id = name; "#2","#3"… on collision). Callers do not supply id.
  | { op: "addField"; field: { name: string; type: FieldType; label: string; required?: boolean; enumValues?: string[] } }
  | { op: "renameLabel"; id: string; label: string }
  | { op: "editEnum"; id: string; enumValues: string[] }
  | { op: "retire"; id: string }
  | { op: "unretire"; id: string }
  | { op: "setAliases"; id: string; aliases: string[] };

export interface SchemaRegistry {
  getConfig(): EntitySchemaConfig;
  getNodeSchema(nodeType: string): NodeSchema | undefined;
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult;
  reload(): void;
  /** Throws if nodeType unknown or op invalid; persists+reloads (rolls back on reload failure). Returns updated NodeSchema. */
  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema;
}
