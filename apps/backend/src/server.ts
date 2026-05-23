import { join } from "node:path";
import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { FileSchemaRegistry } from "./registry.js";
import { createApp } from "./app.js";
import { tickScheduledJobs } from "./jobs.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";
import { log } from "./logger.js";

const db = openDb(join(process.cwd(), "combat.sqlite"));
const repo = new SqliteRepository(db);
const registry = new FileSchemaRegistry(join(process.cwd(), "..", "..", "config", "schemas"));
createApp({ repo, registry, db }).listen(3001, () => {
  console.log("backend on :3001");

  // Auto-scan every 5 minutes (300_000 ms) for escalations and reminders
  const AUTO_SCAN_INTERVAL = 5 * 60 * 1000;
  setInterval(() => {
    try { scanEscalation(repo); } catch (e) { log.warn("auto_scan.escalation.fail", { error: (e as Error).message }); }
    try { scanAndCreateReminders(repo, registry); } catch (e) { log.warn("auto_scan.reminders.fail", { error: (e as Error).message }); }
  }, AUTO_SCAN_INTERVAL).unref();
  log.info("server.auto_scan.started", { intervalMs: AUTO_SCAN_INTERVAL });
});

// §51.2: hourly background scan (production entry only — createApp stays timer-free for tests).
setInterval(() => {
  try { tickScheduledJobs(repo, registry); } catch (e) { console.error("[jobs.tick]", e); }
}, 3600_000).unref();
