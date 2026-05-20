import { describe, it, expect } from "vitest";
import type { EntitySchemaConfig, GraphNode, ProgressLog } from "./index.js";
import type { QueryHit, QueryContext, HelperRecommendation } from "./index.js";
import type { FieldSchema, Repository, SchemaRegistry, FieldOp } from "./index.js";
import type { LeaderboardEntry, PersonHonor } from "./index.js";
import type { RelationProposal, RelationProposalStatus, RelationProposer } from "./index.js";
import type { DashboardSummary } from "./index.js";
import type { DailyReport, DailyReportSection, DailyReportEntry } from "./index.js";
import type { Reminder, ReminderStatus, ReminderKind, ChannelAdapter } from "./index.js";
import type { ExpandedItem, ConflictItem, ConflictRow, ScanConflictsResult, RebuildKGResult, HermesAnswer, HermesCitation, HermesIntent } from "./index.js";

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

describe("ref-edge contracts", () => {
  it("Repository requires deleteEdges", () => {
    const keys: (keyof Repository)[] = ["deleteEdges", "createEdge", "queryEdges"];
    expect(keys).toContain("deleteEdges");
  });
});

describe("concept contracts", () => {
  it("FieldSchema has optional concept and FieldOp has setConcept", () => {
    const f: FieldSchema = { id: "当前处理人", name: "当前处理人", type: "ref", label: "当前处理人", refType: "person", concept: "负责人" };
    const ops: FieldOp[] = [{ op: "setConcept", id: "当前处理人", concept: "负责人" }];
    expect(f.concept).toBe("负责人");
    expect(ops[0].op).toBe("setConcept");
    if (ops[0].op === "setConcept") expect(ops[0].concept).toBe("负责人");
  });
});

describe("relation-proposal contracts", () => {
  it("RelationProposal shape + Chinese status literals", () => {
    const p: RelationProposal = {
      id: "p1", sourceNodeId: "a", targetNodeId: "b", relationType: "SAME_AS",
      confidence: 0.8, proposerSource: "heuristic-v1", rationale: "张伟≈张玮 dist=1",
      status: "待审批", createdAt: new Date().toISOString(),
    };
    const decided: RelationProposalStatus[] = ["待审批", "已通过", "已拒绝"];
    expect(decided).toContain(p.status);
    const p2: RelationProposal = { ...p, status: "已通过", decidedBy: "运营", decidedAt: "t" };
    expect(p2.decidedBy).toBe("运营");
  });
  it("RelationProposer.propose returns proposal drafts (no id/status)", () => {
    const proposer: RelationProposer = {
      propose: () => [{ sourceNodeId: "a", targetNodeId: "b", relationType: "SAME_AS",
        confidence: 0.9, proposerSource: "heuristic-v1", rationale: "r" }],
    };
    const out = proposer.propose({} as Repository, {} as SchemaRegistry);
    expect(out[0].relationType).toBe("SAME_AS");
  });
});

