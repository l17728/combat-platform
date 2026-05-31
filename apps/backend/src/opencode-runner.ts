import type { AgentRunner, LlmMessage, LlmToolCall, LlmTurnResult, ToolCallingRunner } from "./hermes-agent.js";
import type { ToolSchema } from "./hermes-tools.js";
import { signServiceToken } from "./auth.js";
import { log } from "./logger.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * AgentRunner backed by an opencode server (方案①: serve + SDK).
 * Connects to an externally-managed `opencode serve` when HERMES_OPENCODE_URL is
 * set (recommended for prod — the operator controls the server config so the
 * heavy global MCP servers can be disabled to avoid startup hangs), otherwise
 * spawns one in-process via the SDK.
 *
 * Read-only data tools live in the workspace's .opencode/tools; the spawned/used
 * server inherits HERMES_API + HERMES_TOKEN from this process so those tools can
 * call the backend's read endpoints on localhost.
 */
export interface OpencodeRunnerOptions {
  directory: string; // workspace containing .opencode (agents + tools)
  serverUrl?: string; // HERMES_OPENCODE_URL — connect instead of spawn
  model?: string; // "huawei_cloud/glm-5"
  agent?: string; // "hermes"
  apiBase?: string; // backend base url the tools call (default http://localhost:3001)
  timeoutMs?: number; // per-question hard cap
}

export class OpencodeAgentRunner implements AgentRunner {
  private clientP?: Promise<any>;
  private closeServer?: () => void;

  constructor(private opts: OpencodeRunnerOptions) {}

  private async getClient(): Promise<any> {
    if (!this.clientP) {
      this.clientP = (async () => {
        // The read-only tools (.opencode/tools/hermes.ts) read these at call time;
        // the opencode process inherits this env (in-process spawn) so localhost
        // authenticated reads work. External serve must be started with the same env.
        process.env.HERMES_API = this.opts.apiBase ?? process.env.HERMES_API ?? "http://localhost:3001";
        if (!process.env.HERMES_TOKEN) process.env.HERMES_TOKEN = signServiceToken();

        const sdk: any = await import("@opencode-ai/sdk");
        if (this.opts.serverUrl) {
          log.info("hermes.opencode.connect", { url: this.opts.serverUrl });
          return sdk.createOpencodeClient({ baseUrl: this.opts.serverUrl, directory: this.opts.directory });
        }
        log.info("hermes.opencode.spawn", { directory: this.opts.directory });
        const server = await sdk.createOpencodeServer({ hostname: "127.0.0.1", port: 0 });
        this.closeServer = server.close;
        return sdk.createOpencodeClient({ baseUrl: server.url, directory: this.opts.directory });
      })().catch((e) => {
        this.clientP = undefined; // allow retry on next call after a failed init
        throw e;
      });
    }
    return this.clientP;
  }

