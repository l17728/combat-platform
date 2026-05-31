import { describe, it, expect } from "vitest";
import { filterToSql, validateFilter } from "../src/hermes-tools.js";

describe("hermes-tools filter DSL → SQL", () => {
  it("空 filter → 无 WHERE", () => {
    const { sql, params } = filterToSql(undefined);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("空对象 filter → 无 WHERE", () => {
    const { sql, params } = filterToSql({});
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("等值简写 (字符串)", () => {
    const { sql, params } = filterToSql({ 状态: "处理中" });
    expect(sql).toMatch(/json_extract\(properties, '\$\."状态"'\)\s*=\s*\?/);
    expect(params).toEqual(["处理中"]);
  });

  it("eq op", () => {
    const { sql, params } = filterToSql({ 状态: { op: "eq", val: "处理中" } });
    expect(sql).toMatch(/json_extract\(properties, '\$\."状态"'\)\s*=\s*\?/);
    expect(params).toEqual(["处理中"]);
  });

  it("ne op", () => {
    const { sql, params } = filterToSql({ 状态: { op: "ne", val: "已关闭" } });
    expect(sql).toMatch(/!=|<>/);
    expect(params).toEqual(["已关闭"]);
  });

  it("gt/gte/lt/lte op", () => {
    for (const op of ["gt", "gte", "lt", "lte"] as const) {
      const { sql, params } = filterToSql({ updatedAt: { op, val: "2026-05-01" } });
      expect(sql).toContain("?");
      expect(params).toEqual(["2026-05-01"]);
      // top-level field bypass json_extract
      expect(sql).toContain("updated_at");
    }
  });

  it("in op (多值)", () => {
    const { sql, params } = filterToSql({ 当前处理人: { op: "in", val: ["张三", "李四"] } });
    expect(sql).toMatch(/\?,\s*\?/);
    expect(params).toEqual(["张三", "李四"]);
  });

  it("in 空数组 → 永假 (1=0)", () => {
    const { sql } = filterToSql({ 当前处理人: { op: "in", val: [] } });
    expect(sql).toContain("1=0");
  });

  it("like op", () => {
    const { sql, params } = filterToSql({ 标题: { op: "like", val: "断网" } });
    expect(sql).toMatch(/LIKE/i);
    expect(params).toEqual(["%断网%"]);
  });

  it("nodeType/id/createdAt/updatedAt 走顶层列", () => {
    const { sql: s1 } = filterToSql({ nodeType: "person" });
    expect(s1).toContain('"nodeType" = ?');
    const { sql: s2 } = filterToSql({ id: "abc-123" });
    expect(s2).toContain("id = ?");
    const { sql: s3 } = filterToSql({ createdAt: { op: "gte", val: "2026-01-01" } });
    expect(s3).toContain("created_at");
    const { sql: s4 } = filterToSql({ updatedAt: { op: "lt", val: "2026-12-31" } });
    expect(s4).toContain("updated_at");
  });

  it("多 key → AND 拼接", () => {
    const { sql, params } = filterToSql({ 状态: "处理中", 等级: "高" });
    expect(sql.toUpperCase()).toContain("AND");
    expect(params).toEqual(["处理中", "高"]);
  });

  it("拒绝危险 key — SQL 注入尝试 (单引号)", () => {
    expect(() => filterToSql({ "x'; DROP TABLE nodes;--": "y" })).toThrow(/非法字段名|invalid|key/);
  });

  it("拒绝危险 key — 斜杠 / 通配符", () => {
    expect(() => filterToSql({ "状态/*": "x" })).toThrow();
    expect(() => filterToSql({ "状态)": "x" })).toThrow();
  });

  it("拒绝 unknown op", () => {
    expect(() => filterToSql({ 状态: { op: "regex" as any, val: "x" } })).toThrow(/非法操作符|op/);
  });

  it("in 非数组 → 报错", () => {
    expect(() => filterToSql({ 状态: { op: "in", val: "x" as any } })).toThrow(/array/i);
  });

  it("validateFilter 与 filterToSql 一致拒绝", () => {
    expect(validateFilter({ 状态: "处理中" })).toBe(null);
    expect(validateFilter({ "x'": "y" })).not.toBe(null);
  });

  it("数字/布尔值简写等值", () => {
    const { sql, params } = filterToSql({ active: true, score: 5 });
    expect(sql).toContain("?");
    expect(params).toEqual([true, 5]);
  });
});