describe("anchor contracts", () => {
  it("FieldSchema.anchor? + FieldOp setAnchor", () => {
    const f: FieldSchema = { id: "问题单号", name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" };
    expect(f.anchor).toBe("问题单号");
    const op: FieldOp = { op: "setAnchor", id: "问题单号", anchor: "问题单号" };
    expect(op.op).toBe("setAnchor");
  });
});

describe("query contracts", () => {
  it("QueryHit + QueryContext shapes", () => {
    const h: QueryHit = { id: "n1", nodeType: "attackTicket", summary: "断网攻关", score: 2 };
    expect(h.score).toBe(2);
    const ctx: QueryContext = {
      node: { id: "n1", nodeType: "attackTicket", properties: {}, createdAt: "t", updatedAt: "t" },
      related: { outgoing: [], incoming: [], coAnchored: [] },
      progress: [],
    };
    expect(ctx.related.coAnchored).toEqual([]);
  });
});

describe("helper-recommendation contract", () => {
  it("HelperRecommendation shape", () => {
    const r: HelperRecommendation = {
      person: { id: "p1", nodeType: "person", properties: { name: "张三" }, createdAt: "t", updatedAt: "t" },
      score: 6, reasons: ["曾处理共享问题单「PB-1」的攻关单「断网」"],
    };
    expect(r.score).toBe(6);
    expect(r.reasons[0]).toContain("PB-1");
  });
});

describe("dashboard contract", () => {
  it("DashboardSummary shape", () => {
    const d: DashboardSummary = {
      tickets: { total: 3, byStatus: { 进行中: 2, 已解决: 1 }, open: 2, resolved: 1 },
      contributions: { total: 4, topContributors: [{ 贡献人: "张三", count: 3 }] },
      proposalsPending: 1,
      conflicts: { count: 2, topReasons: ["同负责人多并发：甲"] },
      today: { progressEntries: 5, ticketsTouched: 3 },
      recentActivity: [{ ticketId: "t1", 标题: "断网攻关", 状态: "进行中", lastChangedAt: "2026-05-20T10:00:00Z" }],
    };
    expect(d.tickets.open).toBe(2);
    expect(d.contributions.topContributors[0].贡献人).toBe("张三");
    expect(d.conflicts.count).toBe(2);
    expect(d.today.progressEntries).toBe(5);
    expect(d.recentActivity[0].标题).toBe("断网攻关");
  });
});

describe("daily-report contracts", () => {
  it("DailyReport shape", () => {
    const e: DailyReportEntry = { seqNo: 1, statusSnapshot: "进行中", content: "进展X", updatedBy: "甲", at: "2026-05-20T01:02:03Z" };
    const s: DailyReportSection = { ticketId: "t1", 标题: "T1", latestStatus: "进行中", entries: [e] };
    const r: DailyReport = {
      date: "2026-05-20",
      sections: [s],
      summary: { ticketsTouched: 1, entriesTotal: 1, openByStatus: { 进行中: 1 } },
    };
    expect(r.sections[0].entries[0].statusSnapshot).toBe("进行中");
    expect(r.sections[0].标题).toBe("T1");
  });
});

describe("reminder contracts", () => {
  it("Reminder shape + status enum + ChannelAdapter interface", () => {
    const r: Reminder = {
      id: "r1", kind: "问题单跟催", ticketId: "t1",
      recipientPersonId: "p1", recipientName: "甲",
      subject: "跟催: T1", body: "已停滞 5 天",
      status: "待发送", createdAt: new Date().toISOString(),
    };
    const all: ReminderStatus[] = ["待发送", "已发送", "已忽略"];
    expect(all).toContain(r.status);
    const ch: ChannelAdapter = { send: () => ({ sentAt: "t" }) };
    expect(ch.send(r, "actor").sentAt).toBe("t");
  });
  it("ReminderKind extended with 'CCB 提醒' (李嘉②)", () => {
    const kinds: ReminderKind[] = ["问题单跟催", "FE Deadline 提醒", "CCB 提醒"];
    const ccb: Reminder = {
      id: "r2", kind: "CCB 提醒", ticketId: "t1", recipientName: "甲",
      subject: "[CCB] T1", body: "需上 CCB", status: "待发送",
      createdAt: new Date().toISOString(),
    };
    expect(kinds).toContain(ccb.kind);
  });
});

describe("depth-N expansion contract (§32)", () => {
  it("ExpandedItem shape", () => {
    const e: ExpandedItem = {
      node: { id: "n2", nodeType: "person", properties: { name: "甲" }, createdAt: "t", updatedAt: "t" },
      depth: 2, viaEdgeType: "REF", viaField: "当前处理人", parentId: "root",
    };
    expect(e.depth).toBe(2);
    expect(e.viaEdgeType).toBe("REF");
  });
});

describe("conflict / overlap contract (§33)", () => {
  it("ConflictItem + ConflictRow + ScanConflictsResult shapes", () => {
    const node = { id: "n1", nodeType: "attackTicket", properties: { 标题: "X" }, createdAt: "t", updatedAt: "t" };
    const c: ConflictItem = { edgeType: "CONFLICTS_WITH", reason: "同负责人多并发：甲", node };
    expect(c.edgeType).toBe("CONFLICTS_WITH");
    const r: ConflictRow = {
      edgeType: "OVERLAPS_WITH", reason: "同问题单：PB-1",
      source: node, target: { ...node, id: "n2" },
    };
    expect(r.edgeType).toBe("OVERLAPS_WITH");
    const s: ScanConflictsResult = { conflicts: 2, overlaps: 1 };
    expect(s.conflicts + s.overlaps).toBe(3);
  });
});

describe("KG rebuild contract (§34)", () => {
  it("RebuildKGResult shape", () => {
    const r: RebuildKGResult = { refEdges: 7, anchorEdges: 5, conflicts: 1, overlaps: 2, durationMs: 12 };
    expect(r.refEdges + r.anchorEdges).toBe(12);
    expect(r.durationMs).toBeGreaterThan(0);
  });
});

describe("Hermes contract (§35)", () => {
  it("HermesAnswer + HermesCitation + HermesIntent shapes", () => {
    const c: HermesCitation = { nodeId: "t1", nodeType: "attackTicket", summary: "断网攻关", link: "/attack/t1" };
    const intents: HermesIntent[] = ["status", "owner", "ticket-by-pb", "person-workload", "fallback-search",
      "contribution-by-person", "recent-changes", "find-helpers"];
    const a: HermesAnswer = { question: "X 谁负责", intent: "owner", answer: "甲负责。", citations: [c] };
    expect(a.citations[0].summary).toBe("断网攻关");
    expect(intents.length).toBe(8);
  });
});
