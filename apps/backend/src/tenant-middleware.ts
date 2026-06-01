import type { Request, Response, NextFunction } from "express";
import { verifyAuth } from "./auth.js";

export const SAAS_MODE = process.env.SAAS_MODE === "1";

export interface TenantReq extends Request {
  tenantId?: string;
  isSuperAdmin?: boolean;
}

export function tenantMiddleware(req: TenantReq, _res: Response, next: NextFunction): void {
  const payload = verifyAuth(req);
  if (payload) {
    req.tenantId = payload.tenantId;
    req.isSuperAdmin = payload.role === "superadmin";
  }
  next();
}

export async function ensureDefaultTenant(adapter: {
  run: (sql: string, params?: unknown[]) => Promise<unknown>;
  queryOne: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  const row = (await adapter.queryOne("SELECT id FROM tenants WHERE id = 'default'")) as { id: string } | undefined;
  if (!row) {
    const now = new Date().toISOString();
    await adapter.run(
      "INSERT INTO tenants (id, name, slug, plan, status, max_users, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["default", "默认租户", "default", "free", "active", 50, "{}", now, now]
    );
  }
}
