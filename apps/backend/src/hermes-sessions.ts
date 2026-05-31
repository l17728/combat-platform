import type { DbAdapter } from "./db-adapter.js";
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

const SQLITE_DDL = `
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
`;

const PG_DDL = `
  CREATE TABLE IF NOT EXISTS hermes_sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (now()::text),
    updatedAt TEXT NOT NULL DEFAULT (now()::text)
  );
  CREATE TABLE IF NOT EXISTS hermes_messages (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL REFERENCES hermes_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL DEFAULT '',
    citations TEXT,
    createdAt TEXT NOT NULL DEFAULT (now()::text)
  );
  CREATE INDEX IF NOT EXISTS idx_hermes_msgs_session ON hermes_messages(sessionId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_hermes_sessions_user ON hermes_sessions(userId, updatedAt DESC);
`;

let _ensureDone = false;
async function ensureTable(adapter: DbAdapter) {
  if (_ensureDone) return;
  _ensureDone = true;
  await adapter.exec(adapter.kind === "postgres" ? PG_DDL : SQLITE_DDL);
}

export function resetSessionCache() {
  _ensureDone = false;
}

export async function createSession(adapter: DbAdapter, userId: string, title?: string): Promise<HermesSession> {
  await ensureTable(adapter);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row: HermesSession = {
    id,
    userId,
    title: title || "新对话",
    createdAt: now,
    updatedAt: now,
  };
  await adapter.run(`INSERT INTO hermes_sessions (id, userId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`, [
    id,
    userId,
    row.title,
    now,
    now,
  ]);
  return row;
}

export async function getSession(adapter: DbAdapter, sessionId: string): Promise<HermesSession | undefined> {
  await ensureTable(adapter);
  return adapter.queryOne<HermesSession>(`SELECT * FROM hermes_sessions WHERE id = ?`, [sessionId]);
}

export async function listSessions(adapter: DbAdapter, userId: string, limit = 20): Promise<HermesSession[]> {
  await ensureTable(adapter);
  return adapter.query<HermesSession>(
    `SELECT * FROM hermes_sessions WHERE userId = ? ORDER BY updatedAt DESC LIMIT ?`,
    [userId, limit]
  );
}

export async function deleteSession(adapter: DbAdapter, sessionId: string): Promise<boolean> {
  await ensureTable(adapter);
  await adapter.run(`DELETE FROM hermes_messages WHERE sessionId = ?`, [sessionId]);
  const r = await adapter.run(`DELETE FROM hermes_sessions WHERE id = ?`, [sessionId]);
  return r.changes > 0;
}

export async function appendMessage(
  adapter: DbAdapter,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  citations?: string
): Promise<HermesMessage> {
  await ensureTable(adapter);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await adapter.run(
    `INSERT INTO hermes_messages (id, sessionId, role, content, citations, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, sessionId, role, content, citations ?? null, now]
  );
  await adapter.run(`UPDATE hermes_sessions SET updatedAt = ? WHERE id = ?`, [now, sessionId]);
  return { id, sessionId, role, content, citations, createdAt: now };
}

export async function loadRecentMessages(
  adapter: DbAdapter,
  sessionId: string,
  limit = MAX_HISTORY_TURNS * 2
): Promise<HermesMessage[]> {
  await ensureTable(adapter);
  const rows = await adapter.query<HermesMessage>(
    `SELECT * FROM hermes_messages WHERE sessionId = ? ORDER BY createdAt DESC LIMIT ?`,
    [sessionId, limit]
  );
  return rows.reverse();
}

export async function pruneExpiredSessions(adapter: DbAdapter): Promise<number> {
  await ensureTable(adapter);
  const cutoff = new Date(Date.now() - SESSION_EXPIRY_DAYS * 86400000).toISOString();
  const expired = await adapter.query<{ id: string }>(`SELECT id FROM hermes_sessions WHERE updatedAt < ?`, [cutoff]);
  let count = 0;
  for (const { id } of expired) {
    await adapter.run(`DELETE FROM hermes_messages WHERE sessionId = ?`, [id]);
    await adapter.run(`DELETE FROM hermes_sessions WHERE id = ?`, [id]);
    count++;
  }
  if (count > 0) log.info("hermes.session.prune", { pruned: count });
  return count;
}

export async function updateSessionTitle(adapter: DbAdapter, sessionId: string, title: string): Promise<boolean> {
  await ensureTable(adapter);
  const r = await adapter.run(`UPDATE hermes_sessions SET title = ? WHERE id = ?`, [title, sessionId]);
  return r.changes > 0;
}
