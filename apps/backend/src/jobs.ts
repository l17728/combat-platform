import { Router } from "express";
import type { Repository, SchemaRegistry, JobsTickResult } from "@combat/shared";
import { syncConflicts } from "./conflicts.js";
import { scanEscalation } from "./escalation.js";
import { scanAndCreateReminders } from "./reminders.js";

/**
 * §51.2: run all scheduled background scans once (conflicts + escalation + reminders)
 * and return aggregate counts. Pure function — no timers; the production entry wires a
 * setInterval around this so createApp (and tests) stay timer-free.
 */
export function tickScheduledJobs(repo: Repository, registry: SchemaRegistry): JobsTickResult {
  const { conflicts, overlaps } = syncConflicts(repo);
  const { escalated } = scanEscalation(repo);
  const reminders = scanAndCreateReminders(repo, registry);
  return { conflicts, overlaps, escalated, reminders };
}

export function makeJobsRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/jobs/tick", (_req, res) => res.json(tickScheduledJobs(repo, registry)));
  return r;
}
