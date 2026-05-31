import { Router } from "express";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";
import type { DB } from "./db.js";
import type { Repository } from "@combat/shared";
import type { AgentRunner } from "./hermes-agent.js";
import {
  runWelinkExtraction,
  listExtractions,
  getExtraction,
  updateExtraction,
  deleteExtraction,
} from "./welink-extraction.js";
import { parseMembers, syncMemberFields, type TeamMember, type TeamRole } from "./welink-members.js";

export interface WelinkImage {
  filename?: string;
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  md5?: string;
}

export interface WelinkMessage {
  id: string;
  ticketId: string;
  messageId: string;
  sentAt: string;
  author: string;
  authorId: string | null;
  content: string;
  contentType: string;
  contentJson: unknown | null;
  images: WelinkImage[];
  attachments: unknown[];
  raw: string | null;
  selected: boolean;
  deletedAt: string | null;
  createdAt: string;
}

function safeParse(s: any): any {
  if (!s) return null;
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function rowToMessage(r: any): WelinkMessage {
  let attachments: unknown[] = [];
  try {
    attachments = JSON.parse(r.attachments || "[]");
  } catch {
    attachments = [];
  }
  const images = safeParse(r.images_json) ?? [];
  return {
    id: r.id,
    ticketId: r.ticket_id,
    messageId: r.message_id,
    sentAt: r.sent_at,
    author: r.author,
    authorId: r.author_id ?? null,
    content: r.content,
    contentType: r.content_type ?? "TEXT_MSG",
    contentJson: safeParse(r.content_json),
    images: Array.isArray(images) ? images : [],
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
  // 增量列(已有表兼容)
  const cols = db.prepare("PRAGMA table_info(welink_messages)").all() as Array<{ name: string }>;
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has("content_type")) {
    db.exec(`ALTER TABLE welink_messages ADD COLUMN content_type TEXT NOT NULL DEFAULT 'TEXT_MSG'`);
  }
  if (!has("content_json")) {
    db.exec(`ALTER TABLE welink_messages ADD COLUMN content_json TEXT`);
  }
  if (!has("images_json")) {
    db.exec(`ALTER TABLE welink_messages ADD COLUMN images_json TEXT`);
  }
}

// 把 epoch ms / 秒 / ISO 字符串统一转成 ISO 字符串
function normalizeSentAt(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number" && isFinite(raw)) {
    // > 1e12 视为毫秒;> 1e9 视为秒
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : raw;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? String(raw) : d.toISOString();
  }
  const s = String(raw).trim();
  if (!s) return "";
  // 全数字 → 当作 epoch ms / 秒
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? s : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString();
}

// 按 content_type 解析消息内容,返回 { content, contentJson, imagesJson }
export function parseMessageContent(m: any): {
  contentType: string;
  content: string;
  contentJson: string | null;
  imagesJson: string | null;
} {
  const contentType = String(m.contentType ?? "TEXT_MSG");
  if (contentType === "CARD_MSG") {
    const card = m.content && typeof m.content === "object" ? m.content : null;
    const replyContent = card?.cardContext?.replyMsg?.content;
    const preContent = card?.cardContext?.preMsg?.content;
    const content = String(replyContent ?? preContent ?? "");
    return {
      contentType,
      content,
      contentJson: card ? JSON.stringify(card) : null,
      imagesJson: null,
    };
  }
  if (contentType === "PICTURE_MSG") {
    const content = m.content == null ? "[图片]" : String(m.content);
    const images = Array.isArray(m.images) ? m.images : [];
    return {
      contentType,
      content: content || "[图片]",
      contentJson: null,
      imagesJson: JSON.stringify(images),
    };
  }
  // TEXT_MSG 和未知类型:content 是字符串则直接用,否则 stringify
  if (m.content && typeof m.content === "object") {
    return {
      contentType,
      content: "",
      contentJson: JSON.stringify(m.content),
      imagesJson: null,
    };
  }
  return {
    contentType,
    content: m.content == null ? "" : String(m.content),
    contentJson: null,
    imagesJson: null,
  };
}

