import { Router } from "express";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";
import type { DbAdapter } from "./db-adapter.js";

export interface TicketTab {
  id: string;
  ticketId: string;
  tabType: "link" | "custom" | "wiki";
  title: string;
  tabOrder: number;
  config: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function ensureTicketTabsTable(adapter: DbAdapter): void {
  if (adapter.kind !== "sqlite") return;
  const db = adapter.rawSqlite();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_tabs (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      tab_type TEXT NOT NULL CHECK(tab_type IN ('link', 'custom', 'wiki')),
      title TEXT NOT NULL,
      tab_order INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      content TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_tabs_ticket ON ticket_tabs(ticket_id);
  `);
  // Migrate: if table was created with old CHECK(link,custom), widen to include 'wiki'.
  const ck = db.pragma("table_info(ticket_tabs)", { simple: false }) as { name: string }[];
  if (ck.length === 0) return;
  const schemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ticket_tabs'").get() as
    | { sql: string }
    | undefined;
  if (schemaRow?.sql && !schemaRow.sql.includes("'wiki'")) {
    db.exec(`
      CREATE TABLE ticket_tabs_new (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        tab_type TEXT NOT NULL CHECK(tab_type IN ('link', 'custom', 'wiki')),
        title TEXT NOT NULL,
        tab_order INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO ticket_tabs_new SELECT * FROM ticket_tabs;
      DROP TABLE ticket_tabs;
      ALTER TABLE ticket_tabs_new RENAME TO ticket_tabs;
      CREATE INDEX IF NOT EXISTS idx_ticket_tabs_ticket ON ticket_tabs(ticket_id);
    `);
    log.info("ticket_tabs.migrate", { action: "add_wiki_check_constraint" });
  }
}

function rowToTab(r: any): TicketTab {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    tabType: r.tab_type,
    title: r.title,
    tabOrder: r.tab_order,
    config: r.config,
    content: r.content,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function makeTicketTabsRouter(adapter: DbAdapter): Router {
  ensureTicketTabsTable(adapter);
  const r = Router();

  r.get(
    "/tickets/:id/tabs",
    asyncHandler(async (req, res) => {
      const rows = await adapter.query<any>(
        "SELECT * FROM ticket_tabs WHERE ticket_id = ? ORDER BY tab_order, created_at",
        [req.params.id]
      );
      res.json(rows.map(rowToTab));
    })
  );

  r.post(
    "/tickets/:id/tabs",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const { tabType, title, config, content } = req.body as {
        tabType?: string;
        title?: string;
        config?: any;
        content?: string;
      };
      if (!tabType || !["link", "custom", "wiki"].includes(tabType)) {
        return res.status(400).json({ error: "tabType 必须为 link、custom 或 wiki" });
      }
      if (!title?.trim()) {
        return res.status(400).json({ error: "title 不能为空" });
      }
      const maxOrder = await adapter.queryOne<{ m: number }>(
        "SELECT COALESCE(MAX(tab_order), -1) as m FROM ticket_tabs WHERE ticket_id = ?",
        [ticketId]
      );
      const now = new Date().toISOString();
      const id = randomUUID();
      const actor = (req as any).user?.username || "api";
      await adapter.run(
        "INSERT INTO ticket_tabs (id, ticket_id, tab_type, title, tab_order, config, content, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          ticketId,
          tabType,
          title.trim(),
          (maxOrder?.m ?? -1) + 1,
          JSON.stringify(config ?? {}),
          content ?? "",
          actor,
          now,
          now,
        ]
      );
      const row = await adapter.queryOne<any>("SELECT * FROM ticket_tabs WHERE id = ?", [id]);
      log.info("ticket_tab.created", { ticketId, tabId: id, tabType, title });
      res.status(201).json(rowToTab(row));
    })
  );

  r.patch(
    "/tickets/:id/tabs/:tabId",
    asyncHandler(async (req, res) => {
      const { id, tabId } = req.params;
      const existing = await adapter.queryOne<any>("SELECT * FROM ticket_tabs WHERE id = ? AND ticket_id = ?", [
        tabId,
        id,
      ]);
      if (!existing) return res.status(404).json({ error: "标签不存在" });
      const { title, config, content } = req.body as {
        title?: string;
        config?: any;
        content?: string;
      };
      const updates: string[] = [];
      const params: any[] = [];
      if (title !== undefined && title.trim()) {
        updates.push("title = ?");
        params.push(title.trim());
      }
      if (config !== undefined) {
        updates.push("config = ?");
        params.push(JSON.stringify(config));
      }
      if (content !== undefined) {
        updates.push("content = ?");
        params.push(content);
      }
      if (updates.length === 0) return res.status(400).json({ error: "没有要更新的字段" });
      updates.push("updated_at = ?");
      params.push(new Date().toISOString());
      params.push(tabId);
      await adapter.run(`UPDATE ticket_tabs SET ${updates.join(", ")} WHERE id = ?`, params);
      const row = await adapter.queryOne<any>("SELECT * FROM ticket_tabs WHERE id = ?", [tabId]);
      log.info("ticket_tab.updated", {
        ticketId: id,
        tabId,
        fields: updates.filter((u) => !u.startsWith("updated_at")),
      });
      res.json(rowToTab(row));
    })
  );

  r.delete(
    "/tickets/:id/tabs/:tabId",
    asyncHandler(async (req, res) => {
      const { id, tabId } = req.params;
      const existing = await adapter.queryOne<any>("SELECT * FROM ticket_tabs WHERE id = ? AND ticket_id = ?", [
        tabId,
        id,
      ]);
      if (!existing) return res.status(404).json({ error: "标签不存在" });
      await adapter.run("DELETE FROM ticket_tabs WHERE id = ?", [tabId]);
      log.info("ticket_tab.deleted", { ticketId: id, tabId, title: existing.title });
      res.json({ deleted: tabId });
    })
  );

  r.put(
    "/tickets/:id/tabs/order",
    asyncHandler(async (req, res) => {
      const ticketId = req.params.id;
      const { order } = req.body as { order?: string[] };
      if (!Array.isArray(order)) return res.status(400).json({ error: "order 必须为数组" });
      for (let i = 0; i < order.length; i++) {
        await adapter.run("UPDATE ticket_tabs SET tab_order = ? WHERE id = ? AND ticket_id = ?", [
          i,
          order[i],
          ticketId,
        ]);
      }
      log.info("ticket_tab.reordered", { ticketId, count: order.length });
      res.json({ ok: true });
    })
  );

  return r;
}
