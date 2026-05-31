import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, openDbFromUrl } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { SqliteAdapter, PostgresAdapter, type DbAdapter } from "../src/db-adapter.js";
import { Pool as PgPool } from "pg";

// ---------------------------------------------------------------------------
// Test helpers — SQLite (default) + Postgres (opt-in via COMBAT_TEST_DB_URL)
// ---------------------------------------------------------------------------
// SQLite path: one fresh file db per makeTestApp() call (full isolation).
// Postgres path: a SHARED database (COMBAT_TEST_DB_URL) with all tables
// TRUNCATEd before each makeTestApp() call. Vitest MUST run tests sequentially
// against PG (vitest.config.ts switches fileParallelism=false when the env
// var is set).

const PG_URL = process.env.COMBAT_TEST_DB_URL;
const USE_PG = !!PG_URL && (PG_URL.startsWith("postgres://") || PG_URL.startsWith("postgresql://"));

let pgPoolPromise: Promise<{ pool: PgPool; adapter: PostgresAdapter }> | null = null;

async function getPgPool(): Promise<{ pool: PgPool; adapter: PostgresAdapter }> {
  if (!pgPoolPromise) {
    pgPoolPromise = (async () => {
      const handle = await openDbFromUrl(PG_URL!);
      if (handle.kind !== "postgres") throw new Error("expected postgres handle");
      const adapter = new PostgresAdapter(handle.pool);
      return { pool: handle.pool, adapter };
    })();
  }
  return pgPoolPromise;
}

// Tables to TRUNCATE between tests. Match the PG DDL in src/db.ts.
const PG_TABLES = [
  "nodes",
  "edges",
  "progress_log",
  "audit_log",
  "proposals",
  "notifications",
  "app_settings",
  "daily_report_entry",
  "support_template",
  "support_node",
  "users",
  "ticket_tabs",
  "bug_reports",
  "help_requests",
  "documents",
  "op_logs",
];

async function truncateAllPg(pool: PgPool): Promise<void> {
  const tables = PG_TABLES.map((t) => `"${t}"`).join(", ");
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

function writeMinimalSchemas(cfgDir: string) {
  writeFileSync(
    join(cfgDir, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        {
          name: "状态",
          type: "enum",
          label: "状态",
          required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"],
        },
      ],
    })
  );
  writeFileSync(
    join(cfgDir, "person.json"),
    JSON.stringify({
      nodeType: "person",
      label: "人员",
      identityKeys: ["employeeId"],
      derivedToKG: true,
      fields: [
        { name: "name", type: "string", label: "姓名", required: true },
        { name: "employeeId", type: "string", label: "工号" },
      ],
    })
  );
}

/**
 * Async makeTestApp — branches on COMBAT_TEST_DB_URL.
 *
 * - SQLite: temp file + fresh SqliteAdapter (legacy behaviour, fully isolated).
 * - Postgres: shared pool, TRUNCATE all tables, single shared PostgresAdapter.
 *
 * Callers MUST `await` the result. All existing test files have been
 * updated to use `await makeTestApp()`.
 */
export async function makeTestApp(): Promise<{
  app: ReturnType<typeof createApp>;
  repo: SqliteRepository;
  registry: FileSchemaRegistry;
  cfgDir: string;
  adapter: DbAdapter;
  dbPath?: string;
}> {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeMinimalSchemas(cfgDir);

  if (USE_PG) {
    const { pool, adapter } = await getPgPool();
    await truncateAllPg(pool);
    const repo = new SqliteRepository(adapter);
    const registry = new FileSchemaRegistry(cfgDir);
    const app = createApp({ repo, registry, adapter });
    return { app, repo, registry, cfgDir, adapter };
  }

  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(cfgDir);
  // Pass `db` so SQLite-only routers (e.g. welink) get mounted in tests.
  const app = createApp({ repo, registry, adapter, db, dbPath });
  return { app, repo, registry, cfgDir, adapter, dbPath };
}

/** True when tests are targeting Postgres. */
export function isPgTest(): boolean {
  return USE_PG;
}
