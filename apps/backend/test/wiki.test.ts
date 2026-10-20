import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";
import { ensureWikiTable } from "../src/wiki.js";

describe("wiki router", () => {
  let app: ReturnType<typeof makeTestApp>["app"];
  let adapter: ReturnType<typeof makeTestApp>["adapter"];

  beforeEach(async () => {
    const ctx = await makeTestApp();
    app = ctx.app;
    adapter = ctx.adapter;
    await ensureWikiTable(adapter);
  });

  it("GET /api/wiki returns empty array", async () => {
    const res = await request(app).get("/api/wiki?scope=global");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("POST /api/wiki creates an article", async () => {
    const res = await request(app).post("/api/wiki").send({ scope: "global", title: "测试文章", content: "# Hello" });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("测试文章");
    expect(res.body.content).toBe("# Hello");
    expect(res.body.scope).toBe("global");
    expect(res.body.id).toBeTruthy();
  });

  it("POST /api/wiki rejects missing title", async () => {
    const res = await request(app).post("/api/wiki").send({ scope: "global", content: "no title" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("标题");
  });

  it("POST /api/wiki with ticket scope and scopeId", async () => {
    const res = await request(app)
      .post("/api/wiki")
      .send({ scope: "ticket", scopeId: "ticket-123", title: "攻关单知识库" });
    expect(res.status).toBe(201);
    expect(res.body.scope).toBe("ticket");
    expect(res.body.scope_id).toBe("ticket-123");
  });

  it("GET /api/wiki/:id returns article", async () => {
    const created = await request(app).post("/api/wiki").send({ scope: "global", title: "详情测试" });
    const id = created.body.id;

    const res = await request(app).get(`/api/wiki/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("详情测试");
  });

  it("GET /api/wiki/:id returns 404 for non-existent", async () => {
    const res = await request(app).get("/api/wiki/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("PUT /api/wiki/:id updates title and content", async () => {
    const created = await request(app).post("/api/wiki").send({ scope: "global", title: "旧标题" });
    const id = created.body.id;

    const res = await request(app).put(`/api/wiki/${id}`).send({ title: "新标题", content: "更新内容" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("新标题");
    expect(res.body.content).toBe("更新内容");
  });

  it("PUT /api/wiki/:id returns 404 for non-existent", async () => {
    const res = await request(app).put("/api/wiki/nonexistent-id").send({ title: "x" });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/wiki/:id removes article", async () => {
    const created = await request(app).post("/api/wiki").send({ scope: "global", title: "待删除" });
    const id = created.body.id;

    const del = await request(app).delete(`/api/wiki/${id}`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/wiki/${id}`);
    expect(get.status).toBe(404);
  });

  it("DELETE /api/wiki/:id returns 404 for non-existent", async () => {
    const res = await request(app).delete("/api/wiki/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("GET /api/wiki with keyword searches title and content", async () => {
    await request(app).post("/api/wiki").send({ scope: "global", title: "Alpha文章", content: "xyz" });
    await request(app).post("/api/wiki").send({ scope: "global", title: "Beta文章", content: "alpha content" });

    const res = await request(app).get("/api/wiki?scope=global&keyword=alpha");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("GET /api/wiki scopes by ticket scopeId", async () => {
    await request(app).post("/api/wiki").send({ scope: "ticket", scopeId: "t1", title: "T1文章" });
    await request(app).post("/api/wiki").send({ scope: "ticket", scopeId: "t2", title: "T2文章" });

    const res = await request(app).get("/api/wiki?scope=ticket&scopeId=t1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("T1文章");
  });

  it("POST /api/wiki/reorder changes sort order", async () => {
    const a = await request(app).post("/api/wiki").send({ scope: "global", title: "A" });
    const b = await request(app).post("/api/wiki").send({ scope: "global", title: "B" });
    const idB = b.body.id;
    const idA = a.body.id;

    const res = await request(app)
      .post("/api/wiki/reorder")
      .send({ ids: [idB, idA] });
    expect(res.status).toBe(200);

    const list = await request(app).get("/api/wiki?scope=global");
    expect(list.body[0].id).toBe(idB);
    expect(list.body[1].id).toBe(idA);
  });

  it("POST /api/wiki/reorder rejects non-array", async () => {
    const res = await request(app).post("/api/wiki/reorder").send({ ids: "not-array" });
    expect(res.status).toBe(400);
  });

  it("auto-increments sort_order", async () => {
    await request(app).post("/api/wiki").send({ scope: "global", title: "First" });
    await request(app).post("/api/wiki").send({ scope: "global", title: "Second" });
    const list = await request(app).get("/api/wiki?scope=global");
    expect(list.body[0].sort_order).toBe(0);
    expect(list.body[1].sort_order).toBe(1);
  });

  it("created_by is populated", async () => {
    const res = await request(app).post("/api/wiki").send({ scope: "global", title: "Author test" });
    expect(res.status).toBe(201);
    expect(typeof res.body.created_by).toBe("string");
  });
});
