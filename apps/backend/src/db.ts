import Database from "better-sqlite3";

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, nodeType TEXT NOT NULL, properties TEXT NOT NULL,
      search_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY, edgeType TEXT NOT NULL, sourceId TEXT NOT NULL,
      targetId TEXT NOT NULL, properties TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS progress_log (
      id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, seqNo INTEGER NOT NULL,
      content TEXT NOT NULL, statusSnapshot TEXT, updatedBy TEXT, updatedAt TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, entityType TEXT, entityId TEXT,
      changes TEXT, performedBy TEXT, performedAt TEXT);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(sourceId);
    CREATE INDEX IF NOT EXISTS idx_progress_owner ON progress_log(ownerId, seqNo);
  `);
  return db;
}
