import { randomUUID } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";
import { tid } from "./repository.js";

export interface WikiArticle {
  id: string;
  scope: "global" | "ticket";
  scope_id: string | null;
  parent_id: string | null;
  title: string;
  content: string;
  sort_order: number;
  created_by: string;
  is_locked: boolean;
  lock_password: string | null;
  likes: number;
  created_at: string;
  updated_at: string;
}

export async function ensureWikiTable(adapter: DbAdapter): Promise<void> {
  const nowDefault = adapter.kind === "postgres" ? "(now()::text)" : "(datetime('now'))";
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      parent_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      is_locked INTEGER NOT NULL DEFAULT 0,
      lock_password TEXT DEFAULT NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT NOT NULL DEFAULT ${nowDefault},
      updated_at TEXT NOT NULL DEFAULT ${nowDefault}
    )
  `);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_wiki_scope ON wiki_articles(scope, scope_id)`);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_wiki_parent ON wiki_articles(parent_id)`);
  if (adapter.kind === "sqlite") {
    const cols = adapter.rawSqlite().prepare("PRAGMA table_info(wiki_articles)").all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("is_locked"))
      adapter.rawSqlite().exec("ALTER TABLE wiki_articles ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0");
    if (!colNames.has("lock_password"))
      adapter.rawSqlite().exec("ALTER TABLE wiki_articles ADD COLUMN lock_password TEXT DEFAULT NULL");
    if (!colNames.has("likes"))
      adapter.rawSqlite().exec("ALTER TABLE wiki_articles ADD COLUMN likes INTEGER NOT NULL DEFAULT 0");
    if (!colNames.has("tenant_id"))
      adapter.rawSqlite().exec("ALTER TABLE wiki_articles ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
  }
  // v2.9: like tracking table
  if (adapter.kind === "sqlite") {
    adapter.rawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS wiki_likes (
        article_id TEXT NOT NULL,
        username TEXT NOT NULL,
        PRIMARY KEY (article_id, username)
      )
    `);
  }
}

const TIER_ORDER = `
  CASE WHEN is_locked THEN 0
       WHEN likes > 0 THEN 1
       ELSE 2 END,
  likes DESC,
  sort_order, title
`;

export class WikiRepo {
  constructor(private adapter: DbAdapter) {}

  async list(scope: "global" | "ticket", scopeId?: string): Promise<WikiArticle[]> {
    if (scope === "global") {
      return this.adapter.query<WikiArticle>(
        `SELECT * FROM wiki_articles WHERE scope = 'global' AND tenant_id = ? ORDER BY ${TIER_ORDER}`,
        [tid()]
      );
    }
    return this.adapter.query<WikiArticle>(
      `SELECT * FROM wiki_articles WHERE scope = ? AND scope_id = ? AND tenant_id = ? ORDER BY ${TIER_ORDER}`,
      [scope, scopeId || "", tid()]
    );
  }

  async getById(id: string): Promise<WikiArticle | undefined> {
    return this.adapter.queryOne<WikiArticle>("SELECT * FROM wiki_articles WHERE id = ? AND tenant_id = ?", [
      id,
      tid(),
    ]);
  }

