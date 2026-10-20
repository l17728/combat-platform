import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { makeTestApp, makeRealSchemaTestApp } from "./helpers.js";
import { makePlatformRouter } from "../src/platform-router.js";
import { makeGuestAccessRouter, ensureTenantsTable } from "../src/tenant-middleware.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";

function makeToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

function buildSaaSApp(adapter: ReturnType<typeof makeTestApp>["adapter"]) {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res: any, next: any) => {
    const auth = req.headers["authorization"] as string | undefined;
    if (auth?.startsWith("Bearer ")) {
      try {
        req.user = jwt.verify(auth.slice(7), JWT_SECRET);
        return next();
      } catch {}
    }
    if (process.env.COMBAT_NO_AUTH === "1") {
      req.user = { userId: "no-auth", username: "admin", role: "admin", tenantId: "default" };
      return next();
    }
    next();
  });

  app.use("/api", makeGuestAccessRouter(adapter));
  app.use("/api", makePlatformRouter(adapter));
  return app;
}

describe("guest access endpoint", () => {
  let app: ReturnType<typeof makeTestApp>["app"];
  let adapter: ReturnType<typeof makeTestApp>["adapter"];

  beforeEach(async () => {
    const ctx = await makeTestApp();
    app = ctx.app;
    adapter = ctx.adapter;
  });

  it("POST /api/platform/guest-access returns token and username", async () => {
    const res = await request(app).post("/api/platform/guest-access");
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.username).toMatch(/^guest_/);
  });

  it("guest token can access /api/nodes", async () => {
    const guest = await request(app).post("/api/platform/guest-access");
    const res = await request(app).get("/api/nodes/attackTicket").set("Authorization", `Bearer ${guest.body.token}`);
    expect(res.status).toBe(200);
  });

  it("guest token can access /api/dashboard", async () => {
    const guest = await request(app).post("/api/platform/guest-access");
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${guest.body.token}`);
    expect(res.status).toBe(200);
  });
});

describe("superAdmin middleware isolation", () => {
  let app: express.Express;
  let adapter: ReturnType<typeof makeTestApp>["adapter"];

  beforeEach(async () => {
    const ctx = await makeTestApp();
    adapter = ctx.adapter;
    await ensureTenantsTable(adapter);
    delete process.env.COMBAT_NO_AUTH;
    app = buildSaaSApp(adapter);
  });

  afterEach(() => {
    process.env.COMBAT_NO_AUTH = "1";
  });

  it("normal user token can list nodes (superAdmin middleware must not leak)", async () => {
    const normalToken = makeToken({
      userId: "test-user",
      username: "normaluser",
      role: "normal",
      tenantId: "test",
    });

    // This should NOT be intercepted by superAdminMiddleware
    // because we mount platformRouter on /api and it only guards /platform paths
    const res = await request(app).get("/api/nodes/attackTicket").set("Authorization", `Bearer ${normalToken}`);
    // Will be 200 or 404 (no routes mounted for /api/nodes in this test app)
    // but must NOT be 403
    expect(res.status).not.toBe(403);
  });

  it("normal user token gets 403 on /api/platform/tenants", async () => {
    const normalToken = makeToken({
      userId: "test-user",
      username: "normaluser",
      role: "normal",
      tenantId: "test",
    });

    const res = await request(app).get("/api/platform/tenants").set("Authorization", `Bearer ${normalToken}`);
    expect(res.status).toBe(403);
  });

  it("superadmin token can access /api/platform/tenants", async () => {
    const adminToken = makeToken({ userId: "sa-1", username: "superadmin", role: "superadmin" });

    const res = await request(app).get("/api/platform/tenants").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe("tenant CRUD (as superadmin)", () => {
  let app: express.Express;
  let adapter: ReturnType<typeof makeTestApp>["adapter"];

  beforeEach(async () => {
    process.env.COMBAT_NO_AUTH = "1";
    const ctx = await makeTestApp();
    adapter = ctx.adapter;
    app = buildSaaSApp(adapter);
    await ensureTenantsTable(adapter);
  });

  function saToken() {
    return makeToken({ userId: "sa-1", username: "superadmin", role: "superadmin" });
  }

  it("creates a tenant", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${saToken()}`)
      .send({ name: "测试团队", slug: "test-team", plan: "free" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("测试团队");
    expect(res.body.slug).toBe("test-team");
  });

  it("rejects duplicate slug", async () => {
    const token = saToken();
    await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "团队A", slug: "dup-slug" });

    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "团队B", slug: "dup-slug" });
    expect(res.status).toBe(409);
  });

  it("rejects invalid slug format", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${saToken()}`)
      .send({ name: "团队", slug: "INVALID" });
    expect(res.status).toBe(400);
  });

  it("lists tenants", async () => {
    const token = saToken();
    await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "列表团队", slug: "list-team" });

    const res = await request(app).get("/api/platform/tenants").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("gets tenant by id", async () => {
    const token = saToken();
    const created = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "详情团队", slug: "detail-team" });

    const res = await request(app)
      .get(`/api/platform/tenants/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("详情团队");
  });

  it("updates tenant", async () => {
    const token = saToken();
    const created = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "更新前", slug: "update-team" });

    const res = await request(app)
      .put(`/api/platform/tenants/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "更新后", plan: "pro" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("更新后");
  });

  it("suspends and restores tenant", async () => {
    const token = saToken();
    const created = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "暂停团队", slug: "suspend-team" });

    const suspended = await request(app)
      .put(`/api/platform/tenants/${created.body.id}/suspend`)
      .set("Authorization", `Bearer ${token}`);
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe("suspended");

    const restored = await request(app)
      .put(`/api/platform/tenants/${created.body.id}/restore`)
      .set("Authorization", `Bearer ${token}`);
    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe("active");
  });

  it.skip("gets platform stats (requires full DB schema)", async () => {
    const token = saToken();
    await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "统计团队", slug: "stats-team" });

    const res = await request(app).get("/api/platform/stats").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.totalTenants).toBe("number");
  });

  it("gets tenant users", async () => {
    const token = saToken();
    const created = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "用户团队", slug: "users-team" });

    const res = await request(app)
      .get(`/api/platform/tenants/${created.body.id}/users`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it.skip("gets tenant usage (requires full DB schema)", async () => {
    const token = saToken();
    const created = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "用量团队", slug: "usage-team" });

    const res = await request(app)
      .get(`/api/platform/tenants/${created.body.id}/usage`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.users).toBe("number");
    expect(typeof res.body.nodes).toBe("number");
  });
});
