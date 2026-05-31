import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import { makeHermesToolsRouter } from "./hermes-tools-router.js";
import { makeGraphRouter } from "./graph.js";
import { makeAuditRouter } from "./audit.js";
import { makeMergeRouter } from "./merge-route.js";
import { makeEscalationRouter } from "./escalation.js";
import { makeRelationsRouter } from "./relations.js";
import { makeJobsRouter } from "./jobs.js";
import { makeOncallRouter } from "./oncall.js";
import { makeCustomCommandsRouter } from "./custom-commands.js";
import { makeEmailRouter, migrateSmtpPasswordIfNeeded } from "./email.js";
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
import { makeNotificationsRouter } from "./notifications-router.js";
import { NotificationsRepo } from "./notifications.js";
import { makeOpLogRouter } from "./op-log.js";
import { makeAuthRouter, makeUserAdminRouter, authMiddleware, adminMiddleware, leaderMiddleware } from "./auth.js";
import { csrfMiddleware } from "./csrf.js";
import { makeHealthRouter } from "./health.js";
import { makeMetricsRouter, metricsMiddleware } from "./metrics.js";
import { makeBackupRouter } from "./backup.js";
import { makeTicketTabsRouter } from "./ticket-tabs.js";
import { makeDocumentRouter } from "./documents.js";
import { makeWelinkRouter } from "./welink.js";
import { makeDbMigrationRouter } from "./db-migration.js";
import { makeUpgradeRouter } from "./upgrade.js";
import { OpencodeAgentRunner } from "./opencode-runner.js";
import { OpenAICompatibleRunner, type LlmConfig } from "./openai-compatible-runner.js";
import { ensureLlmSettingsTable, getLlmSettings, resolveLlmSecret } from "./llm-settings.js";
import { makeLlmSettingsRouter } from "./llm-settings-router.js";
import { ensureKgOutboxTable, enqueueKgOutbox, KgOutboxWorker, makeKgOutboxRouter } from "./kg-outbox.js";
import type { KgOutboxEventType } from "./kg-outbox.js";
import { ensureAuditChainColumns, makeAuditChainRouter } from "./audit-chain-router.js";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.js";
import { SqliteAdapter, type DbAdapter } from "./db-adapter.js";

