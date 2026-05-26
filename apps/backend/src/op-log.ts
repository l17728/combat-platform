import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";

export function makeOpLogRouter(db: DB): Router {
  const router = Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS op_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_op_logs_session ON op_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_op_logs_user ON op_logs(user_name);
    CREATE INDEX IF NOT EXISTS idx_op_logs_timestamp ON op_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_op_logs_category ON op_logs(category);
  `);

  const getSetting = (key: string): string | null => {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as any;
    return row?.value ?? null;
  };

  const setSetting = (key: string, value: string) => {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
  };

  const isEnabled = (): boolean => {
    const v = getSetting("op_log_enabled");
    return v === null || v === "true";
  };

  router.get("/op-logs/settings", (_req, res) => {
    res.json({ enabled: isEnabled() });
  });

  router.put("/op-logs/settings", (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled 必须为布尔值" });
      return;
    }
    setSetting("op_log_enabled", String(enabled));
    res.json({ enabled });
  });

  const insertStmt = db.prepare(
    `INSERT INTO op_logs (id, session_id, user_name, category, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?)`
  );

  router.post("/op-logs", (req, res) => {
    if (!isEnabled()) {
      res.json({ inserted: 0, ids: [], disabled: true });
      return;
    }
    const entries = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "需要非空数组" });
      return;
    }
    const now = new Date().toISOString();
    const inserted: string[] = [];
    const insertMany = db.transaction((items: any[]) => {
      for (const item of items) {
        const id = randomUUID();
        insertStmt.run(
          id,
          item.session_id || "unknown",
          item.user_name || "",
          item.category || "action",
          typeof item.detail === "string" ? item.detail : JSON.stringify(item.detail || {}),
          item.timestamp || now,
        );
        inserted.push(id);
      }
    });
    insertMany(entries.slice(0, 200));
    res.json({ inserted: inserted.length, ids: inserted });
  });

  router.get("/op-logs", (req, res) => {
    const { sessionId, userName, category, from, to, limit, offset } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    if (sessionId) { conditions.push("session_id = ?"); params.push(sessionId); }
    if (userName) { conditions.push("user_name = ?"); params.push(userName); }
    if (category) { conditions.push("category = ?"); params.push(category); }
    if (from) { conditions.push("timestamp >= ?"); params.push(from); }
    if (to) { conditions.push("timestamp <= ?"); params.push(to); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const lim = Math.min(Number(limit) || 200, 1000);
    const off = Number(offset) || 0;
    const rows = db.prepare(
      `SELECT * FROM op_logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, lim, off);
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM op_logs ${where}`).get(...params) as any;
    res.json({ total: countRow.total, rows });
  });

  router.delete("/op-logs", (req, res) => {
    const { before, sessionId } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    if (before) { conditions.push("timestamp < ?"); params.push(before); }
    if (sessionId) { conditions.push("session_id = ?"); params.push(sessionId); }
    if (conditions.length === 0) {
      res.status(400).json({ error: "必须指定 before 或 sessionId" });
      return;
    }
    const where = "WHERE " + conditions.join(" AND ");
    const result = db.prepare(`DELETE FROM op_logs ${where}`).run(...params);
    res.json({ deleted: result.changes });
  });

  return router;
}
