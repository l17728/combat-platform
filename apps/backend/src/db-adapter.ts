import type { Database as SqliteDatabase } from "better-sqlite3";
import type { Pool as PgPool, PoolClient } from "pg";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Phase 2 — unified async DB adapter
// ---------------------------------------------------------------------------
//
// All Repository methods + router files use this interface. SQLite path wraps
// better-sqlite3's synchronous calls in `Promise.resolve(...)` to keep its
// performance characteristics. Postgres path uses pg.Pool and rewrites `?`
// placeholders to `$1, $2, ...`.
//
// The DbAdapter contract is intentionally narrow — just enough for the
// existing SQL-string-based code to migrate without rewriting everything in
// drizzle. Drizzle is reserved for genuinely new code (or follow-up phases).

export type DbKind = "sqlite" | "postgres";

export interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface DbAdapter {
  readonly kind: DbKind;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  run(sql: string, params?: any[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  /**
   * Escape hatch for code that still needs the synchronous better-sqlite3
   * API (e.g. `db.prepare(...).pluck()` paths or backup/export utilities).
   * Postgres adapter throws — callers must avoid this on the PG path.
   */
  rawSqlite(): SqliteDatabase;
}

// ---------------------------------------------------------------------------
// SQLite adapter — synchronous under the hood, async surface
// ---------------------------------------------------------------------------

export class SqliteAdapter implements DbAdapter {
  readonly kind = "sqlite" as const;
  constructor(private db: SqliteDatabase) {}

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  async run(sql: string, params: any[] = []): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  /**
   * better-sqlite3's `db.transaction()` requires a synchronous function. Our
   * surface is async, so we open IMMEDIATE / COMMIT / ROLLBACK manually. The
   * adapter passed to `fn` is `this` — SQLite is single-process so re-entrant
   * calls share the same connection naturally.
   */
  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* swallow rollback errors */
      }
      throw err;
    }
  }

  rawSqlite(): SqliteDatabase {
    return this.db;
  }
}

// ---------------------------------------------------------------------------
// Postgres adapter — pg.Pool + ? → $n rewrite
// ---------------------------------------------------------------------------

/**
 * Rewrite SQLite `?` placeholders to Postgres `$1, $2, ...`. Skips occurrences
 * inside single-quoted strings so a literal "?" in SQL text is preserved.
 */
export function rewritePlaceholders(sql: string): string {
  let out = "";
  let i = 0;
  let n = 0;
  let inStr = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      inStr = !inStr;
      out += ch;
      i++;
      continue;
    }
    if (ch === "?" && !inStr) {
      n += 1;
      out += "$" + n;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export class PostgresAdapter implements DbAdapter {
  readonly kind = "postgres" as const;
  /** When set, all queries run on this client (transaction context). */
  constructor(
    private pool: PgPool,
    private txClient?: PoolClient
  ) {}

  private async exec_<T = any>(sql: string, params: any[]): Promise<T[]> {
    const text = rewritePlaceholders(sql);
    if (this.txClient) {
      const r = await this.txClient.query(text, params);
      return r.rows as T[];
    }
    const r = await this.pool.query(text, params);
    return r.rows as T[];
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.exec_<T>(sql, params);
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const rows = await this.exec_<T>(sql, params);
    return rows[0];
  }

  async run(sql: string, params: any[] = []): Promise<RunResult> {
    const text = rewritePlaceholders(sql);
    if (this.txClient) {
      const r = await this.txClient.query(text, params);
      return { changes: r.rowCount ?? 0 };
    }
    const r = await this.pool.query(text, params);
    return { changes: r.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    if (this.txClient) {
      await this.txClient.query(sql);
      return;
    }
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    if (this.txClient) {
      // already inside a transaction — collapse to a savepoint-style nesting
      // (simple approach: just reuse the same client; nested rollbacks would
      // need real savepoints which we defer until needed).
      return fn(this);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx = new PostgresAdapter(this.pool, client);
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rbErr) {
        log.warn("db.tx.rollback_failed", { error: (rbErr as Error).message });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  rawSqlite(): SqliteDatabase {
    throw new Error("PostgresAdapter.rawSqlite() — code path requires better-sqlite3; not supported on Postgres.");
  }
}
