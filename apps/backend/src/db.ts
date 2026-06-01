import Database from "better-sqlite3";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { postgresSchema } from "./schema.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Phase 1 driver factory
// ---------------------------------------------------------------------------
//
// Goals:
//  1. Keep SQLite the default + 100% test-green. Existing call sites use the
//     synchronous `better-sqlite3` API directly (db.prepare, db.exec, ...);
//     Phase 1 does NOT touch them.
//  2. Recognise a new `DB_URL` env var with protocol-based dispatch:
//        sqlite://./data/combat.db          -> better-sqlite3 (default)
//        postgres://user:pwd@host:5432/db   -> pg.Pool + drizzle (Phase 1 stub)
//        postgresql://...                   -> same as postgres://
//  3. The Postgres path opens a pool and ensures the schema (CREATE TABLE IF
//     NOT EXISTS) so an operator can verify connectivity. It does NOT plug
//     into Repository — that is Phase 2 (async refactor).
//
// Anything that imports `DB` today keeps the better-sqlite3 type signature.
// The new `DbHandle` type carries either a SQLite DB or a Postgres handle
// alongside its kind, so future call sites can branch on `handle.kind`.

export type DB = Database.Database;

export type DbKind = "sqlite" | "postgres";

export interface SqliteHandle {
  kind: "sqlite";
  db: DB;
  dbPath: string;
}

export interface PostgresHandle {
  kind: "postgres";
  pool: PgPool;
  drizzle: NodePgDatabase<typeof postgresSchema>;
  connectionString: string;
}

export type DbHandle = SqliteHandle | PostgresHandle;

export interface ParsedDbUrl {
  kind: DbKind;
  /** sqlite filesystem path (only for sqlite://) */
  sqlitePath?: string;
  /** original input, with non-sqlite urls passed straight to pg */
  raw: string;
}

const DEFAULT_DB_URL = "sqlite://./combat.sqlite";

/**
 * Parse `DB_URL`-style strings.
 *
 * - `sqlite://<path>` → SQLite at <path>. `<path>` can be:
 *     - absolute: `sqlite:///opt/combat/combat.sqlite` (Unix) → `/opt/combat/combat.sqlite`
 *     - relative: `sqlite://./data/combat.db` → `./data/combat.db`
 *     - bare filename: `sqlite://combat.sqlite` → `combat.sqlite`
 * - `postgres://...` / `postgresql://...` → pass through to pg.
 *
 * Bare paths (no protocol) and falsy input fall back to the default SQLite URL.
 */
export function parseDbUrl(input: string | undefined): ParsedDbUrl {
  const url = (input && input.trim()) || DEFAULT_DB_URL;

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return { kind: "postgres", raw: url };
  }

  if (url.startsWith("sqlite://")) {
    // Strip the protocol. Anything after sqlite:// is treated as a filesystem
    // path verbatim — we don't decode URL escapes because real-world paths use
    // platform-native separators.
    const path = url.slice("sqlite://".length) || "./combat.sqlite";
    return { kind: "sqlite", sqlitePath: path, raw: url };
  }

  // Backwards-compat: treat a bare path like "/opt/combat/data.sqlite" as
  // SQLite. This lets callers pass COMBAT_DB_PATH through unchanged in Phase 1.
  return { kind: "sqlite", sqlitePath: url, raw: url };
}

/**
 * Original SQLite-only entry point. **Keep this unchanged** — every test and
 * existing call site uses it. Phase 2 will introduce an async equivalent.
 */
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SQLITE_SCHEMA_DDL);
  return db;
}

/**
 * New driver factory. Inspects DB_URL (or the argument) and returns a tagged
 * handle. SQLite path is fully functional; Postgres path is a Phase 1 stub
 * (schema created, pool opened, but Repository is still SQLite-only — see
 * docs/POSTGRES_SUPPORT.md).
 */
