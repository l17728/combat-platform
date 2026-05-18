import { describe, it, expect } from "vitest";
import { FileSchemaRegistry } from "../src/registry.js";
import { join } from "node:path";

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
});
