import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import type { DB } from "../src/db.js";

describe("Hermes session CRUD", () => {
  let db: DB;

  beforeAll(async () => {
    const app = await makeTestApp();
    db = app.dbPath ? (await import("../src/db.js")).openDb(app.dbPath) : ({} as DB);
    resetSessionCache();
  });

  it("creates a session", () => {
    const s = createSession(db, "user1", "测试对话");
    expect(s.id).toBeTruthy();
    expect(s.userId).toBe("user1");
    expect(s.title).toBe("测试对话");
  });

  it("gets a session by id", () => {
    const s = createSession(db, "user1");
    const found = getSession(db, s.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(s.id);
  });

  it("lists sessions for a user", () => {
    createSession(db, "user2", "A");
    createSession(db, "user2", "B");
    const list = listSessions(db, "user2");
    expect(list.length).toBeGreaterThanOrEqual(2);
    const titles = list.map((s) => s.title);
    expect(titles).toContain("A");
    expect(titles).toContain("B");
  });

  it("deletes a session", () => {
    const s = createSession(db, "user1");
    expect(deleteSession(db, s.id)).toBe(true);
    expect(getSession(db, s.id)).toBeUndefined();
  });

  it("appends and loads messages", () => {
    const s = createSession(db, "user1");
    appendMessage(db, s.id, "user", "你好");
    appendMessage(db, s.id, "assistant", "你好！有什么可以帮你的？", JSON.stringify([]));
    const msgs = loadRecentMessages(db, s.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("你好");
    expect(msgs[1].role).toBe("assistant");
  });

  it("loadRecentMessages respects limit", () => {
    const s = createSession(db, "user1");
    for (let i = 0; i < 10; i++) {
      appendMessage(db, s.id, "user", `msg ${i}`);
    }
    const msgs = loadRecentMessages(db, s.id, 4);
    expect(msgs.length).toBe(4);
    expect(msgs[0].content).toBe("msg 6");
    expect(msgs[3].content).toBe("msg 9");
  });

  it("updates session title", () => {
    const s = createSession(db, "user1");
    expect(updateSessionTitle(db, s.id, "新标题")).toBe(true);
    expect(getSession(db, s.id)!.title).toBe("新标题");
  });

  it("prunes expired sessions", () => {
    const s = createSession(db, "user1");
    db.prepare(`UPDATE hermes_sessions SET updatedAt = ? WHERE id = ?`).run("2020-01-01T00:00:00Z", s.id);
    const count = pruneExpiredSessions(db);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(getSession(db, s.id)).toBeUndefined();
  });
});

describe("Hermes session REST API", () => {
  let app: ReturnType<typeof import("../src/app.js").createApp>;
  let db: DB;

  beforeAll(async () => {
    const t = await makeTestApp();
    app = t.app;
    db = t.dbPath ? (await import("../src/db.js")).openDb(t.dbPath) : ({} as DB);
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
