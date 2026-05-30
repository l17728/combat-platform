/**
 * DB 迁移路由 (Phase 3.5 / task #68)
 *
 * 三个端点:
 *   GET  /api/db-migration/status         当前驱动 + 表行数 + 上次迁移时间
 *   POST /api/db-migration/test-connection  测试目标 Postgres 连接串
 *   POST /api/db-migration/run            一键迁移(简化版,内部 spawn CLI 工具)
 *
 * 实现策略:
 *   - status: 读 process.env.DB_URL + 用 adapter 跑 SELECT count(*) 拿每表行数;
 *             检查 <sqlitePath>.migrated-to-postgres 文件存在性
 *   - test-connection: 用 pg.Pool 临时连接 + SELECT 1
 *   - run: spawn 子进程跑 scripts/migrate/sqlite-to-postgres.mjs,阻塞返回结果
 *
 * 仅 admin 角色可调用(路由层加 role 守卫)。
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool as PgPool } from "pg";
import { log, asyncHandler } from "./logger.js";
import { parseDbUrl } from "./db.js";
import type { DbAdapter } from "./db-adapter.js";

const TABLES = [
  "users", "app_settings", "nodes", "edges", "progress_log", "audit_log",
  "proposals", "notifications", "daily_report_entry", "support_template",
  "support_node", "ticket_tabs",
];

function adminOnly(req: Request, res: Response, next: NextFunction): void {
  const role = (req as any).user?.role;
  // COMBAT_NO_AUTH 模式 (req.user 缺失) 也允许,与其他 admin-only 路由一致
  if (role !== undefined && role !== "admin") {
    res.status(403).json({ error: "仅管理员可执行数据库迁移" });
    return;
  }
  next();
}

export function makeDbMigrationRouter(adapter: DbAdapter, sqlitePath: string): Router {
  const r = Router();

  r.use(adminOnly);

  r.get("/db-migration/status", asyncHandler(async (_req, res) => {
    const dbUrl = process.env.DB_URL || `sqlite://${sqlitePath}`;
    const parsed = parseDbUrl(dbUrl);

    const tables: { name: string; rows: number }[] = [];
    for (const t of TABLES) {
      try {
        const row = await adapter.queryOne<{ c: number | string }>(`SELECT COUNT(*) as c FROM ${t}`);
        // Postgres returns BIGINT (COUNT) as string; SQLite returns number.
        tables.push({ name: t, rows: Number(row?.c ?? 0) });
      } catch {
        tables.push({ name: t, rows: 0 });
      }
    }

    let lastMigratedAt: string | null = null;
    const marker = resolve(sqlitePath + ".migrated-to-postgres");
    if (existsSync(marker)) {
      try {
        const j = JSON.parse(readFileSync(marker, "utf-8"));
        lastMigratedAt = j.at || statSync(marker).mtime.toISOString();
      } catch {
        lastMigratedAt = statSync(marker).mtime.toISOString();
      }
    }

    res.json({
      kind: parsed.kind,
      url: dbUrl.replace(/(:)([^:@/]+)(@)/, "$1***$3"),
      tables,
      lastMigratedAt,
    });
  }));

  r.post("/db-migration/test-connection", asyncHandler(async (req, res) => {
    const { pgUrl } = req.body as { pgUrl?: string };
    if (!pgUrl || !/^(postgres|postgresql):\/\//.test(pgUrl)) {
      res.status(400).json({ error: "pgUrl 必须以 postgres:// 或 postgresql:// 开头" });
      return;
    }
    const pool = new PgPool({ connectionString: pgUrl, connectionTimeoutMillis: 5000 });
    try {
      const r = await pool.query("SELECT 1 as ok");
      if (r.rows[0]?.ok !== 1) throw new Error("意外的 SELECT 1 响应");
      res.json({ ok: true });
    } catch (e: any) {
      log.warn("db_migration.test_connection.fail", { error: e.message });
      res.status(400).json({ ok: false, error: e.message });
    } finally {
      await pool.end().catch(() => {});
    }
  }));

  r.post("/db-migration/run", asyncHandler(async (req, res) => {
    const { pgUrl, truncate, dryRun } = req.body as { pgUrl?: string; truncate?: boolean; dryRun?: boolean };
    if (!pgUrl) { res.status(400).json({ error: "pgUrl 必填" }); return; }

    // spawn CLI 工具 — 它已实现批量 INSERT + 事务 + 进度
    const scriptPath = join(process.cwd(), "scripts", "migrate", "sqlite-to-postgres.mjs");
    if (!existsSync(scriptPath)) {
      res.status(500).json({ error: `迁移脚本不存在: ${scriptPath}` });
      return;
    }

    const args = ["--sqlite", sqlitePath, "--postgres", pgUrl];
    if (truncate) args.push("--truncate");
    if (dryRun) args.push("--dry-run");

    log.info("db_migration.run.start", { dryRun, truncate });

    const proc = spawn("node", [scriptPath, ...args], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });

    proc.on("close", code => {
      log.info("db_migration.run.done", { code, dryRun });
      if (code === 0) {
        // 从 stdout 反解析每表统计("table 100/100")
        const stats: Record<string, { source: number; copied: number }> = {};
        const re = /^\s+(\w+)\s+(?:would copy\s+)?(\d+)(?:\/(\d+))?\s*$/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(stdout)) !== null) {
          const name = m[1];
          const copied = parseInt(m[2], 10);
          const source = m[3] ? parseInt(m[3], 10) : copied;
          stats[name] = { source, copied };
        }
        res.json({ ok: true, stats, log: stdout });
      } else {
        res.status(500).json({ ok: false, error: stderr || stdout || `exit ${code}`, log: stdout });
      }
    });

    proc.on("error", err => {
      log.error("db_migration.run.spawn_fail", { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    });
  }));

  return r;
}
