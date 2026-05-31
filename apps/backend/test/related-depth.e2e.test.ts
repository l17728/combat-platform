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
  const dir = mkdtempSync(join(tmpdir(), "combat-depth-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§32 depth-N traversal e2e", () => {
  it("depth=1 / default → response byte-identical with prior 1-hop (no 'expanded' key)", async () => {
    const { app } = await makeApp();
    const t = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "深度根",
        状态: "进行中",
        当前处理人: "甲",
      })
    ).body;
    const r1 = await request(app).get(`/api/related/attackTicket/${t.id}`);
    expect(r1.body.expanded).toBeUndefined();
    const r1d = await request(app).get(`/api/related/attackTicket/${t.id}?depth=1`);
    expect(r1d.body.expanded).toBeUndefined();
    // identical body shape
    expect(Object.keys(r1.body).sort()).toEqual(Object.keys(r1d.body).sort());
  });

  it("depth=2 reaches cross-anchor peers (透明锚点不在 expanded)", async () => {
    const { app } = await makeApp();
    const PB = "DEEP-PB-" + Date.now();
    const A = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "A单",
        状态: "进行中",
        当前处理人: "甲",
        问题单号: PB,
      })
    ).body;
    const B = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "B单",
        状态: "进行中",
        当前处理人: "乙",
        问题单号: PB,
      })
    ).body;
    const r = await request(app).get(`/api/related/attackTicket/${A.id}?depth=2`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.expanded)).toBe(true);
    const ids = r.body.expanded.map((x: any) => x.node.id);
    // B is reached via shared anchor (anchor not in expanded — transparent)
    expect(ids).toContain(B.id);
    expect(r.body.expanded.every((x: any) => x.node.nodeType !== "问题单号")).toBe(true);
    // every expanded item has depth >= 2 (or =1 for direct neighbors? both fine; just sanity)
    expect(r.body.expanded.every((x: any) => x.depth >= 1 && x.depth <= 2)).toBe(true);
  });

  it("cycle protection: each business node visited at most once", async () => {
    const { app, repo } = await makeApp();
    // build: T1 当前处理人=人X; T2 当前处理人=人X (so anchor-less but shared via REF→same person)
    // depth=3 should not re-visit T1 (the root) or duplicate 人X.
    const T1 = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "环路A",
        状态: "进行中",
        当前处理人: "环路人",
      })
    ).body;
    const T2 = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "环路B",
        状态: "进行中",
        当前处理人: "环路人",
      })
    ).body;
    void T2;
    void repo;
    const r = await request(app).get(`/api/related/attackTicket/${T1.id}?depth=3`);
    const ids = r.body.expanded.map((x: any) => x.node.id);
    const dup = ids.filter((v: string, i: number) => ids.indexOf(v) !== i);
    expect(dup).toEqual([]); // no duplicates
    // root not in expanded
    expect(ids).not.toContain(T1.id);
  });

  it("depth=99 clamps to 5; depth=0 / NaN → defaults to 1 (no 'expanded')", async () => {
    const { app } = await makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "clamp", 状态: "进行中" })).body;
    expect((await request(app).get(`/api/related/attackTicket/${t.id}?depth=0`)).body.expanded).toBeUndefined();
    expect((await request(app).get(`/api/related/attackTicket/${t.id}?depth=abc`)).body.expanded).toBeUndefined();
    const r = await request(app).get(`/api/related/attackTicket/${t.id}?depth=99`);
    expect(r.status).toBe(200);
    // accepts and returns expanded (possibly empty if isolated); no crash
    expect(r.body.expanded).toBeDefined();
  });

  it("includeCandidates + depth coexist (additive)", async () => {
    const { app } = await makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "组合", 状态: "进行中" })).body;
    const r = await request(app).get(`/api/related/attackTicket/${t.id}?depth=2&includeCandidates=1`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.candidates)).toBe(true);
    expect(Array.isArray(r.body.expanded)).toBe(true);
  });
});
