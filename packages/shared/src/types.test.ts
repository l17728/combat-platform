import { describe, it, expect } from "vitest";
import type { EntitySchemaConfig, GraphNode, ProgressLog } from "./index.js";
import type { FieldSchema, Repository, SchemaRegistry, FieldOp } from "./index.js";
import type { LeaderboardEntry, PersonHonor } from "./index.js";

describe("shared types", () => {
  it("EntitySchemaConfig shape compiles and is usable", () => {
    const cfg: EntitySchemaConfig = {
      version: 1,
      nodeTypes: [{
        nodeType: "attackTicket", label: "攻关单",
        identityKeys: ["攻关单号"], derivedToKG: true,
        fields: [{ id: "标题", name: "标题", type: "string", label: "标题", required: true }],
      }],
      edgeTypes: [{ edgeType: "ASSIGNED_TO", from: "attackTicket", to: "person" }],
    };
    expect(cfg.nodeTypes[0].fields[0].required).toBe(true);
  });
  it("GraphNode and ProgressLog carry JSON properties / sequence", () => {
    const n: GraphNode = { id: "1", nodeType: "attackTicket", properties: { 标题: "x" }, createdAt: "t", updatedAt: "t" };
    const p: ProgressLog = { id: "p1", ownerId: "1", seqNo: 1, content: "c", statusSnapshot: "进行中", updatedBy: "u", updatedAt: "t" };
    expect(n.properties["标题"]).toBe("x");
    expect(p.seqNo).toBe(1);
  });
});

describe("increment-1 contracts", () => {
  it("FieldSchema has immutable id and optional retired", () => {
    const f: FieldSchema = { id: "标题", name: "标题", type: "string", label: "标题", required: true };
    const r: FieldSchema = { id: "x", name: "x", type: "string", label: "X", retired: true };
    expect(f.id).toBe("标题");
    expect(r.retired).toBe(true);
  });
  it("Repository requires deleteNode and logAudit", () => {
    const keys: (keyof Repository)[] = ["deleteNode", "logAudit", "createNode", "updateNode"];
    expect(keys).toContain("deleteNode");
  });
  it("FieldOp union and SchemaRegistry.applyFieldOp typecheck", () => {
    const ops: FieldOp[] = [
      { op: "addField", field: { name: "根因服务", type: "string", label: "根因服务" } },
      { op: "renameLabel", id: "标题", label: "问题标题" },
      { op: "editEnum", id: "状态", enumValues: ["待响应", "已关闭"] },
      { op: "retire", id: "事件级别" },
      { op: "unretire", id: "事件级别" },
    ];
    const applyKey: keyof SchemaRegistry = "applyFieldOp";
    expect(ops).toHaveLength(5);
    expect(applyKey).toBe("applyFieldOp");
  });
});

describe("honor contracts", () => {
  it("LeaderboardEntry and PersonHonor shapes", () => {
    const l: LeaderboardEntry = { 贡献人: "张三", score: 11, 贡献数: 3, byLevel: { 核心: 1 }, byType: { 实施: 2 } };
    const p: PersonHonor = { 贡献人: "张三", contributions: [{ contribution: { id: "c1", nodeType: "contribution", properties: {}, createdAt: "t", updatedAt: "t" }, attackTicketId: "a1" }] };
    expect(l.score).toBe(11);
    expect(p.contributions[0].attackTicketId).toBe("a1");
  });
});

describe("alias contracts", () => {
  it("FieldSchema has optional aliases and FieldOp has setAliases", () => {
    const f: FieldSchema = { id: "标题", name: "标题", type: "string", label: "标题", aliases: ["title", "问题标题"] };
    const ops: FieldOp[] = [{ op: "setAliases", id: "标题", aliases: ["title"] }];
    expect(f.aliases).toEqual(["title", "问题标题"]);
    expect(ops[0].op).toBe("setAliases");
    if (ops[0].op === "setAliases") expect(ops[0].aliases).toEqual(["title"]);
  });
});
