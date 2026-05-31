import { randomUUID } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";

export interface WikiArticle {
  id: string;
  scope: "global" | "ticket";
  scope_id: string | null;
  parent_id: string | null;
  title: string;
  content: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function ensureWikiTable(adapter: DbAdapter): Promise<void> {
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_wiki_scope ON wiki_articles(scope, scope_id)`);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_wiki_parent ON wiki_articles(parent_id)`);
}

export class WikiRepo {
  constructor(private adapter: DbAdapter) {}

  async list(scope: "global" | "ticket", scopeId?: string): Promise<WikiArticle[]> {
    if (scope === "global") {
      return this.adapter.query<WikiArticle>(
        "SELECT * FROM wiki_articles WHERE scope = 'global' ORDER BY sort_order, title"
      );
    }
    return this.adapter.query<WikiArticle>(
      "SELECT * FROM wiki_articles WHERE scope = ? AND scope_id = ? ORDER BY sort_order, title",
      [scope, scopeId || ""]
    );
  }

  async getById(id: string): Promise<WikiArticle | undefined> {
    return this.adapter.queryOne<WikiArticle>("SELECT * FROM wiki_articles WHERE id = ?", [id]);
  }

  async create(params: {
    scope: "global" | "ticket";
    scopeId?: string;
    parentId?: string;
    title: string;
    content?: string;
    createdBy: string;
  }): Promise<WikiArticle> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const maxRow = await this.adapter.queryOne<{ m: number | null }>(
      "SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_articles WHERE scope = ? AND COALESCE(scope_id, '') = ?",
      [params.scope, params.scopeId || ""]
    );
    const sortOrder = (maxRow?.m ?? -1) + 1;
    await this.adapter.run(
      "INSERT INTO wiki_articles (id, scope, scope_id, parent_id, title, content, sort_order, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        params.scope,
        params.scopeId || null,
        params.parentId || null,
        params.title,
        params.content || "",
        sortOrder,
        params.createdBy,
        now,
        now,
      ]
    );
    log.info("wiki.created", { id, scope: params.scope, scopeId: params.scopeId, title: params.title });
    return (await this.getById(id))!;
  }

  async update(
    id: string,
    updates: Partial<Pick<WikiArticle, "title" | "content" | "parent_id" | "sort_order">>
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
    sets.push("updated_at = ?");
    vals.push(new Date().toISOString());
    vals.push(id);
    await this.adapter.run(`UPDATE wiki_articles SET ${sets.join(", ")} WHERE id = ?`, vals);
    log.info("wiki.updated", { id });
    return (await this.getById(id))!;
  }

  async delete(id: string): Promise<void> {
    await this.adapter.run("DELETE FROM wiki_articles WHERE id = ?", [id]);
    log.info("wiki.deleted", { id });
  }

  async search(scope: "global" | "ticket", scopeId: string | undefined, keyword: string): Promise<WikiArticle[]> {
    const like = `%${keyword}%`;
    if (scope === "global") {
      return this.adapter.query<WikiArticle>(
        "SELECT * FROM wiki_articles WHERE scope = 'global' AND (title LIKE ? OR content LIKE ?) ORDER BY sort_order, title",
        [like, like]
      );
    }
    return this.adapter.query<WikiArticle>(
      "SELECT * FROM wiki_articles WHERE scope = ? AND scope_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY sort_order, title",
      [scope, scopeId || "", like, like]
    );
  }

  async reorder(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.adapter.run("UPDATE wiki_articles SET sort_order = ? WHERE id = ?", [i, orderedIds[i]]);
    }
    log.info("wiki.reordered", { count: orderedIds.length });
  }
}
