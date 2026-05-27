import { join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { FileSchemaRegistry } from "./registry.js";
import { createApp } from "./app.js";
import { tickScheduledJobs } from "./jobs.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";
import { runScheduledBackup, applyRestorePending } from "./backup.js";
import { log } from "./logger.js";

const DB_PATH = join(process.cwd(), "combat.sqlite");
applyRestorePending(DB_PATH);
const db = openDb(DB_PATH);
const repo = new SqliteRepository(db);
const registry = new FileSchemaRegistry(join(process.cwd(), "..", "..", "config", "schemas"));
const app = createApp({ repo, registry, db, dbPath: DB_PATH });

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
    try { scanEscalation(repo); } catch (e) { log.warn("auto_scan.escalation.fail", { error: (e as Error).message }); }
    try { scanAndCreateReminders(repo, registry); } catch (e) { log.warn("auto_scan.reminders.fail", { error: (e as Error).message }); }
  }, AUTO_SCAN_INTERVAL).unref();
  log.info("server.auto_scan.started", { intervalMs: AUTO_SCAN_INTERVAL });

  setInterval(() => {
    try { runScheduledBackup(db, DB_PATH); } catch (e) { log.warn("auto_backup.fail", { error: (e as Error).message }); }
  }, 3600_000).unref();
  log.info("server.backup_scheduler.started");
});

setInterval(() => {
  try { tickScheduledJobs(repo, registry); } catch (e) { console.error("[jobs.tick]", e); }
}, 3600_000).unref();
