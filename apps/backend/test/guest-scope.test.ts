import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter, type DbAdapter } from "../src/db-adapter.js";
import { openDb } from "../src/db.js";

const REAL_SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

describe("guest scope", () => {
  let app: Express.Application;
  let guestToken: string;
  let adminToken: string;
  let adminNodeId: string;
  let guestNodeId: string;
  let guestUsername: string;

  beforeEach(() => {
    delete process.env.COMBAT_NO_AUTH;
    const dir = mkdtempSync(join(tmpdir(), "combat-guest-"));
    const db = openDb(join(dir, "t.sqlite"));
    const adapter: DbAdapter = new SqliteAdapter(db);
    const repo = new SqliteRepository(adapter);
    const registry = new FileSchemaRegistry(REAL_SCHEMAS_DIR);
    app = createApp({ repo, registry, adapter });
  });

  it("guest can create nodes", async () => {
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    adminToken = adminLogin.body.token;
    const guestRes = await request(app).post("/api/auth/guest");
    expect(guestRes.status).toBe(201);
    guestToken = guestRes.body.token;
    guestUsername = guestRes.body.user.username;

    const res = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客新建", 状态: "待响应", 事件级别: "P3" });
    expect(res.status).toBe(201);
  });

  it("guest can update own node but not other's", async () => {
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    adminToken = adminLogin.body.token;
    const guestRes = await request(app).post("/api/auth/guest");
    guestToken = guestRes.body.token;
    guestUsername = guestRes.body.user.username;

    const adminTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ 标题: "管理员的单子", 状态: "待响应", 事件级别: "P3" });
    adminNodeId = adminTicket.body.id;

    const guestTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客的单子", 状态: "待响应", 事件级别: "P3" });
    guestNodeId = guestTicket.body.id;

    const updateOwn = await request(app)
      .put(`/api/nodes/${guestNodeId}`)
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客修改自己的" });
    expect(updateOwn.status).toBe(200);

    const updateOther = await request(app)
      .put(`/api/nodes/${adminNodeId}`)
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "试图改别人的" });
    expect(updateOther.status).toBe(403);
  });

  it("guest can delete own node but not other's", async () => {
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    adminToken = adminLogin.body.token;
    const guestRes = await request(app).post("/api/auth/guest");
    guestToken = guestRes.body.token;

    const adminTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ 标题: "管理员的单子", 状态: "待响应", 事件级别: "P3" });
    adminNodeId = adminTicket.body.id;

    const guestTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客的单子", 状态: "待响应", 事件级别: "P3" });
    guestNodeId = guestTicket.body.id;

    const deleteOther = await request(app)
      .delete(`/api/nodes/${adminNodeId}`)
      .set("Authorization", `Bearer ${guestToken}`);
    expect(deleteOther.status).toBe(403);

    const deleteOwn = await request(app)
      .delete(`/api/nodes/${guestNodeId}`)
      .set("Authorization", `Bearer ${guestToken}`);
    expect(deleteOwn.status).toBe(200);
  });

  it("guest can transition own but not other's", async () => {
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    adminToken = adminLogin.body.token;
    const guestRes = await request(app).post("/api/auth/guest");
    guestToken = guestRes.body.token;

    const adminTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ 标题: "管理员的单子", 状态: "待响应", 事件级别: "P3" });
    adminNodeId = adminTicket.body.id;

    const guestTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客的单子", 状态: "待响应", 事件级别: "P3" });
    guestNodeId = guestTicket.body.id;

    const transOther = await request(app)
      .post(`/api/nodes/${adminNodeId}/transition`)
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ toStatus: "处理中" });
    expect(transOther.status).toBe(403);

    const transOwn = await request(app)
      .post(`/api/nodes/${guestNodeId}/transition`)
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ toStatus: "处理中" });
    expect(transOwn.status).toBe(200);
  });

  it("guest can append progress to own but not other's", async () => {
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    adminToken = adminLogin.body.token;
    const guestRes = await request(app).post("/api/auth/guest");
    guestToken = guestRes.body.token;

    const adminTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ 标题: "管理员的单子", 状态: "待响应", 事件级别: "P3" });
    adminNodeId = adminTicket.body.id;

    const guestTicket = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客的单子", 状态: "待响应", 事件级别: "P3" });
    guestNodeId = guestTicket.body.id;

    const progOther = await request(app)
      .post(`/api/nodes/${adminNodeId}/progress`)
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ content: "试图追加" });
    expect(progOther.status).toBe(403);

    const progOwn = await request(app)
      .post(`/api/nodes/${guestNodeId}/progress`)
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ content: "游客追加进展" });
    expect(progOwn.status).toBe(201);
  });

  it("guest can read any node and list nodes", async () => {
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    adminToken = adminLogin.body.token;
    const guestRes = await request(app).post("/api/auth/guest");
    guestToken = guestRes.body.token;

    await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ 标题: "管理员的单子", 状态: "待响应", 事件级别: "P3" });

    await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({ 标题: "游客的单子", 状态: "待响应", 事件级别: "P3" });

    const list = await request(app).get("/api/nodes/attackTicket").set("Authorization", `Bearer ${guestToken}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(2);

    const single = await request(app).get(`/api/nodes/${list.body[0].id}`).set("Authorization", `Bearer ${guestToken}`);
    expect(single.status).toBe(200);
  });
});
