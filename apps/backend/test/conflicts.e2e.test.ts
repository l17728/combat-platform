import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-conflicts-"));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§33 conflicts/overlaps e2e", () => {
  it("Rule 1 — 同人多活跃单 → CONFLICTS_WITH (reason 含人员名)", async () => {
    const { app } = makeApp();
    const A = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "单A", 状态: "进行中", 当前处理人: "甲哥",
    })).body;
    const B = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "单B", 状态: "处理中", 当前处理人: "甲哥",
    })).body;
    void A; void B;
    const scan = await request(app).post("/api/conflicts/scan");
    expect(scan.status).toBe(200);
    expect(scan.body.conflicts).toBeGreaterThanOrEqual(1);
    const rows = await request(app).get("/api/conflicts");
    expect(rows.status).toBe(200);
    const cWith = (rows.body as any[]).filter(r => r.edgeType === "CONFLICTS_WITH");
    expect(cWith.length).toBeGreaterThanOrEqual(1);
    expect(cWith.some(r => String(r.reason).includes("甲哥"))).toBe(true);
  });

  it("Rule 2 — 同问题单号 → OVERLAPS_WITH (reason 含单号)", async () => {
    const { app } = makeApp();
    const PB = "PB-XYZ-" + Date.now();
    const A = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "A", 状态: "进行中", 当前处理人: "甲", 问题单号: PB,
    })).body;
    const B = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "B", 状态: "进行中", 当前处理人: "乙", 问题单号: PB,
    })).body;
    void A; void B;
    const scan = await request(app).post("/api/conflicts/scan");
    expect(scan.body.overlaps).toBeGreaterThanOrEqual(1);
    const rows = await request(app).get("/api/conflicts");
    const ov = (rows.body as any[]).filter(r => r.edgeType === "OVERLAPS_WITH");
    expect(ov.length).toBeGreaterThanOrEqual(1);
    expect(ov.some(r => String(r.reason).includes(PB))).toBe(true);
  });

  it("把一单 状态 改为 已解决 再 scan → 该单不再出现于 CONFLICTS_WITH 边", async () => {
    const { app } = makeApp();
    const A = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "ResolvedA", 状态: "进行中", 当前处理人: "丙",
    })).body;
    const B = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "ResolvedB", 状态: "进行中", 当前处理人: "丙",
    })).body;
    let scan = await request(app).post("/api/conflicts/scan");
    expect(scan.body.conflicts).toBeGreaterThanOrEqual(1);
    // 改为已解决
    await request(app).put(`/api/nodes/${A.id}`).send({ 状态: "已解决" });
    scan = await request(app).post("/api/conflicts/scan");
    const rows = await request(app).get("/api/conflicts");
    const cWith = (rows.body as any[]).filter(r => r.edgeType === "CONFLICTS_WITH");
    // A 不应再出现在任意 CONFLICTS_WITH 边的两端
    expect(cWith.some(r => r.source.id === A.id || r.target.id === A.id)).toBe(false);
    void B;
  });

  it("GET /api/related/... 在冲突端点节点上含 conflicts，无关孤立节点不含", async () => {
    const { app } = makeApp();
    const A = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "PeerA", 状态: "进行中", 当前处理人: "丁",
    })).body;
    const B = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "PeerB", 状态: "进行中", 当前处理人: "丁",
    })).body;
    const lone = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "Lonely", 状态: "进行中", 当前处理人: "戊", // 独有
    })).body;
    await request(app).post("/api/conflicts/scan");
    const rA = await request(app).get(`/api/related/attackTicket/${A.id}`);
    expect(rA.status).toBe(200);
    expect(Array.isArray(rA.body.conflicts)).toBe(true);
    expect((rA.body.conflicts as any[]).length).toBeGreaterThanOrEqual(1);
    expect((rA.body.conflicts as any[]).some(c => c.node.id === B.id)).toBe(true);
    expect((rA.body.conflicts as any[]).some(c => c.edgeType === "CONFLICTS_WITH")).toBe(true);

    const rLone = await request(app).get(`/api/related/attackTicket/${lone.id}`);
    expect(rLone.status).toBe(200);
    expect(rLone.body.conflicts).toBeUndefined();
  });
});
