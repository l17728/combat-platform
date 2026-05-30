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
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-views-")), "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

const NEW_TYPES = ["incidentTracking", "changeIssue", "alarmGovernance", "p3Incident", "dailyTask", "issue400", "issue5xx", "experience"];

describe("§46 req.md 作战表 + 经验总结 view（配置驱动）", () => {
  it("8 个新 nodeType schema 全部加载，字段非空", async () => {
    const { app } = await makeApp();
    for (const nt of NEW_TYPES) {
      const r = await request(app).get(`/api/schema/${nt}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.fields)).toBe(true);
      expect(r.body.fields.length).toBeGreaterThan(0);
    }
  });

  it("现网问题 ↔ 攻关单 共享问题单号 → coAnchored 跨 view 互见", async () => {
    const { app } = await makeApp();
    const PB = "PB-VIEW-001";
    const inc = (await request(app).post("/api/nodes/incidentTracking").send({
      问题说明: "断连现网问题", 状态: "进行中", 关联需求问题单: PB,
    })).body;
    const tk = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "断连攻关", 状态: "进行中", 问题单号: PB,
    })).body;
    // related of the incident should co-anchor the attackTicket via shared 问题单号
    const r = await request(app).get(`/api/related/incidentTracking/${inc.id}`);
    expect(r.status).toBe(200);
    const peers = (r.body.coAnchored ?? []).map((c: any) => c.node.id);
    expect(peers).toContain(tk.id);
  });

  it("ref 责任人写入即建 person + REF 边（concept 负责人）", async () => {
    const { app, repo } = await makeApp();
    const inc = (await request(app).post("/api/nodes/incidentTracking").send({
      问题说明: "x", 状态: "进行中", 运维责任人: "甲运维",
    })).body;
    const refs = (await repo.queryEdges({ sourceId: inc.id, edgeType: "REF" }))
      .filter(e => String(e.properties["field"]) === "运维责任人");
    expect(refs).toHaveLength(1);
    expect(String(refs[0].properties["concept"])).toBe("负责人");
    expect((await repo.getNode(refs[0].targetId))!.properties["姓名"]).toBe("甲运维");
  });

  it("§49 attackTicket 事件单号 ↔ p3Incident 共享 → coAnchored 互见", async () => {
    const { app } = await makeApp();
    const EV = "EV-VIEW-77";
    const tk = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "带事件单号的攻关", 状态: "进行中", 事件单号: EV,
    })).body;
    const p3 = (await request(app).post("/api/nodes/p3Incident").send({
      事件单号: EV, 事件标题: "P3 同事件单",
    })).body;
    const r = await request(app).get(`/api/related/attackTicket/${tk.id}`);
    expect((r.body.coAnchored ?? []).map((c: any) => c.node.id)).toContain(p3.id);
  });

  it("§49 attackTicket 含 req.md 详情新字段（日报发布数量/根因服务/事件单号 等）", async () => {
    const { app } = await makeApp();
    const s = (await request(app).get("/api/schema/attackTicket")).body;
    const ids = s.fields.map((f: any) => f.id);
    for (const f of ["事件单号", "根因服务", "局点", "当前处理部门", "日报发布数量", "攻关成员", "影响及现存风险"])
      expect(ids).toContain(f);
  });

  it("Hermes 全文检索覆盖新 nodeType（experience）", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/experience").send({ 经验: "断连根因排查经验XYZ" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "XYZ" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toContain("断连根因排查经验XYZ");
  });
});
