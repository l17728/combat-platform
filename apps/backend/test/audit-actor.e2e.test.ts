import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";
function tokenFor(username: string, role = "admin"): string {
  return jwt.sign({ userId: "u-" + username, username, role }, SECRET, { expiresIn: "1h" });
}

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-actor-"));
  const cfg = join(dir, "schemas");
  mkdirSync(cfg);
  writeFileSync(
    join(cfg, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        { name: "状态", type: "enum", label: "状态", enumValues: ["进行中", "已解决"] },
        { name: "创建人", type: "string", label: "创建人" },
      ],
    })
  );
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(cfg);
  return { app: createApp({ repo, registry, adapter, db, dbPath }), repo };
}

describe("audit actor 强制取自 req.user 防伪造 (P1)", () => {
  const savedNoAuth = process.env.COMBAT_NO_AUTH;
  const savedNode = process.env.NODE_ENV;
  beforeAll(() => {
    delete process.env.COMBAT_NO_AUTH;
    // 写请求需要 NODE_ENV != test 才能让 CSRF 真校验,这里我们关注 actor,所以保留 test bypass
    process.env.NODE_ENV = "test";
  });
  afterAll(() => {
    if (savedNoAuth !== undefined) process.env.COMBAT_NO_AUTH = savedNoAuth;
    if (savedNode !== undefined) process.env.NODE_ENV = savedNode;
  });

  it("alice 创建节点 → audit_log.performedBy === 'alice'", async () => {
    const { app, repo } = makeApp();
    const r = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", "Bearer " + tokenFor("alice"))
      .send({ 标题: "A", 状态: "进行中" });
    expect(r.status).toBe(201);
    const audit = await repo.listAuditLog({ entityId: r.body.id, limit: 10 });
    expect(audit.length).toBeGreaterThan(0);
    const create = audit.find((a) => a.action === "CREATE");
    expect(create?.performedBy).toBe("alice");
  });

  it("alice 更新 → performedBy === 'alice' (即使 body 里写 actor=hacker 也无效)", async () => {
    const { app, repo } = makeApp();
    const c = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", "Bearer " + tokenFor("alice"))
      .send({ 标题: "A", 状态: "进行中" });
    const u = await request(app)
      .put(`/api/nodes/${c.body.id}`)
      .set("Authorization", "Bearer " + tokenFor("alice"))
      .send({ 状态: "已解决", actor: "hacker" }); // body.actor 不再被信任
    expect(u.status).toBe(200);
    const audit = await repo.listAuditLog({ entityId: c.body.id, limit: 10 });
    const update = audit.find((a) => a.action === "UPDATE");
    expect(update?.performedBy).toBe("alice");
    expect(update?.performedBy).not.toBe("hacker");
  });

  it("PROGRESS body.actor='hacker' 被忽略 → performedBy 仍取自 req.user", async () => {
    const { app, repo } = makeApp();
    const c = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", "Bearer " + tokenFor("carol"))
      .send({ 标题: "C", 状态: "进行中" });
    const p = await request(app)
      .post(`/api/nodes/${c.body.id}/progress`)
      .set("Authorization", "Bearer " + tokenFor("carol"))
      .send({ content: "test", actor: "hacker" });
    expect(p.status).toBe(201);
    // progress 表通过 listProgress 验证 updatedBy
    const all = await repo.listProgress(c.body.id);
    expect(all[0].updatedBy).toBe("carol");
    expect(all[0].updatedBy).not.toBe("hacker");
  });

  it("bob 的 transition → performedBy=bob (无法伪造为别人)", async () => {
    const { app, repo } = makeApp();
    const c = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", "Bearer " + tokenFor("bob"))
      .send({ 标题: "B", 状态: "进行中" });
    const t = await request(app)
      .post(`/api/nodes/${c.body.id}/transition`)
      .set("Authorization", "Bearer " + tokenFor("bob"))
      .send({ toStatus: "已解决" });
    expect(t.status).toBe(200);
    const audit = await repo.listAuditLog({ entityId: c.body.id, limit: 20 });
    // 最后一次 UPDATE 是 transition 触发的
    const updates = audit.filter((a) => a.action === "UPDATE");
    expect(updates[0]?.performedBy).toBe("bob");
  });
});
