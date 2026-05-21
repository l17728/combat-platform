import { join } from "node:path";
import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { FileSchemaRegistry } from "./registry.js";
import { createApp } from "./app.js";
import { tickScheduledJobs } from "./jobs.js";

const repo = new SqliteRepository(openDb(join(process.cwd(), "combat.sqlite")));
const registry = new FileSchemaRegistry(join(process.cwd(), "..", "..", "config", "schemas"));
createApp({ repo, registry }).listen(3001, () => console.log("backend on :3001"));

// §51.2: hourly background scan (production entry only — createApp stays timer-free for tests).
setInterval(() => {
  try { tickScheduledJobs(repo, registry); } catch (e) { console.error("[jobs.tick]", e); }
}, 3600_000).unref();
