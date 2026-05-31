import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("知识图谱全图端点 /kg/graph", () => {
  it("返回筛选后的节点与其间的边", async () => {
    const { app, repo } = await makeTestApp();
    const t1 = await repo.createNode("attackTicket", { 标题: "图测试单A", 状态: "处理中" }, "test");
    const p1 = await repo.createNode("person", { name: "图测试人" }, "test");
    await repo.createEdge("ASSIGNED_TO", t1.id, p1.id, {}, "test");

    const res = await request(app).get("/api/kg/graph");
    expect(res.status).toBe(200);
    const ids = res.body.nodes.map((n: any) => n.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(p1.id);
    expect(
      res.body.edges.some((e: any) => e.source === t1.id && e.target === p1.id && e.edgeType === "ASSIGNED_TO")
    ).toBe(true);
    // 节点带 label 供可视化展示
    expect(res.body.nodes.find((n: any) => n.id === t1.id).label).toBe("图测试单A");
  });

  it("按 types 过滤只返回指定类型节点", async () => {
    const { app, repo } = await makeTestApp();
    await repo.createNode("attackTicket", { 标题: "只要这个单", 状态: "待响应" }, "test");
    await repo.createNode("person", { name: "不应出现的人" }, "test");

    const res = await request(app).get("/api/kg/graph?types=attackTicket");
    expect(res.status).toBe(200);
    expect(res.body.nodes.every((n: any) => n.nodeType === "attackTicket")).toBe(true);
    expect(res.body.nodes.some((n: any) => n.label === "只要这个单")).toBe(true);
    expect(res.body.nodes.some((n: any) => n.nodeType === "person")).toBe(false);
  });

  it("人员节点标签用姓名而非 id", async () => {
    const { app, repo } = await makeTestApp();
    const p = await repo.createNode("person", { 姓名: "张三人KG", 工号: "EKG1" }, "test");
    const res = await request(app).get("/api/kg/graph?types=person");
    const pn = res.body.nodes.find((n: any) => n.id === p.id);
    expect(pn).toBeTruthy();
    expect(pn.label).toBe("张三人KG");
    expect(pn.label).not.toBe(p.id);
  });

  it("按关键词 q 过滤", async () => {
    const { app, repo } = await makeTestApp();
    await repo.createNode("attackTicket", { 标题: "关键词命中单KW", 状态: "处理中" }, "test");
    await repo.createNode("attackTicket", { 标题: "无关单", 状态: "处理中" }, "test");

    const res = await request(app).get("/api/kg/graph?q=KW");
    expect(res.status).toBe(200);
    expect(res.body.nodes.some((n: any) => n.label === "关键词命中单KW")).toBe(true);
    expect(res.body.nodes.some((n: any) => n.label === "无关单")).toBe(false);
  });
});
