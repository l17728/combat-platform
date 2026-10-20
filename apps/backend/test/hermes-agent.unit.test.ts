/**
 * §v2.3.3 桶 B (r-agent) tool-calling 单测
 *
 * 覆盖:
 *   - 单轮 content → answer 正确
 *   - 单轮 tool_call → mock 执行 → 第二轮 content
 *   - 3 轮 tool_call 后 content → trace.length=3
 *   - MAX_TOOL_HOPS=6 触发 → max_hops_exceeded
 *   - 32KB 上限触发截断 → trace._truncated=true,LLM 看到 _truncated 提示
 *   - 上下文 80KB 触发折叠 → 早期 tool result 改 summary
 *   - intent router fallback(放在 hermes-router 集成层覆盖)
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import {
  runToolCalling,
  answerWithToolCalling,
  MAX_TOOL_HOPS,
  TOOL_RESULT_MAX_BYTES,
  type ToolCallingRunner,
  type LlmMessage,
  type LlmTurnResult,
  type ToolExecutor,
} from "../src/hermes-agent.js";
import { TOOL_SCHEMAS } from "../src/hermes-tools-mock.js";

function makeRepoReg() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-agent-tool-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeFileSync(
    join(cfgDir, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        {
          name: "状态",
          type: "enum",
          label: "状态",
          required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"],
        },
      ],
    })
  );
  writeFileSync(
    join(cfgDir, "person.json"),
    JSON.stringify({
      nodeType: "person",
      label: "人员",
      identityKeys: ["姓名"],
      derivedToKG: true,
      fields: [{ name: "姓名", type: "string", label: "姓名", required: true }],
    })
  );
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  const registry = new FileSchemaRegistry(cfgDir);
  return { repo, registry };
}

/** 把若干"回合"按顺序回放成 LlmTurnResult。每次 chat() 取下一回。 */
function scriptedRunner(turns: LlmTurnResult[]): {
  runner: ToolCallingRunner;
  callLog: LlmMessage[][];
} {
  let i = 0;
  const callLog: LlmMessage[][] = [];
  const runner: ToolCallingRunner = {
    chat: async (messages) => {
      callLog.push(messages.map((m) => ({ ...m })));
      if (i >= turns.length) throw new Error(`runner script exhausted (called ${i + 1} times)`);
      return turns[i++];
    },
  };
  return { runner, callLog };
}

