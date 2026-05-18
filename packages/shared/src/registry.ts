import type { EntitySchemaConfig, NodeSchema } from "./types.js";

export interface ValidationResult { ok: boolean; errors: string[]; }

export interface SchemaRegistry {
  getConfig(): EntitySchemaConfig;
  getNodeSchema(nodeType: string): NodeSchema | undefined;
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult;
  reload(): void;
}
