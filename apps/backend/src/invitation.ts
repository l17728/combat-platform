import { randomUUID } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";

export interface Invitation {
  id: string;
  code: string;
  role: string;
  email: string;
  displayName: string;
  usedBy: string | null;
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

function toInv(r: any): Invitation {
  return {
    id: r.id,
    code: r.code,
    role: r.role,
    email: r.email,
    displayName: r.display_name,
    usedBy: r.used_by,
    usedAt: r.used_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

export async function ensureInvitationsTable(adapter: DbAdapter): Promise<void> {
  if (adapter.kind === "sqlite") {
    adapter.rawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'normal',
        email TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        used_by TEXT,
        used_at TEXT,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days'))
      )
    `);
  }
}

export class InvitationRepo {
  constructor(private adapter: DbAdapter) {}

  async list(): Promise<Invitation[]> {
    const rows = await this.adapter.query<any>("SELECT * FROM invitations ORDER BY created_at DESC");
    return rows.map(toInv);
  }

  async create(input: {
    role: string;
    email: string;
    displayName: string;
    createdBy: string;
    expiresInDays?: number;
  }): Promise<Invitation> {
    const id = randomUUID();
    const code = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.expiresInDays || 7) * 24 * 60 * 60 * 1000).toISOString();
    await this.adapter.run(
      `INSERT INTO invitations (id, code, role, email, display_name, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, code, input.role, input.email, input.displayName, input.createdBy, now.toISOString(), expiresAt]
    );
    log.info("invitation.create", { id, code, role: input.role, email: input.email });
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Invitation | null> {
    const row = await this.adapter.queryOne<any>("SELECT * FROM invitations WHERE id = ?", [id]);
    return row ? toInv(row) : null;
  }

  async getByCode(code: string): Promise<Invitation | null> {
    const row = await this.adapter.queryOne<any>("SELECT * FROM invitations WHERE code = ?", [code]);
    return row ? toInv(row) : null;
  }

  async markUsed(id: string, usedBy: string): Promise<void> {
    const now = new Date().toISOString();
    await this.adapter.run("UPDATE invitations SET used_by = ?, used_at = ? WHERE id = ?", [usedBy, now, id]);
    log.info("invitation.used", { id, usedBy });
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.adapter.run("DELETE FROM invitations WHERE id = ?", [id]);
    return (r.changes ?? 0) > 0;
  }
}
