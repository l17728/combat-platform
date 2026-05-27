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
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL, target_node_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, confidence REAL, proposer_source TEXT,
      rationale TEXT, status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT NOT NULL,
      recipient_person_id TEXT, recipient_name TEXT,
      subject TEXT, body TEXT,
      status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(sourceId);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(targetId);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edgeType);
    CREATE INDEX IF NOT EXISTS idx_progress_owner ON progress_log(ownerId, seqNo);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    CREATE TABLE IF NOT EXISTS daily_report_entry (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '进展通报',
      current_progress TEXT NOT NULL DEFAULT '',
      next_steps TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '草稿',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dre_ticket ON daily_report_entry(ticket_id);
    CREATE TABLE IF NOT EXISTS support_template (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_node (
      id TEXT PRIMARY KEY,
      ticket_id TEXT,
      template_id TEXT,
      parent_id TEXT,
      category TEXT NOT NULL,
      domain TEXT NOT NULL,
      person_id TEXT,
      person_name TEXT,
      status TEXT NOT NULL DEFAULT '待确认',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_support_node_ticket ON support_node(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_support_node_template ON support_node(template_id);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'normal',
      display_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE TABLE IF NOT EXISTS ticket_tabs (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      tab_type TEXT NOT NULL CHECK(tab_type IN ('link', 'custom')),
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
  return db;
}
