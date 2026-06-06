import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";
import jwt from "jsonwebtoken";
import { tenantContext, SqliteRepository, tid } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { openDb } from "../src/db.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdirSync, writeFileSync } from "node:fs";

function makeIsolatedAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "ti-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  return new SqliteAdapter(db);
}

const JWT_SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";

function makeToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

describe("repository-level tenant isolation", () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    adapter = makeIsolatedAdapter();
  });

  it("nodes created by tenant A are invisible to tenant B", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");
    const repoB = new SqliteRepository(adapter, "tenant-b");

    await repoA.createNode("person", { name: "A-person", employeeId: "e1" }, "actor");
    expect(await repoA.queryNodes("person")).toHaveLength(1);
    expect(await repoB.queryNodes("person")).toHaveLength(0);
  });

  it("getNode filters by tenant", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");
    const repoB = new SqliteRepository(adapter, "tenant-b");

    const node = await repoA.createNode("person", { name: "A-only", employeeId: "e2" }, "actor");
    expect(await repoA.getNode(node.id)).toBeTruthy();
    expect(await repoB.getNode(node.id)).toBeNull();
  });

  it("deleteNode is scoped to tenant", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");

    const nodeA = await repoA.createNode("person", { name: "del-me", employeeId: "e3" }, "actor");
    await repoA.deleteNode(nodeA.id, "actor");
    expect(await repoA.getNode(nodeA.id)).toBeNull();
  });

  it("edges are isolated by tenant", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");
    const repoB = new SqliteRepository(adapter, "tenant-b");

    const n1 = await repoA.createNode("person", { name: "p1", employeeId: "e1" }, "actor");
    const n2 = await repoA.createNode("person", { name: "p2", employeeId: "e2" }, "actor");
    await repoA.createEdge("关联", n1.id, n2.id, {}, "actor");
    expect(await repoA.queryEdges({})).toHaveLength(1);
    expect(await repoB.queryEdges({})).toHaveLength(0);
  });

  it("null tenantId sees all data (superadmin bypass)", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");
    const repoB = new SqliteRepository(adapter, "tenant-b");
    const superRepo = new SqliteRepository(adapter, null);

    await repoA.createNode("person", { name: "A", employeeId: "e1" }, "actor");
    await repoB.createNode("person", { name: "B", employeeId: "e2" }, "actor");
    expect(await superRepo.queryNodes("person")).toHaveLength(2);
  });

  it("queryNodesByProperty filters by tenant", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");
    const repoB = new SqliteRepository(adapter, "tenant-b");

    await repoA.createNode("person", { name: "unique-name", employeeId: "e1" }, "actor");
    expect(await repoA.queryNodesByProperty("person", "name", "unique-name")).toHaveLength(1);
    expect(await repoB.queryNodesByProperty("person", "name", "unique-name")).toHaveLength(0);
  });

  it("updateNode is scoped to tenant", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");

    const node = await repoA.createNode("person", { name: "original", employeeId: "e1" }, "actor");
    const updated = await repoA.updateNode(node.id, { name: "updated" }, "actor");
    expect(updated.properties["name"]).toBe("updated");
  });

  it("deleteEdgeById is scoped to tenant", async () => {
    const repoA = new SqliteRepository(adapter, "tenant-a");
    const repoB = new SqliteRepository(adapter, "tenant-b");

    const n1 = await repoA.createNode("person", { name: "p1", employeeId: "e1" }, "actor");
    const n2 = await repoA.createNode("person", { name: "p2", employeeId: "e2" }, "actor");
    const edge = await repoA.createEdge("关联", n1.id, n2.id, {}, "actor");
    expect(await repoB.deleteEdgeById(edge.id, "actor")).toBe(false);
    expect(await repoA.deleteEdgeById(edge.id, "actor")).toBe(true);
  });
});

