import { join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { openDb, openDbFromUrl, parseDbUrl } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { FileSchemaRegistry } from "./registry.js";
import { createApp } from "./app.js";
import { tickScheduledJobs } from "./jobs.js";
import { DigestRepo, sendDigest } from "./digest.js";
import { NodemailerSender } from "./mailer.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";
import { runScheduledBackup, applyRestorePending } from "./backup.js";
import { SqliteAdapter, PostgresAdapter, type DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";
import { initSentry, captureException } from "./sentry.js";

initSentry();
process.on("uncaughtException", (e) => {
  captureException(e, { phase: "uncaughtException" });
  log.error("process.uncaughtException", { error: (e as Error).message });
});
process.on("unhandledRejection", (e) => {
  captureException(e, { phase: "unhandledRejection" });
  log.error("process.unhandledRejection", { error: e instanceof Error ? e.message : String(e) });
});

// Driver selection (Phase 2c):
//   - DB_URL takes precedence (sqlite://... or postgres://...)
//   - COMBAT_DB_PATH stays as a SQLite-only override for backwards compat
//   - Default: cwd/combat.sqlite
//
// Both paths use the same dialect-neutral SqliteRepository via DbAdapter.
const explicitDbUrl = process.env.DB_URL?.trim();
const dbUrl = explicitDbUrl || `sqlite://${process.env.COMBAT_DB_PATH || join(process.cwd(), "combat.sqlite")}`;
const parsed = parseDbUrl(dbUrl);

// SQLite path tracks a real file; Postgres path keeps an empty string so the
// backup router knows there's no local SQLite file to back up.
const DB_PATH = parsed.kind === "sqlite" ? parsed.sqlitePath! : "";

// Top-level await is supported in NodeNext ESM — bootstrap async to wire the
// correct adapter before createApp runs.
let adapter: DbAdapter;
let rawSqliteDb: import("./db.js").DB | undefined;
if (parsed.kind === "sqlite") {
  applyRestorePending(DB_PATH);
  rawSqliteDb = openDb(DB_PATH);
  adapter = new SqliteAdapter(rawSqliteDb);
  log.info("server.driver", { kind: "sqlite", path: DB_PATH });
} else {
  // Postgres: enable phase2 marker so openDbFromUrl skips the stub warning.
  process.env.COMBAT_POSTGRES_PHASE2 = "1";
  const handle = await openDbFromUrl(dbUrl);
  if (handle.kind !== "postgres") {
    throw new Error("unexpected: parseDbUrl said postgres but openDbFromUrl returned sqlite");
  }
  adapter = new PostgresAdapter(handle.pool);
  log.info("server.driver", { kind: "postgres" });
}

const repo = new SqliteRepository(adapter);
// v2.3 schema overlay: 用户 UI 新增字段写到 data/schemas-overlay/,跨升级保留。
// 现网 /opt/combat-v2/data/schemas-overlay/(systemd WorkingDirectory=/opt/combat-v2)
// dev: apps/backend/data/schemas-overlay/
const overlayDir = process.env.COMBAT_SCHEMA_OVERLAY_DIR || join(process.cwd(), "data", "schemas-overlay");
const registry = new FileSchemaRegistry(join(process.cwd(), "..", "..", "config", "schemas"), overlayDir);
// Pass rawSqliteDb so welink router (SQLite-only) gets mounted; undefined on
// Postgres path keeps welink disabled until async-refactored.
const app = createApp({ repo, registry, adapter, db: rawSqliteDb, dbPath: DB_PATH });

const frontendDist = join(process.cwd(), "..", "frontend-v2", "dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api")) return next();
    res.sendFile(join(frontendDist, "index.html"));
  });
  log.info("server.serving_frontend", { dir: frontendDist });
}

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`backend on :${PORT}`);

  const AUTO_SCAN_INTERVAL = 5 * 60 * 1000;
  setInterval(() => {
    scanEscalation(repo).catch((e) => log.warn("auto_scan.escalation.fail", { error: (e as Error).message }));
    scanAndCreateReminders(repo, registry).catch((e) =>
      log.warn("auto_scan.reminders.fail", { error: (e as Error).message })
    );
  }, AUTO_SCAN_INTERVAL).unref();
  log.info("server.auto_scan.started", { intervalMs: AUTO_SCAN_INTERVAL });

  setInterval(() => {
    runScheduledBackup(adapter, DB_PATH).catch((e) => log.warn("auto_backup.fail", { error: (e as Error).message }));
  }, 3600_000).unref();
  log.info("server.backup_scheduler.started");
});

setInterval(() => {
  tickScheduledJobs(repo, registry).catch((e) => console.error("[jobs.tick]", e));
}, 3600_000).unref();

setInterval(() => {
  (async () => {
    const digestRepo = new DigestRepo(adapter);
    const config = await digestRepo.getConfig();
    if (!config.enabled || config.recipients.length === 0) return;
    const now = new Date();
    const last = config.lastSentAt ? new Date(config.lastSentAt) : null;
    const shouldSend =
      config.frequency === "daily"
        ? !last || last.toDateString() !== now.toDateString()
        : !last || now.getTime() - last.getTime() > 7 * 24 * 60 * 60 * 1000;
    if (!shouldSend) return;
    const { readConfig } = await import("./email.js");
    const smtpConfig = await readConfig(repo);
    if (!smtpConfig) return;
    await sendDigest(adapter, repo, new NodemailerSender(), smtpConfig);
  })().catch((e) => log.warn("digest.auto_send.fail", { error: (e as Error).message }));
}, 3600_000).unref();
