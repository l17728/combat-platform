#!/usr/bin/env node
/**
 * SQLite → Postgres 一次性数据迁移工具
 *
 * 用法:
 *   node scripts/migrate/sqlite-to-postgres.mjs \
 *     --sqlite ./data/combat.sqlite \
 *     --postgres postgresql://user:pwd@host:5432/combat \
 *     [--dry-run] [--truncate] [--batch 200]
 *
 * 流程:
 *  1. 解析 CLI 参数 + 校验两端可连
 *  2. 在 Postgres 端确保 schema 已建 (调用 server 同款 ensurePostgresSchema)
 *  3. 按表批量 SELECT → 批量 INSERT,带进度
 *  4. (可选) --truncate 先清空 PG 同名表(危险,需显式打开)
 *  5. 全部完成后写 .migrated 标记文件
 *
 * 失败处理:
 *  - 任一表 INSERT 失败 → 整体回滚事务(PG 端),退出码 1
 *  - dry-run 模式只 SELECT 不 INSERT,统计每表行数
 *
 * 这是 Phase 3 的核心交付物;后续 UI 一键迁移(#68) 调用相同后端 API,内部转发到此工具或同款逻辑。
 */

import { parseArgs } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const TABLES_ORDER = [
  // 顺序保证外键(虽然这套没真正外键,但避免依赖错位)
  "users",
  "app_settings",
  "nodes",
  "edges",
  "progress_log",
  "audit_log",
  "proposals",
  "notifications",
  "daily_report_entry",
  "support_template",
  "support_node",
  "ticket_tabs",
];

// Phase 4: PG 端这些列是 JSONB,SQLite 里是 TEXT JSON 字符串。
// 迁移时把 string 用 JSON.parse 转成 JS object,pg 驱动会用 jsonb 协议写入。
const JSONB_COLUMNS = {
  nodes: new Set(["properties"]),
  edges: new Set(["properties"]),
  audit_log: new Set(["changes"]),
};

function log(msg) {
  console.log(`[migrate] ${msg}`);
}

function fail(msg, code = 1) {
  console.error(`[migrate][ERROR] ${msg}`);
  process.exit(code);
}

