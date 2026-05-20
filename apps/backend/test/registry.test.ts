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
  it("reload is tolerant (§13#9): a single malformed file is skipped with a warn, not thrown; ALL-malformed throws", async () => {
    const { vi } = await import("vitest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // single broken file alongside no valid → throws (all files failed)
    const onlyBad = mkdtempSync(join(tmpdir(), "combat-bad1-"));
    writeFileSync(join(onlyBad, "broken.json"), "{ not json");
    expect(() => new FileSchemaRegistry(onlyBad)).toThrow(/无可解析|无可解析的 schema/);
    // broken alongside a valid file → constructs successfully, valid is usable
    const mixed = mkdtempSync(join(tmpdir(), "combat-mix-"));
    writeFileSync(join(mixed, "broken.json"), "{ not json");
    writeFileSync(join(mixed, "ok.json"), JSON.stringify({
      nodeType: "ok", label: "OK", identityKeys: [], derivedToKG: true,
      fields: [{ name: "x", type: "string", label: "x" }],
    }));
    const reg = new FileSchemaRegistry(mixed);
    expect(reg.getNodeSchema("ok")).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
