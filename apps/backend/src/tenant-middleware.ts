import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { verifyAuth } from "./auth.js";
import type { DbAdapter } from "./db-adapter.js";
import { log, asyncHandler } from "./logger.js";

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

const PLAN_QUOTAS: Record<string, { maxUsers: number; maxNodes: number }> = {
  free: { maxUsers: 50, maxNodes: 5000 },
  pro: { maxUsers: 200, maxNodes: 50000 },
  enterprise: { maxUsers: 99999, maxNodes: 999999 },
};

export function quotaMiddleware(req: TenantReq, res: Response, next: NextFunction): void {
  if (!SAAS_MODE || !req.tenantId) return next();
  // Quota checks are async but Express middleware is sync; wrap in IIFE
  (async () => {
    try {
      const adapter = (req.app.locals as any).adapter as DbAdapter | undefined;
      if (!adapter) return next();
      const tenant = await new TenantRepo(adapter).getById(req.tenantId!);
      if (!tenant) return next();
      if (tenant.status === "suspended") {
        res.status(403).json({ error: "租户已暂停，请联系管理员" });
        return;
      }
      // Only check quota on user creation (POST /api/users or POST /api/auth/register)
      if (req.method === "POST" && (req.path === "/users" || req.path === "/auth/register")) {
        const quota = PLAN_QUOTAS[tenant.plan] || PLAN_QUOTAS.free;
        const userCount = await adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE tenant_id = ?", [
          req.tenantId,
        ]);
        if ((userCount?.c ?? 0) >= quota.maxUsers) {
          res.status(403).json({ error: `已达到当前计划 (${tenant.plan}) 的用户上限 (${quota.maxUsers})` });
          return;
        }
      }
      next();
    } catch {
      next();
    }
  })();
}

export async function ensureGuestTenant(adapter: DbAdapter): Promise<void> {
  await ensureTenantsTable(adapter);
  const row = await adapter.queryOne<{ id: string }>("SELECT id FROM tenants WHERE id = 'guest'");
  if (!row) {
    const now = new Date().toISOString();
    await adapter.run(
      "INSERT INTO tenants (id, name, slug, plan, status, max_users, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["guest", "体验租户", "guest", "free", "active", 10, "{}", now, now]
    );
    log.info("tenant.guest_created");
  }
}

export async function ensureSuperAdmin(adapter: DbAdapter): Promise<void> {
  const existing = await adapter.queryOne<{ id: string }>("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1");
  if (existing) return;

  const admin = await adapter.queryOne<{ id: string }>(
    "SELECT id FROM users WHERE username = 'admin' AND (tenant_id = 'default' OR tenant_id IS NULL) LIMIT 1"
  );
  if (!admin) return;

  await adapter.run("UPDATE users SET role = 'superadmin' WHERE id = ?", [admin.id]);
  log.info("tenant.superadmin_promoted", { userId: admin.id });
}

export async function cleanGuestData(adapter: DbAdapter): Promise<{ deleted: number }> {
  const tables = [
    "nodes",
    "edges",
    "progress_log",
    "audit_log",
    "wiki_articles",
    "bug_reports",
    "help_requests",
    "op_logs",
  ];
  let deleted = 0;
  for (const table of tables) {
    try {
      const result = await adapter.run(
        `DELETE FROM ${table} WHERE tenant_id = 'guest' AND created_at < datetime('now', '-7 days')`
      );
      deleted += (result as any)?.changes ?? 0;
    } catch {}
  }
  if (deleted > 0) log.info("tenant.guest_cleaned", { deleted });
  return { deleted };
}

// Write-semantic GET paths: these GET requests download/export data that guests must not access.
// Mounted at /api, so req.path is relative to /api (e.g. /export/attackTicket, /backup/somefile.db).
const GUEST_WRITE_SEMANTIC_GET_TESTS: ((path: string) => boolean)[] = [
  (p) => p.startsWith("/export/"),
  (p) => p.startsWith("/backup/") && !p.startsWith("/backup/schedule"),
];

// Paths where guests are blocked from ALL methods (system admin area).
// req.path is relative to /api mount point.
const GUEST_BLOCKED_PREFIXES = [
  "/audit",
  "/upgrade",
  "/merge",
  "/op-logs",
  "/backup",
  "/proposals",
  "/reminders",
  "/email",
  "/llm-settings",
  "/platform/",
  "/users",
  "/settings",
  "/db-migration",
  "/kg-outbox",
  "/webhook",
  "/digest",
  "/invitation",
  "/schema",
  "/metrics",
  "/auth/register",
  "/auth/user",
];

function isGuestBlockedPath(path: string): boolean {
  return GUEST_BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function guestReadOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.COMBAT_NO_AUTH === "1") return next();
  const payload = verifyAuth(req);
  if (!payload) return next();
  if (!(payload as any).isGuest) return next();

  if (isGuestBlockedPath(req.path)) {
    res.status(403).json({ error: "游客参观期间，请勿触动控制面板，谢谢！" });
    return;
  }

  if (req.method === "GET" && GUEST_WRITE_SEMANTIC_GET_TESTS.some((t) => t(req.path))) {
    res.status(403).json({ error: "游客参观期间，请勿触动控制面板，谢谢！" });
    return;
  }

  // Creator-only delete check is enforced separately in routes.ts
  next();
}

export function makeGuestAccessRouter(adapter: DbAdapter): Router {
  const router = Router();

  router.post(
    "/platform/guest-access",
    asyncHandler(async (_req, res) => {
      const { randomUUID } = await import("node:crypto");
      const tenantId = SAAS_MODE ? "guest" : "default";
      if (SAAS_MODE) {
        await ensureGuestTenant(adapter);
      }
      const guestUser = `guest_${Date.now().toString(36)}`;
      const bcrypt = (await import("bcryptjs")).default;
      const hash = bcrypt.hashSync(randomUUID(), 10);
      const now = new Date().toISOString();
      const id = randomUUID();
      await adapter.run(
        "INSERT INTO users (id, username, password_hash, role, display_name, tenant_id, created_at, updated_at) VALUES (?, ?, ?, 'normal', ?, ?, ?, ?)",
        [id, guestUser, hash, guestUser, tenantId, now, now]
      );
      const jwt = (await import("jsonwebtoken")).default;
      const JWT_SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";
      const payload = { userId: id, username: guestUser, role: "normal", tenantId, isGuest: true };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
      res.json({ token, username: guestUser });
    })
  );

  return router;
}
