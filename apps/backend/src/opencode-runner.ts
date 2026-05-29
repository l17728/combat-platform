import type { AgentRunner } from "./hermes-agent.js";
import { signServiceToken } from "./auth.js";
import { log } from "./logger.js";

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
  directory: string;                 // workspace containing .opencode (agents + tools)
  serverUrl?: string;                // HERMES_OPENCODE_URL — connect instead of spawn
  model?: string;                    // "huawei_cloud/glm-5"
  agent?: string;                    // "hermes"
  apiBase?: string;                  // backend base url the tools call (default http://localhost:3001)
  timeoutMs?: number;                // per-question hard cap
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
      const parts = (res?.data?.parts ?? []) as Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }>;
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
    try { this.closeServer?.(); } catch { /* ignore */ }
  }
}
