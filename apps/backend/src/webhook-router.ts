import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import { WebhooksRepo, ALL_EVENTS, ensureWebhooksTable } from "./webhooks.js";
import { log, asyncHandler } from "./logger.js";
import { adminMiddleware } from "./auth.js";

export function makeWebhookRouter(adapter: DbAdapter): Router {
  ensureWebhooksTable(adapter).catch((e) => log.warn("webhook.ensure_table.fail", { error: (e as Error).message }));

  const r = Router();
  const repo = new WebhooksRepo(adapter);

  r.get(
    "/webhooks",
    asyncHandler(async (_req, res) => {
      const subs = await repo.list();
      res.json(subs);
    })
  );

  r.get("/webhooks/events", (_req, res) => {
    res.json(ALL_EVENTS);
  });

  r.post(
    "/webhooks",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const { url, events } = req.body;
      if (!url || typeof url !== "string") {
        res.status(400).json({ error: "url 必填" });
        return;
      }
      if (!Array.isArray(events) || events.length === 0) {
        res.status(400).json({ error: "events 必填,至少选一个事件" });
        return;
      }
      const user = (req as any).user;
      const sub = await repo.create({ url, events, createdBy: user?.username || "" });
      res.status(201).json(sub);
    })
  );

  r.patch(
    "/webhooks/:id",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const { url, events, enabled } = req.body;
      const sub = await repo.update(req.params.id, { url, events, enabled });
      if (!sub) {
        res.status(404).json({ error: "未找到" });
        return;
      }
      res.json(sub);
    })
  );

  r.delete(
    "/webhooks/:id",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const ok = await repo.delete(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "未找到" });
        return;
      }
      res.json({ ok: true });
    })
  );

  r.post(
    "/webhooks/:id/test",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const sub = await repo.get(req.params.id);
      if (!sub) {
        res.status(404).json({ error: "未找到" });
        return;
      }
      const { dispatchOne } = await import("./webhooks.js");
      const payload = { event: "test", timestamp: new Date().toISOString(), data: { message: "测试推送" } };
      try {
        await dispatchOne(sub, payload);
        res.json({ ok: true, message: "测试事件已发送" });
      } catch (e) {
        res.status(502).json({ ok: false, error: (e as Error).message });
      }
    })
  );

  return r;
}