export async function openDbFromUrl(input?: string): Promise<DbHandle> {
  const parsed = parseDbUrl(input ?? process.env.DB_URL);

  if (parsed.kind === "sqlite") {
    const dbPath = parsed.sqlitePath!;
    const db = openDb(dbPath);
    return { kind: "sqlite", db, dbPath };
  }

  // postgres
  if (!process.env.COMBAT_POSTGRES_PHASE2) {
    log.warn("db.postgres.phase1_stub", {
      message:
        "DB_URL points at Postgres but COMBAT_POSTGRES_PHASE2 is not set. " +
        "Phase 1 only provisions the schema; Repository remains SQLite-only.",
    });
  }

  const pool = new PgPool({ connectionString: parsed.raw });
  const drizzle = drizzlePg(pool, { schema: postgresSchema });
  await ensurePostgresSchema(pool);
  log.info("db.postgres.connected", { url: redact(parsed.raw) });
  return { kind: "postgres", pool, drizzle, connectionString: parsed.raw };
}

/** Redact password in postgres URLs for log output. */
function redact(url: string): string {
  return url.replace(/(:)([^:@/]+)(@)/, "$1***$3");
}

// ---------------------------------------------------------------------------
// DDL — kept inline so SQLite path stays a single fast db.exec() call. The
// Postgres equivalent below is dialect-translated (TEXT, removal of WITHOUT
// ROWID/PRAGMA, datetime() default etc.).
// ---------------------------------------------------------------------------

const SQLITE_SCHEMA_DDL = `
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
      changes TEXT, performedBy TEXT, performedAt TEXT,
      prev_hash TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '');
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
    /* v2.3.4 §1: 用户收件箱通知。与既有 notifications 表(实为 reminder 决策队列)分离,
       避免语义混淆。每条 inbox_notification 对应"某用户应被告知的某事件";
       read_at 为 null 即未读。 */
    CREATE TABLE IF NOT EXISTS inbox_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      source_entity_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_user_unread ON inbox_notifications(user_id, read_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(sourceId);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(targetId);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edgeType);
    CREATE INDEX IF NOT EXISTS idx_progress_owner ON progress_log(ownerId, seqNo);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    /* v2.2 P1 §1: SQLite expression indexes for queryNodesByProperty hot keys.
       配合 Repository.queryNodesByProperty 的 json_extract WHERE 子句使用。
       覆盖热点过滤:状态/问题单号/创建人/客户名称/邮箱/组名/姓名/当前处理人/贡献人。
       SQLite 3.9+ 支持 expression index;每个索引大小约 8 byte/row,5k 节点 < 50 KB。 */
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_status ON nodes(nodeType, json_extract(properties, '$.状态'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_pb ON nodes(nodeType, json_extract(properties, '$.问题单号'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_creator ON nodes(nodeType, json_extract(properties, '$.创建人'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_customer ON nodes(nodeType, json_extract(properties, '$.客户名称'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_email ON nodes(nodeType, json_extract(properties, '$.邮箱'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_group ON nodes(nodeType, json_extract(properties, '$.组名'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_name ON nodes(nodeType, json_extract(properties, '$.姓名'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_handler ON nodes(nodeType, json_extract(properties, '$.当前处理人'));
    CREATE INDEX IF NOT EXISTS idx_nodes_prop_contributor ON nodes(nodeType, json_extract(properties, '$.贡献人'));
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
    CREATE TABLE IF NOT EXISTS welink_extractions (
      id             TEXT PRIMARY KEY,
      ticket_id      TEXT NOT NULL,
      kind           TEXT NOT NULL,
      label          TEXT NOT NULL,
      payload        TEXT NOT NULL,
      source_msg_ids TEXT,
      created_at     TEXT NOT NULL,
      created_by     TEXT,
      reviewed       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_welink_ext_ticket ON welink_extractions(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_welink_ext_kind ON welink_extractions(ticket_id, kind);
  `;

