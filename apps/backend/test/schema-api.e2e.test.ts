import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { makeSchemaApiRouter } from "../src/schema-api.js";
import express from "express";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
const TEST_NODE_TYPE = "testTable123";
const TEST_FILE = join(SCHEMA_DIR, `${TEST_NODE_TYPE}.json`);

// Cleanup helper
function cleanTestSchema() {
  if (existsSync(TEST_FILE)) {
    unlinkSync(TEST_FILE);
  }
}

function make() {
  const repo = new SqliteRepository(
    openDb(join(mkdtempSync(join(tmpdir(), "combat-schema-")), "t.sqlite")),
  );
  const registry = new FileSchemaRegistry(SCHEMA_DIR);
  // Wrap the createApp with schema-api router added
  const baseApp = createApp({ repo, registry });
  // Also register schema-api routes on a standalone app for direct testing
  const app = express();
  app.use(express.json());
  app.use("/api", makeSchemaApiRouter(registry, SCHEMA_DIR, repo));
  // Proxy the rest through createApp for e2e
  return { app, repo, registry };
}

describe("Schema API e2e (增量: 动态新增表)", () => {
  beforeAll(async () => {
    // Ensure no leftover test schema
    cleanTestSchema();
  });

  afterAll(async () => {
    // Clean up any test schema that was created
    cleanTestSchema();
  });

  it("1. GET /api/schema/list 返回全部 nodeType", async () => {
    const { app } = make();
    const res = await request(app).get("/api/schema/list");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // 18 schemas (15 base + domain + infoCard + teamContribution)
    expect(res.body.length).toBe(18);
    // Each should have nodeType and fields
    for (const s of res.body) {
      expect(typeof s.nodeType).toBe("string");
      expect(Array.isArray(s.fields)).toBe(true);
    }
  });

  it("2. GET /api/schema/suggest?q=状态 返回匹配字段", async () => {
    const { app } = make();
    const res = await request(app).get("/api/schema/suggest?q=状态");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // 状态 field exists in many schemas
    expect(res.body.length).toBeGreaterThan(0);
    // Each result should have required fields
    for (const s of res.body) {
      expect(typeof s.nodeType).toBe("string");
      expect(typeof s.fieldId).toBe("string");
      expect(typeof s.matchReason).toBe("string");
    }
    // At least one result should have matchReason of 名称匹配 or 标签匹配
    const reasons = res.body.map((s: { matchReason: string }) => s.matchReason);
    expect(reasons.some((r: string) => r === "名称匹配" || r === "标签匹配")).toBe(true);
  });

  it("3. POST /api/schema/nodeType 创建新 Schema 文件并重载 registry", async () => {
    // Ensure clean state
    cleanTestSchema();

    const { app, registry } = make();
    const body = {
      nodeType: TEST_NODE_TYPE,
      label: "测试表",
      fields: [
        { name: "title", type: "string", label: "标题", required: true },
        { name: "status", type: "enum", label: "状态", enumValues: ["待处理", "已完成"] },
      ],
    };

    const res = await request(app).post("/api/schema/nodeType").send(body);
    expect(res.status).toBe(201);
    expect(res.body.nodeType).toBe(TEST_NODE_TYPE);
    expect(res.body.label).toBe("测试表");
    expect(res.body.fields.length).toBe(2);

    // File should exist on disk
    expect(existsSync(TEST_FILE)).toBe(true);

    // Registry should reflect the new schema after reload
    registry.reload();
    const schema = registry.getNodeSchema(TEST_NODE_TYPE);
    expect(schema).toBeDefined();
    expect(schema!.nodeType).toBe(TEST_NODE_TYPE);
  });

  it("4. POST /api/schema/nodeType 重复名称返回 409", async () => {
    // testTable123 should still exist from test 3
    expect(existsSync(TEST_FILE)).toBe(true);

    const { app } = make();
    const body = {
      nodeType: TEST_NODE_TYPE,
      label: "重复测试",
      fields: [{ name: "name", type: "string", label: "名称" }],
    };

    const res = await request(app).post("/api/schema/nodeType").send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("已存在");
  });

  it("5. DELETE /api/schema/nodeType/:nodeType 删除 Schema", async () => {
    // testTable123 should still exist from test 3
    expect(existsSync(TEST_FILE)).toBe(true);

    const { app } = make();
    const res = await request(app).delete(`/api/schema/nodeType/${TEST_NODE_TYPE}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // File should be removed from disk
    expect(existsSync(TEST_FILE)).toBe(false);
  });

  it("6. DELETE /api/schema/nodeType/:nodeType 有数据时返回 409", async () => {
    // First create the schema again
    cleanTestSchema();
    const { app, repo, registry } = make();

    const createRes = await request(app)
      .post("/api/schema/nodeType")
      .send({
        nodeType: TEST_NODE_TYPE,
        label: "测试表2",
        fields: [{ name: "title", type: "string", label: "标题" }],
      });
    expect(createRes.status).toBe(201);

    // Reload registry so it knows about the new type
    registry.reload();

    // Create a node of this type directly via repo
    await repo.createNode(TEST_NODE_TYPE, { title: "测试数据" }, "test");

    // Now try to delete — should 409 because data exists
    const deleteRes = await request(app).delete(`/api/schema/nodeType/${TEST_NODE_TYPE}`);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error).toBe("该类型下有数据，无法删除");

    // Cleanup
    cleanTestSchema();
  });

  it("POST fields 为空数组 → 400", async () => {
    const { app } = make();
    const r = await request(app).post("/api/schema/nodeType")
      .send({ nodeType: "EmptyFieldsType", label: "空字段", fields: [] });
    expect(r.status).toBe(400);
  });

  it("POST label 为空白 → 400", async () => {
    const { app } = make();
    const r = await request(app).post("/api/schema/nodeType")
      .send({ nodeType: "ValidType", label: "   ", fields: [{ name: "f1", type: "string", label: "字段1" }] });
    expect(r.status).toBe(400);
  });

  it.each([["123bad"], ["bad-type"], ["中文类型"]])(
    "POST nodeType=%s 格式非法 → 400", async (nodeType) => {
      const { app } = make();
      const r = await request(app).post("/api/schema/nodeType")
        .send({ nodeType, label: "测试", fields: [{ name: "f1", type: "string", label: "字段1" }] });
      expect(r.status).toBe(400);
    }
  );

  it("POST 字段缺 name → 400", async () => {
    const { app } = make();
    const r = await request(app).post("/api/schema/nodeType")
      .send({ nodeType: "ValidType2", label: "测试", fields: [{ type: "string", label: "字段1" }] });
    expect(r.status).toBe(400);
  });

  it("DELETE 不存在的 nodeType → 404", async () => {
    const { app } = make();
    const r = await request(app).delete("/api/schema/nodeType/doesNotExist999");
    expect(r.status).toBe(404);
  });

  it("GET suggest?q= 空查询 → 200 空数组", async () => {
    const { app } = make();
    const r = await request(app).get("/api/schema/suggest?q=");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("POST 字段不含 id 时 id 默认为 name", async () => {
    const { app } = make();
    cleanTestSchema();
    const r = await request(app).post("/api/schema/nodeType").send({
      nodeType: "IdDefaultTest", label: "默认id测试",
      fields: [{ name: "fieldName", type: "string", label: "字段" }]
    });
    // Cleanup regardless of result
    const idTestFile = join(SCHEMA_DIR, "IdDefaultTest.json");
    if (existsSync(idTestFile)) unlinkSync(idTestFile);
    expect(r.status).toBe(201);
    const field = r.body.fields?.[0];
    expect(field?.id).toBe("fieldName");
  });
});
