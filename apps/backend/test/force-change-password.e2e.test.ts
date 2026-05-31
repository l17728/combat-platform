import { describe, it, expect, beforeEach, afterAll } from "vitest";
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
  const dir = mkdtempSync(join(tmpdir(), "combat-pwchg-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(CFG);
  return { app: createApp({ repo, registry, adapter, db, dbPath }) };
}

describe("默认密强制首登改密 (P1)", () => {
  const savedNoAuth = process.env.COMBAT_NO_AUTH;
  beforeEach(() => {
    delete process.env.COMBAT_NO_AUTH;
  });
  afterAll(() => {
    if (savedNoAuth !== undefined) process.env.COMBAT_NO_AUTH = savedNoAuth;
  });

  it("admin/admin123 login → passwordMustChange=true", async () => {
    const { app } = makeApp();
    // 等默认 admin seed 完成
    await new Promise((r) => setTimeout(r, 60));
    const r = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    expect(r.status).toBe(200);
    expect(r.body.passwordMustChange).toBe(true);
    expect(r.body.token).toBeTruthy();
  });

  it("改密后 login → passwordMustChange=false", async () => {
    const { app } = makeApp();
    await new Promise((r) => setTimeout(r, 60));
    const login1 = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    expect(login1.body.passwordMustChange).toBe(true);
    const token = login1.body.token;
    const chg = await request(app)
      .put("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: "admin123", newPassword: "new-strong-pwd-2026" });
    expect(chg.status).toBe(200);
    const login2 = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "new-strong-pwd-2026" });
    expect(login2.status).toBe(200);
    expect(login2.body.passwordMustChange).toBe(false);
  });

  it("/auth/me 也持续报 mustChange,直到改密完成", async () => {
    const { app } = makeApp();
    await new Promise((r) => setTimeout(r, 60));
    const login = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.passwordMustChange).toBe(true);
  });
});
