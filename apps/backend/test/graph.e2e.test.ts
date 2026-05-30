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
  const dir = mkdtempSync(join(tmpdir(), "combat-graph-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§38 KG 图形快照 e2e", () => {
  it("孤立 root → 仅自身节点 + 空 edges", async () => {
    const { app } = await makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "孤", 状态: "进行中" })).body;
    const r = await request(app).get(`/api/graph/snapshot/attackTicket/${t.id}?depth=2`);
    expect(r.status).toBe(200);
    expect(r.body.rootId).toBe(t.id);
    expect(r.body.nodes.length).toBe(1);
    expect(r.body.edges.length).toBe(0);
  });

  it("depth=2 BFS 含 REF + ANCHORED_TO + 跨锚点对端", async () => {
    const { app } = await makeApp();
    const PB = "PB-GR-" + Date.now();
    const A = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "图根", 状态: "进行中", 当前处理人: "甲", 问题单号: PB,
    })).body;
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "图邻", 状态: "进行中", 当前处理人: "乙", 问题单号: PB,
    });
    const r = await request(app).get(`/api/graph/snapshot/attackTicket/${A.id}?depth=2`);
    expect(r.status).toBe(200);
    // 至少含 root + person + anchor (问题单号) + 共享 anchor 的另一单
    expect(r.body.nodes.length).toBeGreaterThanOrEqual(4);
    const edgeTypes = new Set(r.body.edges.map((e: any) => e.edgeType));
    expect(edgeTypes.has("REF")).toBe(true);
    expect(edgeTypes.has("ANCHORED_TO")).toBe(true);
    // node dedup
    const ids = r.body.nodes.map((n: any) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    // edge dedup
    const ekeys = r.body.edges.map((e: any) => `${e.source}->${e.target}:${e.edgeType}`);
    expect(new Set(ekeys).size).toBe(ekeys.length);
  });

  it("depth clamp [1,3]: depth=99 同 depth=3；depth=0 / NaN → depth=1", async () => {
    const { app } = await makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "clamp", 状态: "进行中" })).body;
    const r99 = (await request(app).get(`/api/graph/snapshot/attackTicket/${t.id}?depth=99`)).body;
    const r3 = (await request(app).get(`/api/graph/snapshot/attackTicket/${t.id}?depth=3`)).body;
    expect(r99.nodes.length).toBe(r3.nodes.length);
    const r0 = (await request(app).get(`/api/graph/snapshot/attackTicket/${t.id}?depth=0`)).body;
    const r1 = (await request(app).get(`/api/graph/snapshot/attackTicket/${t.id}?depth=1`)).body;
    expect(r0.nodes.length).toBe(r1.nodes.length);
    const rNaN = (await request(app).get(`/api/graph/snapshot/attackTicket/${t.id}?depth=abc`)).body;
    expect(rNaN.nodes.length).toBe(r1.nodes.length);
  });
});
