/**
 * §v2.3.4 — OpenAICompatibleRunner 单测
 *
 * Replaces OpencodeToolCallingRunner. Pure-fetch implementation of both
 * AgentRunner.run(prompt) and ToolCallingRunner.chat(messages, tools).
 *
 * Coverage:
 *  - chat() pure-text reply (no tool_calls)
 *  - chat() single tool_call, arguments JSON.parse
 *  - chat() multiple tool_calls
 *  - chat() empty arguments string -> {} fallback
 *  - chat() thinking: disabled -> request body has thinking:{type:'disabled'}
 *  - chat() thinking: enabled -> request body has thinking:{type:'enabled'}
 *  - chat() thinking: auto -> request body has NO thinking field
 *  - chat() HTTP 4xx/5xx -> throw with status
 *  - chat() invalid JSON -> throw
 *  - chat() timeout -> throw timeout error
 *  - chat() tools=[] -> request body omits tools + tool_choice
 *  - chat() Authorization: Bearer <apiKey>
 *  - run() text prompt -> POST + return content
 *  - run() honors thinking config from getConfig hook
 *  - getConfig() called each invocation for hot-reload
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAICompatibleRunner } from "../src/openai-compatible-runner.js";
import type { LlmMessage } from "../src/hermes-agent.js";
import type { ToolSchema } from "../src/hermes-tools.js";

const sampleTools: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "list_node_types",
      description: "列出所有 nodeType",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "count_nodes",
      description: "计数",
      parameters: {
        type: "object",
        properties: { nodeType: { type: "string" } },
        required: ["nodeType"],
      },
    },
  },
];

function mockOk(bodyObj: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(bodyObj),
  })) as unknown as typeof fetch;
}

describe("OpenAICompatibleRunner", () => {
  let savedFetch: typeof fetch;
  beforeEach(() => {
    savedFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = savedFetch;
    vi.restoreAllMocks();
  });

  describe("chat() — pure text reply", () => {
    it("LLM 返回 content (no tool_calls) → out.content 解析", async () => {
      const captured: { url?: string; body?: any; auth?: string } = {};
      global.fetch = vi.fn(async (url: any, init: any) => {
        captured.url = String(url);
        captured.body = JSON.parse(init.body as string);
        captured.auth = (init.headers as Record<string, string>).Authorization;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "答案是 42。\nCITATIONS: 空" } }],
            }),
        } as Response;
      }) as unknown as typeof fetch;

      const runner = new OpenAICompatibleRunner({
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "test-key",
        model: "glm-4.6",
        thinking: "disabled",
      });
      const messages: LlmMessage[] = [
        { role: "system", content: "你是 Hermes" },
        { role: "user", content: "问题" },
      ];
      const turn = await runner.chat(messages, sampleTools);
      expect(turn.content).toContain("答案是 42");
      expect(turn.toolCalls).toBeUndefined();
      expect(captured.url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
      expect(captured.auth).toBe("Bearer test-key");
      expect(captured.body.model).toBe("glm-4.6");
      expect(captured.body.tools?.length).toBe(2);
      expect(captured.body.tool_choice).toBe("auto");
      expect(captured.body.thinking).toEqual({ type: "disabled" });
    });
  });

  describe("chat() — tool_calls", () => {
    it("LLM 返回单个 tool_call → arguments JSON.parse 为对象", async () => {
      global.fetch = mockOk({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "tc-1",
                  type: "function",
                  function: { name: "count_nodes", arguments: '{"nodeType":"person"}' },
                },
              ],
            },
          },
        ],
      });
      const runner = new OpenAICompatibleRunner({
        baseURL: "https://x/v4",
        apiKey: "k",
        model: "m",
      });
      const turn = await runner.chat([{ role: "user", content: "?" }], sampleTools);
      expect(turn.content).toBeUndefined();
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls?.[0].name).toBe("count_nodes");
      expect(turn.toolCalls?.[0].arguments).toEqual({ nodeType: "person" });
    });

    it("LLM 返回多个 tool_calls → 全部进 toolCalls", async () => {
      global.fetch = mockOk({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "a", type: "function", function: { name: "list_node_types", arguments: "{}" } },
                {
                  id: "b",
                  type: "function",
                  function: { name: "count_nodes", arguments: '{"nodeType":"attackTicket"}' },
                },
              ],
            },
          },
        ],
      });
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      const turn = await runner.chat([{ role: "user", content: "?" }], sampleTools);
      expect(turn.toolCalls).toHaveLength(2);
      expect(turn.toolCalls?.map((c) => c.name)).toEqual(["list_node_types", "count_nodes"]);
    });

    it("LLM 返回 tool_call 的 arguments 是空串 → arguments={} 容错", async () => {
      global.fetch = mockOk({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "x", type: "function", function: { name: "list_node_types", arguments: "" } }],
            },
          },
        ],
      });
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      const turn = await runner.chat([{ role: "user", content: "?" }], sampleTools);
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls?.[0].arguments).toEqual({});
    });
  });

  describe("chat() — thinking field mapping", () => {
    it("thinking=disabled → body.thinking={type:'disabled'}", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({
        baseURL: "https://x/v4",
        apiKey: "k",
        model: "m",
        thinking: "disabled",
      });
      await runner.chat([{ role: "user", content: "?" }], []);
      expect(captured.body.thinking).toEqual({ type: "disabled" });
    });

    it("thinking=enabled → body.thinking={type:'enabled'}", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({
        baseURL: "https://x/v4",
        apiKey: "k",
        model: "m",
        thinking: "enabled",
      });
      await runner.chat([{ role: "user", content: "?" }], []);
      expect(captured.body.thinking).toEqual({ type: "enabled" });
    });

    it("thinking=auto → body 无 thinking 字段 (provider 默认)", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m", thinking: "auto" });
      await runner.chat([{ role: "user", content: "?" }], []);
      expect(captured.body.thinking).toBeUndefined();
    });
  });

  describe("chat() — empty tools list", () => {
    it("tools=[] → body 不带 tools 与 tool_choice", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      await runner.chat([{ role: "user", content: "?" }], []);
      expect(captured.body.tools).toBeUndefined();
      expect(captured.body.tool_choice).toBeUndefined();
    });
  });

  describe("chat() — error handling", () => {
    it("HTTP 500 → throw with status", async () => {
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "boom",
      })) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      await expect(runner.chat([{ role: "user", content: "?" }], [])).rejects.toThrow(/500/);
    });

    it("HTTP 401 → throw", async () => {
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "bad key",
      })) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      await expect(runner.chat([{ role: "user", content: "?" }], [])).rejects.toThrow(/401/);
    });

    it("invalid JSON 响应 → throw", async () => {
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "not-json{{",
      })) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      await expect(runner.chat([{ role: "user", content: "?" }], [])).rejects.toThrow(/JSON|parse/i);
    });

    it("网络错 → throw 原 error", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      await expect(runner.chat([{ role: "user", content: "?" }], [])).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe("chat() — timeout", () => {
    it("timeoutMs 超时 → throw timeout error", async () => {
      global.fetch = vi.fn((_url: any, init: any) => {
        return new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () => {
            const e = new Error("aborted");
            (e as Error & { name: string }).name = "AbortError";
            reject(e);
          });
        });
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({
        baseURL: "https://x/v4",
        apiKey: "k",
        model: "m",
        timeoutMs: 30,
      });
      await expect(runner.chat([{ role: "user", content: "?" }], [])).rejects.toThrow(/timeout/i);
    });
  });

  describe("run() — AgentRunner interface", () => {
    it("run(prompt) → POST messages:[{role:'user',content:prompt}] 返回 content", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "hello world" } }] }),
        } as Response;
      }) as unknown as typeof fetch;
      const runner = new OpenAICompatibleRunner({ baseURL: "https://x/v4", apiKey: "k", model: "m" });
      const out = await runner.run("ping");
      expect(out).toBe("hello world");
      expect(captured.body.messages).toEqual([{ role: "user", content: "ping" }]);
      // 不带工具时不应携带 tools / tool_choice
      expect(captured.body.tools).toBeUndefined();
    });
  });

  describe("getConfig hook (热加载)", () => {
    it("传入 getConfig → 每次 chat 重新读配置", async () => {
      let nthCall = 0;
      const getConfig = vi.fn(async () => {
        nthCall++;
        return {
          baseURL: "https://x/v4",
          apiKey: nthCall === 1 ? "old-key" : "new-key",
          model: nthCall === 1 ? "old-m" : "new-m",
          thinking: "disabled" as const,
          timeoutMs: 30000,
        };
      });
      const captured: Array<{ auth?: string; model?: string }> = [];
      global.fetch = vi.fn(async (_url: any, init: any) => {
        const body = JSON.parse(init.body as string);
        captured.push({
          auth: (init.headers as Record<string, string>).Authorization,
          model: body.model,
        });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;

      const runner = new OpenAICompatibleRunner({ getConfig });
      await runner.chat([{ role: "user", content: "?" }], []);
      await runner.chat([{ role: "user", content: "?" }], []);
      expect(getConfig).toHaveBeenCalledTimes(2);
      expect(captured[0].auth).toBe("Bearer old-key");
      expect(captured[1].auth).toBe("Bearer new-key");
      expect(captured[0].model).toBe("old-m");
      expect(captured[1].model).toBe("new-m");
    });
  });
});
