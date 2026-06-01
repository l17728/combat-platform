/**
 * §v2.3.4 桶 A — LlmSettings repo 单元测试
 *
 * 覆盖:
 *  1) DDL 幂等: ensureLlmSettingsTable 多次调用不报错
 *  2) get 默认行 — 全新 db 返回 null(让上层 fallback 到 env/hardcoded)
 *  3) put 单行 — 单行 id='default' upsert,写入字段全部读得回
 *  4) apiKey 加密 — 写入后行内 api_key_encrypted 是 enc:v1: 开头,getSecret 能还原明文
 *  5) put 不传 apiKey — 保留旧值(只覆盖其他字段),空串/undefined 不清空
 *  6) getMasked — 返回除明文 apiKey 外所有字段 + apiKeyMasked='****' + 后4位
 *  7) update 时间戳 — updated_at 自动刷新
 *  8) maskedKey 短 key(<4字节)→ 不暴露原值,返回 '****'
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../src/db-adapter.js";
import {
  ensureLlmSettingsTable,
  getLlmSettings,
  getLlmSettingsMasked,
  putLlmSettings,
  resolveLlmSecret,
} from "../src/llm-settings.js";

async function makeAdapter() {
  const db = new Database(":memory:");
  const adapter = new SqliteAdapter(db);
  await ensureLlmSettingsTable(adapter);
  return { adapter, db };
}

describe("llm-settings repo", () => {
  beforeEach(() => {
    process.env.COMBAT_ENCRYPT_KEY = ""; // derive from JWT_SECRET
    delete process.env.JWT_SECRET;
  });

  describe("DDL", () => {
    it("ensureLlmSettingsTable 幂等:多次调用不报错", async () => {
      const { adapter } = await makeAdapter();
      await ensureLlmSettingsTable(adapter);
      await ensureLlmSettingsTable(adapter);
      // 再读一次以确认表存在
      const row = await getLlmSettings(adapter);
      expect(row).toBeNull();
    });
  });

  describe("get default row", () => {
    it("空表 → getLlmSettings 返回 null", async () => {
      const { adapter } = await makeAdapter();
      const row = await getLlmSettings(adapter);
      expect(row).toBeNull();
    });

    it("空表 → getLlmSettingsMasked 返回 null", async () => {
      const { adapter } = await makeAdapter();
      const masked = await getLlmSettingsMasked(adapter);
      expect(masked).toBeNull();
    });
  });

  describe("put + get", () => {
    it("put 单行 upsert,字段全部读得回", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "my-secret-key-1234567890",
        defaultModel: "glm-4.6",
        smallModel: "glm-4.5-air",
        thinking: "disabled",
        maxHops: 6,
        timeoutMs: 90000,
        updatedBy: "admin",
      });
      const row = await getLlmSettings(adapter);
      expect(row).not.toBeNull();
      expect(row!.provider).toBe("zhipuai-coding-plan");
      expect(row!.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
      expect(row!.defaultModel).toBe("glm-4.6");
      expect(row!.smallModel).toBe("glm-4.5-air");
      expect(row!.thinking).toBe("disabled");
      expect(row!.maxHops).toBe(6);
      expect(row!.timeoutMs).toBe(90000);
    });

    it("resolveLlmSecret 取得明文 apiKey", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "secret-plain-key-abc",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const key = await resolveLlmSecret(adapter);
      expect(key).toBe("secret-plain-key-abc");
    });

    it("行内的 api_key_encrypted 列是 enc:v1: 开头 — 实际加密", async () => {
      const { adapter, db } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "should-be-encrypted",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const raw = db.prepare("SELECT api_key_encrypted FROM llm_settings WHERE id='default'").get() as {
        api_key_encrypted: string;
      };
      expect(raw.api_key_encrypted.startsWith("enc:v1:")).toBe(true);
      expect(raw.api_key_encrypted.includes("should-be-encrypted")).toBe(false);
    });
  });

  describe("put 时不传 apiKey 不清空旧值", () => {
    it("二次 put 不带 apiKey → 旧 apiKey 保留", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "keep-me",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: undefined, // 关键:不更新 apiKey
        defaultModel: "glm-4.5-air",
        thinking: "enabled",
      });
      const key = await resolveLlmSecret(adapter);
      expect(key).toBe("keep-me");
      const row = await getLlmSettings(adapter);
      expect(row!.defaultModel).toBe("glm-4.5-air");
      expect(row!.thinking).toBe("enabled");
    });

    it("二次 put 空串 apiKey → 旧 apiKey 保留(避免误清空)", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "old-key",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const key = await resolveLlmSecret(adapter);
      expect(key).toBe("old-key");
    });
  });

  describe("getLlmSettingsMasked", () => {
    it("返回 apiKeyMasked,不含明文", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "zhipuai-coding-plan",
        baseUrl: "https://x/v4",
        apiKey: "abcdef-XYZ-secret-9876",
        defaultModel: "glm-4.6",
        thinking: "disabled",
      });
      const masked = await getLlmSettingsMasked(adapter);
      expect(masked).not.toBeNull();
      expect(masked!.apiKeyMasked).toBe("****9876");
      expect((masked as any).apiKey).toBeUndefined();
    });

    it("短 key 仅返回 ****,不暴露", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "x",
        baseUrl: "https://x/v4",
        apiKey: "abc",
        defaultModel: "m",
        thinking: "disabled",
      });
      const masked = await getLlmSettingsMasked(adapter);
      expect(masked!.apiKeyMasked).toBe("****");
    });
  });

  describe("updated_at refresh", () => {
    it("二次 put 后 updatedAt 不同于首次", async () => {
      const { adapter } = await makeAdapter();
      await putLlmSettings(adapter, {
        provider: "x",
        baseUrl: "https://x/v4",
        apiKey: "k",
        defaultModel: "m",
        thinking: "disabled",
      });
      const r1 = await getLlmSettings(adapter);
      await new Promise((r) => setTimeout(r, 10));
      await putLlmSettings(adapter, {
        provider: "x",
        baseUrl: "https://x/v4",
        defaultModel: "m2",
        thinking: "disabled",
      });
      const r2 = await getLlmSettings(adapter);
      expect(r2!.updatedAt).not.toBe(r1!.updatedAt);
    });
  });
});
