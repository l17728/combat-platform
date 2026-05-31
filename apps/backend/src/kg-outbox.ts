import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import type { DbAdapter } from "./db-adapter.js";
import { encodeJsonForAdapter, decodeJsonFromAdapter } from "./repository.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";
import { syncConflictsForOne, syncConflicts } from "./conflicts.js";
import { log } from "./logger.js";

/**
 * resilience(outbox):
 * 用 `kg_outbox` 表 + 后台 worker 取代 setImmediate(syncToKG) 的 fire-and-forget。
 * 业务变更与 outbox 写入在同一事务,进程死掉不丢任务。
 *
 * 事件类型(eventType):
 *   - `attackTicket.saved`         payload: { ticketId }  → 对单 ticket 跑 conflicts + escalation/reminders
 *   - `attackTicket.escalation`    payload: {}            → 全量 scanEscalation
 *   - `attackTicket.reminders`     payload: {}            → 全量 scanAndCreateReminders
 *
 * 设计要点:
 *   - status: pending / done / failed,retries 计数,maxRetries=5
 *   - 指数退避:nextRunAt = now + 2^retries * 1s(1s, 2s, 4s, 8s, 16s)
 *   - 失败 5 次后置 failed,等待 `kg:outbox:replay` 重放
 *   - Worker 默认 1s poll,可通过 KG_OUTBOX_POLL_MS 调整(测试用更短)
 */

export type KgOutboxEventType = "attackTicket.saved" | "attackTicket.escalation" | "attackTicket.reminders";

export type KgOutboxStatus = "pending" | "done" | "failed";

export interface KgOutboxRow {
  id: string;
  eventType: KgOutboxEventType;
  payload: Record<string, unknown>;
  status: KgOutboxStatus;
  retries: number;
  lastError: string | null;
  createdAt: string;
  nextRunAt: string;
  processedAt: string | null;
}

export const KG_OUTBOX_MAX_RETRIES = 5;

/** Ensure the `kg_outbox` table exists. Idempotent — safe to call at app boot. */
export async function ensureKgOutboxTable(adapter: DbAdapter): Promise<void> {
  if (adapter.kind === "postgres") {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS kg_outbox (
        id TEXT PRIMARY KEY,
        "eventType" TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        retries INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        processed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kg_outbox_status ON kg_outbox(status, next_run_at);
    `);
  } else {
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS kg_outbox (
        id TEXT PRIMARY KEY,
        eventType TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        retries INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        processed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_kg_outbox_status ON kg_outbox(status, next_run_at);
    `);
  }
}

/**
 * 写入一条 outbox 事件。可传入 `tx` 让它与业务变更同事务提交;
 * 不传则用默认 adapter,这是 best-effort 兼容路径(同进程内调用)。
 */
