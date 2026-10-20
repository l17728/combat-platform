import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { SqliteAdapter } from "../src/db-adapter.js";

// v2.3.5: 虚拟 schema(helpRequest/bugReport/proposal/reminder) — 用于 UI 渲染,
// 但生成 /api/nodes/:nodeType CRUD 时必须被拒绝。它们的数据存在自己的表里。

function makeAppWithVirtual() {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-virt-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  // attackTicket: real
  writeFileSync(
    join(cfgDir, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        {
          name: "状态",
          type: "enum",
          label: "状态",
          required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"],
        },
      ],
    })
  );
  // helpRequest: virtual
  writeFileSync(
    join(cfgDir, "helpRequest.json"),
    JSON.stringify({
      nodeType: "helpRequest",
      label: "求助",
      identityKeys: [],
      derivedToKG: false,
      virtual: true,
      fields: [{ name: "question", type: "string", label: "求助内容", required: true, group: "基础信息", order: 1 }],
    })
  );
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(cfgDir);
  const app = createApp({ repo, registry, adapter, db, dbPath });
  return { app, registry };
}

describe("virtual schema gating (v2.3.5)", () => {
  it("/api/schema/list returns virtual schemas with virtual:true", async () => {
    const { app } = makeAppWithVirtual();
    const r = await request(app).get("/api/schema/list");
    expect(r.status).toBe(200);
    const hr = (r.body as any[]).find((s) => s.nodeType === "helpRequest");
    expect(hr).toBeDefined();
    expect(hr.virtual).toBe(true);
    expect(hr.fields[0].group).toBe("基础信息");
  });

  it("POST /api/nodes/<virtual> is rejected with 400", async () => {
    const { app } = makeAppWithVirtual();
    const r = await request(app).post("/api/nodes/helpRequest").send({ question: "should not work" });
    expect(r.status).toBe(400);
    expect(String(r.body.error || "")).toMatch(/虚拟|virtual/);
  });

  it("GET /api/nodes/<virtual> as list is rejected with 400", async () => {
    const { app } = makeAppWithVirtual();
    const r = await request(app).get("/api/nodes/helpRequest");
    expect(r.status).toBe(400);
    expect(String(r.body.error || "")).toMatch(/虚拟|virtual/);
  });

  it("real nodeType still works", async () => {
    const { app } = makeAppWithVirtual();
    const r = await request(app).post("/api/nodes/attackTicket").send({ 标题: "real ticket", 状态: "进行中" });
    expect(r.status).toBe(201);
  });
});
