import { Router } from "express";
import type { DB } from "./db.js";
import type { Repository, SmtpConfig } from "@combat/shared";
import type { MailSender } from "./mailer.js";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";

export interface HelpRequest {
  id: string;
  ticketId: string;
  requesterName: string;
  targetName: string | null;
  targetEmail: string;
  category: string;
  question: string;
  extraNote: string | null;
  feedbackToken: string;
  status: string;
  feedback: string | null;
  feedbackBy: string | null;
  feedbackAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toHelpRequest(r: any): HelpRequest {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    requesterName: r.requester_name,
    targetName: r.target_name ?? null,
    targetEmail: r.target_email,
    category: r.category,
    question: r.question,
    extraNote: r.extra_note ?? null,
    feedbackToken: r.feedback_token,
    status: r.status,
    feedback: r.feedback ?? null,
    feedbackBy: r.feedback_by ?? null,
    feedbackAt: r.feedback_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function ensureTable(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS help_requests (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      target_name TEXT,
      target_email TEXT NOT NULL,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      extra_note TEXT,
      feedback_token TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT '待回复',
      feedback TEXT,
      feedback_by TEXT,
      feedback_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_help_requests_ticket ON help_requests(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status);
    CREATE INDEX IF NOT EXISTS idx_help_requests_token ON help_requests(feedback_token);
  `);
}

export function makeHelpRequestRouter(db: DB, repo: Repository, mailSender: MailSender, baseUrl?: string): Router {
  ensureTable(db);
  const r = Router();
  const BASE = baseUrl ?? process.env.HELP_BASE_URL ?? "http://124.156.193.122:3001";

  r.post(
    "/help-requests",
    asyncHandler(async (req, res) => {
      const { ticketId, requesterName, targetName, targetEmail, category, question, extraNote } =
        req.body ?? {};
      if (!ticketId || !requesterName || !targetEmail || !category || !question) {
        return res.status(400).json({
          error: "ticketId, requesterName, targetEmail, category, question 为必填项",
        });
      }

      const now = new Date().toISOString();
      const id = randomUUID();
      const feedbackToken = randomUUID();

      const ticket = repo.getNode(ticketId);
      const ticketTitle = ticket
        ? String(ticket.properties["标题"] ?? ticketId.slice(0, 8))
        : ticketId.slice(0, 8);

      db.prepare(
        `INSERT INTO help_requests (id, ticket_id, requester_name, target_name, target_email, category, question, extra_note, feedback_token, status, created_at, updated_at)
         VALUES (@id, @ticket_id, @requester_name, @target_name, @target_email, @category, @question, @extra_note, @feedback_token, @status, @created_at, @updated_at)`,
      ).run({
        id,
        ticket_id: ticketId,
        requester_name: requesterName,
        target_name: targetName ?? null,
        target_email: targetEmail,
        category,
        question,
        extra_note: extraNote ?? null,
        feedback_token: feedbackToken,
        status: "待回复",
        created_at: now,
        updated_at: now,
      });

      // Link points at the FRONTEND feedback form route (renders a form), not the
      // JSON API endpoint. The form then GETs /api/help/feedback/:token for data.
      const feedbackLink = `${BASE}/help/feedback/${feedbackToken}`;
      const emailSubject = `【作战平台求助】${requesterName} 就「${ticketTitle}」向您求助`;
      const emailBody = `${requesterName} 在攻关单「${ticketTitle}」中需要您的帮助：\n\n${question}\n\n请点击以下链接回复：\n${feedbackLink}\n\n— 作战平台`;

      let emailSent = false;
      let emailNote = "";
      try {
        const raw = repo.getSetting("smtp");
        if (raw) {
          const cfg = JSON.parse(raw) as SmtpConfig;
          if (cfg.host) {
            await mailSender.send(cfg, {
              to: [targetEmail],
              subject: emailSubject,
              body: emailBody,
            });
            emailSent = true;
            log.info("help_request.email_sent", { id, to: targetEmail });
          } else {
            emailNote = "邮箱未配置（SMTP 主机为空）";
            log.warn("help_request.no_smtp_host", { id });
          }
        } else {
          emailNote = "邮箱未配置（未设置 SMTP），请到「邮件设置」配置";
          log.warn("help_request.no_smtp", { id });
        }
      } catch (e) {
        emailNote = `邮件发送失败：${(e as Error).message}`;
        log.warn("help_request.email_fail", { id, error: (e as Error).message });
      }

      log.info("help_request.create", { id, ticketId, emailSent });
      const row = db.prepare("SELECT * FROM help_requests WHERE id=?").get(id) as any;
      res.status(201).json({ ...toHelpRequest(row), emailSent, emailNote, feedbackLink });
    }),
  );

  r.get("/help-requests", (req, res) => {
    const { ticketId, status } = req.query ?? {};
    let sql = "SELECT * FROM help_requests WHERE 1=1";
    const params: any[] = [];
    if (ticketId) {
      sql += " AND ticket_id=?";
      params.push(ticketId);
    }
    if (status) {
      sql += " AND status=?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC";
    const rows = db.prepare(sql).all(...params) as any[];
    res.json(rows.map(toHelpRequest));
  });

  r.get("/help/feedback/:token", (req, res) => {
    const row = db
      .prepare("SELECT * FROM help_requests WHERE feedback_token=?")
      .get(req.params.token) as any;
    if (!row) return res.status(404).json({ error: "未找到该求助记录" });
    const ticket = repo.getNode(row.ticket_id);
    res.json({
      ticketTitle: ticket
        ? String(ticket.properties["标题"] ?? row.ticket_id.slice(0, 8))
        : row.ticket_id.slice(0, 8),
      requesterName: row.requester_name,
      question: row.question,
      category: row.category,
      status: row.status,
    });
  });

  r.post("/help/feedback/:token", (req, res) => {
    const row = db
      .prepare("SELECT * FROM help_requests WHERE feedback_token=?")
      .get(req.params.token) as any;
    if (!row) return res.status(404).json({ error: "未找到该求助记录" });
    if (row.status === "已回复")
      return res.status(400).json({ error: "该求助已回复" });

    const { feedback, name } = req.body ?? {};
    if (!feedback) return res.status(400).json({ error: "反馈内容不能为空" });

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE help_requests SET feedback=?, feedback_by=?, feedback_at=?, status='已回复', updated_at=? WHERE id=?`,
    ).run(feedback, name ?? null, now, now, row.id);

    if (row.ticket_id) {
      try {
        repo.appendProgress(
          row.ticket_id,
          `【求助回复】${row.target_name ?? row.target_email} 回复了「${row.question.slice(0, 40)}...」：${feedback}`,
          "处理中",
          "system",
        );
      } catch {
        log.warn("help_request.progress_append_fail", { id: row.id });
      }
    }

    log.info("help_request.feedback", { id: row.id });
    const updated = db.prepare("SELECT * FROM help_requests WHERE id=?").get(row.id) as any;
    res.json(toHelpRequest(updated));
  });

  return r;
}
