import type { NodeSchema, ValidationResult } from "@combat/shared";

export function validateNode(schema: NodeSchema, props: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  for (const f of schema.fields) {
    const v = props[f.name];
    if (f.required && (v === undefined || v === null || v === "")) {
      errors.push(`字段「${f.name}」必填`);
      continue;
    }
    if (v !== undefined && f.type === "enum" && f.enumValues && !f.enumValues.includes(String(v))) {
      errors.push(`字段「${f.name}」取值非法: ${String(v)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
