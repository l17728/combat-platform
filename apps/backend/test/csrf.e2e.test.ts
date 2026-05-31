import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
const SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";
const TOKEN =
  "Bearer " + jwt.sign({ userId: "u-admin", username: "admin", role: "admin" }, SECRET, { expiresIn: "1h" });

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-csrf-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(CFG);
  return { app: createApp({ repo, registry, adapter, db, dbPath }) };
}

describe("CSRF 同源 Referer 校验 (P1)", () => {
  // CSRF 检查在 NODE_ENV=test 时 bypass → 测试里必须临时切到 development
  const savedNode = process.env.NODE_ENV;
  const savedNoAuth = process.env.COMBAT_NO_AUTH;
  beforeAll(() => {
    delete process.env.COMBAT_NO_AUTH;
    process.env.NODE_ENV = "development";
  });
  afterAll(() => {
    if (savedNode !== undefined) process.env.NODE_ENV = savedNode;
    if (savedNoAuth !== undefined) process.env.COMBAT_NO_AUTH = savedNoAuth;
  });

  it("已登录写请求 + 跨站 Origin → 403", async () => {
    const { app } = makeApp();
    const r = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", TOKEN)
      .set("Origin", "http://evil.example.com")
      .send({ 标题: "x", 状态: "进行中" });
    expect(r.status).toBe(403);
    expect(r.body.error).toContain("CSRF");
  });

  it("已登录写请求 + 同源 Origin → 通过 (不被 CSRF 拦)", async () => {
    const { app } = makeApp();
    const r = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", TOKEN)
      .set("Host", "127.0.0.1:3001")
      .set("Origin", "http://127.0.0.1:3001")
      .send({ 标题: "x", 状态: "进行中" });
    // 401 (auth) 或 201 (创建成功) 都说明没被 CSRF 拦
    expect(r.status).not.toBe(403);
  });

  it("GET 请求不校验 CSRF (即使带跨站 Origin)", async () => {
    const { app } = makeApp();
    const r = await request(app)
      .get("/api/nodes/attackTicket")
      .set("Authorization", TOKEN)
      .set("Origin", "http://evil.com");
    expect(r.status).not.toBe(403);
  });

  it("写请求无 Authorization → 不校验 CSRF (CLI/匿名 bug 上报路径)", async () => {
    const { app } = makeApp();
    const r = await request(app)
      .post("/api/bug-reports")
      .set("Origin", "http://evil.com")
      .send({ title: "x", description: "y" });
    expect(r.status).not.toBe(403);
  });

  it("Referer 同源也可放行 (Safari 默认不发 Origin)", async () => {
    const { app } = makeApp();
    const r = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", TOKEN)
      .set("Host", "combat.example.com")
      .set("Referer", "http://combat.example.com/attack")
      .send({ 标题: "x", 状态: "进行中" });
    expect(r.status).not.toBe(403);
  });
});