  async run(prompt: string): Promise<string> {
    const directory = this.opts.directory;
    const model = this.opts.model ?? "huawei_cloud/glm-5";
    const slash = model.indexOf("/");
    const providerID = slash > 0 ? model.slice(0, slash) : "huawei_cloud";
    const modelID = slash > 0 ? model.slice(slash + 1) : model;
    const timeoutMs = this.opts.timeoutMs ?? (Number(process.env.HERMES_TIMEOUT_MS) || 180000);

    const work = (async () => {
      const client = await this.getClient();
      const created = await client.session.create({ query: { directory } });
      const sessionId = created?.data?.id;
      if (!sessionId) throw new Error("opencode session create returned no id");
      const res = await client.session.prompt({
        path: { id: sessionId },
        query: { directory },
        body: {
          model: { providerID, modelID },
          agent: this.opts.agent ?? "hermes",
          parts: [{ type: "text", text: prompt }],
        },
      });
      const parts = (res?.data?.parts ?? []) as Array<{
        type: string;
        text?: string;
        synthetic?: boolean;
        ignored?: boolean;
      }>;
      return parts
        .filter((p) => p.type === "text" && !p.synthetic && !p.ignored && typeof p.text === "string")
        .map((p) => p.text as string)
        .join("\n")
        .trim();
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`opencode run timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 预热:boot 时调用以提前 spawn/连接 serve,省掉首问冷启动(~常驻保活)。fire-and-forget。 */
  warmup(): void {
    this.getClient().catch((e) => log.warn("hermes.opencode.warmup_fail", { error: (e as Error).message }));
  }

  dispose(): void {
    try {
      this.closeServer?.();
    } catch {
      /* ignore */
    }
  }
}

// ===================================================================
// §v2.6: OpencodeToolCallingRunner — OpenAI-compatible tool-calling
// -------------------------------------------------------------------
// 直接打 OpenAI 兼容 /chat/completions(华为云 MaaS / 任何 OpenAI 兼容端点),
// 把 LlmMessage[] + ToolSchema[] 编排成请求,把响应解析回 LlmTurnResult。
// 不依赖 opencode SDK / opencode serve — 更轻、更可控。
//
// 配置三层(任一可用):
//   1) 构造参数: { baseUrl, apiKey, model }
//   2) env:HERMES_LLM_BASE_URL / HERMES_LLM_API_KEY / HERMES_MODEL
//   3) ~/.config/opencode/opencode.json 的 provider.huawei_cloud(自动加载,本地开发友好)
//
// 失败语义:HTTP 错 / 解析错 / 超时 → 直接 throw,让 hermes-agent.ts 的
// 多轮编排在 catch 里走 intent fallback。
// ===================================================================

export interface OpencodeToolCallingRunnerOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /** 提供商命名空间,用于剥离前缀(huawei_cloud/glm-5 → glm-5)。 */
  providerNamespace?: string;
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
}

function loadOpencodeConfigCreds(): { baseUrl?: string; apiKey?: string; model?: string } {
  // 仅本机开发用;现网请用 env。永远不写回任何文件。
  const candidates = [
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".opencode", "opencode.json"),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8");
      const cfg = JSON.parse(raw);
      const huawei = cfg?.provider?.huawei_cloud;
      if (!huawei) continue;
      const baseUrl = huawei?.options?.baseURL || huawei?.options?.baseUrl;
      const apiKey = huawei?.options?.apiKey;
      // 取第一个 model name 作 default
      const models = huawei?.models ? Object.keys(huawei.models) : [];
      const model = models[0];
      if (baseUrl && apiKey) return { baseUrl, apiKey, model };
    } catch {
      /* ignore parse failure */
    }
  }
  return {};
}

export class OpencodeToolCallingRunner implements ToolCallingRunner {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly providerNamespace: string;

  constructor(opts: OpencodeToolCallingRunnerOptions = {}) {
    const fileCreds = loadOpencodeConfigCreds();
    const baseUrl = opts.baseUrl ?? process.env.HERMES_LLM_BASE_URL ?? fileCreds.baseUrl ?? "";
    const apiKey = opts.apiKey ?? process.env.HERMES_LLM_API_KEY ?? fileCreds.apiKey ?? "";
    const model = opts.model ?? process.env.HERMES_MODEL ?? fileCreds.model ?? "GLM-5";
    if (!baseUrl)
      throw new Error("OpencodeToolCallingRunner: missing baseUrl (set HERMES_LLM_BASE_URL or opencode.json)");
    if (!apiKey) throw new Error("OpencodeToolCallingRunner: missing apiKey (set HERMES_LLM_API_KEY or opencode.json)");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.HERMES_LLM_TIMEOUT_MS) || 90000);
    this.providerNamespace = opts.providerNamespace ?? "huawei_cloud";
  }

  /** 把 model id 里的 provider 前缀剥掉(huawei_cloud/glm-5 → glm-5)。 */
  private resolveModelId(): string {
    const m = this.model;
    const slash = m.indexOf("/");
    if (slash <= 0) return m;
    return m.slice(slash + 1);
  }

  /** 把 LlmMessage 转 OpenAI ChatCompletions message 形态。 */
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

  /** 主入口 — ToolCallingRunner.chat */
  async chat(messages: LlmMessage[], tools: ToolSchema[]): Promise<LlmTurnResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.resolveModelId(),
      messages: this.toOpenaiMessages(messages),
      tools,
      tool_choice: "auto" as const,
      temperature: 0,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = (e as Error).message || String(e);
      if (msg.includes("aborted") || (e as Error).name === "AbortError") {
        throw new Error(`opencode tool-calling timeout after ${this.timeoutMs}ms`);
      }
      throw e;
    }
    clearTimeout(timer);

    if (!resp.ok) {
      let detail = "";
      try {
        detail = await resp.text();
      } catch {
        /* ignore */
      }
      throw new Error(`opencode tool-calling HTTP ${resp.status} ${resp.statusText || ""}: ${detail.slice(0, 200)}`);
    }

    const text = await resp.text();
    let parsed: OpenaiChatResponse;
    try {
      parsed = JSON.parse(text) as OpenaiChatResponse;
    } catch {
      throw new Error(`opencode tool-calling invalid JSON response: ${text.slice(0, 200)}`);
    }

    if (parsed.error?.message) throw new Error(`opencode LLM error: ${parsed.error.message}`);

    const choices = parsed.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error(`opencode tool-calling no choices in response: ${text.slice(0, 200)}`);
    }
    const message = choices[0]?.message;
    if (!message) throw new Error(`opencode tool-calling response missing message`);

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
            // arguments 非法 JSON — 丢一个空对象,让工具调用回报错(LLM 下一轮纠错)
            args = {};
          }
        }
        toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
      }
      if (toolCalls.length > 0) out.toolCalls = toolCalls;
    }
    log.info("hermes.llm.chat", {
      model: this.resolveModelId(),
      messages: messages.length,
      tools: tools.length,
      hasContent: !!out.content,
      toolCalls: out.toolCalls?.length ?? 0,
    });
    return out;
  }
}
