import { Router, type Request, type Response } from "express";
import type { DbAdapter } from "./db-adapter.js";
import { NotificationsRepo, subscribeNotifications, type InboxNotification } from "./notifications.js";
import { asyncHandler, log } from "./logger.js";

function currentUsername(req: Request): string | null {
  const u = (req as any).user;
  if (u?.username) return String(u.username);
  // E2E bypass: COMBAT_NO_AUTH=1 → 默认 admin 用户
  if (process.env.COMBAT_NO_AUTH === "1") return "admin";
  return null;
}

function isAdminReq(req: Request): boolean {
  if (process.env.COMBAT_NO_AUTH === "1") return true;
  const u = (req as any).user;
  return u?.role === "admin";
}

export function makeNotificationsRouter(adapter: DbAdapter): Router {
  const r = Router();
  const repo = new NotificationsRepo(adapter);

  // SSE endpoint - registered BEFORE the generic /notifications GET so it doesn't clash.
  r.get("/notifications/stream", (req: Request, res: Response) => {
    const userId = currentUsername(req);
    if (!userId) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`event: ready\ndata: {"ok":true}\n\n`);

    const send = (n: InboxNotification) => {
      if (n.userId !== userId) return;
      try {
        res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
      } catch {
        /* client gone — unsubscribe will fire on close */
      }
    };
    const off = subscribeNotifications(send);

    // 心跳:防止反代/浏览器 60s 静默断开
    const keepalive = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* ignore */
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(keepalive);
      off();
      log.info("notifications.stream.close", { userId });
    });
  });

  r.get(
    "/notifications",
    asyncHandler(async (req: Request, res: Response) => {
      const userId = currentUsername(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      const unread = req.query.unread === "true" || req.query.unread === "1";
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const items = await repo.list(userId, { unread, limit });
      const count = await repo.unreadCount(userId);
      res.json({ items, unreadCount: count });
    })
  );

  r.get(
    "/notifications/unread-count",
    asyncHandler(async (req: Request, res: Response) => {
      const userId = currentUsername(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      res.json({ unreadCount: await repo.unreadCount(userId) });
    })
  );

  r.post(
    "/notifications/read-all",
    asyncHandler(async (req: Request, res: Response) => {
      const userId = currentUsername(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      const updated = await repo.markAllRead(userId);
      res.json({ updated });
    })
  );

  r.post(
    "/notifications/:id/read",
    asyncHandler(async (req: Request, res: Response) => {
      const userId = currentUsername(req);
      if (!userId) return res.status(401).json({ error: "未登录" });
      const n = await repo.markRead(userId, req.params.id);
      if (!n) return res.status(404).json({ error: "通知不存在或不属于当前用户" });
      res.json(n);
    })
  );

  // 创建通知:仅 admin (测试/手动通知用)
  r.post(
    "/notifications",
    asyncHandler(async (req: Request, res: Response) => {
      if (!isAdminReq(req)) return res.status(403).json({ error: "仅管理员可创建通知" });
      const { userId, kind, title, body, link, sourceEntityId } = req.body ?? {};
      if (!userId || !kind || !title) {
        return res.status(400).json({ error: "userId, kind, title 必填" });
      }
      const n = await repo.create({ userId, kind, title, body, link, sourceEntityId });
      res.status(201).json(n);
    })
  );

  return r;
}
