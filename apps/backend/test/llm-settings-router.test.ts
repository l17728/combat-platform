/**
 * §v2.6 — LlmSettings router e2e
 *
 * 覆盖:
 *  GET /api/llm-settings
 *   - 空表 → 200 {provider:'', baseUrl:'', defaultModel:'', thinking:'disabled', maxHops:6, apiKeyMasked:''}
 *   - 写过 → 含 apiKeyMasked,且永远不含明文 apiKey
 *  PUT /api/llm-settings
 *   - body 完整 → 200 + 数据 round-trip
 *   - body 不传 apiKey → 保留旧值
 *  POST /api/llm-settings/test
 *   - 注入 mock fetch(返回 200 含 "pong") → {ok:true, latencyMs >= 0}
 *   - mock fetch 抛错 → {ok:false, error}
 *   - body.apiKey 临时覆盖优先级高于 DB
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../src/db-adapter.js";
import { ensureLlmSettingsTable, putLlmSettings } from "../src/llm-settings.js";
import { makeLlmSettingsRouter } from "../src/llm-settings-router.js";

async function makeMiniApp() {
  process.env.COMBAT_NO_AUTH = "1";
  const db = new Database(":memory:");
  const adapter = new SqliteAdapter(db);
  await ensureLlmSettingsTable(adapter);
  const app = express();
  app.use(express.json());
  app.use("/api", makeLlmSettingsRouter(adapter));
  return { app, adapter };
}

describe("llm-settings router", () => {
  let savedFetch: typeof fetch;
  beforeEach(() => {
    savedFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = savedFetch;
    vi.restoreAllMocks();
  });

  describe("GET /api/llm-settings", () => {
    it("空表 → 200 默认空配置", async () => {
      const { app } = await makeMiniApp();
      const res = await request(app).get("/api/llm-settings");
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("");
      expect(res.body.thinking).toBe("disabled");
      expect(res.body.maxHops).toBe(6);
      expect(res.body.apiKeyMasked).toBe("");
      expect((res.body as any).apiKey).toBeUndefined();
    });

    it("已写入 → 返回 apiKeyMasked,永远不含明文", async () => {
      const { app, adapter } = await makeMiniApp();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "totally-secret-1234567890",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const res = await request(app).get("/api/llm-settings");
      expect(res.status).toBe(200);
      expect(res.body.apiKeyMasked).toBe("****7890");
      expect(JSON.stringify(res.body).includes("totally-secret-1234567890")).toBe(false);
    });
  });

  describe("PUT /api/llm-settings", () => {
    it("body 完整 → 200 + round-trip", async () => {
      const { app } = await makeMiniApp();
      const res = await request(app).put("/api/llm-settings").send({
        provider: "zhipuai-coding-plan",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "k-1234567890abcdef",
        defaultModel: "glm-4.6",
        smallModel: "glm-4.5-air",
        thinking: "disabled",
        maxHops: 8,
        timeoutMs: 120000,
      });
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("zhipuai-coding-plan");
      expect(res.body.defaultModel).toBe("glm-4.6");
      expect(res.body.maxHops).toBe(8);
      expect(res.body.timeoutMs).toBe(120000);
      expect(res.body.apiKeyMasked).toBe("****cdef");
    });

    it("body 不传 apiKey → 保留旧 apiKey,其他字段更新", async () => {
      const { app, adapter } = await makeMiniApp();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "keep-old-key",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const res = await request(app).put("/api/llm-settings").send({
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        defaultModel: "glm-4.5-air",
        thinking: "enabled",
      });
      expect(res.status).toBe(200);
      expect(res.body.defaultModel).toBe("glm-4.5-air");
      expect(res.body.thinking).toBe("enabled");
      expect(res.body.apiKeyMasked).toBe("****-key");
    });

    it("body 缺必填字段 → 400", async () => {
      const { app } = await makeMiniApp();
      const res = await request(app).put("/api/llm-settings").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/llm-settings/test", () => {
    it("当前 DB 有配置 + mock fetch 返回 ok → {ok:true, latencyMs}", async () => {
      const { app, adapter } = await makeMiniApp();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "real-key",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "pong" } }],
            model: "glm-4.6",
          }),
      })) as unknown as typeof fetch;

      const res = await request(app).post("/api/llm-settings/test").send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.latencyMs).toBe("number");
    });

    it("mock fetch 抛错 → {ok:false, error}", async () => {
      const { app, adapter } = await makeMiniApp();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "k",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      global.fetch = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;

      const res = await request(app).post("/api/llm-settings/test").send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(String(res.body.error)).toContain("ECONNREFUSED");
    });

    it("body.apiKey 临时覆盖 → 使用 body 而非 DB 内 apiKey", async () => {
      const { app, adapter } = await makeMiniApp();
      await putLlmSettings(adapter, {
        provider: "x",
        baseUrl: "https://x/v4",
        apiKey: "db-key",
        defaultModel: "m",
        thinking: "disabled",
      });
      const captured: { auth?: string; body?: any; url?: string } = {};
      global.fetch = vi.fn(async (url: any, init: any) => {
        captured.url = String(url);
        captured.auth = (init.headers as Record<string, string>).Authorization;
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        } as Response;
      }) as unknown as typeof fetch;

      const res = await request(app)
        .post("/api/llm-settings/test")
        .send({ apiKey: "override-key", model: "glm-4.5-air", baseUrl: "https://other/v4" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(captured.auth).toBe("Bearer override-key");
      expect(captured.body.model).toBe("glm-4.5-air");
      expect(captured.url).toContain("https://other/v4");
    });

    it("DB 与 body 均无 baseUrl/apiKey → {ok:false}", async () => {
      const { app } = await makeMiniApp();
      const res = await request(app).post("/api/llm-settings/test").send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(String(res.body.error)).toMatch(/baseUrl|apiKey|配置/i);
    });
  });

  describe("thinking field 传给 LLM payload", () => {
    it("thinking=disabled → 请求 body 含 thinking:{type:'disabled'}", async () => {
      const { app, adapter } = await makeMiniApp();
      await putLlmSettings(adapter, {
        provider: "x",
        baseUrl: "https://x/v4",
        apiKey: "k",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const captured: { body?: any } = {};
      global.fetch = vi.fn(async (_url: any, init: any) => {
        captured.body = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "pong" } }] }),
        } as Response;
      }) as unknown as typeof fetch;

      await request(app).post("/api/llm-settings/test").send({});
      expect(captured.body.thinking).toEqual({ type: "disabled" });
    });
  });
});
