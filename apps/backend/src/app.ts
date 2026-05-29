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
import { makeEscalationRouter } from "./escalation.js";
import { makeRelationsRouter } from "./relations.js";
import { makeJobsRouter } from "./jobs.js";
import { makeOncallRouter } from "./oncall.js";
import { makeCustomCommandsRouter } from "./custom-commands.js";
import { makeEmailRouter } from "./email.js";
import { NodemailerSender, type MailSender } from "./mailer.js";
import { requestLogger, log } from "./logger.js";
import { makeResponsibilityRouter } from "./responsibility.js";
import { makeSchemaApiRouter, seedConfigFromSchemas } from "./schema-api.js";
import { makeUiCacheRouter } from "./ui-cache.js";
import { FileSchemaRegistry } from "./registry.js";
import { makeDailyReportEntryRouter } from "./daily-report-entry.js";
import { makeSupportNodeRouter } from "./support-node.js";
import { makeHelpRequestRouter } from "./help-request.js";
import { makeSettingsRouter } from "./settings.js";
import { makeBugReportRouter } from "./bug-report.js";
import { makeOpLogRouter } from "./op-log.js";
import { makeAuthRouter, makeUserAdminRouter, authMiddleware } from "./auth.js";
import { makeBackupRouter } from "./backup.js";
import { makeTicketTabsRouter } from "./ticket-tabs.js";
import { makeDocumentRouter } from "./documents.js";
import { OpencodeAgentRunner } from "./opencode-runner.js";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.js";

export function createApp(deps: { repo: Repository; registry: SchemaRegistry; mailSender?: MailSender; db?: DB; dbPath?: string }) {
  const mailSender = deps.mailSender ?? new NodemailerSender();
  const app = express();
  app.use(express.json());
  app.use(requestLogger());

  if (deps.db) {
    app.use("/api", makeAuthRouter(deps.db));
    app.use("/api", authMiddleware);
    app.use("/api", makeUserAdminRouter(deps.db));
  }

  seedConfigFromSchemas(deps.registry, deps.repo);

  if (deps.registry instanceof FileSchemaRegistry) {
    app.use("/api", makeSchemaApiRouter(deps.registry, deps.registry.dir, deps.repo));
  }
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
  // Hermes 概念用 agent(opencode)实现;默认关闭(HERMES_AGENT=1 开启),
  // 关闭或失败时回退规则引擎,保证现网零风险接入。
  const hermesRunner = process.env.HERMES_AGENT === "1"
    ? new OpencodeAgentRunner({
        directory: fileURLToPath(new URL("../hermes-workspace", import.meta.url)),
        serverUrl: process.env.HERMES_OPENCODE_URL,
        model: process.env.HERMES_MODEL || "huawei_cloud/glm-5",
      })
    : undefined;
  app.use("/api", makeHermesRouter(deps.repo, deps.registry, hermesRunner));
  app.use("/api", makeGraphRouter(deps.repo));
  app.use("/api", makeAuditRouter(deps.repo));
  app.use("/api", makeMergeRouter(deps.repo));
  app.use("/api", makeEscalationRouter(deps.repo));
  app.use("/api", makeRelationsRouter(deps.repo));
  app.use("/api", makeJobsRouter(deps.repo, deps.registry));
  app.use("/api", makeOncallRouter(deps.repo));
  app.use("/api", makeCustomCommandsRouter(deps.repo));
  app.use("/api", makeEmailRouter(deps.repo, deps.registry, mailSender));
  app.use("/api", makeResponsibilityRouter(deps.repo));
  app.use("/api", makeUiCacheRouter(deps.repo));
  if (deps.db) {
    app.use("/api", makeDailyReportEntryRouter(deps.db));
    app.use("/api", makeSupportNodeRouter(deps.db));
    app.use("/api", makeHelpRequestRouter(deps.db, deps.repo, mailSender));
    app.use("/api", makeSettingsRouter(deps.db));
    app.use("/api", makeBugReportRouter(deps.db));
    app.use("/api", makeOpLogRouter(deps.db));
    app.use("/api", makeBackupRouter(deps.db, deps.dbPath || ""));
    app.use("/api", makeTicketTabsRouter(deps.db));
    app.use("/api", makeDocumentRouter(deps.db));
  }
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("http.error", { path: req.path, error: err.message });
    res.status(500).json({ error: err.message });
  });
  return app;
}
