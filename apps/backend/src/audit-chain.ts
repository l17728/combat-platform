import { createHash } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import { decodeJsonFromAdapter } from "./repository.js";

/**
 * resilience(audit-merkle): audit_log Merkle 链完整性。
 *
 * 每条 audit_log 行带 `prev_hash` 和 `hash` 两列。计算公式:
 *
 *   hash = sha256(prevHash + entityType + entityId + action + JSON(changes) + performedAt)
 *
 * 首条行的 prev_hash = "" (空字符串),后续每条行的 prev_hash = 上一行的 hash。
 * 链中任意一条被改/删,verifyAuditChain 报错并返回断点 id。
 *
 * 不破坏既有写入 API —— 在 SqliteRepository.auditTx / logAudit 内部
 * 取当前 tail.hash → 计算新 hash → 一并写入。需保证并发写入的事务原子性
 * (SQLite 单进程天然顺序;Postgres 走 transaction(),tx 内 SELECT 拿到一致快照)。
 */

export const EMPTY_PREV_HASH = "";

export interface AuditHashInput {
  prevHash: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: unknown;
  performedAt: string;
}

/** 计算一条 audit 行的 hash。changes 用稳定 JSON 序列化(key 排序)。 */
export function computeAuditHash(input: AuditHashInput): string {
  const changesText = stableStringify(input.changes ?? {});
  const payload = [input.prevHash, input.entityType, input.entityId, input.action, changesText, input.performedAt].join(
    "␟"
  ); // U+241F SYMBOL FOR UNIT SEPARATOR — won't collide with real content
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** 稳定 JSON 序列化:对象按 key 字典序输出,数组按位置。 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") +
    "}"
  );
}

/**
 * Ensure prev_hash / hash columns exist on audit_log.
 * Idempotent: skips ALTER if columns already present.
 */
export async function ensureAuditChainColumns(adapter: DbAdapter): Promise<void> {
  if (adapter.kind === "postgres") {
    await adapter.exec(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash TEXT NOT NULL DEFAULT ''`);
    await adapter.exec(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash TEXT NOT NULL DEFAULT ''`);
    return;
  }
  // SQLite has no IF NOT EXISTS for ADD COLUMN; introspect first.
  const cols = await adapter.query<{ name: string }>(`PRAGMA table_info(audit_log)`);
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has("prev_hash")) {
    await adapter.exec(`ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL DEFAULT ''`);
  }
  if (!has("hash")) {
    await adapter.exec(`ALTER TABLE audit_log ADD COLUMN hash TEXT NOT NULL DEFAULT ''`);
  }
}

/** Tail hash 查询:取 audit_log 中按 (performedAt, id) 排序的最后一条 hash。 */
export async function getTailHash(adapter: DbAdapter): Promise<string> {
  const row = await adapter.queryOne<{ hash: string }>(
    `SELECT hash FROM audit_log ORDER BY "performedAt" DESC, id DESC LIMIT 1`
  );
  return row?.hash ?? EMPTY_PREV_HASH;
}

export interface VerifyResult {
  ok: boolean;
  verified: number;
  brokenAt?: string;
  reason?: string;
}

/**
 * Walk audit_log in (performedAt, id) order; recompute each hash and compare.
 * Returns { ok: false, brokenAt: id } on first mismatch.
 */
export async function verifyAuditChain(adapter: DbAdapter): Promise<VerifyResult> {
  const rows = await adapter.query<any>(
    `SELECT id, action, "entityType", "entityId", changes, "performedAt", prev_hash, hash
     FROM audit_log ORDER BY "performedAt", id`
  );
  let prevHash = EMPTY_PREV_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.prev_hash !== prevHash) {
      return {
        ok: false,
        verified: i,
        brokenAt: r.id,
        reason: `prev_hash mismatch at row ${i}: stored=${r.prev_hash.slice(0, 12)}..., expected=${prevHash.slice(0, 12)}...`,
      };
    }
    const expected = computeAuditHash({
      prevHash: r.prev_hash,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      changes: decodeJsonFromAdapter(adapter, r.changes),
      performedAt: r.performedAt,
    });
    if (expected !== r.hash) {
      return {
        ok: false,
        verified: i,
        brokenAt: r.id,
        reason: `hash mismatch at row ${i}: stored=${r.hash.slice(0, 12)}..., recomputed=${expected.slice(0, 12)}...`,
      };
    }
    prevHash = r.hash;
  }
  return { ok: true, verified: rows.length };
}
