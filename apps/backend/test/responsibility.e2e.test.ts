import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { makeResponsibilityRouter } from "../src/responsibility.js";
import { makeEscalationRouter } from "../src/escalation.js";
import express from "express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function make() {
  const dir = mkdtempSync(join(tmpdir(), "combat-resp-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  const app = express();
  app.use(express.json());
  app.use("/api", makeResponsibilityRouter(repo));
  app.use("/api", makeEscalationRouter(repo));
  return { app, repo };
}

describe("责任矩阵 Mermaid 图 e2e", () => {
  it("空数据库 — 返回完整结构体，默认包含升级配置", async () => {
    const { app } = make();
    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    expect(typeof res.body.mermaid).toBe("string");
    expect(typeof res.body.nodeCount).toBe("number");
    expect(typeof res.body.edgeCount).toBe("number");
    expect(typeof res.body.totalTickets).toBe("number");
    expect(typeof res.body.totalPersons).toBe("number");
    expect(typeof res.body.totalConflicts).toBe("number");
    expect(Array.isArray(res.body.escalationRules)).toBe(true);
    expect(Array.isArray(res.body.personLoads)).toBe(true);
    expect(Array.isArray(res.body.conflictTop)).toBe(true);
    expect(res.body.mermaid.trim()).toMatch(/^flowchart TD/);
    expect(res.body.edgeCount).toBeGreaterThanOrEqual(4);
    expect(res.body.nodeCount).toBeGreaterThanOrEqual(2);
    expect(res.body.totalTickets).toBe(0);
    expect(res.body.totalPersons).toBe(0);
    expect(res.body.escalationRules.length).toBeGreaterThanOrEqual(4);
  });

  it("自定义升级配置 — 图中包含对应 SLA 标签和角色节点", async () => {
    const { app } = make();
    await request(app)
      .put("/api/escalation/config")
      .send({
        rules: [
          { 事件级别: "P1", slaHours: 1, 上升角色: "超级值班员" },
          { 事件级别: "P2", slaHours: 6, 上升角色: "超级值班员" },
        ],
      });

    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    const mermaid: string = res.body.mermaid;
    expect(mermaid).toContain("超级值班员");
    expect(mermaid).toContain("SLA 1h");
    expect(mermaid).toContain("SLA 6h");
    expect(res.body.edgeCount).toBe(2);
    expect(res.body.nodeCount).toBe(3);
  });

  it("ASSIGNED_TO 边 — 人员负载表含分配数，概览图含人员节点", async () => {
    const { app, repo } = make();
    const person = await repo.createNode("person", { 姓名: "张三", 角色: "攻关" }, "test");
    const ticket = await repo.createNode("attackTicket", { 标题: "攻关单001", 状态: "进行中" }, "test");
    await repo.createEdge("分配", ticket.id, person.id, { role: "owner" }, "test");

    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    expect(res.body.mermaid).toContain("张三");
    expect(res.body.personLoads.length).toBe(1);
    expect(res.body.personLoads[0].name).toBe("张三");
    expect(res.body.personLoads[0].assignedCount).toBe(1);
    expect(res.body.totalTickets).toBe(1);
    expect(res.body.totalPersons).toBe(1);
  });

  it("CONFLICTS_WITH 边 — 冲突计数 > 0，conflictTop 含冲突对", async () => {
    const { app, repo } = make();
    const t1 = await repo.createNode("attackTicket", { 标题: "冲突单A", 状态: "进行中" }, "test");
    const t2 = await repo.createNode("attackTicket", { 标题: "冲突单B", 状态: "待响应" }, "test");
    await repo.createEdge("冲突", t1.id, t2.id, { reason: "人员重叠" }, "test");

    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    expect(res.body.totalConflicts).toBe(1);
    expect(res.body.conflictTop.length).toBe(1);
    const pair = res.body.conflictTop[0];
    const titles = [pair.ticketA, pair.ticketB].sort();
    expect(titles).toContain("冲突单A");
    expect(titles).toContain("冲突单B");
  });

  it("ESCALATED_TO 边 — 人员负载表含上报数", async () => {
    const { app, repo } = make();
    const ticket = await repo.createNode("attackTicket", { 标题: "网络故障", 状态: "处理中" }, "test");
    const person = await repo.createNode("person", { 姓名: "运维李四" }, "test");
    await repo.createEdge("上报", ticket.id, person.id, {}, "test");
    const r = await request(app).get("/api/responsibility/diagram");
    expect(r.status).toBe(200);
    expect(r.body.personLoads.some((p: { name: string }) => p.name === "运维李四")).toBe(true);
  });

  it("超长标题在冲突对中被截断并含省略号", async () => {
    const { app, repo } = make();
    const longTitle = "这是一个超过二十个字符的非常非常长的攻关单标题用于测试截断逻辑";
    const ticket = await repo.createNode("attackTicket", { 标题: longTitle, 状态: "处理中" }, "test");
    const ticket2 = await repo.createNode("attackTicket", { 标题: "短标题", 状态: "处理中" }, "test");
    const person = await repo.createNode("person", { 姓名: "负责人甲" }, "test");
    await repo.createEdge("分配", ticket.id, person.id, { role: "owner" }, "test");
    await repo.createEdge("冲突", ticket.id, ticket2.id, {}, "test");
    const r = await request(app).get("/api/responsibility/diagram");
    const conflictText = JSON.stringify(r.body.conflictTop);
    expect(conflictText).toContain("…");
    expect(conflictText).not.toContain(longTitle);
  });

  it("空规则配置时返回正常", async () => {
    const { app } = make();
    await request(app).put("/api/escalation/config").send({ rules: [] });
    const r = await request(app).get("/api/responsibility/diagram");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("mermaid");
    expect(r.body).toHaveProperty("nodeCount");
    expect(r.body).toHaveProperty("totalTickets");
    expect(r.body).toHaveProperty("escalationRules");
    expect(r.body.escalationRules).toEqual([]);
  });
});
