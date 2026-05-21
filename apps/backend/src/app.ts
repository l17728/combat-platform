import express from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import { makeRouter } from "./routes.js";
import { makeImportRouter } from "./import.js";
import { makeHonorRouter } from "./honor.js";
import { makeExportRouter } from "./export.js";
import { makeRelatedRouter } from "./related.js";
import { makeProposalsRouter } from "./proposals.js";
import { makeQueryRouter } from "./query.js";
import { makeRecommendRouter } from "./recommend.js";
import { makeDashboardRouter } from "./dashboard.js";
import { makeDailyReportRouter } from "./daily-report.js";
import { makeRemindersRouter } from "./reminders.js";
import { makeConflictsRouter } from "./conflicts.js";
import { makeKGRouter } from "./kg-rebuild.js";
import { makeHermesRouter } from "./hermes.js";
import { makeGraphRouter } from "./graph.js";
import { makeAuditRouter } from "./audit.js";
import { makeMergeRouter } from "./merge-route.js";
import { makeEmailRouter } from "./email.js";
import { NodemailerSender, type MailSender } from "./mailer.js";

export function createApp(deps: { repo: Repository; registry: SchemaRegistry; mailSender?: MailSender }) {
  const mailSender = deps.mailSender ?? new NodemailerSender();
  const app = express();
  app.use(express.json());
  app.use("/api", makeRouter(deps.repo, deps.registry));
  app.use("/api", makeImportRouter(deps.repo, deps.registry));
  app.use("/api", makeHonorRouter(deps.repo));
  app.use("/api", makeExportRouter(deps.repo, deps.registry));
  app.use("/api", makeRelatedRouter(deps.repo));
  app.use("/api", makeProposalsRouter(deps.repo, deps.registry));
  app.use("/api", makeQueryRouter(deps.repo, deps.registry));
  app.use("/api", makeRecommendRouter(deps.repo));
  app.use("/api", makeDashboardRouter(deps.repo));
  app.use("/api", makeDailyReportRouter(deps.repo));
  app.use("/api", makeRemindersRouter(deps.repo, deps.registry));
  app.use("/api", makeConflictsRouter(deps.repo));
  app.use("/api", makeKGRouter(deps.repo, deps.registry));
  app.use("/api", makeHermesRouter(deps.repo, deps.registry));
  app.use("/api", makeGraphRouter(deps.repo));
  app.use("/api", makeAuditRouter(deps.repo));
  app.use("/api", makeMergeRouter(deps.repo));
  app.use("/api", makeEmailRouter(deps.repo, deps.registry, mailSender));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}
