import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";
import { ensureShareTable } from "../src/share.js";
import { ensureWikiTable } from "../src/wiki.js";

describe("share router", () => {
  let app: ReturnType<typeof makeTestApp>["app"];
  let adapter: ReturnType<typeof makeTestApp>["adapter"];

  beforeEach(async () => {
    const ctx = await makeTestApp();
    app = ctx.app;
    adapter = ctx.adapter;
    await ensureShareTable(adapter);
    await ensureWikiTable(adapter);
  });

  describe("POST /api/share — create sharing link", () => {
    it("creates a share link for a ticket", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "分享测试单", 状态: "待响应" });
      expect(ticket.status).toBe(201);

      const res = await request(app).post("/api/share").send({
        entityType: "ticket",
        entityId: ticket.body.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
      expect(res.body.url).toContain("/s/");
      expect(res.body.id).toBeTruthy();
    });

    it("creates a share link for a wiki article", async () => {
      const article = await request(app)
        .post("/api/wiki")
        .send({ scope: "global", title: "可分享文章", content: "# Hello" });
      expect(article.status).toBe(201);

      const res = await request(app).post("/api/share").send({
        entityType: "wiki",
        entityId: article.body.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
    });

    it("rejects missing entityType or entityId", async () => {
      const res = await request(app).post("/api/share").send({ entityType: "ticket" });
      expect(res.status).toBe(400);
    });

    it("rejects unsupported entity type", async () => {
      const res = await request(app).post("/api/share").send({ entityType: "unknown", entityId: "abc" });
      expect(res.status).toBe(400);
    });

    it("rejects sharing a locked wiki article", async () => {
      const article = await request(app)
        .post("/api/wiki")
        .send({ scope: "global", title: "加锁文章", content: "# Secret" });
      expect(article.status).toBe(201);

      await adapter.run("UPDATE wiki_articles SET is_locked = 1 WHERE id = ?", [article.body.id]);

      const res = await request(app).post("/api/share").send({
        entityType: "wiki",
        entityId: article.body.id,
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("加锁");
    });

    it("creates a share link with password and expiration", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "密码分享", 状态: "待响应" });

      const res = await request(app).post("/api/share").send({
        entityType: "ticket",
        entityId: ticket.body.id,
        password: "mypass123",
        expiresIn: 3600,
      });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
    });
  });

  describe("GET /api/s/:token — public share access", () => {
    it("returns shared ticket content", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "公开分享单", 状态: "处理中" });

      const share = await request(app).post("/api/share").send({
        entityType: "ticket",
        entityId: ticket.body.id,
      });

      const res = await request(app).get(`/api/s/${share.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.entityType).toBe("ticket");
      expect(res.body.title).toBe("公开分享单");
    });

    it("returns shared wiki content", async () => {
      const article = await request(app)
        .post("/api/wiki")
        .send({ scope: "global", title: "公开文章", content: "# 公开内容" });

      const share = await request(app).post("/api/share").send({
        entityType: "wiki",
        entityId: article.body.id,
      });

      const res = await request(app).get(`/api/s/${share.body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("公开文章");
      expect(res.body.content).toBe("# 公开内容");
    });

    it("returns 404 for nonexistent token", async () => {
      const res = await request(app).get("/api/s/nonexistent-token");
      expect(res.status).toBe(404);
    });

    it("requires password for password-protected links", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "密码保护", 状态: "待响应" });

      const share = await request(app).post("/api/share").send({
        entityType: "ticket",
        entityId: ticket.body.id,
        password: "secret",
      });

      const noPass = await request(app).get(`/api/s/${share.body.token}`);
      expect(noPass.status).toBe(403);
      expect(noPass.body.requiresPassword).toBe(true);

      const wrongPass = await request(app).get(`/api/s/${share.body.token}?password=wrong`);
      expect(wrongPass.status).toBe(403);

      const correctPass = await request(app).get(`/api/s/${share.body.token}?password=secret`);
      expect(correctPass.status).toBe(200);
    });
  });

  describe("GET /api/share — list sharing links", () => {
    it("lists links for an entity", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "列表测试", 状态: "待响应" });

      await request(app).post("/api/share").send({ entityType: "ticket", entityId: ticket.body.id });
      await request(app).post("/api/share").send({ entityType: "ticket", entityId: ticket.body.id });

      const res = await request(app).get(`/api/share?entityType=ticket&entityId=${ticket.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("masks passwords in list", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "密码遮蔽", 状态: "待响应" });

      await request(app)
        .post("/api/share")
        .send({ entityType: "ticket", entityId: ticket.body.id, password: "hidden" });

      const res = await request(app).get(`/api/share?entityType=ticket&entityId=${ticket.body.id}`);
      expect(res.body[0].password).toBe("******");
    });

    it("rejects missing params", async () => {
      const res = await request(app).get("/api/share?entityType=ticket");
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/share/:id — revoke sharing link", () => {
    it("revokes a sharing link", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "撤销测试", 状态: "待响应" });

      const share = await request(app).post("/api/share").send({ entityType: "ticket", entityId: ticket.body.id });

      const res = await request(app).delete(`/api/share/${share.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("returns 404 for nonexistent share", async () => {
      const res = await request(app).delete("/api/share/nonexistent-id");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/share/stats — share statistics", () => {
    it("returns empty stats for entity with no shares", async () => {
      const res = await request(app).get("/api/share/stats?entityType=ticket&entityId=nonexistent");
      expect(res.status).toBe(200);
      expect(res.body.totalLinks).toBe(0);
      expect(res.body.totalViews).toBe(0);
    });

    it("tracks views and returns stats", async () => {
      const ticket = await request(app).post("/api/nodes/attackTicket").send({ 标题: "统计测试", 状态: "待响应" });

      const share = await request(app).post("/api/share").send({ entityType: "ticket", entityId: ticket.body.id });

      await request(app).get(`/api/s/${share.body.token}`);
      await request(app).get(`/api/s/${share.body.token}`);

      const res = await request(app).get(`/api/share/stats?entityType=ticket&entityId=${ticket.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.totalLinks).toBe(1);
      expect(res.body.totalViews).toBe(2);
      expect(res.body.dailyViews.length).toBeGreaterThanOrEqual(1);
    });
  });
});
