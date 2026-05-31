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
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-sn-"));
  const db = openDb(join(dir, "t.sqlite"));
  const repo = new SqliteRepository(new SqliteAdapter(db));
  const registry = new FileSchemaRegistry(CFG);
  return { app: createApp({ repo, registry, db }), db };
}

describe("求助网络 support-node e2e", () => {
  it("1. POST /api/support-nodes/:ticketId → 创建节点，检查响应字段", async () => {
    const { app } = await makeApp();
    const r = await request(app)
      .post("/api/support-nodes/ticket-001")
      .send({ category: "领域专家", domain: "推理引擎", personName: "张三", note: "熟悉引擎内核" });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    expect(r.body.ticketId).toBe("ticket-001");
    expect(r.body.category).toBe("领域专家");
    expect(r.body.domain).toBe("推理引擎");
    expect(r.body.personName).toBe("张三");
    expect(r.body.status).toBe("待确认");
    expect(r.body.note).toBe("熟悉引擎内核");
    expect(r.body.createdAt).toBeTruthy();
    expect(r.body.parentId).toBeNull();
    expect(r.body.resolvedAt).toBeNull();
  });

  it("2. GET /api/support-nodes/:ticketId → 返回列表含刚创建的节点", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/support-nodes/ticket-002").send({ category: "环境", domain: "环境主持人" });
    await request(app).post("/api/support-nodes/ticket-002").send({ category: "团队协作", domain: "调度" });
    const r = await request(app).get("/api/support-nodes/ticket-002");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(2);
    expect(r.body[0].ticketId).toBe("ticket-002");
    // sorted by created_at ASC
    const categories = r.body.map((n: any) => n.category);
    expect(categories).toContain("环境");
    expect(categories).toContain("团队协作");
  });

  it("3. PUT /api/support-nodes/node/:nodeId → 更新 personName + status", async () => {
    const { app } = await makeApp();
    const created = (
      await request(app).post("/api/support-nodes/ticket-003").send({ category: "资源", domain: "管控面" })
    ).body;
    const r = await request(app)
      .put(`/api/support-nodes/node/${created.id}`)
      .send({ personName: "李四", status: "支持中" });
    expect(r.status).toBe(200);
    expect(r.body.personName).toBe("李四");
    expect(r.body.status).toBe("支持中");
    expect(r.body.category).toBe("资源"); // unchanged
  });

  it("4. 父子节点：创建父节点，创建子节点（parentId），GET 返回二者", async () => {
    const { app } = await makeApp();
    const parent = (await request(app).post("/api/support-nodes/ticket-004").send({ category: "环境", domain: "调度" }))
      .body;
    const child = (
      await request(app)
        .post("/api/support-nodes/ticket-004")
        .send({ category: "领域专家", domain: "推理引擎", parentId: parent.id })
    ).body;
    expect(child.parentId).toBe(parent.id);
    const list = (await request(app).get("/api/support-nodes/ticket-004")).body;
    expect(list).toHaveLength(2);
    const parentInList = list.find((n: any) => n.id === parent.id);
    const childInList = list.find((n: any) => n.id === child.id);
    expect(parentInList).toBeDefined();
    expect(childInList).toBeDefined();
    expect(childInList.parentId).toBe(parent.id);
  });

  it("5. DELETE /api/support-nodes/node/:nodeId → 删除父节点同时删子节点（子也消失）", async () => {
    const { app } = await makeApp();
    const parent = (await request(app).post("/api/support-nodes/ticket-005").send({ category: "环境", domain: "调度" }))
      .body;
    await request(app)
      .post("/api/support-nodes/ticket-005")
      .send({ category: "领域专家", domain: "管控面", parentId: parent.id });
    // Verify both exist
    const before = (await request(app).get("/api/support-nodes/ticket-005")).body;
    expect(before).toHaveLength(2);
    // Delete parent
    const del = await request(app).delete(`/api/support-nodes/node/${parent.id}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(2);
    // Both should be gone
    const after = (await request(app).get("/api/support-nodes/ticket-005")).body;
    expect(after).toHaveLength(0);
  });

  it("6. POST /api/support-templates → 创建模板（带 nodes 数组）", async () => {
    const { app } = await makeApp();
    const r = await request(app)
      .post("/api/support-templates")
      .send({
        name: "通用攻关模板",
        description: "含环境+专家+协作三层",
        nodes: [
          { category: "环境", domain: "环境主持人" },
          { category: "领域专家", domain: "推理引擎", parentIndex: 0 },
          { category: "团队协作", domain: "调度", parentIndex: 0 },
        ],
      });
    expect(r.status).toBe(201);
    expect(r.body.template).toBeDefined();
    expect(r.body.template.id).toBeTruthy();
    expect(r.body.template.name).toBe("通用攻关模板");
    expect(r.body.template.usageCount).toBe(0);
    expect(r.body.nodes).toHaveLength(3);
    // Child nodes should have parentId set
    const root = r.body.nodes.find((n: any) => n.domain === "环境主持人");
    const expert = r.body.nodes.find((n: any) => n.domain === "推理引擎");
    expect(root.parentId).toBeNull();
    expect(expert.parentId).toBe(root.id);
  });

  it("7. GET /api/support-templates → 返回模板列表", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/support-templates").send({ name: "模板A" });
    await request(app).post("/api/support-templates").send({ name: "模板B" });
    const r = await request(app).get("/api/support-templates");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(2);
    const names = r.body.map((t: any) => t.name);
    expect(names).toContain("模板A");
    expect(names).toContain("模板B");
  });

  it("8. POST /api/support-templates/:id/apply/:ticketId → 克隆节点到 ticket，usage_count +1", async () => {
    const { app } = await makeApp();
    // Create template with 2 nodes (parent + child)
    const tmplRes = (
      await request(app)
        .post("/api/support-templates")
        .send({
          name: "标准模板",
          nodes: [
            { category: "环境", domain: "调度" },
            { category: "领域专家", domain: "推理引擎", parentIndex: 0 },
          ],
        })
    ).body;
    const templateId = tmplRes.template.id;
    // Apply to ticket
    const r = await request(app).post(`/api/support-templates/${templateId}/apply/ticket-apply-01`);
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(2);
    expect(r.body.nodes).toHaveLength(2);
    // All cloned nodes reference correct ticketId
    expect(r.body.nodes.every((n: any) => n.ticketId === "ticket-apply-01")).toBe(true);
    expect(r.body.nodes.every((n: any) => n.templateId === templateId)).toBe(true);
    // Parent-child mapping preserved
    const rootClone = r.body.nodes.find((n: any) => n.domain === "调度");
    const childClone = r.body.nodes.find((n: any) => n.domain === "推理引擎");
    expect(rootClone.parentId).toBeNull();
    expect(childClone.parentId).toBe(rootClone.id);
    // usage_count incremented
    const templates = (await request(app).get("/api/support-templates")).body;
    const updated = templates.find((t: any) => t.id === templateId);
    expect(updated.usageCount).toBe(1);
    // Verify nodes appear in ticket list
    const ticketNodes = (await request(app).get("/api/support-nodes/ticket-apply-01")).body;
    expect(ticketNodes).toHaveLength(2);
  });

  it("9. POST /api/support-nodes → 缺少 category 返回 400", async () => {
    const { app } = await makeApp();
    const r = await request(app).post("/api/support-nodes/ticket-400").send({ domain: "调度" });
    expect(r.status).toBe(400);
  });

  it("10. DELETE /api/support-templates/:templateId → 删除模板及模板节点", async () => {
    const { app } = await makeApp();
    const tmpl = (
      await request(app)
        .post("/api/support-templates")
        .send({
          name: "待删模板",
          nodes: [{ category: "资源", domain: "管控面" }],
        })
    ).body;
    const templateId = tmpl.template.id;
    const del = await request(app).delete(`/api/support-templates/${templateId}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBeGreaterThanOrEqual(1);
    // Template no longer in list
    const list = (await request(app).get("/api/support-templates")).body;
    expect(list.find((t: any) => t.id === templateId)).toBeUndefined();
  });
});
