import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("op-log router", () => {
  let app: ReturnType<typeof makeTestApp>["app"];
  let origNoAuth: string | undefined;

  beforeEach(() => {
    ({ app } = makeTestApp());
    origNoAuth = process.env.COMBAT_NO_AUTH;
    process.env.COMBAT_NO_AUTH = "1";
  });

  afterEach(() => {
    if (origNoAuth === undefined) delete process.env.COMBAT_NO_AUTH;
    else process.env.COMBAT_NO_AUTH = origNoAuth;
  });

  it("GET /op-logs/settings returns default enabled=true", async () => {
    const res = await request(app).get("/api/op-logs/settings");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it("PUT /op-logs/settings toggles enabled", async () => {
    await request(app).put("/api/op-logs/settings").send({ enabled: false });
    const off = await request(app).get("/api/op-logs/settings");
    expect(off.body.enabled).toBe(false);

    await request(app).put("/api/op-logs/settings").send({ enabled: true });
    const on = await request(app).get("/api/op-logs/settings");
    expect(on.body.enabled).toBe(true);
  });

  it("PUT /op-logs/settings rejects non-boolean", async () => {
    const res = await request(app).put("/api/op-logs/settings").send({ enabled: "yes" });
    expect(res.status).toBe(400);
  });

  it("POST /op-logs batch inserts entries", async () => {
    const res = await request(app).post("/api/op-logs").send([
      { session_id: "s1", user_name: "u1", category: "api", detail: { method: "GET", path: "/test" } },
      { session_id: "s1", user_name: "u1", category: "navigate", detail: { from: "/", to: "/attack" } },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.ids).toHaveLength(2);
  });

  it("POST /op-logs rejects empty array", async () => {
    const res = await request(app).post("/api/op-logs").send([]);
    expect(res.status).toBe(400);
  });

  it("POST /op-logs rejects non-array", async () => {
    const res = await request(app).post("/api/op-logs").send({ foo: "bar" });
    expect(res.status).toBe(400);
  });

  it("POST /op-logs caps at 200 entries", async () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({
      session_id: "cap-test", user_name: "u", category: "action", detail: { i },
    }));
    const res = await request(app).post("/api/op-logs").send(entries);
    expect(res.body.inserted).toBe(200);
  });

  it("POST /op-logs returns disabled when tracking is off", async () => {
    await request(app).put("/api/op-logs/settings").send({ enabled: false });
    const res = await request(app).post("/api/op-logs").send([
      { session_id: "s", category: "action", detail: {} },
    ]);
    expect(res.body.inserted).toBe(0);
    expect(res.body.disabled).toBe(true);
  });

  it("GET /op-logs returns inserted entries", async () => {
    await request(app).post("/api/op-logs").send([
      { session_id: "list-test", user_name: "tester", category: "api", detail: { path: "/x" } },
    ]);
    const res = await request(app).get("/api/op-logs?sessionId=list-test");
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].session_id).toBe("list-test");
    expect(res.body.rows[0].user_name).toBe("tester");
    expect(res.body.rows[0].category).toBe("api");
  });

  it("GET /op-logs filters by userName", async () => {
    await request(app).post("/api/op-logs").send([
      { session_id: "filter-s", user_name: "alice", category: "action", detail: {} },
      { session_id: "filter-s", user_name: "bob", category: "action", detail: {} },
    ]);
    const res = await request(app).get("/api/op-logs?userName=alice&sessionId=filter-s");
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].user_name).toBe("alice");
  });

  it("GET /op-logs filters by category", async () => {
    await request(app).post("/api/op-logs").send([
      { session_id: "cat-s", user_name: "u", category: "api", detail: {} },
      { session_id: "cat-s", user_name: "u", category: "error", detail: {} },
    ]);
    const res = await request(app).get("/api/op-logs?category=error&sessionId=cat-s");
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].category).toBe("error");
  });

  it("DELETE /op-logs by sessionId", async () => {
    await request(app).post("/api/op-logs").send([
      { session_id: "del-s", user_name: "u", category: "action", detail: {} },
    ]);
    const res = await request(app).delete("/api/op-logs?sessionId=del-s");
    expect(res.body.deleted).toBe(1);

    const list = await request(app).get("/api/op-logs?sessionId=del-s");
    expect(list.body.total).toBe(0);
  });

  it("DELETE /op-logs by before timestamp", async () => {
    await request(app).post("/api/op-logs").send([
      { session_id: "old-s", user_name: "u", category: "action", detail: {}, timestamp: "2020-01-01T00:00:00Z" },
    ]);
    const res = await request(app).delete("/api/op-logs?before=2021-01-01T00:00:00Z");
    expect(res.body.deleted).toBeGreaterThanOrEqual(1);
  });

  it("DELETE /op-logs requires filter", async () => {
    const res = await request(app).delete("/api/op-logs");
    expect(res.status).toBe(400);
  });

  it("GET /op-logs paginates with limit/offset", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      session_id: "page-s", user_name: "u", category: "action", detail: { i },
    }));
    await request(app).post("/api/op-logs").send(entries);

    const page1 = await request(app).get("/api/op-logs?sessionId=page-s&limit=2&offset=0");
    expect(page1.body.rows).toHaveLength(2);

    const page2 = await request(app).get("/api/op-logs?sessionId=page-s&limit=2&offset=2");
    expect(page2.body.rows).toHaveLength(2);

    const page3 = await request(app).get("/api/op-logs?sessionId=page-s&limit=2&offset=4");
    expect(page3.body.rows).toHaveLength(1);
  });
});
