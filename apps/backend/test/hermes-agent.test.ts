import { describe, it, expect } from "vitest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHermesPrompt,
  parseAgentOutput,
  buildCitations,
  answerWithAgent,
  type AgentRunner,
} from "../src/hermes-agent.js";

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
  const repo = new SqliteRepository(db);
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
});