// Phase 4: Postgres-only JSONB + GIN — SQLite path unchanged. JSONB gives us:
//   1. Native binary JSON storage (faster + smaller than TEXT)
//   2. GIN indexes on properties for @>/->>/-> queries
//   3. GIN to_tsvector on search_text for full-text search
// Repository.ts encodes/decodes via adapter.kind branch so SQLite still gets TEXT JSON.
const POSTGRES_SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, "nodeType" TEXT NOT NULL, properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      search_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY, "edgeType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
      "targetId" TEXT NOT NULL, properties JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS progress_log (
      id TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "seqNo" INTEGER NOT NULL,
      content TEXT NOT NULL, "statusSnapshot" TEXT, "updatedBy" TEXT, "updatedAt" TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, "entityType" TEXT, "entityId" TEXT,
      changes JSONB DEFAULT NULL, "performedBy" TEXT, "performedAt" TEXT,
      prev_hash TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL, target_node_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, confidence DOUBLE PRECISION, proposer_source TEXT,
      rationale TEXT, status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT NOT NULL,
      recipient_person_id TEXT, recipient_name TEXT,
      subject TEXT, body TEXT,
      status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS inbox_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      source_entity_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_user_unread ON inbox_notifications(user_id, read_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes("nodeType");
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges("sourceId");
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges("targetId");
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges("edgeType");
    CREATE INDEX IF NOT EXISTS idx_progress_owner ON progress_log("ownerId", "seqNo");
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    -- Phase 4: GIN indexes on JSONB + tsvector for property-key/value containment
    -- and full-text search. 'simple' tsvector config keeps原文(适合中文,不做语言归一)。
    CREATE INDEX IF NOT EXISTS idx_nodes_properties_gin ON nodes USING GIN (properties);
    CREATE INDEX IF NOT EXISTS idx_edges_properties_gin ON edges USING GIN (properties);
    CREATE INDEX IF NOT EXISTS idx_nodes_search_tsv ON nodes USING GIN (to_tsvector('simple', coalesce(search_text, '')));
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
       tab_type TEXT NOT NULL CHECK(tab_type IN ('link', 'custom', 'wiki')),
       title TEXT NOT NULL,
       tab_order INTEGER NOT NULL DEFAULT 0,
       config TEXT NOT NULL DEFAULT '{}',
       content TEXT NOT NULL DEFAULT '',
       created_by TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
       updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
     );
     CREATE INDEX IF NOT EXISTS idx_ticket_tabs_ticket ON ticket_tabs(ticket_id);
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
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      filename TEXT,
      original_name TEXT,
      mimetype TEXT,
      size INTEGER,
      url TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);
    CREATE TABLE IF NOT EXISTS op_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_op_logs_session ON op_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_op_logs_user ON op_logs(user_name);
    CREATE INDEX IF NOT EXISTS idx_op_logs_timestamp ON op_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_op_logs_category ON op_logs(category);
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
    CREATE TABLE IF NOT EXISTS welink_extractions (
      id             TEXT PRIMARY KEY,
      ticket_id      TEXT NOT NULL,
      kind           TEXT NOT NULL,
      label          TEXT NOT NULL,
      payload        TEXT NOT NULL,
      source_msg_ids TEXT,
      created_at     TEXT NOT NULL,
      created_by     TEXT,
      reviewed       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_welink_ext_ticket ON welink_extractions(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_welink_ext_kind ON welink_extractions(ticket_id, kind);
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      parent_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_scope ON wiki_articles(scope, scope_id);
    CREATE INDEX IF NOT EXISTS idx_wiki_parent ON wiki_articles(parent_id);
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'normal',
      email TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      used_by TEXT,
      used_at TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      expires_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
  `;

async function ensurePostgresSchema(pool: PgPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(POSTGRES_SCHEMA_DDL);
  } finally {
    client.release();
  }
}