describe("hermes-agent tool-calling (§v2.3.3 桶 B)", () => {
  describe("单轮 content", () => {
    it("LLM 直接返回 content → answer = content, trace 为空", async () => {
      const { registry } = makeRepoReg();
      const { runner } = scriptedRunner([{ content: "答案是 42。\nCITATIONS: 空" }]);
      const out = await runToolCalling({ runner, registry, question: "随便问问" });
      expect(out.content).toContain("答案是 42");
      expect(out.trace).toEqual([]);
    });
  });

  describe("单轮 tool_call → 第二轮 content", () => {
    it("第一轮 LLM 叫 list_node_types,第二轮给 content;trace.length=1", async () => {
      const { repo, registry } = makeRepoReg();
      const { runner } = scriptedRunner([
        {
          toolCalls: [{ id: "c1", name: "list_node_types", arguments: {} }],
        },
        { content: "节点类型有 2 种。\nCITATIONS: 空" },
      ]);
      const ans = await answerWithToolCalling(repo, registry, "有哪些节点类型", runner);
      expect(ans.engine).toBe("tool");
      expect(ans.trace).toHaveLength(1);
      expect(ans.trace![0].tool).toBe("list_node_types");
      expect(ans.trace![0].outputSize).toBeGreaterThan(0);
      expect(ans.answer).toContain("节点类型");
    });
  });

  describe("3 轮 tool_call 后 content → trace.length=3", () => {
    it("依次叫 list/count/query,第 4 轮 content", async () => {
      const { repo, registry } = makeRepoReg();
      await repo.createNode("attackTicket", { 标题: "test", 状态: "处理中" }, "test");
      const { runner } = scriptedRunner([
        { toolCalls: [{ id: "c1", name: "list_node_types", arguments: {} }] },
        { toolCalls: [{ id: "c2", name: "count_nodes", arguments: { nodeType: "attackTicket" } }] },
        { toolCalls: [{ id: "c3", name: "query_nodes", arguments: { nodeType: "attackTicket", limit: 5 } }] },
        { content: "共有 1 条攻关单。\nCITATIONS: 空" },
      ]);
      const out = await runToolCalling({
        runner,
        registry,
        question: "有几条攻关单",
        ctx: { repo, registry },
      });
      expect(out.trace).toHaveLength(3);
      expect(out.trace.map((t) => t.tool)).toEqual(["list_node_types", "count_nodes", "query_nodes"]);
      expect(out.content).toContain("共有 1 条");
    });
  });

  describe("MAX_TOOL_HOPS=6 触发 → max_hops_exceeded", () => {
    it("LLM 一直叫工具不收尾,超过 maxHops 抛错", async () => {
      const { registry } = makeRepoReg();
      // 每次都叫 list_node_types(无限循环)
      const turns: LlmTurnResult[] = Array.from({ length: 10 }, () => ({
        toolCalls: [{ id: "c", name: "list_node_types", arguments: {} }],
      }));
      const { runner } = scriptedRunner(turns);
      await expect(runToolCalling({ runner, registry, question: "死循环", maxHops: 3 })).rejects.toThrow(
        /max_hops_exceeded/
      );
    });

    it("默认 MAX_TOOL_HOPS 为 6", () => {
      expect(MAX_TOOL_HOPS).toBe(6);
    });
  });

  describe("32KB 上限触发截断", () => {
    it("工具返回 > 32KB → trace._truncated=true, content 含 _truncated 标志", async () => {
      const { registry } = makeRepoReg();
      const big = "x".repeat(TOOL_RESULT_MAX_BYTES + 1000);
      const executor: ToolExecutor = async () => ({ data: big });
      let toolMsgContent = "";
      const runner: ToolCallingRunner = {
        chat: async (messages) => {
          // 第一次叫工具
          if (messages.filter((m) => m.role === "tool").length === 0) {
            return { toolCalls: [{ id: "c1", name: "list_node_types", arguments: {} }] };
          }
          // 第二次:把 tool message 内容记录后给 content
          const toolMsg = messages.find((m) => m.role === "tool");
          if (toolMsg?.content) toolMsgContent = toolMsg.content;
          return { content: "知道了。\nCITATIONS: 空" };
        },
      };
      const out = await runToolCalling({ runner, registry, question: "X", executor });
      expect(out.trace).toHaveLength(1);
      expect(out.trace[0]._truncated).toBe(true);
      // LLM 看到的 tool result 已被替换成 _truncated wrapper
      expect(toolMsgContent).toContain("_truncated");
    });
  });

  describe("工具执行抛错 → trace.error 填充,LLM 收到 error 字段", () => {
    it("executor throw → trace[i].error 有值,LLM tool message 是 {error:...}", async () => {
      const { registry } = makeRepoReg();
      const executor: ToolExecutor = async () => {
        throw new Error("boom");
      };
      const { runner } = scriptedRunner([
        { toolCalls: [{ id: "c1", name: "list_node_types", arguments: {} }] },
        { content: "失败了。\nCITATIONS: 空" },
      ]);
      const out = await runToolCalling({ runner, registry, question: "X", executor });
      expect(out.trace).toHaveLength(1);
      expect(out.trace[0].error).toBe("boom");
    });
  });

  describe("answerWithToolCalling — 全链路", () => {
    it("LLM 引用真实 id 与编造 id → 编造 id 被丢弃", async () => {
      const { repo, registry } = makeRepoReg();
      const t = await repo.createNode("attackTicket", { 标题: "断网", 状态: "处理中" }, "test");
      const { runner } = scriptedRunner([
        {
          toolCalls: [{ id: "c1", name: "query_nodes", arguments: { nodeType: "attackTicket" } }],
        },
        {
          content: `《断网》处理中。\nCITATIONS: ${t.id}, 编造ID`,
        },
      ]);
      const ans = await answerWithToolCalling(repo, registry, "断网状态", runner);
      expect(ans.engine).toBe("tool");
      expect(ans.intent).toBe("agent");
      expect(ans.citations).toHaveLength(1);
      expect(ans.citations[0].nodeId).toBe(t.id);
      expect(ans.trace).toHaveLength(1);
      expect(ans.trace![0].tool).toBe("query_nodes");
    });
  });

  describe("上下文折叠 — 大量 tool result 时早期消息被折叠", () => {
    it("第 5+ 轮 tool result 折叠后,LLM 看到的早期 tool message 被改写成 summary", async () => {
      const { registry } = makeRepoReg();
      // 故意把每轮工具结果做得很大,逼近 CONTEXT_MAX_BYTES
      const bigPayload = "y".repeat(30 * 1024);
      const executor: ToolExecutor = async () => ({ items: [bigPayload] });
      let lastSeenMessages: LlmMessage[] | undefined;
      let hops = 0;
      const runner: ToolCallingRunner = {
        chat: async (messages) => {
          lastSeenMessages = messages;
          if (hops < 4) {
            hops++;
            return { toolCalls: [{ id: `c${hops}`, name: "list_node_types", arguments: {} }] };
          }
          return { content: "好了。\nCITATIONS: 空" };
        },
      };
      const out = await runToolCalling({ runner, registry, question: "X", executor, maxHops: 6 });
      expect(out.content).toContain("好了");
      // 检查最后一次发给 LLM 的 messages 中,早期 tool message 已被折叠
      const toolMsgs = (lastSeenMessages ?? []).filter((m) => m.role === "tool");
      const folded = toolMsgs.filter((m) => (m.content ?? "").includes("previous tool result"));
      expect(folded.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("TOOL_SCHEMAS shape", () => {
    it("符合 OpenAI ChatCompletions tools 协议", () => {
      expect(Array.isArray(TOOL_SCHEMAS)).toBe(true);
      expect(TOOL_SCHEMAS.length).toBeGreaterThanOrEqual(4);
      for (const s of TOOL_SCHEMAS) {
        expect(s.type).toBe("function");
        expect(typeof s.function.name).toBe("string");
        expect(typeof s.function.description).toBe("string");
        expect(s.function.parameters.type).toBe("object");
      }
      const names = TOOL_SCHEMAS.map((t) => t.function.name);
      expect(names).toContain("list_node_types");
      expect(names).toContain("query_nodes");
    });
  });
});
