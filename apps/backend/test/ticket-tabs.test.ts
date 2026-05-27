import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("ticket-tabs router", () => {
  let app: ReturnType<typeof makeTestApp>["app"];

  beforeEach(() => {
    ({ app } = makeTestApp());
  });

  it("GET /tickets/:id/tabs returns empty array", async () => {
    const res = await request(app).get("/api/tickets/t1/tabs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("POST /tickets/:id/tabs creates a link tab", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "相关贡献", config: { edgeType: "CONTRIBUTED_TO" } });
    expect(res.status).toBe(201);
    expect(res.body.tabType).toBe("link");
    expect(res.body.title).toBe("相关贡献");
    expect(res.body.tabOrder).toBe(0);
    expect(res.body.config).toBe('{"edgeType":"CONTRIBUTED_TO"}');
  });

  it("POST /tickets/:id/tabs creates a custom tab", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "会议笔记", content: "# 会议纪要\n..." });
    expect(res.status).toBe(201);
    expect(res.body.tabType).toBe("custom");
    expect(res.body.title).toBe("会议笔记");
    expect(res.body.content).toBe("# 会议纪要\n...");
  });

  it("POST rejects missing tabType", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ title: "no type" });
    expect(res.status).toBe(400);
  });

  it("POST rejects invalid tabType", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ tabType: "other", title: "bad type" });
    expect(res.status).toBe(400);
  });

  it("POST rejects missing title", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ tabType: "link" });
    expect(res.status).toBe(400);
  });

  it("POST rejects empty title", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "  " });
    expect(res.status).toBe(400);
  });

  it("auto-increments tab_order", async () => {
    await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "first" });
    await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "second" });
    const res = await request(app).get("/api/tickets/t1/tabs");
    expect(res.body).toHaveLength(2);
    expect(res.body[0].tabOrder).toBe(0);
    expect(res.body[1].tabOrder).toBe(1);
  });

  it("GET returns tabs sorted by tabOrder", async () => {
    await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "A" });
    await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "B" });
    const res = await request(app).get("/api/tickets/t1/tabs");
    expect(res.body.map((t: any) => t.title)).toEqual(["A", "B"]);
  });

  it("PATCH updates title", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "old" });
    const tabId = created.body.id;
    const res = await request(app)
      .patch(`/api/tickets/t1/tabs/${tabId}`)
      .send({ title: "new" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("new");
  });

  it("PATCH updates config", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "tab", config: { a: 1 } });
    const tabId = created.body.id;
    const res = await request(app)
      .patch(`/api/tickets/t1/tabs/${tabId}`)
      .send({ config: { b: 2 } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.config)).toEqual({ b: 2 });
  });

  it("PATCH updates content", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "tab" });
    const tabId = created.body.id;
    const res = await request(app)
      .patch(`/api/tickets/t1/tabs/${tabId}`)
      .send({ content: "# updated" });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("# updated");
  });

  it("PATCH returns 404 for non-existent tab", async () => {
    const res = await request(app)
      .patch("/api/tickets/t1/tabs/nonexistent")
      .send({ title: "x" });
    expect(res.status).toBe(404);
  });

  it("PATCH rejects no fields", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "tab" });
    const tabId = created.body.id;
    const res = await request(app)
      .patch(`/api/tickets/t1/tabs/${tabId}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("DELETE removes a tab", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "to delete" });
    const tabId = created.body.id;
    const del = await request(app).delete(`/api/tickets/t1/tabs/${tabId}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(tabId);

    const list = await request(app).get("/api/tickets/t1/tabs");
    expect(list.body).toHaveLength(0);
  });

  it("DELETE returns 404 for non-existent tab", async () => {
    const res = await request(app).delete("/api/tickets/t1/tabs/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PUT /tickets/:id/tabs/order reorders tabs", async () => {
    const a = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "A" });
    const b = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "B" });
    const idB = b.body.id;
    const idA = a.body.id;

    const res = await request(app)
      .put("/api/tickets/t1/tabs/order")
      .send({ order: [idB, idA] });
    expect(res.status).toBe(200);

    const list = await request(app).get("/api/tickets/t1/tabs");
    expect(list.body[0].id).toBe(idB);
    expect(list.body[1].id).toBe(idA);
  });

  it("PUT /order rejects non-array", async () => {
    const res = await request(app)
      .put("/api/tickets/t1/tabs/order")
      .send({ order: "not-array" });
    expect(res.status).toBe(400);
  });

  it("tabs are scoped to ticket — different tickets have independent tabs", async () => {
    await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "T1 only" });
    await request(app).post("/api/tickets/t2/tabs")
      .send({ tabType: "custom", title: "T2 only" });

    const t1 = await request(app).get("/api/tickets/t1/tabs");
    const t2 = await request(app).get("/api/tickets/t2/tabs");
    expect(t1.body).toHaveLength(1);
    expect(t1.body[0].title).toBe("T1 only");
    expect(t2.body).toHaveLength(1);
    expect(t2.body[0].title).toBe("T2 only");
  });

  it("POST sets createdBy (api when no auth)", async () => {
    const res = await request(app)
      .post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "creator test" });
    expect(res.status).toBe(201);
    expect(res.body.createdBy).toBe("api");
  });

  it("PATCH updates updatedAt timestamp", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "time test" });
    const tabId = created.body.id;
    const createdAt = created.body.updatedAt;
    await new Promise(r => setTimeout(r, 50));
    const res = await request(app)
      .patch(`/api/tickets/t1/tabs/${tabId}`)
      .send({ content: "updated" });
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).not.toBe(createdAt);
  });

  it("PATCH ignores empty title update", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "link", title: "original" });
    const tabId = created.body.id;
    const res = await request(app)
      .patch(`/api/tickets/t1/tabs/${tabId}`)
      .send({ title: "   ", content: "kept" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("original");
    expect(res.body.content).toBe("kept");
  });

  it("DELETE logs include title", async () => {
    const created = await request(app).post("/api/tickets/t1/tabs")
      .send({ tabType: "custom", title: "log test" });
    const tabId = created.body.id;
    const res = await request(app).delete(`/api/tickets/t1/tabs/${tabId}`);
    expect(res.status).toBe(200);
  });
});