export function createApp(deps: {
  repo: Repository;
  registry: SchemaRegistry;
  mailSender?: MailSender;
  /** Legacy: raw better-sqlite3 handle. When provided without `adapter`, wrapped in SqliteAdapter automatically. */
  db?: DB;
  /** Preferred: unified DB adapter (Phase 2b+). Takes precedence over `db`. */
  adapter?: DbAdapter;
  dbPath?: string;
}) {
  const mailSender = deps.mailSender ?? new NodemailerSender();
  const adapter: DbAdapter | undefined = deps.adapter ?? (deps.db ? new SqliteAdapter(deps.db) : undefined);
  const app = express();
  // P1 安全头:helmet 缺省一揽子(X-Frame-Options/X-Content-Type-Options/Referrer-Policy 等)。
  // contentSecurityPolicy 关闭 —— SPA + Ant Design 5 inline style + 第三方 CDN 配 CSP 易踩坑,
  // 放到 Nginx/CDN 前置层统一管理更稳。
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  // P1 CORS:开发期(NODE_ENV!=production)放行所有 Origin;生产期同源(浏览器直接同域,
  // 无 Origin 头时回 *,有 Origin 时回 echo)。复杂跨域请在反代层做。
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    const isProd = process.env.NODE_ENV === "production";
    if (!isProd) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    } else if (origin) {
      // 生产期:仅当 Origin 与 Host 同源时回显,否则不发 CORS 头(由浏览器同源策略拦截)
      const host = req.headers.host || "";
      const sameHost = origin.endsWith("//" + host) || origin.endsWith("//" + host.split(":")[0]);
      if (sameHost) res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  // P1 全局限流:60 req/IP/min,COMBAT_RATE_LIMIT_PER_MIN env 可调。
  // 跳过 NODE_ENV=test 与 COMBAT_NO_AUTH=1(e2e 走 supertest,每个 case 都会被打挂)。
  const skipRate = process.env.NODE_ENV === "test" || process.env.COMBAT_NO_AUTH === "1";
  const perMin = Number(process.env.COMBAT_RATE_LIMIT_PER_MIN || 60);
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: perMin,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => skipRate,
      message: { error: "请求过于频繁,请稍后再试" },
    })
  );
  // P1 登录爆破限流:5 req/IP/15min,仅限 POST /auth/login,跳过 test/NO_AUTH。
  app.use(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => skipRate,
      message: { error: "登录尝试过多,请 15 分钟后重试" },
    })
  );
  // logger 先注册:即便后续 body parser 抛错(如截图反馈 base64 超限)也会留下日志便于追踪。
  app.use(requestLogger());
  // v2.2 P1 §7: metrics 中间件紧随 logger,统计每个请求的 in_flight/count/duration
  app.use(metricsMiddleware());
  // body 限制提升到 20mb:截图反馈/笔记导入等可能上传 MB 级 base64;以前默认 100kb 直接拒绝。
  app.use(express.json({ limit: "20mb" }));

  // 健康检查 + Prometheus 指标:auth 之前注册,无需鉴权 — 系统级端点,供 systemd / 反代 / Prometheus 调用。
  app.use("/api", makeHealthRouter(deps.db));
  app.use("/api", makeMetricsRouter());

  if (adapter) {
    app.use("/api", makeAuthRouter(adapter));
    app.use("/api", authMiddleware);
    // P1 CSRF:同源 Origin/Referer 校验,挂在 auth 之后(只对已登录的写请求生效)。
    app.use("/api", csrfMiddleware);
    app.use("/api", makeUserAdminRouter(adapter));
  }

  // P0-4 修复:敏感路由统一加 adminMiddleware 守卫(必须挂在对应 router 之前)。
  // 仅当 adapter 存在(即生产/集成路径)且未设置 COMBAT_NO_AUTH 时挂载守卫;
  // 没有 adapter 的 e2e 单元测试(如 audit/reminders/email)与 COMBAT_NO_AUTH=1 的
  // 集成测试均跳过守卫,保持既有测试行为(348 通过基线)。
  if (adapter && process.env.COMBAT_NO_AUTH !== "1") {
    app.use("/api/audit", adminMiddleware);
    app.use("/api/upgrade", adminMiddleware);
    app.use("/api/merge", adminMiddleware);
    app.use("/api/op-logs", adminMiddleware);
    app.use("/api/backup", adminMiddleware);
    app.use("/api/proposals", adminMiddleware);
    app.use("/api/reminders", adminMiddleware);
    // email:配置 + 测试 + 发送均限 admin
    app.use("/api/email", adminMiddleware);
    // §v2.6: LLM 设置仅 admin 可读写。空表 GET 返回默认占位,所以读也限 admin(避免泄露已配 baseURL)。
    app.use("/api/llm-settings", adminMiddleware);
    // ticket-tabs:leader+ 可写(普通用户不应改 markdown/导致 XSS 投毒)。
    app.use("/api/tickets/:id/tabs", leaderMiddleware);
    // documents: 写入(POST/PUT/DELETE)限 leader+; GET 列表/下载保留公开(链接点击)。
    app.use("/api/documents", (req, res, next) => {
      if (req.method === "GET") return next();
      return leaderMiddleware(req, res, next);
    });
  }

  // Fire-and-forget — runs the seed in background; failures are logged but
  // don't block server startup.
  seedConfigFromSchemas(deps.registry, deps.repo).catch(() => {
    /* logged inside */
  });

  // P1 SMTP 密码加密:启动期把历史明文密码原地加密 (一次性迁移,幂等)。
  migrateSmtpPasswordIfNeeded(deps.repo).catch((e) =>
    log.warn("smtp.migration_failed", { error: (e as Error).message })
  );

  if (deps.registry instanceof FileSchemaRegistry) {
    app.use("/api", makeSchemaApiRouter(deps.registry, deps.registry.dir, deps.repo));
  }

  // resilience(outbox): provision kg_outbox + start background worker when adapter
  // is available. Without adapter (rare test paths) we degrade to no-outbox path —
  // makeRouter's `outbox?` is undefined and triggerPostSaveJobs becomes a noop.
  let outboxEnqueuer: { enqueue(eventType: string, payload: Record<string, unknown>): Promise<void> } | undefined;
  if (adapter) {
    // Provision table synchronously-ish: fire-and-forget but logged. Worker
    // will hit pending rows on its first tick (defaults to 1s).
    ensureKgOutboxTable(adapter).catch((e) => log.warn("kg_outbox.ensure_table.fail", { error: (e as Error).message }));
    // resilience(audit-merkle): ensure prev_hash/hash columns + mount verify router.
    ensureAuditChainColumns(adapter).catch((e) =>
      log.warn("audit_chain.ensure_columns.fail", { error: (e as Error).message })
    );
    app.use("/api", makeAuditChainRouter(adapter));
    outboxEnqueuer = {
      enqueue: (eventType, payload) =>
        enqueueKgOutbox(adapter, eventType as KgOutboxEventType, payload).then(() => undefined),
    };
    // Worker only in non-test envs to avoid surprising existing tests that
    // expect explicit scan endpoints to return non-zero. Tests can dispatch
    // /api/kg-outbox/process manually to drain.
    if (process.env.NODE_ENV !== "test") {
      new KgOutboxWorker(adapter, deps.repo, deps.registry).start();
    }
    app.use("/api", makeKgOutboxRouter(adapter, deps.repo, deps.registry));
  }

  app.use("/api", makeRouter(deps.repo, deps.registry, outboxEnqueuer));
  app.use("/api", makeImportRouter(deps.repo, deps.registry));
  app.use("/api", makeHonorRouter(deps.repo));
  app.use("/api", makeExportRouter(deps.repo, deps.registry));
  app.use("/api", makeRelatedRouter(deps.repo));
  app.use("/api", makeProposalsRouter(deps.repo, deps.registry));
  app.use("/api", makeQueryRouter(deps.repo, deps.registry));
  app.use("/api", makeRecommendRouter(deps.repo));
  app.use("/api", makeDashboardRouter(deps.repo));
  app.use("/api", makeDailyReportRouter(deps.repo));
  app.use(
    "/api",
    makeRemindersRouter(deps.repo, deps.registry, undefined, adapter ? new NotificationsRepo(adapter) : undefined)
  );
  app.use("/api", makeConflictsRouter(deps.repo));
  app.use("/api", makeKGRouter(deps.repo, deps.registry));
  // §v2.6: Hermes runner — 统一走 OpenAICompatibleRunner(纯 fetch OpenAI 兼容协议)。
  // 配置全部从 DB(llm_settings 表)取,经 getConfig 钩子热加载;
  // 缺 DB 配置时 fallback env → 最后 hardcoded baseURL(智谱)+ 必须 env apiKey,
  // 绝无 hardcoded apiKey。
  //
  // 同一实例同时实现 AgentRunner 与 ToolCallingRunner — runner + toolRunner 双注入,
  // hermes router 内部 plannedEngine 决定走哪条路径。
  //
  // 旧 OpencodeAgentRunner 保留为可选 fallback(HERMES_AGENT=1 时启用),用于 welink 的
  // 历史 prompt 路径;默认不启用。
  let llmRunner: OpenAICompatibleRunner | undefined;
  if (adapter) {
    ensureLlmSettingsTable(adapter).catch((e) =>
      log.warn("llm_settings.ensure_table.fail", { error: (e as Error).message })
    );
    const getConfig = async (): Promise<LlmConfig> => {
      const row = await getLlmSettings(adapter);
      const secret = await resolveLlmSecret(adapter);
      const envBase = process.env.HERMES_LLM_BASE_URL;
      const envKey = process.env.HERMES_LLM_API_KEY;
      const envModel = process.env.HERMES_MODEL;
      // 三层 fallback: DB → env → 智谱默认。apiKey 绝无 hardcoded。
      const baseURL = row?.baseUrl || envBase || "https://open.bigmodel.cn/api/paas/v4";
      const apiKey = secret || envKey || "";
      const model = row?.defaultModel || envModel || "glm-4.6";
      const smallModel = row?.smallModel || undefined;
      const thinking = row?.thinking ?? "disabled";
      const timeoutMs = row?.timeoutMs ?? 60000;
      return { baseURL, apiKey, model, smallModel, thinking, timeoutMs };
    };
    llmRunner = new OpenAICompatibleRunner({ getConfig });
    // 启动日志:报告解析到的配置来源,但不打印 apiKey。
    (async () => {
      try {
        const cfg = await getConfig();
        const row = await getLlmSettings(adapter);
        let source: "db" | "env" | "default" = "default";
        if (row && (row.baseUrl || row.defaultModel)) source = "db";
        else if (process.env.HERMES_LLM_API_KEY || process.env.HERMES_LLM_BASE_URL) source = "env";
        log.info("llm.runner.config", {
          provider: row?.provider || "default",
          baseURL: cfg.baseURL,
          model: cfg.model,
          thinking: cfg.thinking,
          source,
        });
      } catch (e) {
        log.warn("llm.runner.config_resolve_fail", { error: (e as Error).message });
      }
    })();
  }

  // 历史:仅当 HERMES_AGENT=1 显式开启时,用旧 OpencodeAgentRunner 走 welink prompt 路径。
  // 现网默认不开,welink prompt 自动走 llmRunner.run(prompt) 兼容路径。
  const hermesRunner =
    process.env.HERMES_AGENT === "1"
      ? new OpencodeAgentRunner({
          directory: fileURLToPath(new URL("../hermes-workspace", import.meta.url)),
          serverUrl: process.env.HERMES_OPENCODE_URL,
          model: process.env.HERMES_MODEL || "huawei_cloud/glm-5",
        })
      : undefined;
  hermesRunner?.warmup();
  app.use(
    "/api",
    makeHermesRouter(deps.repo, deps.registry, {
      // 默认两端都用 OpenAICompatibleRunner 实例;HERMES_AGENT=1 时 runner 路径走旧 opencode
      runner: hermesRunner ?? llmRunner,
      toolRunner: llmRunner,
      db: deps.db,
    })
  );
  // v2.5: 通用 14 工具暴露;hermes-agent 与 LLM tool-calling 用同一 callTool 入口。
  app.use("/api", makeHermesToolsRouter(deps.repo, deps.registry, adapter, deps.db));
  app.use("/api", makeGraphRouter(deps.repo, deps.registry));
  app.use("/api", makeAuditRouter(deps.repo));
  app.use("/api", makeMergeRouter(deps.repo));
  app.use("/api", makeEscalationRouter(deps.repo, adapter ? new NotificationsRepo(adapter) : undefined));
  app.use("/api", makeRelationsRouter(deps.repo));
  app.use("/api", makeJobsRouter(deps.repo, deps.registry));
  app.use("/api", makeOncallRouter(deps.repo));
  app.use("/api", makeCustomCommandsRouter(deps.repo));
  app.use("/api", makeEmailRouter(deps.repo, deps.registry, mailSender));
  // §v2.6: LLM 全局配置 (admin only)
  if (adapter) {
    app.use("/api", makeLlmSettingsRouter(adapter));
  }
  app.use("/api", makeResponsibilityRouter(deps.repo));
  app.use("/api", makeUiCacheRouter(deps.repo));
  if (adapter) {
    const notificationsRepo = new NotificationsRepo(adapter);
    app.use("/api", makeNotificationsRouter(adapter));
    app.use("/api", makeDailyReportEntryRouter(adapter));
    app.use("/api", makeSupportNodeRouter(adapter));
    app.use("/api", makeHelpRequestRouter(adapter, deps.repo, mailSender, undefined, notificationsRepo));
    app.use("/api", makeSettingsRouter(adapter));
    app.use("/api", makeBugReportRouter(adapter, notificationsRepo));
    app.use("/api", makeOpLogRouter(adapter));
    app.use("/api", makeBackupRouter(adapter, deps.dbPath || ""));
    app.use("/api", makeTicketTabsRouter(adapter));
    app.use("/api", makeDocumentRouter(adapter));
    // Always mount db-migration router (with adapter); sqlitePath may be empty
    // on Postgres path — that's fine, /status reports kind correctly and the
    // mutation endpoints validate input. The legacy `dbPath` branch stays for
    // SQLite hot-migrate flows.
    app.use("/api", makeDbMigrationRouter(adapter, deps.dbPath || ""));
  }
  // 一键升级 router (v2.3) — 不依赖 adapter,任何模式都挂载
  app.use("/api", makeUpgradeRouter(deps.dbPath || ""));
  // Welink router uses the raw better-sqlite3 handle for now.
  // Postgres path keeps Welink disabled until Welink is async-refactored.
  if (deps.db) {
    // welink 用 AgentRunner.run(prompt) 协议;hermesRunner(若启用)优先,否则 llmRunner。
    app.use("/api", makeWelinkRouter(deps.db, deps.repo, hermesRunner ?? llmRunner));
  }
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("http.error", { path: req.path, error: err.message });
    res.status(500).json({ error: err.message });
  });
  return app;
}
