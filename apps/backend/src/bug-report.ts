import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";
import { createNotificationSafe, type NotificationsRepo } from "./notifications.js";

export interface BugReport {
  id: string;
  title: string;
  description: string;
  severity: string;
  pageUrl: string;
  reporter: string;
  screenshot: string | null;
  consoleLogs: string | null;
  userAgent: string | null;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toBugReport(r: any): BugReport {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    severity: r.severity,
    pageUrl: r.page_url,
    reporter: r.reporter,
    screenshot: r.screenshot ?? null,
    consoleLogs: r.console_logs ?? null,
    userAgent: r.user_agent ?? null,
    status: r.status,
    resolution: r.resolution ?? null,
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: r.resolved_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function ensureTable(adapter: DbAdapter) {
  // SQLite-only DDL — Postgres path already provisioned by POSTGRES_SCHEMA_DDL.
  if (adapter.kind !== "sqlite") return;
  adapter.rawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT '一般',
      page_url TEXT NOT NULL DEFAULT '',
      reporter TEXT NOT NULL DEFAULT '',
      screenshot TEXT,
      console_logs TEXT,
      user_agent TEXT,
      status TEXT NOT NULL DEFAULT '待处理',
      resolution TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
    CREATE INDEX IF NOT EXISTS idx_bug_reports_severity ON bug_reports(severity);
  `);
}

export function makeBugReportRouter(adapter: DbAdapter, notifications?: NotificationsRepo): Router {
  ensureTable(adapter);
  const r = Router();

  r.post(
    "/bug-reports",
    asyncHandler(async (req, res) => {
      const { title, description, severity, pageUrl, reporter, screenshot, consoleLogs, userAgent } = req.body ?? {};
      if (!title) return res.status(400).json({ error: "title 为必填项" });

      const now = new Date().toISOString();
      const id = randomUUID();

      await adapter.run(
        `INSERT INTO bug_reports (id, title, description, severity, page_url, reporter, screenshot, console_logs, user_agent, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          title,
          description ?? "",
          severity ?? "一般",
          pageUrl ?? "",
          reporter ?? "",
          screenshot ?? null,
          consoleLogs ?? null,
          userAgent ?? null,
          "待处理",
          now,
          now,
        ]
      );

      log.info("bug_report.create", { id, title });
      const row = await adapter.queryOne<any>("SELECT * FROM bug_reports WHERE id=?", [id]);
      res.status(201).json(toBugReport(row));
    })
  );

  r.get(
    "/bug-reports",
    asyncHandler(async (req, res) => {
      const { status, severity } = req.query ?? {};
      let sql = "SELECT * FROM bug_reports WHERE 1=1";
      const params: any[] = [];
      if (status) {
        sql += " AND status=?";
        params.push(status);
      }
      if (severity) {
        sql += " AND severity=?";
        params.push(severity);
      }
      sql += " ORDER BY created_at DESC";
      const rows = await adapter.query<any>(sql, params);
      res.json(rows.map(toBugReport));
    })
  );

  r.get(
    "/bug-reports/:id",
    asyncHandler(async (req, res) => {
      const row = await adapter.queryOne<any>("SELECT * FROM bug_reports WHERE id=?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "未找到该问题" });
      res.json(toBugReport(row));
    })
  );

  r.patch(
    "/bug-reports/:id",
    asyncHandler(async (req, res) => {
      const row = await adapter.queryOne<any>("SELECT * FROM bug_reports WHERE id=?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "未找到该问题" });

      const { status, resolution, resolvedBy, title, description, severity, pageUrl, reporter } = req.body ?? {};
      const now = new Date().toISOString();
      const updates: string[] = ["updated_at=?"];
      const params: any[] = [now];

      if (title !== undefined) {
        updates.push("title=?");
        params.push(title);
      }
      if (description !== undefined) {
        updates.push("description=?");
        params.push(description);
      }
      if (severity !== undefined) {
        updates.push("severity=?");
        params.push(severity);
      }
      if (pageUrl !== undefined) {
        updates.push("page_url=?");
        params.push(pageUrl);
      }
      if (reporter !== undefined) {
        updates.push("reporter=?");
        params.push(reporter);
      }
      if (status !== undefined) {
        updates.push("status=?");
        params.push(status);
      }
      if (resolution !== undefined) {
        updates.push("resolution=?");
        params.push(resolution);
      }
      if (resolvedBy !== undefined) {
        updates.push("resolved_by=?");
        params.push(resolvedBy);
      }
      if (status === "已解决" || status === "已关闭") {
        updates.push("resolved_at=?");
        params.push(now);
      }

      params.push(req.params.id);
      await adapter.run(`UPDATE bug_reports SET ${updates.join(", ")} WHERE id=?`, params);

      log.info("bug_report.update", { id: req.params.id, status });
      const updated = await adapter.queryOne<any>("SELECT * FROM bug_reports WHERE id=?", [req.params.id]);

      // 状态变更且提报人非空 → 给提报人投递收件箱通知
      if (notifications && status !== undefined && status !== row.status && updated.reporter) {
        await createNotificationSafe(notifications, {
          userId: updated.reporter,
          kind: "bug_update",
          title: `问题反馈状态变更:${status}`,
          body: `「${updated.title}」从「${row.status}」变更为「${status}」${
            updated.resolution ? "\n备注:" + String(updated.resolution).slice(0, 80) : ""
          }`,
          link: `/bug-report`,
          sourceEntityId: updated.id,
        });
      }

      res.json(toBugReport(updated));
    })
  );

  r.delete(
    "/bug-reports/:id",
    asyncHandler(async (req, res) => {
      const row = await adapter.queryOne<any>("SELECT * FROM bug_reports WHERE id=?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "未找到该问题" });
      await adapter.run("DELETE FROM bug_reports WHERE id=?", [req.params.id]);
      log.info("bug_report.delete", { id: req.params.id });
      res.json({ deleted: req.params.id });
    })
  );

  return r;
}
