import type { DB } from "./db.js";
import { log } from "./logger.js";

export interface HermesSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface HermesMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  citations?: string;
  createdAt: string;
}

const MAX_HISTORY_TURNS = 10;
const SESSION_EXPIRY_DAYS = 7;

let _ensureDone = false;
function ensureTable(db: DB) {
  if (_ensureDone) return;
  _ensureDone = true;
  db.exec(`
    CREATE TABLE IF NOT EXISTS hermes_sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hermes_messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES hermes_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL DEFAULT '',
      citations TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hermes_msgs_session ON hermes_messages(sessionId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_hermes_sessions_user ON hermes_sessions(userId, updatedAt DESC);
  `);
}

export function resetSessionCache() {
  _ensureDone = false;
}

export function createSession(db: DB, userId: string, title?: string): HermesSession {
  ensureTable(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row: HermesSession = {
    id,
    userId,
    title: title || "新对话",
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(`INSERT INTO hermes_sessions (id, userId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    userId,
    row.title,
    now,
    now
  );
  return row;
}

export function getSession(db: DB, sessionId: string): HermesSession | undefined {
  ensureTable(db);
  const row = db.prepare(`SELECT * FROM hermes_sessions WHERE id = ?`).get(sessionId) as HermesSession | undefined;
  return row;
}

export function listSessions(db: DB, userId: string, limit = 20): HermesSession[] {
  ensureTable(db);
  const rows = db
    .prepare(`SELECT * FROM hermes_sessions WHERE userId = ? ORDER BY updatedAt DESC LIMIT ?`)
    .all(userId, limit) as HermesSession[];
  return rows;
}

export function deleteSession(db: DB, sessionId: string): boolean {
  ensureTable(db);
  db.prepare(`DELETE FROM hermes_messages WHERE sessionId = ?`).run(sessionId);
  const r = db.prepare(`DELETE FROM hermes_sessions WHERE id = ?`).run(sessionId);
  return r.changes > 0;
}

export function appendMessage(
  db: DB,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  citations?: string
): HermesMessage {
  ensureTable(db);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO hermes_messages (id, sessionId, role, content, citations, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, role, content, citations ?? null, now);
  db.prepare(`UPDATE hermes_sessions SET updatedAt = ? WHERE id = ?`).run(now, sessionId);
  return { id, sessionId, role, content, citations, createdAt: now };
}

export function loadRecentMessages(db: DB, sessionId: string, limit = MAX_HISTORY_TURNS * 2): HermesMessage[] {
  ensureTable(db);
  const rows = db
    .prepare(`SELECT * FROM hermes_messages WHERE sessionId = ? ORDER BY createdAt DESC LIMIT ?`)
    .all(sessionId, limit) as HermesMessage[];
  return rows.reverse();
}

export function pruneExpiredSessions(db: DB): number {
  ensureTable(db);
  const cutoff = new Date(Date.now() - SESSION_EXPIRY_DAYS * 86400000).toISOString();
  const expired = db.prepare(`SELECT id FROM hermes_sessions WHERE updatedAt < ?`).all(cutoff) as { id: string }[];
  let count = 0;
  for (const { id } of expired) {
    db.prepare(`DELETE FROM hermes_messages WHERE sessionId = ?`).run(id);
    db.prepare(`DELETE FROM hermes_sessions WHERE id = ?`).run(id);
    count++;
  }
  if (count > 0) log.info("hermes.session.prune", { pruned: count });
  return count;
}

export function updateSessionTitle(db: DB, sessionId: string, title: string): boolean {
  ensureTable(db);
  const r = db.prepare(`UPDATE hermes_sessions SET title = ? WHERE id = ?`).run(title, sessionId);
  return r.changes > 0;
}