  async create(params: {
    scope: "global" | "ticket";
    scopeId?: string;
    parentId?: string;
    title: string;
    content?: string;
    createdBy: string;
    isLocked?: boolean;
    lockPassword?: string;
  }): Promise<WikiArticle> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const maxRow = await this.adapter.queryOne<{ m: number | null }>(
      "SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_articles WHERE scope = ? AND COALESCE(scope_id, '') = ? AND tenant_id = ?",
      [params.scope, params.scopeId || "", tid()]
    );
    const sortOrder = (maxRow?.m ?? -1) + 1;
    await this.adapter.run(
      "INSERT INTO wiki_articles (id, scope, scope_id, parent_id, title, content, sort_order, created_by, is_locked, lock_password, likes, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      [
        id,
        params.scope,
        params.scopeId || null,
        params.parentId || null,
        params.title,
        params.content || "",
        sortOrder,
        params.createdBy,
        params.isLocked ? 1 : 0,
        params.isLocked && params.lockPassword ? params.lockPassword : null,
        tid(),
        now,
        now,
      ]
    );
    log.info("wiki.created", { id, scope: params.scope, scopeId: params.scopeId, title: params.title });
    return (await this.getById(id))!;
  }

  async update(
    id: string,
    updates: Partial<
      Pick<WikiArticle, "title" | "content" | "parent_id" | "sort_order"> & {
        is_locked?: boolean;
        lock_password?: string | null;
      }
    >
  ): Promise<WikiArticle> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.title !== undefined) {
      sets.push("title = ?");
      vals.push(updates.title);
    }
    if (updates.content !== undefined) {
      sets.push("content = ?");
      vals.push(updates.content);
    }
    if (updates.parent_id !== undefined) {
      sets.push("parent_id = ?");
      vals.push(updates.parent_id);
    }
    if (updates.sort_order !== undefined) {
      sets.push("sort_order = ?");
      vals.push(updates.sort_order);
    }
    if (updates.is_locked !== undefined) {
      sets.push("is_locked = ?");
      vals.push(updates.is_locked ? 1 : 0);
    }
    if ("lock_password" in updates) {
      sets.push("lock_password = ?");
      vals.push(updates.lock_password ?? null);
    }
    sets.push("updated_at = ?");
    vals.push(new Date().toISOString());
    vals.push(id);
    vals.push(tid());
    await this.adapter.run(`UPDATE wiki_articles SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`, vals);
    log.info("wiki.updated", { id });
    return (await this.getById(id))!;
  }

  async delete(id: string): Promise<void> {
    await this.adapter.run("DELETE FROM wiki_likes WHERE article_id = ?", [id]);
    await this.adapter.run("DELETE FROM wiki_articles WHERE id = ? AND tenant_id = ?", [id, tid()]);
    log.info("wiki.deleted", { id });
  }

  async search(scope: "global" | "ticket", scopeId: string | undefined, keyword: string): Promise<WikiArticle[]> {
    const like = `%${keyword}%`;
    if (scope === "global") {
      return this.adapter.query<WikiArticle>(
        `SELECT * FROM wiki_articles WHERE scope = 'global' AND (title LIKE ? OR content LIKE ?) AND tenant_id = ? ORDER BY ${TIER_ORDER}`,
        [like, like, tid()]
      );
    }
    return this.adapter.query<WikiArticle>(
      `SELECT * FROM wiki_articles WHERE scope = ? AND scope_id = ? AND (title LIKE ? OR content LIKE ?) AND tenant_id = ? ORDER BY ${TIER_ORDER}`,
      [scope, scopeId || "", like, like, tid()]
    );
  }

  async reorder(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.adapter.run("UPDATE wiki_articles SET sort_order = ? WHERE id = ? AND tenant_id = ?", [
        i,
        orderedIds[i],
        tid(),
      ]);
    }
    log.info("wiki.reordered", { count: orderedIds.length });
  }

  async toggleLike(articleId: string, username: string): Promise<{ liked: boolean; likes: number }> {
    const existing = await this.adapter.queryOne<any>(
      "SELECT 1 FROM wiki_likes WHERE article_id = ? AND username = ?",
      [articleId, username]
    );
    if (existing) {
      await this.adapter.run("DELETE FROM wiki_likes WHERE article_id = ? AND username = ?", [articleId, username]);
      await this.adapter.run("UPDATE wiki_articles SET likes = MAX(0, likes - 1) WHERE id = ? AND tenant_id = ?", [
        articleId,
        tid(),
      ]);
    } else {
      await this.adapter.run("INSERT OR IGNORE INTO wiki_likes (article_id, username) VALUES (?, ?)", [
        articleId,
        username,
      ]);
      await this.adapter.run("UPDATE wiki_articles SET likes = likes + 1 WHERE id = ? AND tenant_id = ?", [
        articleId,
        tid(),
      ]);
    }
    const row = await this.getById(articleId);
    return { liked: !existing, likes: row?.likes ?? 0 };
  }

  async isLikedBy(articleId: string, username: string): Promise<boolean> {
    const row = await this.adapter.queryOne<any>("SELECT 1 FROM wiki_likes WHERE article_id = ? AND username = ?", [
      articleId,
      username,
    ]);
    return !!row;
  }

  async likedByUser(scope: "global" | "ticket", scopeId: string | undefined, username: string): Promise<Set<string>> {
    const rows = await this.adapter.query<{ article_id: string }>(
      `SELECT wl.article_id FROM wiki_likes wl JOIN wiki_articles wa ON wa.id = wl.article_id WHERE wl.username = ? AND wa.scope = ? AND COALESCE(wa.scope_id, '') = ? AND wa.tenant_id = ?`,
      [username, scope, scopeId || "", tid()]
    );
    return new Set(rows.map((r) => r.article_id));
  }
}
