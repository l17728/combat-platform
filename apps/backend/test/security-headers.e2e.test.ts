import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
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

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-sec-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(CFG);
  return { app: createApp({ repo, registry, adapter, db, dbPath }) };
}

describe("helmet + CORS + rate-limit (P1)", () => {
  // 强制关闭 test bypass 才能验证 helmet/CORS headers
  const savedNoAuth = process.env.COMBAT_NO_AUTH;
  const savedNode = process.env.NODE_ENV;
  beforeAll(() => {
    delete process.env.COMBAT_NO_AUTH;
    process.env.NODE_ENV = "development";
  });
  afterAll(() => {
    if (savedNoAuth !== undefined) process.env.COMBAT_NO_AUTH = savedNoAuth;
    if (savedNode !== undefined) process.env.NODE_ENV = savedNode;
  });

  it("helmet 注入 X-Content-Type-Options nosniff", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("helmet 注入 X-Frame-Options/Referrer-Policy 等", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/health");
    // helmet 缺省给 SAMEORIGIN
    expect(r.headers["x-frame-options"]).toBeTruthy();
    expect(r.headers["referrer-policy"]).toBeTruthy();
  });

  it("CORS 开发期回显任意 Origin", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/health").set("Origin", "http://evil.example.com");
    expect(r.headers["access-control-allow-origin"]).toBe("http://evil.example.com");
  });

  it("OPTIONS 预检返回 204", async () => {
    const { app } = makeApp();
    const r = await request(app)
      .options("/api/nodes/attackTicket")
      .set("Origin", "http://x.com")
      .set("Access-Control-Request-Method", "GET");
    expect(r.status).toBe(204);
  });

  it("rate limit 放宽后 50 次连续请求不触发 429", async () => {
    const { app } = makeApp();
    const results = await Promise.all(Array.from({ length: 50 }, () => request(app).get("/api/health")));
    const rateLimited = results.filter((r) => r.status === 429);
    expect(rateLimited.length).toBe(0);
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});
