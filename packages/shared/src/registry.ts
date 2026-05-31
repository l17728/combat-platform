import type { EntitySchemaConfig, NodeSchema, FieldType, FieldValidation } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export type FieldOp =
  // addField: id is derived from name (id = name). name must be unique within the schema (it is the property/form key); duplicate names are rejected. Callers do not supply id.
  | {
      op: "addField";
      field: {
        name: string;
        type: FieldType;
        label: string;
        required?: boolean;
        enumValues?: string[];
        group?: string;
        order?: number;
      };
    }
  | { op: "renameLabel"; id: string; label: string }
  | { op: "editEnum"; id: string; enumValues: string[] }
  | { op: "retire"; id: string }
  | { op: "unretire"; id: string }
  | { op: "setAliases"; id: string; aliases: string[] }
  | { op: "setConcept"; id: string; concept: string }
  | { op: "setAnchor"; id: string; anchor: string }
  | { op: "setOptionsKey"; id: string; optionsKey: string | null }
  // v2.6: Schema-as-UI — group/order/visible/defaultValue/validation
  | {
      op: "updateField";
      id: string;
      group?: string | null;
      order?: number | null;
      visible?: string | null;
      defaultValue?: unknown;
      validation?: FieldValidation | null;
    };

export interface SchemaRegistry {
  getConfig(): EntitySchemaConfig;
  getNodeSchema(nodeType: string): NodeSchema | undefined;
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult;
  reload(): void;
  /** Throws if nodeType unknown or op invalid; persists+reloads (rolls back on reload failure). Returns updated NodeSchema. */
  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema;
}
