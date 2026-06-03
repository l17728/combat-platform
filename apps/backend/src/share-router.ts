import { Router } from "express";
import { ShareRepo, ensureShareTable } from "./share.js";
import { WikiRepo } from "./wiki.js";
import type { DbAdapter } from "./db-adapter.js";
import { asyncHandler, log } from "./logger.js";
import { verifyAuth } from "./auth.js";
import { randomUUID } from "node:crypto";
import { NotificationsRepo } from "./notifications.js";

function actorOf(req: { headers: Record<string, unknown> }): string {
  const u = verifyAuth(req);
  return (u as any)?.displayName || (u as any)?.username || "";
}

function writeAudit(
  adapter: DbAdapter,
  entry: { action: string; entityType: string; entityId: string; changes: unknown; actor: string }
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  adapter
    .run(
      "INSERT INTO audit_log (id, action, entityType, entityId, changes, performedBy, performedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.changes), entry.actor, now]
    )
    .catch((e) => log.warn("share.audit_write_failed", { error: (e as Error).message }));
}

export function makeShareRouter(adapter: DbAdapter, notificationsRepo?: NotificationsRepo): Router {
  const router = Router();
  const shareRepo = new ShareRepo(adapter);
  const wikiRepo = new WikiRepo(adapter);

  ensureShareTable(adapter).catch((e) => {
    log.error("share.ensure_table_failed", { error: (e as Error).message });
  });

  // POST /api/share — create a sharing link
  router.post(
    "/share",
    asyncHandler(async (req, res) => {
      const { entityType, entityId, password, expiresIn, maxViews, targetUsers } = req.body as {
        entityType?: string;
        entityId?: string;
        password?: string;
        expiresIn?: number;
        maxViews?: number;
        targetUsers?: string[];
      };
      if (!entityType || !entityId) return res.status(400).json({ error: "entityType 和 entityId 必填" });
      if (!["ticket", "wiki", "infoCard"].includes(entityType))
        return res.status(400).json({ error: "不支持的实体类型" });

      const actor = actorOf(req);
      if (!actor) return res.status(401).json({ error: "请先登录" });

      // Wiki: locked articles cannot be shared
      if (entityType === "wiki") {
        const article = await wikiRepo.getById(entityId);
        if (!article) return res.status(404).json({ error: "文章不存在" });
        if (article.is_locked) return res.status(403).json({ error: "加锁文章不允许生成分享链接" });
      }

      // Ticket: verify read access (member or admin)
      if (entityType === "ticket") {
        // Allow any authenticated user to share for now; finer-grained checks later
      }

      const result = await shareRepo.createLink({
        entityType,
        entityId,
        sharedBy: actor,
        password,
        expiresIn,
        maxViews,
        targetUsers,
      });

      const baseUrl = process.env.SHARE_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const url = `${baseUrl}/s/${result.token}`;

      writeAudit(adapter, {
        action: "share.create",
        entityType,
        entityId,
        changes: { token: result.token, expiresIn, maxViews, hasPassword: !!password, targetUsers },
        actor,
      });

      // P2: push notifications to target users for internal sharing
      if (targetUsers && targetUsers.length > 0 && notificationsRepo) {
        const entityLabel = entityType === "wiki" ? "知识库文章" : entityType === "ticket" ? "攻关单" : "公告";
        const title = entityType === "wiki" ? ((await wikiRepo.getById(entityId))?.title ?? entityLabel) : entityLabel;
        for (const username of targetUsers) {
          const userRow = await adapter.queryOne<{ id: string }>(
            "SELECT id FROM users WHERE display_name = ? OR username = ?",
            [username, username]
          );
          if (userRow) {
            notificationsRepo
              .create({
                userId: userRow.id,
                kind: "mention",
                title: `${actor} 向你分享了${entityLabel}`,
                body: `「${title}」`,
                link: url,
                sourceEntityId: entityId,
              })
              .catch((e) => log.warn("share.notify_failed", { error: (e as Error).message, username }));
          }
        }
      }

      res.status(201).json({ id: result.id, url, token: result.token, expiresAt: result.expiresAt });
    })
  );

  // GET /api/s/:token — public access to shared content
  router.get(
    "/s/:token",
    asyncHandler(async (req, res) => {
      const { token } = req.params;
      const password = req.query.password as string | undefined;

      const link = await shareRepo.getByToken(token);
      if (!link) return res.status(404).json({ error: "分享链接不存在或已失效" });

      const validity = await shareRepo.isLinkValid(link);
      if (!validity.valid) return res.status(410).json({ error: validity.reason });

      // Check password if set
      if (link.password) {
        if (!password) return res.status(403).json({ error: "此链接需要访问密码", requiresPassword: true });
        const ok = await shareRepo.verifyPassword(link, password);
        if (!ok) return res.status(403).json({ error: "密码错误" });
      }

      // Fetch entity content based on type
      let title = "";
      let content = "";
      let extra: Record<string, unknown> = {};

      if (link.entity_type === "wiki") {
        const article = await wikiRepo.getById(link.entity_id);
        if (!article) return res.status(404).json({ error: "文章不存在" });
        title = article.title;
        content = article.content;
      } else if (link.entity_type === "ticket") {
        // Sanitized ticket: title + status + description only
        const row = await adapter.queryOne<any>("SELECT * FROM nodes WHERE id = ?", [link.entity_id]);
        if (!row) return res.status(404).json({ error: "攻关单不存在" });
        const props = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties || {};
        title = props["标题"] || props["title"] || row.label || "";
        content = [
          `**状态**: ${props["状态"] || props["status"] || "未知"}`,
          props["描述"] || props["description"] ? `\n${props["描述"] || props["description"]}` : "",
        ].join("\n");
        extra = { status: props["状态"] || props["status"] };
      } else if (link.entity_type === "infoCard") {
        const row = await adapter.queryOne<any>("SELECT * FROM nodes WHERE id = ?", [link.entity_id]);
        if (!row) return res.status(404).json({ error: "公告不存在" });
        const props = typeof row.properties === "string" ? JSON.parse(row.properties) : row.properties || {};
        title = props["标题"] || props["title"] || row.label || "";
        content = props["内容"] || props["content"] || props["描述"] || props["description"] || "";
        extra = { category: props["分类"] || props["category"] };
      }

      // Record view
      const ip = req.headers["x-forwarded-for"]?.toString() || req.socket.remoteAddress;
      const user = actorOf(req) || undefined;
      await shareRepo.recordView(link.id, ip, user);

      res.json({
        entityType: link.entity_type,
        title,
        content,
        sharedBy: link.shared_by,
        sharedAt: link.created_at,
        expiresAt: link.expires_at,
        ...extra,
      });
    })
  );

  // GET /api/share — list sharing links for an entity
  router.get(
    "/share",
    asyncHandler(async (req, res) => {
      const entityType = req.query.entityType as string;
      const entityId = req.query.entityId as string;
      if (!entityType || !entityId) return res.status(400).json({ error: "entityType 和 entityId 必填" });

      const links = await shareRepo.listByEntity(entityType, entityId);
      // Mask passwords
      res.json(
        links.map((l) => ({
          ...l,
          password: l.password ? "******" : null,
        }))
      );
    })
  );

  // DELETE /api/share/:id — revoke a sharing link
  router.delete(
    "/share/:id",
    asyncHandler(async (req, res) => {
      const link = await shareRepo.getById(req.params.id);
      if (!link) return res.status(404).json({ error: "分享链接不存在" });

      const user = verifyAuth(req);
      const actor = (user as any)?.displayName || (user as any)?.username || "";
      const isAdmin = (user as any)?.role === "admin";
      if (link.shared_by !== actor && !isAdmin) return res.status(403).json({ error: "仅分享创建者或管理员可撤销" });

      await shareRepo.revoke(req.params.id, actor);
      writeAudit(adapter, {
        action: "share.revoke",
        entityType: link.entity_type,
        entityId: link.entity_id,
        changes: { token: link.token },
        actor,
      });
      res.json({ ok: true });
    })
  );

  // POST /api/wiki/:id/copy — copy wiki article to another ticket
  router.post(
    "/wiki/:id/copy",
    asyncHandler(async (req, res) => {
      const { targetScopeId, title } = req.body as { targetScopeId?: string; title?: string };
      if (!targetScopeId) return res.status(400).json({ error: "目标攻关单 ID 必填" });

      const actor = actorOf(req);
      if (!actor) return res.status(401).json({ error: "请先登录" });

      const source = await wikiRepo.getById(req.params.id);
      if (!source) return res.status(404).json({ error: "源文章不存在" });
      if (source.is_locked) return res.status(403).json({ error: "加锁文章不允许复制" });

      const copied = await wikiRepo.create({
        scope: "ticket",
        scopeId: targetScopeId,
        title: title || `副本: ${source.title}`,
        content: source.content,
        createdBy: actor,
      });

      writeAudit(adapter, {
        action: "wiki.copy",
        entityType: "wiki",
        entityId: source.id,
        changes: { targetScopeId, copyId: copied.id, copyTitle: copied.title },
        actor,
      });

      res.status(201).json({ ok: true, copyId: copied.id, title: copied.title });
    })
  );

  // P3: share stats — access trend for a given entity
  router.get(
    "/share/stats",
    asyncHandler(async (req, res) => {
      const entityType = req.query.entityType as string;
      const entityId = req.query.entityId as string;
      if (!entityType || !entityId) return res.status(400).json({ error: "entityType 和 entityId 必填" });
      const links = await shareRepo.listByEntity(entityType, entityId);
      const linkIds = links.map((l) => l.id);
      if (linkIds.length === 0) {
        res.json({ totalLinks: 0, totalViews: 0, dailyViews: [] });
        return;
      }
      const placeholders = linkIds.map(() => "?").join(",");
      const views = await adapter.query<{ viewed_at: string }>(
        `SELECT viewed_at FROM shared_link_views WHERE link_id IN (${placeholders}) ORDER BY viewed_at ASC`,
        linkIds
      );
      const totalViews = views.length;
      const dailyMap = new Map<string, number>();
      for (const v of views) {
        const day = v.viewed_at.slice(0, 10);
        dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
      }
      const dailyViews = Array.from(dailyMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
      res.json({ totalLinks: links.length, totalViews, dailyViews });
    })
  );

  return router;
}
