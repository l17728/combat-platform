// §v2.6: LLM 全局配置 — 单行 (id='default') 表 + AES-256-GCM 加密 apiKey。
// 数据流:
//   - 写: PUT /api/llm-settings → putLlmSettings(adapter, body) → 行内 api_key_encrypted = enc:v1:...
//   - 读 (路由 / 前端展示): getLlmSettingsMasked(adapter) → 不含明文,只回 ****XXXX
//   - 读 (LlmRunner 启动 / 热加载): resolveLlmSecret(adapter) → 明文,直接给 Authorization Bearer
//
// 不出现明文 apiKey 的场景:GET 路由响应、日志、CLI llm:get 输出。
import type { DbAdapter } from "./db-adapter.js";
import { encrypt, decrypt } from "./crypto.js";

export type ThinkingMode = "disabled" | "enabled" | "auto";

export interface LlmSettingsRow {
  provider: string;
  baseUrl: string;
  defaultModel: string;
  smallModel?: string;
  thinking: ThinkingMode;
  maxHops: number;
  timeoutMs: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface LlmSettingsMasked extends LlmSettingsRow {
  apiKeyMasked: string;
}

export interface PutLlmSettingsInput {
  provider: string;
  baseUrl: string;
  defaultModel: string;
  smallModel?: string;
  thinking: ThinkingMode;
  /** 不传或空串 → 保留旧值;实际是 string 才更新。 */
  apiKey?: string;
  maxHops?: number;
  timeoutMs?: number;
  updatedBy?: string;
}

const DEFAULT_MAX_HOPS = 6;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_THINKING: ThinkingMode = "disabled";

export async function ensureLlmSettingsTable(adapter: DbAdapter): Promise<void> {
  if (adapter.kind === "sqlite") {
    adapter.rawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS llm_settings (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        api_key_encrypted TEXT NOT NULL DEFAULT '',
        default_model TEXT NOT NULL DEFAULT '',
        small_model TEXT NOT NULL DEFAULT '',
        thinking TEXT NOT NULL DEFAULT 'disabled',
        max_hops INTEGER NOT NULL DEFAULT 6,
        timeout_ms INTEGER NOT NULL DEFAULT 90000,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by TEXT NOT NULL DEFAULT ''
      )
    `);
    return;
  }
  // Postgres path: same DDL idea
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS llm_settings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      api_key_encrypted TEXT NOT NULL DEFAULT '',
      default_model TEXT NOT NULL DEFAULT '',
      small_model TEXT NOT NULL DEFAULT '',
      thinking TEXT NOT NULL DEFAULT 'disabled',
      max_hops INTEGER NOT NULL DEFAULT 6,
      timeout_ms INTEGER NOT NULL DEFAULT 90000,
      updated_at TEXT NOT NULL DEFAULT (now()::text),
      updated_by TEXT NOT NULL DEFAULT ''
    )
  `);
}

interface RawRow {
  provider: string;
  base_url: string;
  api_key_encrypted: string;
  default_model: string;
  small_model: string;
  thinking: string;
  max_hops: number;
  timeout_ms: number;
  updated_at: string;
  updated_by: string;
}

function rowToPublic(r: RawRow): LlmSettingsRow {
  return {
    provider: r.provider,
    baseUrl: r.base_url,
    defaultModel: r.default_model,
    smallModel: r.small_model || undefined,
    thinking: (r.thinking as ThinkingMode) || DEFAULT_THINKING,
    maxHops: r.max_hops ?? DEFAULT_MAX_HOPS,
    timeoutMs: r.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by || undefined,
  };
}

export async function getLlmSettings(adapter: DbAdapter): Promise<LlmSettingsRow | null> {
  const r = await adapter.queryOne<RawRow>(`SELECT * FROM llm_settings WHERE id = ?`, ["default"]);
  if (!r) return null;
  return rowToPublic(r);
}

function maskKey(plain: string): string {
  if (!plain) return "";
  if (plain.length < 4) return "****";
  return "****" + plain.slice(-4);
}

export async function getLlmSettingsMasked(adapter: DbAdapter): Promise<LlmSettingsMasked | null> {
  const r = await adapter.queryOne<RawRow>(`SELECT * FROM llm_settings WHERE id = ?`, ["default"]);
  if (!r) return null;
  const pub = rowToPublic(r);
  const plain = r.api_key_encrypted ? decrypt(r.api_key_encrypted) : "";
  return { ...pub, apiKeyMasked: maskKey(plain) };
}

/** LlmRunner 读真明文 apiKey;调用方负责不日志、不上行。 */
export async function resolveLlmSecret(adapter: DbAdapter): Promise<string | null> {
  const r = await adapter.queryOne<{ api_key_encrypted: string }>(
    `SELECT api_key_encrypted FROM llm_settings WHERE id = ?`,
    ["default"]
  );
  if (!r || !r.api_key_encrypted) return null;
  const plain = decrypt(r.api_key_encrypted);
  return plain || null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function putLlmSettings(adapter: DbAdapter, input: PutLlmSettingsInput): Promise<LlmSettingsRow> {
  const existing = await adapter.queryOne<RawRow>(`SELECT * FROM llm_settings WHERE id = ?`, ["default"]);
  // apiKey 处理:输入有非空 string 才覆盖,否则保留旧值
  let apiKeyCipher = existing?.api_key_encrypted ?? "";
  if (typeof input.apiKey === "string" && input.apiKey.length > 0) {
    apiKeyCipher = encrypt(input.apiKey);
  }
  const updatedAt = nowIso();
  const maxHops = input.maxHops ?? existing?.max_hops ?? DEFAULT_MAX_HOPS;
  const timeoutMs = input.timeoutMs ?? existing?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const smallModel = input.smallModel ?? existing?.small_model ?? "";

  if (existing) {
    await adapter.run(
      `UPDATE llm_settings SET provider=?, base_url=?, api_key_encrypted=?, default_model=?, small_model=?, thinking=?, max_hops=?, timeout_ms=?, updated_at=?, updated_by=? WHERE id=?`,
      [
        input.provider,
        input.baseUrl,
        apiKeyCipher,
        input.defaultModel,
        smallModel,
        input.thinking,
        maxHops,
        timeoutMs,
        updatedAt,
        input.updatedBy ?? "",
        "default",
      ]
    );
  } else {
    await adapter.run(
      `INSERT INTO llm_settings (id, provider, base_url, api_key_encrypted, default_model, small_model, thinking, max_hops, timeout_ms, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        "default",
        input.provider,
        input.baseUrl,
        apiKeyCipher,
        input.defaultModel,
        smallModel,
        input.thinking,
        maxHops,
        timeoutMs,
        updatedAt,
        input.updatedBy ?? "",
      ]
    );
  }
  const row = (await getLlmSettings(adapter)) as LlmSettingsRow;
  return row;
}
