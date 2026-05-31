import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, openDbFromUrl } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { SqliteAdapter, PostgresAdapter, type DbAdapter } from "../src/db-adapter.js";
import { Pool as PgPool } from "pg";

// 真实 config/schemas 目录(repo 根的 config/schemas/),供需要完整 schema 的测试使用。
export const REAL_SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

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

/**
 * 使用真实 config/schemas 目录的轻量 sqlite 测试应用。
 * 用于 merge/rbac/automation 这类依赖完整 nodeType 注册的 e2e 测试 —
 * 不需要 TRUNCATE/PG 分支,也不需要 makeTestApp 的写最小 schema 逻辑。
 *
 * 与 makeTestApp 的差异:
 *  - 不写 minimal schemas;直接指向 repo 的 config/schemas/
 *  - 始终走 sqlite(忽略 COMBAT_TEST_DB_URL)
 *  - 同步签名,无 await 成本
 *  - 不默认设置 COMBAT_NO_AUTH(rbac 测试需要 auth/JWT 校验真实生效);
 *    需要免登录请传 { noAuth: true }
 */
export function makeRealSchemaTestApp(opts: { noAuth?: boolean } = {}): {
  app: ReturnType<typeof createApp>;
  repo: SqliteRepository;
  registry: FileSchemaRegistry;
} {
  if (opts.noAuth) {
    process.env.COMBAT_NO_AUTH = "1";
  } else {
    // RBAC 测试需要 gradeGate 真实生效;若同 worker 内之前 makeTestApp 设置过 NO_AUTH=1
    // 这里要清掉,否则 gradeGate 会 short-circuit return null 而放行。
    delete process.env.COMBAT_NO_AUTH;
  }
  const dir = mkdtempSync(join(tmpdir(), "combat-real-"));
  const db = openDb(join(dir, "t.sqlite"));
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(REAL_SCHEMAS_DIR);
  // 注意:若不传 adapter,createApp 不会挂 authMiddleware → 与旧 make() 等价。
  // rbac 用例必须不传 adapter(否则 authMiddleware 会先拦截无关请求);
  // merge/automation 不挂 auth 也无影响,默认走"无 adapter"路径。
  const app = createApp({ repo, registry });
  return { app, repo, registry };
}
