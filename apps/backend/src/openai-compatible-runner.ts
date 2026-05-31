// §v2.6: OpenAICompatibleRunner — pure fetch, OpenAI-compatible /chat/completions client.
//
// 一份实现同时实现:
//   - AgentRunner.run(prompt) — 旧 prompt-based 路径(向后兼容,welink.ts 等还会用)
//   - ToolCallingRunner.chat(messages, tools) — §v2.5 多轮工具编排路径
//
// 配置来源(优先级):
//   1. 构造时静态字段 (baseURL/apiKey/model/...)
//   2. getConfig 钩子 (每次调用前 await,支持 UI 改配置后立即生效,不重启 backend)
//
// 失败语义: HTTP 非 2xx / JSON 解析失败 / 网络错 / timeout 全 throw — 让上层 (hermes.ts)
// 决定 intent fallback。
//
// 安全: 不读任何本机 opencode 配置文件;apiKey 必须显式从 DB(经 llm-settings.ts) 或
// env 传入。绝不会把 apiKey 写日志(只在 Authorization header 出现)。

import type { AgentRunner, LlmMessage, LlmToolCall, LlmTurnResult, ToolCallingRunner } from "./hermes-agent.js";
import type { ToolSchema } from "./hermes-tools.js";
import { log } from "./logger.js";

export type ThinkingMode = "disabled" | "enabled" | "auto";

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  smallModel?: string;
  thinking?: ThinkingMode;
  timeoutMs?: number;
}

export interface OpenAICompatibleRunnerOptions {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  smallModel?: string;
  thinking?: ThinkingMode;
  timeoutMs?: number;
  /** 每次调用前重读配置(支持 UI 热改)。优先级高于静态字段。 */
  getConfig?: () => Promise<LlmConfig>;
}

interface OpenaiToolCallShape {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenaiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenaiToolCallShape[];
  tool_call_id?: string;
  name?: string;
}

interface OpenaiChatResponse {
  choices?: Array<{
    message?: OpenaiChatMessage;
    finish_reason?: string;
  }>;
  error?: { message?: string };
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 2048;

export class OpenAICompatibleRunner implements ToolCallingRunner, AgentRunner {
  constructor(private readonly opts: OpenAICompatibleRunnerOptions = {}) {}

  /** 拉一份当前要用的 config(静态字段 + getConfig 合并,后者覆盖前者)。 */
  private async resolveConfig(): Promise<LlmConfig> {
    let baseURL = this.opts.baseURL;
    let apiKey = this.opts.apiKey;
    let model = this.opts.model;
    let smallModel = this.opts.smallModel;
    let thinking: ThinkingMode | undefined = this.opts.thinking;
    let timeoutMs = this.opts.timeoutMs;
    if (this.opts.getConfig) {
      const live = await this.opts.getConfig();
      if (live.baseURL) baseURL = live.baseURL;
      if (live.apiKey) apiKey = live.apiKey;
      if (live.model) model = live.model;
      if (live.smallModel) smallModel = live.smallModel;
      if (live.thinking) thinking = live.thinking;
      if (typeof live.timeoutMs === "number") timeoutMs = live.timeoutMs;
    }
    if (!baseURL) throw new Error("OpenAICompatibleRunner: missing baseURL");
    if (!apiKey) throw new Error("OpenAICompatibleRunner: missing apiKey");
    if (!model) throw new Error("OpenAICompatibleRunner: missing model");
    return {
      baseURL: baseURL.replace(/\/$/, ""),
      apiKey,
      model,
      smallModel,
      thinking: thinking ?? "disabled",
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /** LlmMessage → OpenAI ChatCompletions message shape。 */
  private toOpenaiMessages(messages: LlmMessage[]): OpenaiChatMessage[] {
    return messages.map((m) => {
      const out: OpenaiChatMessage = { role: m.role };
      if (m.content !== undefined) out.content = m.content;
      if (m.tool_calls && m.tool_calls.length > 0)
        out.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name) out.name = m.name;
      return out;
    });
  }

  private buildBody(cfg: LlmConfig, messages: LlmMessage[], tools: ToolSchema[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: this.toOpenaiMessages(messages),
      max_tokens: DEFAULT_MAX_TOKENS,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (cfg.thinking === "disabled" || cfg.thinking === "enabled") {
      body.thinking = { type: cfg.thinking };
    }
    return body;
  }

  /** Core fetch — 共用给 chat() 与 run()。 */
  private async post(cfg: LlmConfig, body: Record<string, unknown>): Promise<OpenaiChatResponse> {
    const url = `${cfg.baseURL}/chat/completions`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const err = e as Error;
      if (err.name === "AbortError" || /abort/i.test(err.message || "")) {
        throw new Error(`openai-compatible timeout after ${cfg.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      let detail = "";
      try {
        detail = await resp.text();
      } catch {
        /* ignore */
      }
      throw new Error(`openai-compatible HTTP ${resp.status} ${resp.statusText || ""}: ${detail.slice(0, 200)}`);
    }
    const text = await resp.text();
    let parsed: OpenaiChatResponse;
    try {
      parsed = JSON.parse(text) as OpenaiChatResponse;
    } catch {
      throw new Error(`openai-compatible invalid JSON response: ${text.slice(0, 200)}`);
    }
    if (parsed.error?.message) throw new Error(`openai-compatible LLM error: ${parsed.error.message}`);
    return parsed;
  }

  /** §v2.5 多轮工具协议 — ToolCallingRunner.chat。 */
  async chat(messages: LlmMessage[], tools: ToolSchema[]): Promise<LlmTurnResult> {
    const cfg = await this.resolveConfig();
    const body = this.buildBody(cfg, messages, tools);
    const parsed = await this.post(cfg, body);
    const choices = parsed.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("openai-compatible no choices in response");
    }
    const message = choices[0]?.message;
    if (!message) throw new Error("openai-compatible response missing message");
    const out: LlmTurnResult = {};
    if (typeof message.content === "string" && message.content.length > 0) {
      out.content = message.content;
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const toolCalls: LlmToolCall[] = [];
      for (const tc of message.tool_calls) {
        if (!tc?.function?.name) continue;
        let args: Record<string, unknown> = {};
        const rawArgs = tc.function.arguments ?? "";
        if (rawArgs && rawArgs.trim() !== "") {
          try {
            const parsedArgs = JSON.parse(rawArgs);
            if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
              args = parsedArgs as Record<string, unknown>;
            }
          } catch {
            args = {};
          }
        }
        toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
      }
      if (toolCalls.length > 0) out.toolCalls = toolCalls;
    }
    log.info("hermes.llm.chat", {
      model: cfg.model,
      messages: messages.length,
      tools: tools.length,
      hasContent: !!out.content,
      toolCalls: out.toolCalls?.length ?? 0,
    });
    return out;
  }

  /**
   * 旧 prompt-based 路径 — AgentRunner.run(prompt)。
   * 把 prompt 包成一条 user message,不发工具,期望 LLM 直接返 content。
   * welink.ts 等历史代码会走这条路径。
   */
  async run(prompt: string): Promise<string> {
    const cfg = await this.resolveConfig();
    const body = this.buildBody(cfg, [{ role: "user", content: prompt }], []);
    const parsed = await this.post(cfg, body);
    const content = parsed.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }
}
