import type { Request, Response, NextFunction } from "express";
import { verifyAuth } from "./auth.js";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";

export const SAAS_MODE = process.env.SAAS_MODE === "1";

export interface TenantReq extends Request {
  tenantId?: string;
  isSuperAdmin?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  max_users: number;
  settings: string;
  created_at: string;
  updated_at: string;
}

export async function ensureTenantsTable(adapter: DbAdapter): Promise<void> {
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      max_users INTEGER NOT NULL DEFAULT 50,
      settings TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await adapter.run(`CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)`);
}

export function tenantMiddleware(req: TenantReq, _res: Response, next: NextFunction): void {
  const payload = verifyAuth(req);
  if (payload) {
    req.tenantId = payload.tenantId;
    req.isSuperAdmin = payload.role === "superadmin";
  }
  next();
}

export function superAdminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.COMBAT_NO_AUTH === "1") return next();
  const payload = verifyAuth(req);
  if (!payload) {
    res.status(401).json({ error: "未登录或 token 已过期" });
    return;
  }
  if (payload.role !== "superadmin") {
    res.status(403).json({ error: "仅 SuperAdmin 可访问" });
    return;
  }
  (req as any).user = payload;
  next();
}

export async function ensureDefaultTenant(adapter: DbAdapter): Promise<void> {
  await ensureTenantsTable(adapter);
  const row = await adapter.queryOne<{ id: string }>("SELECT id FROM tenants WHERE id = 'default'");
  if (!row) {
    const now = new Date().toISOString();
    await adapter.run(
      "INSERT INTO tenants (id, name, slug, plan, status, max_users, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["default", "默认租户", "default", "free", "active", 50, "{}", now, now]
    );
    log.info("tenant.default_created");
  }
}

export class TenantRepo {
  constructor(private adapter: DbAdapter) {}

  async list(): Promise<Tenant[]> {
    return this.adapter.query<Tenant>("SELECT * FROM tenants ORDER BY created_at DESC");
  }

  async getById(id: string): Promise<Tenant | undefined> {
    return this.adapter.queryOne<Tenant>("SELECT * FROM tenants WHERE id = ?", [id]);
  }

  async getBySlug(slug: string): Promise<Tenant | undefined> {
    return this.adapter.queryOne<Tenant>("SELECT * FROM tenants WHERE slug = ?", [slug]);
  }

  async create(params: { name: string; slug: string; plan?: string; maxUsers?: number }): Promise<Tenant> {
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.adapter.run(
      "INSERT INTO tenants (id, name, slug, plan, status, max_users, settings, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, '{}', ?, ?)",
      [id, params.name, params.slug, params.plan || "free", params.maxUsers || 50, now, now]
    );
    log.info("tenant.created", { id, name: params.name, slug: params.slug });
    return (await this.getById(id))!;
  }

  async update(
    id: string,
    updates: Partial<Pick<Tenant, "name" | "plan" | "status" | "max_users" | "settings">>
  ): Promise<Tenant> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) {
      sets.push("name = ?");
      vals.push(updates.name);
    }
    if (updates.plan !== undefined) {
      sets.push("plan = ?");
      vals.push(updates.plan);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      vals.push(updates.status);
    }
    if (updates.max_users !== undefined) {
      sets.push("max_users = ?");
      vals.push(updates.max_users);
    }
    if (updates.settings !== undefined) {
      sets.push("settings = ?");
      vals.push(updates.settings);
    }
    sets.push("updated_at = ?");
    vals.push(new Date().toISOString());
    vals.push(id);
    await this.adapter.run(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`, vals);
    log.info("tenant.updated", { id });
    return (await this.getById(id))!;
  }

  async suspend(id: string): Promise<Tenant> {
    return this.update(id, { status: "suspended" });
  }

  async restore(id: string): Promise<Tenant> {
    return this.update(id, { status: "active" });
  }

  async stats(): Promise<{ tenantCount: number; userCount: number; nodeCount: number }> {
    const t = await this.adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM tenants");
    const u = await this.adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM users");
    const n = await this.adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM nodes");
    return { tenantCount: t?.c ?? 0, userCount: u?.c ?? 0, nodeCount: n?.c ?? 0 };
  }
}
