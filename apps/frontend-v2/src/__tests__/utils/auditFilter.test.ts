import { describe, it, expect } from "vitest";
import { categorizeAudit, filterKeyAudits } from "../../utils/auditFilter.js";
import type { AuditLogEntry } from "@combat/shared";

function entry(partial: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: "a1",
    action: "UPDATE",
    entityType: "node",
    entityId: "n1",
    performedBy: "admin",
    performedAt: "2026-05-31T00:00:00Z",
    changes: null,
    ...partial,
  } as AuditLogEntry;
}

describe("auditFilter.categorizeAudit", () => {
  it("ESCALATE → 升级 (orange)", () => {
    const r = categorizeAudit(entry({ action: "ESCALATE" }));
    expect(r?.kind).toBe("升级");
    expect(r?.color).toBe("orange");
  });

  it("MERGE → 合并 (gold)", () => {
    const r = categorizeAudit(entry({ action: "MERGE" }));
    expect(r?.kind).toBe("合并");
    expect(r?.color).toBe("gold");
  });

  it("UPDATE + changes.状态 → 状态流转 (green) 含 from→to summary", () => {
    const r = categorizeAudit(
      entry({
        action: "UPDATE",
        changes: { 状态: { from: "待响应", to: "处理中" } },
      })
    );
    expect(r?.kind).toBe("状态流转");
    expect(r?.color).toBe("green");
    expect(r?.summary).toContain("待响应");
    expect(r?.summary).toContain("处理中");
  });

  it("UPDATE + changes.成员列表 → 成员变更 (blue)", () => {
    const r = categorizeAudit(entry({ action: "UPDATE", changes: { 成员列表: { from: "[]", to: "[{}]" } } }));
    expect(r?.kind).toBe("成员变更");
    expect(r?.color).toBe("blue");
  });

  it("UPDATE + changes.攻关组长 → 成员变更", () => {
    const r = categorizeAudit(entry({ action: "UPDATE", changes: { 攻关组长: { from: "", to: "张三" } } }));
    expect(r?.kind).toBe("成员变更");
  });

  it("CREATE / DELETE / 与无关字段更新 → null(不进 Timeline)", () => {
    expect(categorizeAudit(entry({ action: "CREATE" }))).toBeNull();
    expect(categorizeAudit(entry({ action: "DELETE" }))).toBeNull();
    expect(categorizeAudit(entry({ action: "UPDATE", changes: { 客户名称: { from: "A", to: "B" } } }))).toBeNull();
  });

  it("UPDATE + changes 为 null/非对象 → null", () => {
    expect(categorizeAudit(entry({ action: "UPDATE", changes: null }))).toBeNull();
  });
});

describe("auditFilter.filterKeyAudits", () => {
  it("过滤后保持原顺序,只剩可分类条目", () => {
    const list = [
      entry({ id: "1", action: "CREATE" }), // 丢
      entry({ id: "2", action: "UPDATE", changes: { 状态: { from: "A", to: "B" } } }),
      entry({ id: "3", action: "UPDATE", changes: { 客户名称: { from: "x", to: "y" } } }), // 丢
      entry({ id: "4", action: "MERGE" }),
    ];
    const r = filterKeyAudits(list);
    expect(r.map((c) => c.entry.id)).toEqual(["2", "4"]);
  });

  it("空数组 → 空数组", () => {
    expect(filterKeyAudits([])).toEqual([]);
  });
});
