import { Router } from "express";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";
import type { DB } from "./db.js";

export interface WelinkMessage {
  id: string;
  ticketId: string;
  messageId: string;
  sentAt: string;
  author: string;
  authorId: string | null;
  content: string;
  attachments: unknown[];
  raw: string | null;
  selected: boolean;
  deletedAt: string | null;
  createdAt: string;
}

function rowToMessage(r: any): WelinkMessage {
  let attachments: unknown[] = [];
  try { attachments = JSON.parse(r.attachments || "[]"); } catch { attachments = []; }
  return {
    id: r.id,
    ticketId: r.ticket_id,
    messageId: r.message_id,
    sentAt: r.sent_at,
    author: r.author,
    authorId: r.author_id ?? null,
    content: r.content,
    attachments,
    raw: r.raw ?? null,
    selected: !!r.selected,
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at,
  };
}

export function ensureWelinkMessagesTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS welink_messages (
      id           TEXT PRIMARY KEY,
      ticket_id    TEXT NOT NULL,
      message_id   TEXT NOT NULL,
      sent_at      TEXT NOT NULL,
      author       TEXT NOT NULL,
      author_id    TEXT,
      content      TEXT NOT NULL,
      attachments  TEXT NOT NULL DEFAULT '[]',
      raw          TEXT,
      selected     INTEGER NOT NULL DEFAULT 1,
      deleted_at   TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uk_welink_msg ON welink_messages(ticket_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_welink_msg_ticket ON welink_messages(ticket_id, sent_at);
  `);
}

export function makeWelinkRouter(db: DB): Router {
  ensureWelinkMessagesTable(db);
  const r = Router();

  // 批量 upsert
  r.post("/tickets/:id/welink-messages", asyncHandler(async (req, res) => {
    const ticketId = req.params.id;
    const body = req.body as { messages?: any[] };
    if (!body || !Array.isArray(body.messages)) {
      return res.status(400).json({ error: "messages 必须为数组" });
    }
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    const findStmt = db.prepare("SELECT id FROM welink_messages WHERE ticket_id = ? AND message_id = ?");
    const insertStmt = db.prepare(
      `INSERT INTO welink_messages (id, ticket_id, message_id, sent_at, author, author_id, content, attachments, raw, selected, deleted_at, created_at)
       VALUES (@id, @ticket_id, @message_id, @sent_at, @author, @author_id, @content, @attachments, @raw, @selected, NULL, @created_at)`,
    );
    const updateStmt = db.prepare(
      `UPDATE welink_messages
       SET sent_at = @sent_at, author = @author, author_id = @author_id, content = @content, attachments = @attachments, raw = @raw, deleted_at = NULL
       WHERE id = @id`,
    );

    const tx = db.transaction((messages: any[]) => {
      for (const m of messages) {
        const messageId = String(m.messageId ?? "").trim();
        const sentAt = String(m.sentAt ?? "").trim();
        const author = String(m.author ?? "").trim();
        const content = m.content === undefined || m.content === null ? "" : String(m.content);
        if (!messageId || !sentAt || !author) continue;
        const existing = findStmt.get(ticketId, messageId) as { id: string } | undefined;
        const payload = {
          ticket_id: ticketId,
          message_id: messageId,
          sent_at: sentAt,
          author,
          author_id: m.authorId ? String(m.authorId) : null,
          content,
          attachments: JSON.stringify(Array.isArray(m.attachments) ? m.attachments : []),
          raw: m.raw ? (typeof m.raw === "string" ? m.raw : JSON.stringify(m.raw)) : null,
          selected: 1,
          created_at: now,
        };
        if (existing) {
          updateStmt.run({ ...payload, id: existing.id });
          updated++;
        } else {
          insertStmt.run({ ...payload, id: randomUUID() });
          inserted++;
        }
      }
    });
    tx(body.messages);

    log.info("welink.upload", { ticketId, inserted, updated, total: body.messages.length });
    res.json({ inserted, updated, total: body.messages.length });
  }));

  // 查询
  r.get("/tickets/:id/welink-messages", asyncHandler(async (req, res) => {
    const ticketId = req.params.id;
    const { author, since, until, keyword, includeDeleted, offset, limit } = req.query as Record<string, string | undefined>;
    let sql = "SELECT * FROM welink_messages WHERE ticket_id = ?";
    const params: any[] = [ticketId];
    if (!includeDeleted || includeDeleted === "false") {
      sql += " AND deleted_at IS NULL";
    }
    if (author) { sql += " AND author = ?"; params.push(author); }
    if (since) { sql += " AND sent_at >= ?"; params.push(since); }
    if (until) { sql += " AND sent_at <= ?"; params.push(until); }
    if (keyword) { sql += " AND content LIKE ?"; params.push(`%${keyword}%`); }
    sql += " ORDER BY sent_at ASC, created_at ASC";
    const off = Math.max(0, parseInt(offset || "0", 10) || 0);
    const lim = Math.min(2000, Math.max(1, parseInt(limit || "200", 10) || 200));
    sql += " LIMIT ? OFFSET ?";
    params.push(lim, off);

    const rows = db.prepare(sql).all(...params) as any[];

    // 统计:总数 / 已选数 / 已删除数
    const totalRow = db.prepare("SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NULL").get(ticketId) as { c: number };
    const selectedRow = db.prepare("SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NULL AND selected = 1").get(ticketId) as { c: number };
    const deletedRow = db.prepare("SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NOT NULL").get(ticketId) as { c: number };

    res.json({
      messages: rows.map(rowToMessage),
      stats: {
        total: totalRow.c,
        selected: selectedRow.c,
        deleted: deletedRow.c,
      },
    });
  }));

  // 物理清空
  r.delete("/tickets/:id/welink-messages", asyncHandler(async (req, res) => {
    const ticketId = req.params.id;
    const info = db.prepare("DELETE FROM welink_messages WHERE ticket_id = ?").run(ticketId);
    log.info("welink.clear", { ticketId, deleted: info.changes });
    res.json({ deleted: info.changes });
  }));

  // 单条软删
  r.delete("/tickets/:id/welink-messages/:messageId", asyncHandler(async (req, res) => {
    const { id, messageId } = req.params;
    const now = new Date().toISOString();
    const info = db.prepare(
      "UPDATE welink_messages SET deleted_at = ? WHERE ticket_id = ? AND (id = ? OR message_id = ?) AND deleted_at IS NULL",
    ).run(now, id, messageId, messageId);
    if (info.changes === 0) {
      return res.status(404).json({ error: "消息不存在或已删除" });
    }
    log.info("welink.soft_delete", { ticketId: id, messageId });
    res.json({ deleted: info.changes });
  }));

  // 批量软删
  r.post("/tickets/:id/welink-messages/batch-delete", asyncHandler(async (req, res) => {
    const ticketId = req.params.id;
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids 必须为非空数组" });
    }
    const now = new Date().toISOString();
    const stmt = db.prepare("UPDATE welink_messages SET deleted_at = ? WHERE ticket_id = ? AND id = ? AND deleted_at IS NULL");
    let n = 0;
    const tx = db.transaction((arr: string[]) => {
      for (const i of arr) {
        const r2 = stmt.run(now, ticketId, i);
        n += r2.changes;
      }
    });
    tx(ids);
    log.info("welink.batch_soft_delete", { ticketId, count: n });
    res.json({ deleted: n });
  }));

  // 批量改选中
  r.patch("/tickets/:id/welink-messages/selection", asyncHandler(async (req, res) => {
    const ticketId = req.params.id;
    const { ids, selected } = req.body as { ids?: string[]; selected?: boolean };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids 必须为非空数组" });
    }
    if (typeof selected !== "boolean") {
      return res.status(400).json({ error: "selected 必须为布尔值" });
    }
    const stmt = db.prepare("UPDATE welink_messages SET selected = ? WHERE ticket_id = ? AND id = ?");
    let n = 0;
    const tx = db.transaction((arr: string[]) => {
      for (const i of arr) {
        const r2 = stmt.run(selected ? 1 : 0, ticketId, i);
        n += r2.changes;
      }
    });
    tx(ids);
    log.info("welink.selection_update", { ticketId, count: n, selected });
    res.json({ updated: n, selected });
  }));

  // AI 分析占位
  r.post("/tickets/:id/welink-messages/analyze", asyncHandler(async (req, res) => {
    const ticketId = req.params.id;
    const row = db.prepare(
      "SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NULL AND selected = 1",
    ).get(ticketId) as { c: number };
    log.info("welink.analyze_stub", { ticketId, queued: row.c });
    res.json({
      ok: true,
      queued: row.c,
      message: "AI 抽取功能下一阶段开放",
    });
  }));

  return r;
}
