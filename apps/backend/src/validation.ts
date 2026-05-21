import type { NodeSchema, ValidationResult } from "@combat/shared";

export function validateNode(schema: NodeSchema, props: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  for (const f of schema.fields) {
    if (f.retired) continue;
    const v = props[f.id];
    if (f.required && (v === undefined || v === null || v === "")) {
      errors.push(`字段「${f.label}」必填`);
      continue;
    }
    // M2 fix: an optional enum left blank (undefined/null/"") is valid — only a
    // non-empty value must be in the enum. (Excel empty cells arrive as "" and
    // were wrongly rejected, silently skipping valid import rows.)
    if (v !== undefined && v !== null && v !== "" && f.type === "enum" && f.enumValues && !f.enumValues.includes(String(v))) {
      errors.push(`字段「${f.label}」取值非法: ${String(v)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
