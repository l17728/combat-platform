import { Router } from "express";
import { WikiRepo, ensureWikiTable } from "./wiki.js";
import type { DbAdapter } from "./db-adapter.js";
import { asyncHandler, log } from "./logger.js";
import { verifyAuth } from "./auth.js";
import { timingSafeEqual } from "node:crypto";
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
      const list = keyword
        ? await repo.search(scope as "global" | "ticket", scopeId, keyword)
        : await repo.list(scope as "global" | "ticket", scopeId);
      const username = actorOf(req);
      const likedSet = username
        ? await repo.likedByUser(scope as "global" | "ticket", scopeId, username)
        : new Set<string>();
      res.json(
        list.map((a) => ({
          ...a,
          lock_password: undefined,
          is_locked: !!a.is_locked,
          liked: likedSet.has(a.id),
        }))
      );
    })
  );

  router.get(
    "/wiki/:id",
    asyncHandler(async (req, res) => {
      const article = await repo.getById(req.params.id);
      if (!article) return res.status(404).json({ error: "文章不存在" });
      const username = actorOf(req);
      res.json({
        ...article,
        lock_password: undefined,
        is_locked: !!article.is_locked,
        liked: username ? await repo.isLikedBy(article.id, username) : false,
      });
    })
  );

  router.post(
    "/wiki",
    asyncHandler(async (req, res) => {
      const { scope, scopeId, parentId, title, content, isLocked, lockPassword } = req.body;
      if (!title) return res.status(400).json({ error: "标题必填" });
      if (isLocked && !lockPassword) return res.status(400).json({ error: "加锁时必须设置密码" });
      const article = await repo.create({
        scope: scope || "global",
        scopeId,
        parentId,
        title,
        content,
        createdBy: actorOf(req),
        isLocked: !!isLocked,
        lockPassword,
      });
      res.status(201).json({ ...article, lock_password: undefined, is_locked: !!article.is_locked, liked: false });
    })
  );

  router.put(
    "/wiki/:id",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "文章不存在" });
      const { title, content, parentId, sortOrder, isLocked, lockPassword } = req.body;
      const updates: any = { title, content, parent_id: parentId, sort_order: sortOrder };
      if (isLocked !== undefined) {
        if (isLocked && !lockPassword && !existing.lock_password) {
          return res.status(400).json({ error: "加锁时必须设置密码" });
        }
        updates.is_locked = isLocked;
        if (lockPassword !== undefined) updates.lock_password = lockPassword;
      }
      const article = await repo.update(req.params.id, updates);
      res.json({ ...article, lock_password: undefined, is_locked: !!article.is_locked });
    })
  );

  router.delete(
    "/wiki/:id",
    asyncHandler(async (req, res) => {
      const existing = await repo.getById(req.params.id);
      if (!existing) return res.status(404).json({ error: "文章不存在" });
      const user = verifyAuth(req);
      const role = (user as any)?.role ?? "normal";
      const username = (user as any)?.displayName || (user as any)?.username || "";
      const isAdmin = role === "admin";
      const isCreator = existing.created_by === username;
      if (!isAdmin && !isCreator) {
        return res.status(403).json({ error: "仅创建者或管理员可删除此文章" });
      }
      if (existing.is_locked) {
        const password = String(req.query.password ?? req.body?.password ?? "");
        if (!existing.lock_password) {
          return res.status(423).json({ error: "文章已加锁，无法删除" });
        }
        if (!password) {
          return res.status(423).json({ error: "请输入加锁密码" });
        }
        const a = Buffer.from(String(existing.lock_password));
        const b = Buffer.from(String(password));
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return res.status(423).json({ error: "密码错误" });
        }
      }
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

  router.post(
    "/wiki/:id/like",
    asyncHandler(async (req, res) => {
      const article = await repo.getById(req.params.id);
      if (!article) return res.status(404).json({ error: "文章不存在" });
      const username = actorOf(req);
      if (!username) return res.status(401).json({ error: "请先登录" });
      const result = await repo.toggleLike(req.params.id, username);
      res.json(result);
    })
  );
  return router;
}
