import { describe, it, expect } from "vitest";
import { FileSchemaRegistry } from "../src/registry.js";
import { validateNode } from "../src/validation.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function regWith(schema: object) {
  const dir = mkdtempSync(join(tmpdir(), "combat-vid-"));
  writeFileSync(join(dir, "t.json"), JSON.stringify(schema));
  return new FileSchemaRegistry(dir);
}

describe("id-based validation + legacy normalization", () => {
  it("legacy config without field.id gets id defaulted to name on load", () => {
    const reg = regWith({ nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ name: "标题", type: "string", label: "标题", required: true }] });
    expect(reg.getNodeSchema("t")!.fields[0].id).toBe("标题");
  });
  it("validateNode reads values by field.id and rejects missing required", () => {
    const reg = regWith({ nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ id: "标题", name: "标题", type: "string", label: "标题", required: true }] });
    expect(reg.validateNode("t", {}).ok).toBe(false);
    expect(reg.validateNode("t", { "标题": "x" }).ok).toBe(true);
  });
  it("validateNode skips retired fields entirely", () => {
    const reg = regWith({ nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ id: "f1", name: "f1", type: "enum", label: "F1", required: true,
                 enumValues: ["a"], retired: true }] });
    expect(reg.validateNode("t", {}).ok).toBe(true);
    expect(reg.validateNode("t", { f1: "不在枚举" }).ok).toBe(true);
  });
  it("validateNode unit: value read by id not name", () => {
    const schema = { nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ id: "real-id", name: "displayName", type: "string", label: "L", required: true }] } as any;
    expect(validateNode(schema, { "displayName": "x" }).ok).toBe(false);
    expect(validateNode(schema, { "real-id": "x" }).ok).toBe(true);
  });
});
