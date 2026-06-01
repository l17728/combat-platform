#!/usr/bin/env node

const SAAS_TABLES = [
  "users",
  "nodes",
  "edges",
  "progress_log",
  "audit_log",
  "wiki_articles",
  "bug_reports",
  "help_requests",
  "ticket_tabs",
  "support_node",
  "webhook_subscriptions",
  "digest_config",
  "invitations",
  "op_logs",
  "app_settings",
  "ticket_tab_dynamic",
];

async function main() {
  const dbPath = process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
  if (!dbPath) {
    console.error("Usage: node to-saas.mjs --db=/path/to/combat.sqlite");
    process.exit(1);
  }

  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  console.log("Starting SaaS migration on:", dbPath);

  const backupPath = dbPath + ".pre-saas";
  db.backup(backupPath);
  console.log("Backup created:", backupPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      max_users INTEGER NOT NULL DEFAULT 50,
      settings TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM tenants WHERE id = ?").get("default");
  if (!existing) {
    db.prepare("INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "default",
      "默认租户",
      "default",
      now,
      now
    );
    console.log("Created default tenant");
  }

  for (const table of SAAS_TABLES) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some((c) => c.name === "tenant_id")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
        console.log(`Added tenant_id to ${table}`);
      } else {
        console.log(`tenant_id already exists on ${table}, skipping`);
      }
    } catch (e) {
      console.log(`Skipping ${table} (does not exist or error): ${e.message}`);
    }
  }

  const userCount = db
    .prepare("UPDATE users SET tenant_id = 'default' WHERE tenant_id IS NULL OR tenant_id = ''")
    .run().changes;
  console.log(`Updated ${userCount} users to default tenant`);

  console.log("Migration complete!");
  db.close();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
