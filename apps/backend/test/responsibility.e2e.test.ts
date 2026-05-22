import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { makeResponsibilityRouter } from "../src/responsibility.js";
import { makeEscalationRouter } from "../src/escalation.js";
import express from "express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Make a test app with the responsibility router + escalation router (for config setup) */
function make() {
  const dir = mkdtempSync(join(tmpdir(), "combat-resp-"));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  const app = express();
  app.use(express.json());
  app.use("/api", makeResponsibilityRouter(repo));
  app.use("/api", makeEscalationRouter(repo));
  return { app, repo };
}

describe("责任矩阵 Mermaid 图 e2e", () => {
  it("空数据库 — 返回 { mermaid, nodeCount, edgeCount } 结构，默认包含升级配置", async () => {
    const { app } = make();
    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    expect(typeof res.body.mermaid).toBe("string");
    expect(typeof res.body.nodeCount).toBe("number");
    expect(typeof res.body.edgeCount).toBe("number");
    // mermaid string must start with flowchart
    expect(res.body.mermaid.trim()).toMatch(/^flowchart TD/);
    // default escalation rules always produce edges (P1, P2, P3, P4A = 4 rules)
    expect(res.body.edgeCount).toBeGreaterThanOrEqual(4);
    // nodeCount includes both level nodes and role nodes
    expect(res.body.nodeCount).toBeGreaterThanOrEqual(2);
  });

  it("自定义升级配置 — 图中包含对应 SLA 标签和角色节点", async () => {
    const { app } = make();
    // Set a custom escalation config with unique role name
    await request(app).put("/api/escalation/config").send({
      rules: [
        { 事件级别: "P1", slaHours: 1, 上升角色: "超级值班员" },
        { 事件级别: "P2", slaHours: 6, 上升角色: "超级值班员" },
      ],
    });

    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    const mermaid: string = res.body.mermaid;
    // Should mention the custom role
    expect(mermaid).toContain("超级值班员");
    // Should show SLA hours
    expect(mermaid).toContain("SLA 1h");
    expect(mermaid).toContain("SLA 6h");
    // Arrows for each rule (2 rules = 2 edges)
    expect(res.body.edgeCount).toBe(2);
    // P1 node, P2 node, 超级值班员 node (both rules share same role node)
    expect(res.body.nodeCount).toBe(3);
  });

  it("ASSIGNED_TO 边 — 图中展示人员负责攻关单的关系", async () => {
    const { app, repo } = make();
    // Create a person node and a ticket node, then link via ASSIGNED_TO edge
    const person = repo.createNode("person", { 姓名: "张三", 角色: "攻关" }, "test");
    const ticket = repo.createNode("attackTicket", { 标题: "攻关单001", 状态: "进行中" }, "test");
    repo.createEdge("ASSIGNED_TO", ticket.id, person.id, { role: "owner" }, "test");

    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    const mermaid: string = res.body.mermaid;
    // Person name should appear
    expect(mermaid).toContain("张三");
    // Ticket title should appear
    expect(mermaid).toContain("攻关单001");
    // "负责" label should appear
    expect(mermaid).toContain("负责");
  });

  it("CONFLICTS_WITH 边 — 展示为虚线箭头（-.->）且含 '冲突' 标签", async () => {
    const { app, repo } = make();
    // Create two attack tickets
    const t1 = repo.createNode("attackTicket", { 标题: "冲突单A", 状态: "进行中" }, "test");
    const t2 = repo.createNode("attackTicket", { 标题: "冲突单B", 状态: "待响应" }, "test");
    repo.createEdge("CONFLICTS_WITH", t1.id, t2.id, { reason: "人员重叠" }, "test");

    const res = await request(app).get("/api/responsibility/diagram");
    expect(res.status).toBe(200);
    const mermaid: string = res.body.mermaid;
    // Dashed line syntax
    expect(mermaid).toContain("-.->|\"冲突\"|");
    // Both ticket titles should appear
    expect(mermaid).toContain("冲突单A");
    expect(mermaid).toContain("冲突单B");
  });
});
