// §v2.6: /api/llm-settings router
//
// 端点:
//   GET  /api/llm-settings              → 当前配置(apiKey 已 masked)
//   PUT  /api/llm-settings              → 更新(body.apiKey 留空则保留旧值)
//   POST /api/llm-settings/test         → 用当前(或临时 body 覆盖)配置发 ping
//
// 鉴权:adminMiddleware 由 app.ts 挂在 router 之前。
import { Router } from "express";
import { asyncHandler, log } from "./logger.js";
import type { DbAdapter } from "./db-adapter.js";
import {
  getLlmSettingsMasked,
  putLlmSettings,
  resolveLlmSecret,
  getLlmSettings,
  type ThinkingMode,
  type PutLlmSettingsInput,
} from "./llm-settings.js";

interface PingBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  thinking?: ThinkingMode;
  timeoutMs?: number;
}

const DEFAULT_PUBLIC: {
  provider: string;
  baseUrl: string;
  defaultModel: string;
  smallModel: string;
  thinking: ThinkingMode;
  maxHops: number;
  timeoutMs: number;
  apiKeyMasked: string;
  updatedAt: string;
  updatedBy: string;
} = {
  provider: "",
  baseUrl: "",
  defaultModel: "",
  smallModel: "",
  thinking: "disabled",
  maxHops: 6,
  timeoutMs: 90000,
  apiKeyMasked: "",
  updatedAt: "",
  updatedBy: "",
};

function isValidThinking(v: unknown): v is ThinkingMode {
  return v === "disabled" || v === "enabled" || v === "auto";
}

export function makeLlmSettingsRouter(adapter: DbAdapter): Router {
  const r = Router();

  r.get(
    "/llm-settings",
    asyncHandler(async (_req, res) => {
      const m = await getLlmSettingsMasked(adapter);
      if (!m) return res.json(DEFAULT_PUBLIC);
      res.json({
        provider: m.provider,
        baseUrl: m.baseUrl,
        defaultModel: m.defaultModel,
        smallModel: m.smallModel ?? "",
        thinking: m.thinking,
        maxHops: m.maxHops,
        timeoutMs: m.timeoutMs,
        apiKeyMasked: m.apiKeyMasked,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy ?? "",
      });
    })
  );

  r.put(
    "/llm-settings",
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as Partial<PutLlmSettingsInput>;
      if (!b.provider || !b.baseUrl || !b.defaultModel) {
        return res.status(400).json({ error: "provider/baseUrl/defaultModel 必填" });
      }
      const thinking: ThinkingMode = isValidThinking(b.thinking) ? b.thinking : "disabled";
      const updatedBy = (req as any).user?.username || "";
      const updated = await putLlmSettings(adapter, {
        provider: String(b.provider),
        baseUrl: String(b.baseUrl).replace(/\/$/, ""),
        defaultModel: String(b.defaultModel),
        smallModel: b.smallModel ? String(b.smallModel) : undefined,
        apiKey: typeof b.apiKey === "string" ? b.apiKey : undefined,
        thinking,
        maxHops: typeof b.maxHops === "number" ? b.maxHops : undefined,
        timeoutMs: typeof b.timeoutMs === "number" ? b.timeoutMs : undefined,
        updatedBy,
      });
      log.info("llm_settings.put", {
        provider: updated.provider,
        baseUrl: updated.baseUrl,
        defaultModel: updated.defaultModel,
        thinking: updated.thinking,
        updatedBy,
      });
      const masked = await getLlmSettingsMasked(adapter);
      res.json({
        provider: masked!.provider,
        baseUrl: masked!.baseUrl,
        defaultModel: masked!.defaultModel,
        smallModel: masked!.smallModel ?? "",
        thinking: masked!.thinking,
        maxHops: masked!.maxHops,
        timeoutMs: masked!.timeoutMs,
        apiKeyMasked: masked!.apiKeyMasked,
        updatedAt: masked!.updatedAt,
        updatedBy: masked!.updatedBy ?? "",
      });
    })
  );

  r.post(
    "/llm-settings/test",
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as PingBody;
      const current = await getLlmSettings(adapter);
      const baseUrl = (b.baseUrl ?? current?.baseUrl ?? "").replace(/\/$/, "");
      const apiKey = b.apiKey ?? (await resolveLlmSecret(adapter)) ?? "";
      const model = b.model ?? current?.defaultModel ?? "";
      const thinking: ThinkingMode = isValidThinking(b.thinking)
        ? b.thinking
        : ((current?.thinking ?? "disabled") as ThinkingMode);
      const timeoutMs = b.timeoutMs ?? current?.timeoutMs ?? 30000;

      if (!baseUrl || !apiKey) {
        return res.json({ ok: false, error: "缺少 baseUrl 或 apiKey,请先保存配置或在测试时临时提供" });
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 30000));
      const url = `${baseUrl}/chat/completions`;
      const body: Record<string, unknown> = {
        model: model || "glm-4.5-air",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
        temperature: 0,
      };
      if (thinking === "disabled" || thinking === "enabled") {
        body.thinking = { type: thinking };
      }
      const startedAt = Date.now();
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - startedAt;
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          return res.json({ ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}`, latencyMs });
        }
        const text = await resp.text();
        let modelEcho = "";
        try {
          const j = JSON.parse(text);
          modelEcho = String(j?.model ?? j?.choices?.[0]?.model ?? "");
        } catch {
          /* ignore */
        }
        return res.json({ ok: true, latencyMs, modelEcho });
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).message || String(e);
        log.warn("llm_settings.test.fail", { error: msg });
        return res.json({ ok: false, error: msg });
      }
    })
  );

  return r;
}
