import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";

export interface SharedLink {
  id: string;
  token: string;
  entity_type: string;
  entity_id: string;
  share_type: string;
  shared_by: string;
  password: string | null;
  max_views: number | null;
  current_views: number;
  expires_at: string | null;
  target_users: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function ensureShareTable(adapter: DbAdapter): Promise<void> {
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS shared_links (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      share_type TEXT NOT NULL DEFAULT 'link',
      shared_by TEXT NOT NULL,
      password TEXT,
      max_views INTEGER,
      current_views INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      target_users TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    )
  `);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_shared_links_token ON shared_links(token)`);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_shared_links_entity ON shared_links(entity_type, entity_id)`);

  await adapter.run(`
    CREATE TABLE IF NOT EXISTS shared_link_views (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      viewer_ip TEXT,
      viewer_user TEXT,
      viewed_at TEXT NOT NULL
    )
  `);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_slv_link ON shared_link_views(link_id)`);
}

function generateToken(): string {
  return randomBytes(9).toString("base64url");
}

export class ShareRepo {
  constructor(private adapter: DbAdapter) {}

  async createLink(params: {
    entityType: string;
    entityId: string;
    sharedBy: string;
    password?: string;
    expiresIn?: number;
    maxViews?: number;
    targetUsers?: string[];
  }): Promise<{ id: string; token: string; expiresAt: string | null }> {
    const id = randomUUID();
    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = params.expiresIn ? new Date(Date.now() + params.expiresIn * 1000).toISOString() : null;
    const passwordHash = params.password ? await bcrypt.hash(params.password, 10) : null;

    await this.adapter.run(
      `INSERT INTO shared_links (id, token, entity_type, entity_id, share_type, shared_by, password, max_views, current_views, expires_at, target_users, created_at, revoked_at)
       VALUES (?, ?, ?, ?, 'link', ?, ?, ?, 0, ?, ?, ?, NULL)`,
      [
        id,
        token,
        params.entityType,
        params.entityId,
        params.sharedBy,
        passwordHash,
        params.maxViews ?? null,
        expiresAt,
        params.targetUsers ? JSON.stringify(params.targetUsers) : null,
        now,
      ]
    );
    log.info("share.created", {
      id,
      entityType: params.entityType,
      entityId: params.entityId,
      sharedBy: params.sharedBy,
    });
    return { id, token, expiresAt };
  }

  async getByToken(token: string): Promise<SharedLink | undefined> {
    return this.adapter.queryOne<SharedLink>("SELECT * FROM shared_links WHERE token = ? AND revoked_at IS NULL", [
      token,
    ]);
  }

  async listByEntity(entityType: string, entityId: string): Promise<SharedLink[]> {
    return this.adapter.query<SharedLink>(
      "SELECT * FROM shared_links WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC",
      [entityType, entityId]
    );
  }

  async revoke(id: string, revokedBy: string): Promise<void> {
    const now = new Date().toISOString();
    await this.adapter.run("UPDATE shared_links SET revoked_at = ? WHERE id = ?", [now, id]);
    log.info("share.revoked", { id, revokedBy });
  }

  async verifyPassword(link: SharedLink, password: string): Promise<boolean> {
    if (!link.password) return true;
    return bcrypt.compare(password, link.password);
  }

  async recordView(linkId: string, ip: string | undefined, user: string | undefined): Promise<void> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.adapter.run(
      "INSERT INTO shared_link_views (id, link_id, viewer_ip, viewer_user, viewed_at) VALUES (?, ?, ?, ?, ?)",
      [id, linkId, ip ?? null, user ?? null, now]
    );
    await this.adapter.run("UPDATE shared_links SET current_views = current_views + 1 WHERE id = ?", [linkId]);
  }

  async isLinkValid(link: SharedLink): Promise<{ valid: boolean; reason?: string }> {
    if (link.revoked_at) return { valid: false, reason: "此分享链接已被撤销" };
    if (link.expires_at && new Date(link.expires_at) < new Date()) return { valid: false, reason: "此分享链接已过期" };
    if (link.max_views !== null && link.current_views >= link.max_views)
      return { valid: false, reason: "此分享链接已达到最大查看次数" };
    return { valid: true };
  }

  async getById(id: string): Promise<SharedLink | undefined> {
    return this.adapter.queryOne<SharedLink>("SELECT * FROM shared_links WHERE id = ?", [id]);
  }
}
