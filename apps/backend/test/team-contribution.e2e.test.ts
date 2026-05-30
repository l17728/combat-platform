import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

// Points the registry at the REAL config/schemas so this also asserts the
// committed teamContribution.json parses and is registered.
const realSchemas = fileURLToPath(new URL("../../../config/schemas", import.meta.url));

function makeRealApp() {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-team-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const repo = new SqliteRepository(new SqliteAdapter(db));
  const registry = new FileSchemaRegistry(realSchemas);
  return { app: createApp({ repo, registry, db, dbPath }), registry };
}

describe("teamContribution e2e", () => {
  let app: ReturnType<typeof makeRealApp>["app"];
  beforeAll(async () => { app = makeRealApp().app; });

  it("schema is registered with expected fields", async () => {
    const s = await request(app).get("/api/schema/teamContribution");
    expect(s.status).toBe(200);
    const names = s.body.fields.map((f: any) => f.name);
    expect(names).toEqual(expect.arrayContaining(["团队名称", "贡献等级", "组长", "组员"]));
  });

  it("creates a team contribution and round-trips 组员 as an array", async () => {
    const c = await request(app).post("/api/nodes/teamContribution").send({
      团队名称: "攻坚突击队",
      贡献等级: "核心",
      贡献类型: "实施",
      描述: "主导根因定位与修复",
      组长: "张三",
      组员: ["李四", "王五", "赵敏"],
      关联攻关单: "PB202612345",
      周期: "2026-Q2",
    });
    expect(c.status).toBe(201);
    const got = await request(app).get(`/api/nodes/${c.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.properties["组员"]).toEqual(["李四", "王五", "赵敏"]);
    expect(got.body.properties["团队名称"]).toBe("攻坚突击队");
  });

  it("rejects missing required 团队名称 / 贡献等级", async () => {
    const r = await request(app).post("/api/nodes/teamContribution").send({ 描述: "缺必填" });
    expect(r.status).toBe(400);
  });

  it("lists team contributions", async () => {
    await request(app).post("/api/nodes/teamContribution").send({ 团队名称: "护航队", 贡献等级: "关键" });
    const list = await request(app).get("/api/nodes/teamContribution");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });
});