function progressLine(table, done, total) {
  const pct = total > 0 ? Math.floor((done / total) * 100) : 100;
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r[migrate] ${table.padEnd(22)} ${bar} ${done}/${total} (${pct}%)`);
  if (done >= total) process.stdout.write("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      sqlite: { type: "string" },
      postgres: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      truncate: { type: "boolean", default: false },
      batch: { type: "string", default: "200" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help || !values.sqlite || !values.postgres) {
    console.log(`SQLite → Postgres 数据迁移

用法:
  node scripts/migrate/sqlite-to-postgres.mjs \\
    --sqlite <path>           # 源 SQLite 文件路径
    --postgres <conn-string>  # 目标 PG 连接串
    [--dry-run]               # 只清点,不写入
    [--truncate]              # 写入前先 TRUNCATE PG 同名表(危险)
    [--batch N]               # 单批 INSERT 行数,默认 200`);
    process.exit(values.help ? 0 : 1);
  }

  const sqlitePath = resolve(values.sqlite);
  if (!existsSync(sqlitePath)) fail(`SQLite 文件不存在: ${sqlitePath}`);

  const batchSize = parseInt(values.batch, 10);
  if (!Number.isFinite(batchSize) || batchSize < 1) fail(`--batch 无效: ${values.batch}`);

  log(`SQLite 源: ${sqlitePath}`);
  log(`Postgres 目标: ${redact(values.postgres)}`);
  log(`模式: ${values["dry-run"] ? "DRY-RUN" : "WRITE"}${values.truncate ? " + TRUNCATE" : ""}`);

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pgPool = new Pool({ connectionString: values.postgres });

  // 验证两端可连
  try {
    const r = await pgPool.query("SELECT 1 as ok");
    if (r.rows[0].ok !== 1) fail("PG 连接异常");
    log("✓ PG 连接成功");
  } catch (e) {
    fail(`PG 连接失败: ${e.message}`);
  }

  // PG schema 必须事先就绪(server 启动时 ensurePostgresSchema 会建好);
  // 这里只做一次预检,表不存在则停。
  const tableCheck = await pgPool.query(
    `
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)
  `,
    [TABLES_ORDER]
  );
  const existing = new Set(tableCheck.rows.map((r) => r.tablename));
  const missing = TABLES_ORDER.filter((t) => !existing.has(t));
  if (missing.length > 0) {
    fail(`PG 端缺少以下表(请先启动一次后端用 DB_URL=postgres://... 让它建表):\n  ${missing.join("\n  ")}`);
  }
  log("✓ PG schema 完整");

  const stats = {};
  const client = await pgPool.connect();
  try {
    if (!values["dry-run"]) {
      await client.query("BEGIN");
    }

    for (const table of TABLES_ORDER) {
      const countRow = sqlite.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
      const total = countRow.c;
      stats[table] = { source: total, copied: 0 };
      if (total === 0) {
        log(`${table.padEnd(22)} 空表,跳过`);
        continue;
      }
      if (values.truncate && !values["dry-run"]) {
        await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
      }
      if (values["dry-run"]) {
        log(`${table.padEnd(22)} ${total} 行 (dry-run,未写入)`);
        continue;
      }

      // 取一行得列名(SQLite 的列名与 PG 一致 — schema.ts 已对齐)
      const sample = sqlite.prepare(`SELECT * FROM ${table} LIMIT 1`).get();
      const cols = Object.keys(sample);
      const colsQuoted = cols.map((c) => `"${c}"`).join(", ");

      // Phase 4: 把 PG 端 JSONB 列名识别出来,迁移时 JSON.parse 一次,
      // 让 pg 驱动用 jsonb 协议序列化(SQLite 那边是 TEXT JSON 字符串)。
      const jsonbCols = JSONB_COLUMNS[table] ?? new Set();

      let offset = 0;
      while (offset < total) {
        const rows = sqlite.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).all(batchSize, offset);
        if (rows.length === 0) break;
        // 构造批量 VALUES
        const placeholderRows = rows
          .map((_, i) => {
            const base = i * cols.length;
            return `(${cols.map((_, j) => `$${base + j + 1}`).join(", ")})`;
          })
          .join(", ");
        const params = rows.flatMap((r) =>
          cols.map((c) => {
            const v = r[c];
            if (jsonbCols.has(c)) {
              if (v === null || v === undefined) return null;
              if (typeof v !== "string") return v;
              try {
                return JSON.parse(v);
              } catch {
                // 历史脏数据回退:整个字符串包成 { _raw: ... } 保留
                return { _raw: v };
              }
            }
            return v;
          })
        );
        await client.query(
          `INSERT INTO "${table}" (${colsQuoted}) VALUES ${placeholderRows} ON CONFLICT DO NOTHING`,
          params
        );
        offset += rows.length;
        stats[table].copied += rows.length;
        progressLine(table, offset, total);
      }
    }

    if (!values["dry-run"]) {
      await client.query("COMMIT");
      log("✓ 事务已提交");
    }
  } catch (e) {
    if (!values["dry-run"]) {
      await client.query("ROLLBACK").catch(() => {});
      log("✗ 已回滚");
    }
    fail(`迁移失败: ${e.message}`);
  } finally {
    client.release();
    sqlite.close();
    await pgPool.end();
  }

  console.log("\n[migrate] === 总结 ===");
  for (const [table, s] of Object.entries(stats)) {
    const tag = values["dry-run"] ? `would copy ${s.source}` : `${s.copied}/${s.source}`;
    console.log(`  ${table.padEnd(22)} ${tag}`);
  }

  if (!values["dry-run"]) {
    const marker = resolve(sqlitePath + ".migrated-to-postgres");
    writeFileSync(
      marker,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          target: redact(values.postgres),
          stats,
        },
        null,
        2
      )
    );
    log(`✓ 已写迁移标记: ${marker}`);
  }
  log("迁移完成");
}

function redact(url) {
  return url.replace(/(:)([^:@/]+)(@)/, "$1***$3");
}

main().catch((e) => fail(e.stack || e.message));
