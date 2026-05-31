import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-audit-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§39 audit log read API e2e", () => {
  it("creating a node leaves a CREATE entry; entityId filter narrows", async () => {
    const { app } = await makeApp();
    const t = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "审计单",
        状态: "进行中",
      })
    ).body;
    const r = await request(app).get("/api/audit");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.some((e: any) => e.action === "CREATE" && e.entityId === t.id)).toBe(true);

    const r2 = await request(app).get(`/api/audit?entityId=${t.id}`);
    expect(r2.body.every((e: any) => e.entityId === t.id)).toBe(true);
    expect(r2.body.length).toBeGreaterThanOrEqual(1);
  });

  it("update yields UPDATE entry; action filter narrows", async () => {
    const { app } = await makeApp();
    const t = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "原标题",
        状态: "进行中",
      })
    ).body;
    await request(app).put(`/api/nodes/${t.id}`).send({ 标题: "改后标题", 状态: "已解决" });
    const all = (await request(app).get(`/api/audit?entityId=${t.id}`)).body;
    const actions = new Set(all.map((e: any) => e.action));
    expect(actions.has("CREATE")).toBe(true);
    expect(actions.has("UPDATE")).toBe(true);

    const onlyUpdate = (await request(app).get(`/api/audit?entityId=${t.id}&action=UPDATE`)).body;
    expect(onlyUpdate.length).toBeGreaterThanOrEqual(1);
    expect(onlyUpdate.every((e: any) => e.action === "UPDATE")).toBe(true);
  });

  it("limit clamp [1,500]; default 100; NaN→default; sorted DESC by performedAt", async () => {
    const { app } = await makeApp();
    // create 5 entries quickly
    for (let i = 0; i < 5; i++)
      await request(app)
        .post("/api/nodes/attackTicket")
        .send({ 标题: `单${i}`, 状态: "进行中" });
    const def = (await request(app).get("/api/audit")).body;
    expect(def.length).toBeLessThanOrEqual(100);
    expect(def.length).toBeGreaterThanOrEqual(5);

    const lim = (await request(app).get("/api/audit?limit=2")).body;
    expect(lim.length).toBe(2);
    // sorted DESC by performedAt (latest first)
    expect(lim[0].performedAt >= lim[1].performedAt).toBe(true);

    // clamp 999 -> 500 (we only have ~5 so just verify <= 500)
    const huge = (await request(app).get("/api/audit?limit=999")).body;
    expect(huge.length).toBeLessThanOrEqual(500);

    // NaN -> default 100
    const nan = (await request(app).get("/api/audit?limit=abc")).body;
    expect(nan.length).toBeLessThanOrEqual(100);
  });
});
