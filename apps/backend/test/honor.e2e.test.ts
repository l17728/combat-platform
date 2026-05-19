import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-honor-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
             { name: "攻关单号", type: "string", label: "攻关单号" }] }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [
      { name: "贡献人", type: "string", label: "贡献人", required: true },
      { name: "关联攻关单", type: "string", label: "关联攻关单" },
      { name: "贡献类型", type: "enum", label: "贡献类型", required: true, enumValues: ["发现","设计","实施","协调","公关"] },
      { name: "贡献等级", type: "enum", label: "贡献等级", enumValues: ["普通","关键","核心"] },
      { name: "周期", type: "string", label: "周期" }] }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("honor e2e", () => {
  it("creating a contribution with 关联攻关单 builds a CONTRIBUTED_TO edge to the ticket", async () => {
    const { app, repo } = makeApp();
    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连攻关", 攻关单号: "GK-1" });
    const c = await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 关联攻关单: "GK-1", 贡献类型: "实施", 贡献等级: "核心" });
    expect(c.status).toBe(201);
    const edges = repo.queryEdges({ sourceId: c.body.id, edgeType: "CONTRIBUTED_TO" });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(t.body.id);
  });
  it("leaderboard is level-weighted, sorted desc, with per-level/type counts and period filter", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献类型: "实施", 贡献等级: "核心", 周期: "2026-Q2" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献类型: "设计", 贡献等级: "普通", 周期: "2026-Q2" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "李四", 贡献类型: "协调", 贡献等级: "关键", 周期: "2026-Q1" });
    const lb = await request(app).get("/api/honor/leaderboard");
    expect(lb.body[0]).toMatchObject({ 贡献人: "张三", score: 9, 贡献数: 2 });
    expect(lb.body[0].byLevel).toMatchObject({ 核心: 1, 普通: 1 });
    expect(lb.body[1]).toMatchObject({ 贡献人: "李四", score: 3 });
    const q2 = await request(app).get("/api/honor/leaderboard?period=2026-Q2");
    expect(q2.body).toHaveLength(1);
    expect(q2.body[0]).toMatchObject({ 贡献人: "张三", score: 9 });
  });
  it("person profile lists the person's contributions with linked attackTicketId", async () => {
    const { app } = makeApp();
    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 攻关单号: "GK-9" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "王五", 关联攻关单: "GK-9", 贡献类型: "发现", 贡献等级: "关键" });
    const p = await request(app).get("/api/honor/person/王五");
    expect(p.body.贡献人).toBe("王五");
    expect(p.body.contributions).toHaveLength(1);
    expect(p.body.contributions[0].attackTicketId).toBe(t.body.id);
  });
});
