import { describe, it, expect, beforeAll } from "vitest";
import { makeTestApp } from "./helpers.js";
import request from "supertest";
import {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  appendMessage,
  loadRecentMessages,
  updateSessionTitle,
  pruneExpiredSessions,
  resetSessionCache,
} from "../src/hermes-sessions.js";
import type { DbAdapter } from "../src/db-adapter.js";

describe("Hermes session CRUD", () => {
  let adapter: DbAdapter;

  beforeAll(async () => {
    const app = await makeTestApp();
    adapter = app.adapter;
    resetSessionCache();
  });

  it("creates a session", async () => {
    const s = await createSession(adapter, "user1", "测试对话");
    expect(s.id).toBeTruthy();
    expect(s.userId).toBe("user1");
    expect(s.title).toBe("测试对话");
  });

  it("gets a session by id", async () => {
    const s = await createSession(adapter, "user1");
    const found = await getSession(adapter, s.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(s.id);
  });

  it("lists sessions for a user", async () => {
    await createSession(adapter, "user2", "A");
    await createSession(adapter, "user2", "B");
    const list = await listSessions(adapter, "user2");
    expect(list.length).toBeGreaterThanOrEqual(2);
    const titles = list.map((s) => s.title);
    expect(titles).toContain("A");
    expect(titles).toContain("B");
  });

  it("deletes a session", async () => {
    const s = await createSession(adapter, "user1");
    expect(await deleteSession(adapter, s.id)).toBe(true);
    expect(await getSession(adapter, s.id)).toBeUndefined();
  });

  it("appends and loads messages", async () => {
    const s = await createSession(adapter, "user1");
    await appendMessage(adapter, s.id, "user", "你好");
    await appendMessage(adapter, s.id, "assistant", "你好！有什么可以帮你的？", JSON.stringify([]));
    const msgs = await loadRecentMessages(adapter, s.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("你好");
    expect(msgs[1].role).toBe("assistant");
  });

  it("loadRecentMessages respects limit", async () => {
    const s = await createSession(adapter, "user1");
    for (let i = 0; i < 10; i++) {
      await appendMessage(adapter, s.id, "user", `msg ${i}`);
    }
    const msgs = await loadRecentMessages(adapter, s.id, 4);
    expect(msgs.length).toBe(4);
    expect(msgs[0].content).toBe("msg 6");
    expect(msgs[3].content).toBe("msg 9");
  });

  it("updates session title", async () => {
    const s = await createSession(adapter, "user1");
    expect(await updateSessionTitle(adapter, s.id, "新标题")).toBe(true);
    const found = await getSession(adapter, s.id);
    expect(found!.title).toBe("新标题");
  });

  it("prunes expired sessions", async () => {
    const s = await createSession(adapter, "user1");
    await adapter.run(`UPDATE hermes_sessions SET updatedAt = ? WHERE id = ?`, ["2020-01-01T00:00:00Z", s.id]);
    const count = await pruneExpiredSessions(adapter);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await getSession(adapter, s.id)).toBeUndefined();
  });
});

describe("Hermes session REST API", () => {
  let app: ReturnType<typeof import("../src/app.js").createApp>;

  beforeAll(async () => {
    const t = await makeTestApp();
    app = t.app;
    resetSessionCache();
  });

  it("POST /api/hermes/sessions creates a session", async () => {
    const res = await request(app).post("/api/hermes/sessions").send({ title: "REST测试" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe("REST测试");
  });

  it("GET /api/hermes/sessions lists sessions", async () => {
    const res = await request(app).get("/api/hermes/sessions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/hermes/sessions/:id returns session with messages", async () => {
    const createRes = await request(app).post("/api/hermes/sessions").send({ title: "详细" });
    const id = createRes.body.id;
    const res = await request(app).get(`/api/hermes/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it("DELETE /api/hermes/sessions/:id deletes a session", async () => {
    const createRes = await request(app).post("/api/hermes/sessions").send({});
    const id = createRes.body.id;
    const res = await request(app).delete(`/api/hermes/sessions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PATCH /api/hermes/sessions/:id updates title", async () => {
    const createRes = await request(app).post("/api/hermes/sessions").send({});
    const id = createRes.body.id;
    const res = await request(app).patch(`/api/hermes/sessions/${id}`).send({ title: "改名" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
