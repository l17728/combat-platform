/**
 * §v2.6 桶 — OpencodeToolCallingRunner 单测
 *
 * 这个 runner 接收 LlmMessage[] + ToolSchema[],打 OpenAI 兼容 /chat/completions,
 * 解析回包为 LlmTurnResult({content?, toolCalls?})。
 *
 * 覆盖:
 *   1) 纯文本回复 → content 解析
 *   2) 单个 tool_call → toolCalls 数组,arguments 已 JSON.parse
 *   3) 多 tool_call 并发 → 全部进 toolCalls
 *   4) tool_call.arguments 是空串 → arguments={} (容错)
 *   5) HTTP 错误 → throw
 *   6) 非 200 响应 → throw 带 status
 *   7) JSON 解析失败 → throw
 *   8) messages 转 OpenAI 协议(tool_calls 字段会被序列化、tool_call_id 透传)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpencodeToolCallingRunner } from "../src/opencode-runner.js";
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

function mockFetch(response: { status?: number; body?: unknown; text?: string; throwError?: Error }): typeof fetch {
  return vi.fn(async () => {
    if (response.throwError) throw response.throwError;
    const status = response.status ?? 200;
    const bodyText = response.text ?? JSON.stringify(response.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("OpencodeToolCallingRunner", () => {
  let savedFetch: typeof fetch;
  beforeEach(() => {
    savedFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = savedFetch;
    vi.restoreAllMocks();
  });

  describe("text reply", () => {
    it("LLM 返回纯文本 → content 解析,toolCalls 为空", async () => {
      const captured: { url?: string; body?: any } = {};
      global.fetch = vi.fn(async (url: any, init: any) => {
        captured.url = String(url);
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [
                {
                  message: { role: "assistant", content: "答案是 42。\nCITATIONS: 空" },
                  finish_reason: "stop",
                },
              ],
            }),
          json: async () => ({
            choices: [
              {
                message: { role: "assistant", content: "答案是 42。\nCITATIONS: 空" },
                finish_reason: "stop",
              },
            ],
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://api.modelarts-maas.com/openai/v1",
        apiKey: "test-key",
        model: "GLM-5",
      });
      const messages: LlmMessage[] = [
        { role: "system", content: "你是 Hermes" },
        { role: "user", content: "随便问问" },
      ];
      const turn = await runner.chat(messages, sampleTools);
      expect(turn.content).toContain("答案是 42");
      expect(turn.toolCalls).toBeUndefined();
      expect(captured.url).toContain("/chat/completions");
      expect(captured.body.model).toBe("GLM-5");
      expect(captured.body.tools?.length).toBe(2);
      expect(captured.body.messages[0]).toEqual({ role: "system", content: "你是 Hermes" });
    });
  });

  describe("single tool_call", () => {
    it("LLM 返回 1 个 tool_call → toolCalls 解析,arguments JSON.parse 成对象", async () => {
      global.fetch = mockFetch({
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_abc",
                    type: "function",
                    function: { name: "list_node_types", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      });

      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://api.modelarts-maas.com/openai/v1",
        apiKey: "test-key",
        model: "GLM-5",
      });
      const turn = await runner.chat([{ role: "user", content: "X" }], sampleTools);
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls![0]).toEqual({
        id: "call_abc",
        name: "list_node_types",
        arguments: {},
      });
    });
  });

  describe("multi tool_calls", () => {
    it("LLM 返回 2 个 tool_calls → 全部进 toolCalls", async () => {
      global.fetch = mockFetch({
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "list_node_types", arguments: "{}" } },
                  {
                    id: "c2",
                    type: "function",
                    function: { name: "count_nodes", arguments: '{"nodeType":"person"}' },
                  },
                ],
              },
            },
          ],
        },
      });
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      const turn = await runner.chat([{ role: "user", content: "Q" }], sampleTools);
      expect(turn.toolCalls).toHaveLength(2);
      expect(turn.toolCalls![0].name).toBe("list_node_types");
      expect(turn.toolCalls![1].name).toBe("count_nodes");
      expect(turn.toolCalls![1].arguments).toEqual({ nodeType: "person" });
    });
  });

  describe("tool_call.arguments 为空串 → arguments={}", () => {
    it("空 arguments 不抛错,默认空对象", async () => {
      global.fetch = mockFetch({
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [{ id: "c1", type: "function", function: { name: "list_node_types", arguments: "" } }],
              },
            },
          ],
        },
      });
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      const turn = await runner.chat([{ role: "user", content: "Q" }], sampleTools);
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls![0].arguments).toEqual({});
    });
  });

  describe("error paths", () => {
    it("HTTP 抛错 → throw", async () => {
      global.fetch = mockFetch({ throwError: new Error("ECONNREFUSED") });
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      await expect(runner.chat([{ role: "user", content: "Q" }], sampleTools)).rejects.toThrow(/ECONNREFUSED/);
    });

    it("非 200 → throw 带 status", async () => {
      global.fetch = mockFetch({ status: 500, body: { error: "internal" } });
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      await expect(runner.chat([{ role: "user", content: "Q" }], sampleTools)).rejects.toThrow(/500/);
    });

    it("无 choices → throw", async () => {
      global.fetch = mockFetch({ body: {} });
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      await expect(runner.chat([{ role: "user", content: "Q" }], sampleTools)).rejects.toThrow();
    });

    it("响应不是合法 JSON → throw", async () => {
      global.fetch = mockFetch({ text: "<<NOT JSON>>" });
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      await expect(runner.chat([{ role: "user", content: "Q" }], sampleTools)).rejects.toThrow();
    });
  });

  describe("message protocol conversion", () => {
    it("tool role 消息透传 tool_call_id + name; assistant 的 tool_calls 序列化", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "done" } }],
            }),
        } as Response;
      }) as unknown as typeof fetch;

      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
      });
      const messages: LlmMessage[] = [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "list_node_types", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "c1", name: "list_node_types", content: '{"data":[]}' },
      ];
      await runner.chat(messages, sampleTools);
      const sentMessages = captured.body.messages;
      expect(sentMessages).toHaveLength(4);
      expect(sentMessages[2].role).toBe("assistant");
      expect(sentMessages[2].tool_calls?.[0]).toEqual({
        id: "c1",
        type: "function",
        function: { name: "list_node_types", arguments: "{}" },
      });
      expect(sentMessages[3]).toEqual({
        role: "tool",
        tool_call_id: "c1",
        name: "list_node_types",
        content: '{"data":[]}',
      });
    });

    it("Authorization Bearer header 与 Content-Type 都正确", async () => {
      const captured: { headers?: Record<string, string> } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.headers = init.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "ok" } }],
            }),
        } as Response;
      }) as unknown as typeof fetch;

      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "secret-key",
        model: "GLM-5",
      });
      await runner.chat([{ role: "user", content: "Q" }], sampleTools);
      expect(captured.headers!["Authorization"]).toBe("Bearer secret-key");
      expect(captured.headers!["Content-Type"]).toBe("application/json");
    });
  });

  describe("model id resolution", () => {
    it("model='huawei_cloud/glm-5' → 自动剥前缀,只送 glm-5 给后端", async () => {
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;

      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "huawei_cloud/glm-5",
      });
      await runner.chat([{ role: "user", content: "Q" }], sampleTools);
      expect(captured.body.model).toBe("glm-5");
    });
  });

  describe("timeout", () => {
    it("超过 timeoutMs → throw 含 timeout", async () => {
      global.fetch = vi.fn((_url: any, init: any) => {
        const signal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            (err as Error & { name: string }).name = "AbortError";
            reject(err);
          });
        });
      }) as unknown as typeof fetch;
      const runner = new OpencodeToolCallingRunner({
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "GLM-5",
        timeoutMs: 50,
      });
      await expect(runner.chat([{ role: "user", content: "Q" }], sampleTools)).rejects.toThrow(/timeout/i);
    });
  });
});
