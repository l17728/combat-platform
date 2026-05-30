import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-dash-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "string", label: "状态" },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" },
      { name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [{ name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true },
      { name: "贡献等级", type: "string", label: "贡献等级" },
      { name: "关联问题单", type: "string", label: "关联问题单", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const db = openDb(join(dir, "t.sqlite"));
  const repo = new SqliteRepository(new SqliteAdapter(db));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, db };
}

describe("dashboard e2e", () => {
  it("aggregates tickets/contributions/proposals correctly + deterministic top contributors", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "B", 状态: "进行中", 问题单号: "PB-1" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "C", 状态: "已解决" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "D", 状态: "已关闭" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "E", 状态: "待响应" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献等级: "核心", 关联问题单: "PB-1" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献等级: "关键" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "李四", 贡献等级: "普通" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "F", 状态: "进行中", 当前处理人: "张伟" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "G", 状态: "进行中", 当前处理人: "张玮" });
    await request(app).post("/api/proposals/scan").send({});

    const r = await request(app).get("/api/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.tickets.total).toBe(7);
    expect(r.body.tickets.byStatus["进行中"]).toBe(4);
    expect(r.body.tickets.byStatus["已解决"]).toBe(1);
    expect(r.body.tickets.byStatus["已关闭"]).toBe(1);
    expect(r.body.tickets.byStatus["待响应"]).toBe(1);
    expect(r.body.tickets.open).toBe(5);
    expect(r.body.tickets.resolved).toBe(2);
    expect(r.body.contributions.total).toBe(3);
    expect(r.body.contributions.topContributors[0]).toEqual({ 贡献人: "张三", count: 2 });
    expect(r.body.contributions.topContributors[1]).toEqual({ 贡献人: "李四", count: 1 });
    expect(r.body.proposalsPending).toBeGreaterThanOrEqual(1);
  });

  it("read-only: audit_log row count unchanged across calls; deterministic", async () => {
    const { app, db } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "X", 状态: "进行中" });
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    const a = await request(app).get("/api/dashboard");
    const b = await request(app).get("/api/dashboard");
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
    expect(a.body).toEqual(b.body);
  });

  it("empty system → zeroed summary", async () => {
    const { app } = await makeApp();
    const r = await request(app).get("/api/dashboard");
    expect(r.body).toMatchObject({
      tickets: { total: 0, byStatus: {}, open: 0, resolved: 0 },
      contributions: { total: 0, topContributors: [] },
      proposalsPending: 0,
    });
    // §36-extended fields exist alongside the legacy three (additive contract).
    expect(r.body.conflicts).toBeDefined();
    expect(r.body.today).toBeDefined();
    expect(r.body.recentActivity).toBeDefined();
  });
});
