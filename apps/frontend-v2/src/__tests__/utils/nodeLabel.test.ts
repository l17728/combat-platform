import { describe, it, expect } from "vitest";
import { nodeLabel, detailPath } from "../../utils/nodeLabel.js";

describe("utils.nodeLabel", () => {
  it("优先 标题 字段(攻关单)", () => {
    expect(
      nodeLabel({
        nodeType: "attackTicket",
        properties: { 标题: "GPU 卡死", 攻关单号: "AT-2026-001", 姓名: "不应取到" },
      })
    ).toBe("GPU 卡死");
  });

  it("标题未设置 → 退到 攻关单号", () => {
    // 注意 ?? 只 fallback null/undefined,空白字符串本身仍优先返回 → 这是设计约定
    expect(nodeLabel({ nodeType: "attackTicket", properties: { 攻关单号: "AT-001" } })).toBe("AT-001");
  });

  it("人员节点用 姓名", () => {
    expect(nodeLabel({ nodeType: "person", properties: { 姓名: "张三", 工号: "E001" } })).toBe("张三");
  });

  it("英文 name 字段也兜底", () => {
    expect(nodeLabel({ nodeType: "person", properties: { name: "alice" } })).toBe("alice");
  });

  it("贡献节点用 贡献人", () => {
    expect(nodeLabel({ nodeType: "contribution", properties: { 贡献人: "李四" } })).toBe("李四");
  });

  it("无可读字段 → 退到中文类型名,绝不返回 id (UUID)", () => {
    expect(
      nodeLabel({
        nodeType: "attackTicket",
        id: "abc-uuid-1234",
        properties: {},
      })
    ).toBe("攻关单");
  });

  it("未知 nodeType 且无可读字段 → 类型字符串本身", () => {
    expect(nodeLabel({ nodeType: "unknownType", properties: {} })).toBe("unknownType");
  });

  it("properties 缺失 → 不抛错,返回类型名", () => {
    expect(nodeLabel({ nodeType: "person" } as any)).toBe("人员");
  });
});

describe("utils.detailPath", () => {
  it("攻关单走 /attack/:id", () => {
    expect(detailPath({ nodeType: "attackTicket", id: "x1" })).toBe("/attack/x1");
  });

  it("其它类型走 /related/:type/:id", () => {
    expect(detailPath({ nodeType: "person", id: "p1" })).toBe("/related/person/p1");
    expect(detailPath({ nodeType: "contribution", id: "c1" })).toBe("/related/contribution/c1");
  });
});
