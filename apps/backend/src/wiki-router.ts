import { Router } from "express";
import { WikiRepo, ensureWikiTable } from "./wiki.js";
import type { DbAdapter } from "./db-adapter.js";
import { asyncHandler, log } from "./logger.js";
import { verifyAuth } from "./auth.js";
import type { Request, Response } from "express";

export function makeWikiRouter(adapter: DbAdapter): Router {
  const router = Router();
  const repo = new WikiRepo(adapter);

  ensureWikiTable(adapter).catch((e) => {
    log.error("wiki.ensure_table_failed", { error: (e as Error).message });
  });

  function actorOf(req: Request): string {
    const u = verifyAuth(req);
    return (u as any)?.displayName || (u as any)?.username || "";
  }

  router.get(
    "/wiki",
    asyncHandler(async (req, res) => {
      const scope = (req.query.scope as string) || "global";
      const scopeId = req.query.scopeId as string | undefined;
      const keyword = req.query.keyword as string | undefined;
      if (keyword) {
        return res.json(await repo.search(scope as "global" | "ticket", scopeId, keyword));
      }
      res.json(await repo.list(scope as "global" | "ticket", scopeId));
    })
  );

  router.get(
    "/wiki/:id",
    asyncHandler(async (req, res) => {
      const article = await repo.getById(req.params.id);
      if (!article) return res.status(404).json({ error: "文章不存在" });
      res.json(article);
    })
  );

  router.post(
    "/wiki",
    asyncHandler(async (req, res) => {
      const { scope, scopeId, parentId, title, content } = req.body;
      if (!title) return res.status(400).json({ error: "标题必填" });
      const article = await repo.create({
        scope: scope || "global",
        scopeId,
        parentId,
        title,
        content,
        createdBy: actorOf(req),
      });
      res.status(201).json(article);
    })
  );

  router.put(
    "/wiki/:id",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "文章不存在" });
      const { title, content, parentId, sortOrder } = req.body;
      const article = await repo.update(req.params.id, { title, content, parent_id: parentId, sort_order: sortOrder });
      res.json(article);
    })
  );

  router.delete(
    "/wiki/:id",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "文章不存在" });
      await repo.delete(req.params.id);
      res.json({ ok: true });
    })
  );

  router.post(
    "/wiki/reorder",
    asyncHandler(async (req, res) => {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: "ids 必须是数组" });
      await repo.reorder(ids);
      res.json({ ok: true });
    })
  );

  return router;
}
