import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "../src/db-adapter.js";
import { makeDbMigrationRouter } from "../src/db-migration.js";
import { makeTestApp, isPgTest } from "./helpers.js";

// ---------------------------------------------------------------------------
// Use the standard await makeTestApp() for happy paths (COMBAT_NO_AUTH=1 → guard
// allows because req.user is undefined). For the 403 admin-only branch we
// build a tiny express app that injects req.user.role = 'normal' BEFORE the
// router.
// ---------------------------------------------------------------------------

function makeMiniAppWithRole(role: string, sqlitePath: string) {
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT);
    CREATE TABLE IF NOT EXISTS nodes (id TEXT);
    CREATE TABLE IF NOT EXISTS edges (id TEXT);
    CREATE TABLE IF NOT EXISTS progress_log (id TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT);
    CREATE TABLE IF NOT EXISTS proposals (id TEXT);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT);
    CREATE TABLE IF NOT EXISTS daily_report_entry (id TEXT);
    CREATE TABLE IF NOT EXISTS support_template (id TEXT);
    CREATE TABLE IF NOT EXISTS support_node (id TEXT);
    CREATE TABLE IF NOT EXISTS ticket_tabs (id TEXT);
  `);
  const adapter = new SqliteAdapter(db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { role };
    next();
  });
  app.use("/api", makeDbMigrationRouter(adapter, sqlitePath));
  return app;
}

describe("db-migration router", () => {
  describe("GET /api/db-migration/status", () => {
    it("returns kind=adapter dialect + tables array + lastMigratedAt=null", async () => {
      const { app } = await makeTestApp();
      const res = await request(app).get("/api/db-migration/status");
      expect(res.status).toBe(200);
      // /status returns the kind parsed from process.env.DB_URL. In tests we
      // don't set DB_URL, so the route falls back to sqlite://<empty> →
      // kind='sqlite'. We accept both for forward compat.
      expect(["sqlite", "postgres"]).toContain(res.body.kind);
      expect(Array.isArray(res.body.tables)).toBe(true);
      // standard tables list from db-migration.ts
      const names = res.body.tables.map((t: any) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "users", "app_settings", "nodes", "edges", "progress_log",
          "audit_log", "proposals", "notifications",
        ]),
      );
      // every entry has numeric rows
      for (const t of res.body.tables) {
        expect(typeof t.rows).toBe("number");
        expect(t.rows).toBeGreaterThanOrEqual(0);
      }
      expect(res.body.lastMigratedAt).toBeNull();
    });
  });

  describe("POST /api/db-migration/test-connection", () => {
    it("returns 400 when pgUrl is missing", async () => {
      const { app } = await makeTestApp();
      const res = await request(app).post("/api/db-migration/test-connection").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/postgres/i);
    });

    it("returns 400 when pgUrl has invalid scheme", async () => {
      const { app } = await makeTestApp();
      const res = await request(app)
        .post("/api/db-migration/test-connection")
        .send({ pgUrl: "mysql://foo:bar@host/db" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/postgres/i);
    });

    it("returns ok:false with error for an unreachable postgres URL", async () => {
      const { app } = await makeTestApp();
      // 127.0.0.1:1 will refuse immediately; combined with 5s timeout from the
      // route, this resolves quickly.
      const res = await request(app)
        .post("/api/db-migration/test-connection")
        .send({ pgUrl: "postgres://x:y@127.0.0.1:1/db" });
      // backend returns 400 with ok:false on connection failure
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe("POST /api/db-migration/run", () => {
    it("returns 400 when pgUrl is missing", async () => {
      const { app } = await makeTestApp();
      const res = await request(app).post("/api/db-migration/run").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/pgUrl/i);
    });
  });

  describe("admin-only guard", () => {
    it("returns 403 when req.user.role is not 'admin'", async () => {
      const dir = mkdtempSync(join(tmpdir(), "combat-mig-"));
      const sqlitePath = join(dir, "t.sqlite");
      const app = makeMiniAppWithRole("normal", sqlitePath);
      const res = await request(app).get("/api/db-migration/status");
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/管理员|admin/i);
    });

    it("allows access when req.user.role === 'admin'", async () => {
      const dir = mkdtempSync(join(tmpdir(), "combat-mig-"));
      const sqlitePath = join(dir, "t.sqlite");
      const app = makeMiniAppWithRole("admin", sqlitePath);
      const res = await request(app).get("/api/db-migration/status");
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe("sqlite");
    });

    it("allows access when req.user is missing entirely (NO_AUTH/CLI mode)", async () => {
      // makeTestApp uses COMBAT_NO_AUTH=1 → req.user is undefined → guard allows
      const { app } = await makeTestApp();
      const res = await request(app).get("/api/db-migration/status");
      expect(res.status).toBe(200);
      // smoke-check we got a real status payload, regardless of adapter
      expect(typeof res.body.kind).toBe("string");
      void isPgTest; // referenced to keep import warning-free
    });
  });
});