export function makeWelinkRouter(db: DB, repo?: Repository, runner?: AgentRunner): Router {
  ensureWelinkMessagesTable(db);
  const r = Router();

  // 批量 upsert
  r.post(
    "/tickets/:id/welink-messages",
    asyncHandler(async (req, res) => {
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
        `INSERT INTO welink_messages (id, ticket_id, message_id, sent_at, author, author_id, content, content_type, content_json, images_json, attachments, raw, selected, deleted_at, created_at)
       VALUES (@id, @ticket_id, @message_id, @sent_at, @author, @author_id, @content, @content_type, @content_json, @images_json, @attachments, @raw, @selected, NULL, @created_at)`
      );
      const updateStmt = db.prepare(
        `UPDATE welink_messages
       SET sent_at = @sent_at, author = @author, author_id = @author_id, content = @content,
           content_type = @content_type, content_json = @content_json, images_json = @images_json,
           attachments = @attachments, raw = @raw, deleted_at = NULL
       WHERE id = @id`
      );

      const tx = db.transaction((messages: any[]) => {
        for (const m of messages) {
          // 宽容兼容:messageId / id / msgId
          const messageId = String(m.messageId ?? m.id ?? m.msgId ?? "").trim();
          // sentAt / time / timestamp / serverSendTime — epoch ms 自动转 ISO
          const sentAtRaw = m.sentAt ?? m.time ?? m.timestamp ?? m.serverSendTime ?? m.sendTime;
          const sentAt = normalizeSentAt(sentAtRaw);
          // author / sender / from / userName
          const author = String(m.author ?? m.sender ?? m.from ?? m.userName ?? "").trim();
          if (!messageId || !sentAt || !author) continue;

          const parsed = parseMessageContent(m);

          const existing = findStmt.get(ticketId, messageId) as { id: string } | undefined;
          const payload = {
            ticket_id: ticketId,
            message_id: messageId,
            sent_at: sentAt,
            author,
            author_id: (m.authorId ?? m.senderId ?? m.fromId) ? String(m.authorId ?? m.senderId ?? m.fromId) : null,
            content: parsed.content,
            content_type: parsed.contentType,
            content_json: parsed.contentJson,
            images_json: parsed.imagesJson,
            attachments: JSON.stringify(Array.isArray(m.attachments) ? m.attachments : []),
            raw: m.raw ? (typeof m.raw === "string" ? m.raw : JSON.stringify(m.raw)) : JSON.stringify(m),
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
    })
  );

  // 查询
  r.get(
    "/tickets/:id/welink-messages",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const { author, since, until, keyword, includeDeleted, offset, limit } = req.query as Record<
        string,
        string | undefined
      >;
      let sql = "SELECT * FROM welink_messages WHERE ticket_id = ?";
      const params: any[] = [ticketId];
      if (!includeDeleted || includeDeleted === "false") {
        sql += " AND deleted_at IS NULL";
      }
      if (author) {
        sql += " AND author = ?";
        params.push(author);
      }
      if (since) {
        sql += " AND sent_at >= ?";
        params.push(since);
      }
      if (until) {
        sql += " AND sent_at <= ?";
        params.push(until);
      }
      if (keyword) {
        sql += " AND content LIKE ?";
        params.push(`%${keyword}%`);
      }
      sql += " ORDER BY sent_at ASC, created_at ASC";
      const off = Math.max(0, parseInt(offset || "0", 10) || 0);
      const lim = Math.min(2000, Math.max(1, parseInt(limit || "200", 10) || 200));
      sql += " LIMIT ? OFFSET ?";
      params.push(lim, off);

      const rows = db.prepare(sql).all(...params) as any[];

      // 统计:总数 / 已选数 / 已删除数
      const totalRow = db
        .prepare("SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NULL")
        .get(ticketId) as { c: number };
      const selectedRow = db
        .prepare(
          "SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NULL AND selected = 1"
        )
        .get(ticketId) as { c: number };
      const deletedRow = db
        .prepare("SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NOT NULL")
        .get(ticketId) as { c: number };

      res.json({
        messages: rows.map(rowToMessage),
        stats: {
          total: totalRow.c,
          selected: selectedRow.c,
          deleted: deletedRow.c,
        },
      });
    })
  );

  // 物理清空
  r.delete(
    "/tickets/:id/welink-messages",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const info = db.prepare("DELETE FROM welink_messages WHERE ticket_id = ?").run(ticketId);
      log.info("welink.clear", { ticketId, deleted: info.changes });
      res.json({ deleted: info.changes });
    })
  );

  // 单条软删
  r.delete(
    "/tickets/:id/welink-messages/:messageId",
    asyncHandler(async (req, res) => {
      const { id, messageId } = req.params;
      const now = new Date().toISOString();
      const info = db
        .prepare(
          "UPDATE welink_messages SET deleted_at = ? WHERE ticket_id = ? AND (id = ? OR message_id = ?) AND deleted_at IS NULL"
        )
        .run(now, id, messageId, messageId);
      if (info.changes === 0) {
        return res.status(404).json({ error: "消息不存在或已删除" });
      }
      log.info("welink.soft_delete", { ticketId: id, messageId });
      res.json({ deleted: info.changes });
    })
  );

  // 批量软删
  r.post(
    "/tickets/:id/welink-messages/batch-delete",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const { ids } = req.body as { ids?: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids 必须为非空数组" });
      }
      const now = new Date().toISOString();
      const stmt = db.prepare(
        "UPDATE welink_messages SET deleted_at = ? WHERE ticket_id = ? AND id = ? AND deleted_at IS NULL"
      );
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
    })
  );

  // 批量改选中
  r.patch(
    "/tickets/:id/welink-messages/selection",
    asyncHandler(async (req, res) => {
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
    })
  );

  // AI 抽取:同步阻塞,落 welink_extractions
  r.post(
    "/tickets/:id/welink-messages/analyze",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      if (!repo) {
        const row = db
          .prepare(
            "SELECT COUNT(*) AS c FROM welink_messages WHERE ticket_id = ? AND deleted_at IS NULL AND selected = 1"
          )
          .get(ticketId) as { c: number };
        log.warn("welink.analyze_norepo", { ticketId, queued: row.c });
        return res.json({
          ok: true,
          queued: row.c,
          extracted: 0,
          source: "noop",
          extractions: [],
          message: "未注入 repo,跳过抽取",
        });
      }
      const result = await runWelinkExtraction(db, repo, ticketId, runner);
      res.json({ ok: true, ...result });
    })
  );

  // 抽取结果 CRUD
  r.get(
    "/tickets/:id/welink-extractions",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const { kind, reviewed } = req.query as Record<string, string | undefined>;
      const rev = reviewed == null ? null : reviewed === "true" ? true : reviewed === "false" ? false : null;
      const items = listExtractions(db, ticketId, { kind: kind || undefined, reviewed: rev });
      res.json({ items });
    })
  );

  r.patch(
    "/tickets/:id/welink-extractions/:extId",
    asyncHandler(async (req, res) => {
      const { extId } = req.params;
      const body = req.body as { reviewed?: boolean; label?: string; payload?: any };
      const updated = updateExtraction(db, extId, body || {});
      if (!updated) return res.status(404).json({ error: "extraction 不存在" });
      res.json(updated);
    })
  );

  r.delete(
    "/tickets/:id/welink-extractions/:extId",
    asyncHandler(async (req, res) => {
      const { extId } = req.params;
      const ok = deleteExtraction(db, extId);
      if (!ok) return res.status(404).json({ error: "extraction 不存在" });
      res.json({ ok: true });
    })
  );

  // 单条详情(便于前端跳转 / agent 工具回查)
  r.get(
    "/tickets/:id/welink-extractions/:extId",
    asyncHandler(async (req, res) => {
      const item = getExtraction(db, req.params.extId);
      if (!item) return res.status(404).json({ error: "extraction 不存在" });
      res.json(item);
    })
  );

  // === Agent / 对话补齐用的 welink 端点 ===

  // 关键词全文搜该 ticket 的 welink 消息(给 hermes_welink_search 用)
  r.get(
    "/tickets/:id/welink/search",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const q = String(req.query.q ?? "").trim();
      if (!q) return res.json({ matches: [] });
      const rows = db
        .prepare(
          `SELECT id, message_id, sent_at, author, content
         FROM welink_messages
        WHERE ticket_id = ? AND deleted_at IS NULL AND content LIKE ?
        ORDER BY sent_at ASC LIMIT 50`
        )
        .all(ticketId, `%${q}%`) as any[];
      res.json({
        matches: rows.map((r) => ({
          id: r.id,
          messageId: r.message_id,
          sentAt: r.sent_at,
          author: r.author,
          content: r.content,
        })),
      });
    })
  );

  // 精简时间线(给 hermes_welink_timeline 用)
  r.get(
    "/tickets/:id/welink/timeline",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "200"), 10) || 200));
      const rows = db
        .prepare(
          `SELECT id, message_id, sent_at, author, content
         FROM welink_messages
        WHERE ticket_id = ? AND deleted_at IS NULL
        ORDER BY sent_at ASC LIMIT ?`
        )
        .all(ticketId, limit) as any[];
      res.json({
        timeline: rows.map((r) => ({
          id: r.id,
          messageId: r.message_id,
          sentAt: r.sent_at,
          author: r.author,
          content: r.content,
        })),
      });
    })
  );

  // gap-analysis(活跃发言 vs 攻关单成员)— 给 hermes_welink_gap 用,也给前端"AI 抽取"展示用
  r.get(
    "/tickets/:id/welink/gap-analysis",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      if (!repo) return res.status(500).json({ error: "repo 未注入" });
      const node = await repo.getNode(ticketId);
      if (!node) return res.status(404).json({ error: "攻关单不存在" });

      const rows = db
        .prepare(
          `SELECT author, COUNT(*) AS c
         FROM welink_messages
        WHERE ticket_id = ? AND deleted_at IS NULL
        GROUP BY author
        ORDER BY c DESC`
        )
        .all(ticketId) as Array<{ author: string; c: number }>;

      // 反查工号 → 姓名(person 节点)
      const nameByEmpNo = new Map<string, string>();
      for (const p of await repo.queryNodes("person")) {
        const pp = p.properties as Record<string, unknown>;
        const name = String(pp["姓名"] ?? pp["name"] ?? "").trim();
        const empNo = String(pp["工号"] ?? pp["employeeId"] ?? pp["empNo"] ?? "").trim();
        if (name && empNo) nameByEmpNo.set(empNo, name);
        if (name) nameByEmpNo.set(name, name);
      }

      const members = parseMembers(node.properties as Record<string, unknown>);
      const memberSet = new Set(members.map((m) => m.姓名));

      const activeSenders = rows.map((r) => {
        const resolvedName = nameByEmpNo.get(r.author) || null;
        return {
          senderId: r.author,
          resolvedName,
          appearedCount: r.c,
          inTicket: resolvedName ? memberSet.has(resolvedName) : memberSet.has(r.author),
        };
      });

      const gap = activeSenders
        .filter((s) => !s.inTicket)
        .map((s) => ({
          name: s.resolvedName || s.senderId,
          senderId: s.senderId,
          appearedCount: s.appearedCount,
          suggestion: "建议加入攻关成员",
        }));

      res.json({
        ticketId,
        welinkActiveSenders: rows.map((r) => r.author),
        welinkActiveNames: activeSenders.map((s) => s.resolvedName || s.senderId),
        ticketMembers: members,
        gap,
      });
    })
  );

  // 批量加成员(给 hermes_welink_add_members 用,也给前端"加入攻关成员"按钮用)
  r.post(
    "/tickets/:id/welink/add-members",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      if (!repo) return res.status(500).json({ error: "repo 未注入" });
      const node = await repo.getNode(ticketId);
      if (!node) return res.status(404).json({ error: "攻关单不存在" });
      const body = req.body as { names?: string[]; role?: TeamRole };
      const names = Array.isArray(body?.names) ? body.names.map((s) => String(s).trim()).filter(Boolean) : [];
      if (names.length === 0) return res.status(400).json({ error: "names 必须为非空数组" });
      const role: TeamRole = body?.role === "组长" ? "组长" : "组员";

      const current = parseMembers(node.properties as Record<string, unknown>);
      const seen = new Set(current.map((m) => m.姓名));
      let added = 0;
      const next: TeamMember[] = [...current];
      for (const n of names) {
        if (seen.has(n)) continue;
        next.push({ 姓名: n, 角色: role });
        seen.add(n);
        added++;
      }
      if (added > 0) {
        await repo.updateNode(ticketId, syncMemberFields(next), "welink");
        log.info("welink.members.add", { ticketId, added, role });
      }
      res.json({ ok: true, added, members: next });
    })
  );

  // 单人改角色(给 hermes_welink_set_role 用)
  r.post(
    "/tickets/:id/welink/set-member-role",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      if (!repo) return res.status(500).json({ error: "repo 未注入" });
      const node = await repo.getNode(ticketId);
      if (!node) return res.status(404).json({ error: "攻关单不存在" });
      const { name, role } = req.body as { name?: string; role?: TeamRole };
      if (!name || (role !== "组长" && role !== "组员")) {
        return res.status(400).json({ error: "name + role(组长|组员) 必填" });
      }
      const current = parseMembers(node.properties as Record<string, unknown>);
      const idx = current.findIndex((m) => m.姓名 === name);
      if (idx < 0) return res.status(404).json({ error: `「${name}」不在成员列表中` });
      const next = current.map((m, i) => (i === idx ? { ...m, 角色: role } : m));
      await repo.updateNode(ticketId, syncMemberFields(next), "welink");
      log.info("welink.members.set_role", { ticketId, name, role });
      res.json({ ok: true, members: next });
    })
  );

  return r;
}
