import { describe, it, expect } from "vitest";
import { FileSchemaRegistry } from "../src/registry.js";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CONFIG_DIR = join(process.cwd(), "..", "..", "config", "schemas");

describe("FileSchemaRegistry", () => {
  const reg = new FileSchemaRegistry(CONFIG_DIR);
  it("loads attackTicket schema from config dir", () => {
    expect(reg.getNodeSchema("attackTicket")?.label).toBe("攻关单");
  });
  it("rejects missing required field", () => {
    const r = reg.validateNode("attackTicket", { 状态: "进行中" });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("标题");
  });
  it("rejects invalid enum value (Chinese literals canonical)", () => {
    const r = reg.validateNode("attackTicket", { 标题: "x", 状态: "不存在" });
    expect(r.ok).toBe(false);
  });
  it("accepts valid node", () => {
    expect(reg.validateNode("attackTicket", { 标题: "x", 状态: "进行中" }).ok).toBe(true);
  });
  it("returns error for unknown nodeType", () => {
    const r = reg.validateNode("不存在的类型", {});
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("未知节点类型");
  });
  it("reload throws a descriptive error on a malformed schema file", () => {
    const dir = mkdtempSync(join(tmpdir(), "combat-bad-"));
    writeFileSync(join(dir, "broken.json"), "{ not json");
    expect(() => new FileSchemaRegistry(dir)).toThrow(/不是合法 JSON/);
  });
});
