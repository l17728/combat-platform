import { Router } from "express";
import { TenantRepo, ensureTenantsTable, superAdminMiddleware } from "./tenant-middleware.js";
import type { DbAdapter } from "./db-adapter.js";
import { asyncHandler, log } from "./logger.js";

export function makePlatformRouter(adapter: DbAdapter): Router {
  const router = Router();
  const repo = new TenantRepo(adapter);

  ensureTenantsTable(adapter).catch((e) => {
    log.error("platform.ensure_tenants_failed", { error: (e as Error).message });
  });

  router.use("/platform", superAdminMiddleware);

  router.get(
    "/platform/tenants",
    asyncHandler(async (_req, res) => {
      const tenants = await repo.list();
      res.json(tenants);
    })
  );

  router.post(
    "/platform/tenants",
    asyncHandler(async (req, res) => {
      const { name, slug, plan, maxUsers } = req.body as {
        name?: string;
        slug?: string;
        plan?: string;
        maxUsers?: number;
      };
      if (!name || !slug) return res.status(400).json({ error: "name 和 slug 必填" });
      if (!/^[a-z0-9][-a-z0-9]+$/.test(slug)) return res.status(400).json({ error: "slug 格式无效" });
      const existing = await repo.getBySlug(slug);
      if (existing) return res.status(409).json({ error: "slug 已存在" });
      const tenant = await repo.create({ name, slug, plan, maxUsers });
      res.status(201).json(tenant);
    })
  );

  router.get(
    "/platform/tenants/:id",
    asyncHandler(async (req, res) => {
      const tenant = await repo.getById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "租户不存在" });
      res.json(tenant);
    })
  );

  router.put(
    "/platform/tenants/:id",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "租户不存在" });
      const { name, plan, status, maxUsers, settings } = req.body as {
        name?: string;
        plan?: string;
        status?: string;
        maxUsers?: number;
        settings?: string;
      };
      const tenant = await repo.update(req.params.id, { name, plan, status, max_users: maxUsers, settings });
      res.json(tenant);
    })
  );

  router.put(
    "/platform/tenants/:id/suspend",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "租户不存在" });
      if (existing.id === "default") return res.status(400).json({ error: "不能暂停默认租户" });
      const tenant = await repo.suspend(req.params.id);
      res.json(tenant);
    })
  );

  router.put(
    "/platform/tenants/:id/restore",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "租户不存在" });
      const tenant = await repo.restore(req.params.id);
      res.json(tenant);
    })
  );

  router.get(
    "/platform/stats",
    asyncHandler(async (_req, res) => {
      const stats = await repo.stats();
      res.json(stats);
    })
  );

  router.get(
    "/platform/tenants/:id/users",
    asyncHandler(async (req, res) => {
      const tenant = await repo.getById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "租户不存在" });
      const users = await adapter.query<any>(
        "SELECT id, username, role, display_name, created_at, updated_at FROM users WHERE tenant_id = ? ORDER BY created_at",
        [req.params.id]
      );
      res.json(users);
    })
  );

  router.get(
    "/platform/tenants/:id/usage",
    asyncHandler(async (req, res) => {
      const tenant = await repo.getById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "租户不存在" });
      const tid = req.params.id;
      const [nodes, edges, wiki, audit] = await Promise.all([
        adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM nodes WHERE tenant_id = ?", [tid]),
        adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM edges WHERE tenant_id = ?", [tid]),
        adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM wiki_articles WHERE tenant_id = ?", [tid]),
        adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM audit_log WHERE tenant_id = ?", [tid]),
      ]);
      const users = await adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE tenant_id = ?", [tid]);
      res.json({
        users: users?.c ?? 0,
        nodes: nodes?.c ?? 0,
        edges: edges?.c ?? 0,
        wikiArticles: wiki?.c ?? 0,
        auditLogs: audit?.c ?? 0,
        maxUsers: tenant.max_users,
        plan: tenant.plan,
      });
    })
  );

  router.put(
    "/platform/tenants/:id/settings",
    asyncHandler(async (req, res) => {
      const tenant = await repo.getById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "租户不存在" });
      const settings = JSON.stringify(req.body);
      const updated = await repo.update(req.params.id, { settings });
      res.json(updated);
    })
  );

  return router;
}
