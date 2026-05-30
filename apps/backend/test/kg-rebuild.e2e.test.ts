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
  const dir = mkdtempSync(join(tmpdir(), "combat-kg-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§34 KG full rebuild e2e", () => {
  it("rebuild restores REF/ANCHORED_TO edges to incremental-sync counts after drift", async () => {
    const { app, repo } = await makeApp();
    // seed via API → triggers incremental syncRef + syncAnchor
    const PB = "REB-" + Date.now();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "增量同步建好的", 状态: "进行中", 当前处理人: "甲", 问题单号: PB,
    });
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "另一单同问题单", 状态: "进行中", 当前处理人: "乙", 问题单号: PB,
    });
    const refBefore = (await repo.queryEdges({ edgeType: "REF" })).length;
    const anchorBefore = (await repo.queryEdges({ edgeType: "ANCHORED_TO" })).length;
    expect(refBefore).toBeGreaterThan(0);
    expect(anchorBefore).toBeGreaterThan(0);

    // simulate drift: drop every REF edge from the table
    for (const e of await repo.queryEdges({ edgeType: "REF" })) {
      await repo.deleteEdges({ sourceId: e.sourceId, edgeType: "REF" }, "test");
    }
    expect((await repo.queryEdges({ edgeType: "REF" })).length).toBe(0);

    const r = await request(app).post("/api/kg/rebuild").send({});
    expect(r.status).toBe(200);
    expect(r.body.refEdges).toBe(refBefore);
    expect(r.body.anchorEdges).toBe(anchorBefore);
    expect(typeof r.body.durationMs).toBe("number");
  });

  it("rebuild is idempotent — second rebuild yields identical counts", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "幂等单A", 状态: "进行中", 当前处理人: "甲", 问题单号: "PB-X",
    });
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "幂等单B", 状态: "进行中", 当前处理人: "甲", 问题单号: "PB-X",
    });
    const r1 = (await request(app).post("/api/kg/rebuild").send({})).body;
    const r2 = (await request(app).post("/api/kg/rebuild").send({})).body;
    expect(r2.refEdges).toBe(r1.refEdges);
    expect(r2.anchorEdges).toBe(r1.anchorEdges);
    expect(r2.conflicts).toBe(r1.conflicts);
    expect(r2.overlaps).toBe(r1.overlaps);
  });

  it("rebuild re-creates conflict/overlap edges", async () => {
    const { app, repo } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "C1", 状态: "进行中", 当前处理人: "丙",
    });
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "C2", 状态: "进行中", 当前处理人: "丙",
    });
    // wipe all conflict edges manually
    await repo.deleteEdges({ edgeType: "CONFLICTS_WITH" }, "test");
    expect((await repo.queryEdges({ edgeType: "CONFLICTS_WITH" })).length).toBe(0);
    const r = await request(app).post("/api/kg/rebuild").send({});
    expect(r.body.conflicts).toBeGreaterThanOrEqual(1);
    expect((await repo.queryEdges({ edgeType: "CONFLICTS_WITH" })).length).toBeGreaterThan(0);
  });

  it("rebuild result shape matches RebuildKGResult contract", async () => {
    const { app } = await makeApp();
    const r = await request(app).post("/api/kg/rebuild").send({});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("refEdges");
    expect(r.body).toHaveProperty("anchorEdges");
    expect(r.body).toHaveProperty("conflicts");
    expect(r.body).toHaveProperty("overlaps");
    expect(r.body).toHaveProperty("durationMs");
  });
});