describe("AsyncLocalStorage integration", () => {
  it("tid() returns tenant ID inside run()", () => {
    expect(tid()).toBe("default");
    tenantContext.run("my-tenant", () => {
      expect(tid()).toBe("my-tenant");
    });
    expect(tid()).toBe("default");
  });

  it("nested context is isolated", () => {
    tenantContext.run("outer", () => {
      expect(tid()).toBe("outer");
      tenantContext.run("inner", () => {
        expect(tid()).toBe("inner");
      });
      expect(tid()).toBe("outer");
    });
  });
});

describe("creator-only delete enforcement", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    process.env.COMBAT_NO_AUTH = "1";
    const dir = mkdtempSync(join(tmpdir(), "cd-"));
    const cfgDir = join(dir, "schemas");
    mkdirSync(cfgDir);
    writeFileSync(
      join(cfgDir, "attackTicket.json"),
      JSON.stringify({
        nodeType: "attackTicket",
        label: "攻关单",
        identityKeys: ["攻关单号"],
        fields: [
          { name: "标题", type: "string", label: "标题", required: true },
          { name: "状态", type: "enum", label: "状态", required: true, enumValues: ["待响应", "处理中"] },
        ],
      })
    );
    writeFileSync(
      join(cfgDir, "person.json"),
      JSON.stringify({
        nodeType: "person",
        label: "人员",
        identityKeys: ["employeeId"],
        fields: [
          { name: "name", type: "string", label: "姓名", required: true },
          { name: "employeeId", type: "string", label: "工号" },
        ],
      })
    );
    const db = openDb(join(dir, "t.sqlite"));
    const adapter = new SqliteAdapter(db);
    const repo = new SqliteRepository(adapter);
    const registry = new FileSchemaRegistry(cfgDir);
    app = createApp({ repo, registry, adapter, db });
    delete process.env.COMBAT_NO_AUTH;
  });

  afterEach(() => {
    process.env.COMBAT_NO_AUTH = "1";
  });

  function token(role: string, username: string, tenantId = "default") {
    return makeToken({ userId: "u1", username, role, tenantId });
  }

  it("creator can delete own node", async () => {
    const creator = token("normal", "creator1");
    const createRes = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${creator}`)
      .send({ 标题: "mine", 状态: "待响应" });
    expect(createRes.status).toBe(201);

    const delRes = await request(app)
      .delete(`/api/nodes/${createRes.body.id}`)
      .set("Authorization", `Bearer ${creator}`);
    expect(delRes.status).toBe(200);
  });

  it("non-creator non-admin gets 403 on DELETE", async () => {
    const creator = token("normal", "creator1");
    const other = token("normal", "other1");
    const createRes = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${creator}`)
      .send({ 标题: "protected", 状态: "待响应" });
    expect(createRes.status).toBe(201);

    const delRes = await request(app).delete(`/api/nodes/${createRes.body.id}`).set("Authorization", `Bearer ${other}`);
    expect(delRes.status).toBe(403);
  });

  it("admin can delete anyone's node", async () => {
    const creator = token("normal", "creator1");
    const admin = token("admin", "admin1");
    const createRes = await request(app)
      .post("/api/nodes/attackTicket")
      .set("Authorization", `Bearer ${creator}`)
      .send({ 标题: "admin-del", 状态: "待响应" });
    expect(createRes.status).toBe(201);

    const delRes = await request(app).delete(`/api/nodes/${createRes.body.id}`).set("Authorization", `Bearer ${admin}`);
    expect(delRes.status).toBe(200);
  });
});

describe("schema protection", () => {
  let app: ReturnType<typeof makeTestApp>["app"];

  beforeEach(async () => {
    const ctx = await makeTestApp();
    app = ctx.app;
  });

  it("DELETE /api/schema/nodeType/attackTicket returns 403", async () => {
    const res = await request(app).delete("/api/schema/nodeType/attackTicket");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("系统核心类型");
  });

  it("DELETE /api/schema/nodeType/person returns 403", async () => {
    const res = await request(app).delete("/api/schema/nodeType/person");
    expect(res.status).toBe(403);
  });

  it("DELETE /api/schema/nodeType/contribution returns 403", async () => {
    const res = await request(app).delete("/api/schema/nodeType/contribution");
    expect(res.status).toBe(403);
  });
});
