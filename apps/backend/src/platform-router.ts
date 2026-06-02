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

  router.use(superAdminMiddleware);

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

  return router;
}
