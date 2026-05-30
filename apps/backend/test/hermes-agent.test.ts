import { describe, it, expect } from "vitest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHermesPrompt,
  parseAgentOutput,
  buildCitations,
  buildWelinkCitations,
  answerWithAgent,
  type AgentRunner,
} from "../src/hermes-agent.js";
import { ensureWelinkMessagesTable } from "../src/welink.js";
import { randomUUID } from "node:crypto";

function makeRepoRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-agent-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "enum", label: "状态", required: true,
        enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
      { name: "当前处理人", type: "string", label: "当前处理人" },
    ],
  }));
  const db = openDb(join(dir, "t.sqlite"));
  const repo = new SqliteRepository(new SqliteAdapter(db));
  const registry = new FileSchemaRegistry(cfgDir);
  return { repo, registry };
}

describe("hermes-agent 确定性核心", () => {
  describe("buildHermesPrompt", () => {
    it("含问题、数据字典(类型/字段/枚举)与 a2 引用指令", async () => {
      const { registry } = makeRepoRegistry();
      const p = buildHermesPrompt(registry, "PB-1 谁负责");
      expect(p).toContain("PB-1 谁负责");
      expect(p).toContain("攻关单");
      expect(p).toContain("当前处理人");
      expect(p).toContain("待响应");        // 枚举值出现在字典里
      expect(p).toMatch(/CITATIONS/);       // a2 引用约定
    });
  });

  describe("parseAgentOutput", () => {
    it("拆分答案正文与引用 ID(逗号/空格/中文逗号分隔)", async () => {
      const text = "张前线负责，状态处理中。\nCITATIONS: a1, b2，c3";
      const r = parseAgentOutput(text);
      expect(r.answer).toBe("张前线负责，状态处理中。");
      expect(r.citedIds).toEqual(["a1", "b2", "c3"]);
    });
    it("CITATIONS 为空 → 引用为空数组", async () => {
      const r = parseAgentOutput("没有找到相关记录。\nCITATIONS: 空");
      expect(r.citedIds).toEqual([]);
      expect(r.answer).toBe("没有找到相关记录。");
    });
    it("无 CITATIONS 行 → 全文为答案,引用空", async () => {
      const r = parseAgentOutput("只是一段普通回答。");
      expect(r.answer).toBe("只是一段普通回答。");
      expect(r.citedIds).toEqual([]);
    });
  });

  describe("buildCitations(a2 + 防幻觉)", () => {
    it("仅保留真实存在的节点;丢弃编造 ID;去重", async () => {
      const { repo } = makeRepoRegistry();
      const t = await repo.createNode("attackTicket", { 标题: "MaaS 503 故障", 状态: "处理中" }, "test");
      const cites = await buildCitations(repo, [t.id, "fake-id-不存在", t.id]);
      expect(cites).toHaveLength(1);
      expect(cites[0]).toMatchObject({
        nodeId: t.id,
        nodeType: "attackTicket",
        summary: "MaaS 503 故障",
        link: `/attack/${t.id}`,
      });
    });
    it("空输入 → 空引用", async () => {
      const { repo } = makeRepoRegistry();
      expect(await buildCitations(repo, [])).toEqual([]);
    });
  });

  describe("answerWithAgent(编排)", () => {
    it("跑 agent → HermesAnswer intent=agent,引用经校验回填", async () => {
      const { repo, registry } = makeRepoRegistry();
      const t = await repo.createNode("attackTicket", { 标题: "断网攻关", 状态: "待响应", 当前处理人: "张前线" }, "test");
      const fake: AgentRunner = {
        run: async () => `《断网攻关》当前由张前线负责，状态待响应。\nCITATIONS: ${t.id}, 编造ID`,
      };
      const ans = await answerWithAgent(repo, registry, "断网攻关谁负责", fake);
      expect(ans.intent).toBe("agent");
      expect(ans.question).toBe("断网攻关谁负责");
      expect(ans.answer).toContain("张前线");
      expect(ans.citations).toHaveLength(1);           // 编造ID 被丢弃
      expect(ans.citations[0].nodeId).toBe(t.id);
      expect(ans.citations[0].link).toBe(`/attack/${t.id}`);
    });
  });

  describe("场景 3 — parseAgentOutput 解析 WELINK_CITATIONS", () => {
    it("agent 输出含 WELINK_CITATIONS JSON → 解析为 welinkHints", () => {
      const text = [
        "小王在 [2026-05-29 11:05] 首次提到 OOM。",
        "CITATIONS: 空",
        'WELINK_CITATIONS: [{"messageId":"w42","brief":"我先看看 OOM"}]',
      ].join("\n");
      const r = parseAgentOutput(text);
      expect(r.answer).toContain("小王");
      expect(r.answer).not.toContain("WELINK_CITATIONS");
      expect(r.citedIds).toEqual([]);
      expect(r.welinkHints).toEqual([{ messageId: "w42", brief: "我先看看 OOM" }]);
    });
    it("不含 WELINK_CITATIONS → welinkHints 空", () => {
      const r = parseAgentOutput("普通回答。\nCITATIONS: 空");
      expect(r.welinkHints).toEqual([]);
    });
    it("WELINK_CITATIONS JSON 解析失败 → welinkHints 空(降级,不抛)", () => {
      const r = parseAgentOutput("回答。\nCITATIONS: 空\nWELINK_CITATIONS: [乱码,不是 JSON]");
      expect(r.welinkHints).toEqual([]);
    });
  });

  describe("场景 3 — buildWelinkCitations(防幻觉回查 db)", () => {
    function makeDbWith(rows: Array<{ ticketId: string; messageId: string; author?: string; content?: string }>) {
      const dir = mkdtempSync(join(tmpdir(), "hermes-agent-welink-"));
      const db = openDb(join(dir, "t.sqlite"));
      ensureWelinkMessagesTable(db);
      const stmt = db.prepare(
        `INSERT INTO welink_messages (id, ticket_id, message_id, sent_at, author, content, attachments, raw, selected, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 1, ?)`,
      );
      const now = new Date().toISOString();
      for (const r of rows) {
        stmt.run(randomUUID(), r.ticketId, r.messageId, "2026-05-29T10:00:00.000Z", r.author || "u1", r.content || "msg", now);
      }
      return db;
    }

    it("hints 命中真实消息 → 返回 kind=welink citation,link 含 welinkMsg query", () => {
      const db = makeDbWith([{ ticketId: "ticket-A", messageId: "w42", author: "小王", content: "我先看看 OOM" }]);
      const out = buildWelinkCitations(db, [{ messageId: "w42", brief: "我先看看 OOM" }], "ticket-A");
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe("welink");
      expect(out[0].messageId).toBe("w42");
      expect(out[0].ticketId).toBe("ticket-A");
      expect(out[0].link).toContain("/attack/ticket-A");
      expect(out[0].link).toContain("welinkMsg=w42");
    });
    it("hints 含编造 messageId → 该项被丢弃(防幻觉)", () => {
      const db = makeDbWith([{ ticketId: "ticket-A", messageId: "w42", content: "真" }]);
      const out = buildWelinkCitations(
        db,
        [{ messageId: "w42" }, { messageId: "编造-msg" }],
        "ticket-A",
      );
      expect(out).toHaveLength(1);
      expect(out[0].messageId).toBe("w42");
    });
    it("db 未注入 → 直接返回空数组,不抛", () => {
      const out = buildWelinkCitations(undefined, [{ messageId: "w42" }], "ticket-A");
      expect(out).toEqual([]);
    });
    it("空 hints → 空数组", () => {
      const db = makeDbWith([]);
      expect(buildWelinkCitations(db, [], "ticket-A")).toEqual([]);
    });
  });

  describe("场景 3 — answerWithAgent 透传 welink 引用", () => {
    it("agent 输出 WELINK_CITATIONS → citations 含 kind=welink 项", async () => {
      const { repo, registry } = makeRepoRegistry();
      // 准备 db + 一条 welink message
      const dir = mkdtempSync(join(tmpdir(), "hermes-agent-welink-flow-"));
      const db = openDb(join(dir, "t.sqlite"));
      ensureWelinkMessagesTable(db);
      const stmt = db.prepare(
        `INSERT INTO welink_messages (id, ticket_id, message_id, sent_at, author, content, attachments, raw, selected, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 1, ?)`,
      );
      stmt.run(randomUUID(), "ticket-X", "wid-1", "2026-05-29T10:00:00.000Z", "小王", "我先看看 OOM", new Date().toISOString());

      const fake: AgentRunner = {
        run: async () => [
          "小王在 [2026-05-29 10:00] 首次提到 OOM。",
          "CITATIONS: 空",
          'WELINK_CITATIONS: [{"messageId":"wid-1","brief":"我先看看 OOM"}]',
        ].join("\n"),
      };
      const ans = await answerWithAgent(repo, registry, "谁最早提 OOM", fake, "ticketId=ticket-X", db);
      const welinkCites = ans.citations.filter((c) => c.kind === "welink");
      expect(welinkCites).toHaveLength(1);
      expect(welinkCites[0].messageId).toBe("wid-1");
      expect(welinkCites[0].ticketId).toBe("ticket-X");
    });
  });
});