export async function enqueueKgOutbox(
  adapter: DbAdapter,
  eventType: KgOutboxEventType,
  payload: Record<string, unknown>
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const eventCol = adapter.kind === "postgres" ? `"eventType"` : "eventType";
  await adapter.run(
    `INSERT INTO kg_outbox (id, ${eventCol}, payload, status, retries, last_error, created_at, next_run_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, eventType, encodeJsonForAdapter(adapter, payload), "pending", 0, null, now, now, null]
  );
  return id;
}

function mapRow(adapter: DbAdapter, r: any): KgOutboxRow {
  return {
    id: r.id,
    eventType: r.eventType,
    payload: decodeJsonFromAdapter(adapter, r.payload),
    status: r.status,
    retries: r.retries,
    lastError: r.last_error ?? null,
    createdAt: r.created_at,
    nextRunAt: r.next_run_at,
    processedAt: r.processed_at ?? null,
  };
}

export async function listKgOutbox(
  adapter: DbAdapter,
  opts: { status?: KgOutboxStatus; limit?: number } = {}
): Promise<KgOutboxRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  }
  const limit = Number.isFinite(opts.limit) && opts.limit! > 0 ? Math.min(500, Math.floor(opts.limit!)) : 100;
  const sql = `SELECT * FROM kg_outbox${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${limit}`;
  const rows = await adapter.query<any>(sql, params);
  return rows.map((r) => mapRow(adapter, r));
}

export async function countKgOutboxByStatus(adapter: DbAdapter): Promise<Record<KgOutboxStatus, number>> {
  const rows = await adapter.query<{ status: string; cnt: number | string }>(
    "SELECT status, COUNT(*) AS cnt FROM kg_outbox GROUP BY status"
  );
  const out: Record<KgOutboxStatus, number> = { pending: 0, done: 0, failed: 0 };
  for (const r of rows) {
    const s = r.status as KgOutboxStatus;
    if (s in out) out[s] = Number(r.cnt);
  }
  return out;
}

/** 把 failed 项重置为 pending,retries 清零,next_run_at = now。 */
export async function replayFailed(adapter: DbAdapter): Promise<number> {
  const now = new Date().toISOString();
  const res = await adapter.run(
    "UPDATE kg_outbox SET status = ?, retries = 0, last_error = NULL, next_run_at = ? WHERE status = ?",
    ["pending", now, "failed"]
  );
  return res.changes;
}

async function processOne(
  adapter: DbAdapter,
  repo: Repository,
  registry: SchemaRegistry,
  row: KgOutboxRow
): Promise<void> {
  try {
    switch (row.eventType) {
      case "attackTicket.saved": {
        const ticketId = String(row.payload?.ticketId ?? "");
        if (ticketId) {
          await syncConflictsForOne(repo, ticketId);
        } else {
          await syncConflicts(repo);
        }
        break;
      }
      case "attackTicket.escalation":
        await scanEscalation(repo);
        break;
      case "attackTicket.reminders":
        await scanAndCreateReminders(repo, registry);
        break;
      default:
        throw new Error(`unknown eventType: ${row.eventType}`);
    }
    const now = new Date().toISOString();
    await adapter.run("UPDATE kg_outbox SET status = ?, processed_at = ?, last_error = NULL WHERE id = ?", [
      "done",
      now,
      row.id,
    ]);
    log.info("kg_outbox.done", { id: row.id, eventType: row.eventType });
  } catch (e) {
    const errMsg = (e as Error).message;
    const nextRetries = row.retries + 1;
    if (nextRetries >= KG_OUTBOX_MAX_RETRIES) {
      const now = new Date().toISOString();
      await adapter.run("UPDATE kg_outbox SET status = ?, retries = ?, last_error = ?, processed_at = ? WHERE id = ?", [
        "failed",
        nextRetries,
        errMsg,
        now,
        row.id,
      ]);
      log.error("kg_outbox.failed", { id: row.id, eventType: row.eventType, retries: nextRetries, error: errMsg });
    } else {
      const backoffMs = Math.pow(2, nextRetries) * 1000;
      const nextRunAt = new Date(Date.now() + backoffMs).toISOString();
      await adapter.run("UPDATE kg_outbox SET retries = ?, last_error = ?, next_run_at = ? WHERE id = ?", [
        nextRetries,
        errMsg,
        nextRunAt,
        row.id,
      ]);
      log.warn("kg_outbox.retry", {
        id: row.id,
        eventType: row.eventType,
        retries: nextRetries,
        backoffMs,
        error: errMsg,
      });
    }
  }
}

/** Process all due pending events (one pass). Returns count processed. */
export async function processKgOutbox(
  adapter: DbAdapter,
  repo: Repository,
  registry: SchemaRegistry,
  opts: { batchSize?: number } = {}
): Promise<number> {
  const limit = opts.batchSize ?? 50;
  const now = new Date().toISOString();
  const rows = await adapter.query<any>(
    `SELECT * FROM kg_outbox WHERE status = ? AND next_run_at <= ? ORDER BY created_at ASC LIMIT ${limit}`,
    ["pending", now]
  );
  let n = 0;
  for (const r of rows) {
    await processOne(adapter, repo, registry, mapRow(adapter, r));
    n++;
  }
  return n;
}

export class KgOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private adapter: DbAdapter,
    private repo: Repository,
    private registry: SchemaRegistry,
    private pollMs: number = Number(process.env.KG_OUTBOX_POLL_MS) || 1000
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      processKgOutbox(this.adapter, this.repo, this.registry)
        .catch((e) => log.warn("kg_outbox.worker.fail", { error: (e as Error).message }))
        .finally(() => {
          this.running = false;
        });
    }, this.pollMs);
    this.timer.unref?.();
    log.info("kg_outbox.worker.started", { pollMs: this.pollMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function makeKgOutboxRouter(adapter: DbAdapter, repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.get("/kg-outbox/status", async (_req, res) => {
    try {
      const counts = await countKgOutboxByStatus(adapter);
      res.json(counts);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
  r.get("/kg-outbox", async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? (req.query.status as KgOutboxStatus) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const rows = await listKgOutbox(adapter, { status, limit });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
  r.post("/kg-outbox/replay", async (_req, res) => {
    try {
      const reset = await replayFailed(adapter);
      const processed = await processKgOutbox(adapter, repo, registry);
      res.json({ reset, processed });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
  r.post("/kg-outbox/process", async (_req, res) => {
    try {
      const processed = await processKgOutbox(adapter, repo, registry);
      res.json({ processed });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
  return r;
}
