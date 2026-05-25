import { Router } from "express";
import type { DB } from "./db.js";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";

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

function ensureTable(db: DB) {
  db.exec(`
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

export function makeBugReportRouter(db: DB): Router {
  ensureTable(db);
  const r = Router();

  r.post(
    "/bug-reports",
    asyncHandler(async (req, res) => {
      const { title, description, severity, pageUrl, reporter, screenshot, consoleLogs, userAgent } =
        req.body ?? {};
      if (!title) return res.status(400).json({ error: "title 为必填项" });

      const now = new Date().toISOString();
      const id = randomUUID();

      db.prepare(
        `INSERT INTO bug_reports (id, title, description, severity, page_url, reporter, screenshot, console_logs, user_agent, status, created_at, updated_at)
         VALUES (@id, @title, @description, @severity, @page_url, @reporter, @screenshot, @console_logs, @user_agent, @status, @created_at, @updated_at)`,
      ).run({
        id,
        title,
        description: description ?? "",
        severity: severity ?? "一般",
        page_url: pageUrl ?? "",
        reporter: reporter ?? "",
        screenshot: screenshot ?? null,
        console_logs: consoleLogs ?? null,
        user_agent: userAgent ?? null,
        status: "待处理",
        created_at: now,
        updated_at: now,
      });

      log.info("bug_report.create", { id, title });
      const row = db.prepare("SELECT * FROM bug_reports WHERE id=?").get(id) as any;
      res.status(201).json(toBugReport(row));
    }),
  );

  r.get("/bug-reports", (req, res) => {
    const { status, severity } = req.query ?? {};
    let sql = "SELECT * FROM bug_reports WHERE 1=1";
    const params: any[] = [];
    if (status) { sql += " AND status=?"; params.push(status); }
    if (severity) { sql += " AND severity=?"; params.push(severity); }
    sql += " ORDER BY created_at DESC";
    const rows = db.prepare(sql).all(...params) as any[];
    res.json(rows.map(toBugReport));
  });

  r.get("/bug-reports/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM bug_reports WHERE id=?").get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: "未找到该问题" });
    res.json(toBugReport(row));
  });

  r.patch(
    "/bug-reports/:id",
    asyncHandler(async (req, res) => {
      const row = db.prepare("SELECT * FROM bug_reports WHERE id=?").get(req.params.id) as any;
      if (!row) return res.status(404).json({ error: "未找到该问题" });

      const { status, resolution, resolvedBy } = req.body ?? {};
      const now = new Date().toISOString();
      const updates: string[] = ["updated_at=?"];
      const params: any[] = [now];

      if (status !== undefined) { updates.push("status=?"); params.push(status); }
      if (resolution !== undefined) { updates.push("resolution=?"); params.push(resolution); }
      if (resolvedBy !== undefined) { updates.push("resolved_by=?"); params.push(resolvedBy); }
      if (status === "已解决" || status === "已关闭") { updates.push("resolved_at=?"); params.push(now); }

      params.push(req.params.id);
      db.prepare(`UPDATE bug_reports SET ${updates.join(", ")} WHERE id=?`).run(...params);

      log.info("bug_report.update", { id: req.params.id, status });
      const updated = db.prepare("SELECT * FROM bug_reports WHERE id=?").get(req.params.id) as any;
      res.json(toBugReport(updated));
    }),
  );

  r.delete("/bug-reports/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM bug_reports WHERE id=?").get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: "未找到该问题" });
    db.prepare("DELETE FROM bug_reports WHERE id=?").run(req.params.id);
    log.info("bug_report.delete", { id: req.params.id });
    res.json({ deleted: req.params.id });
  });

  return r;
}
