import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeRealSchemaTestApp } from "./helpers.js";

function makeApp() {
  const { app, repo } = makeRealSchemaTestApp();
  return { app, repo };
}

describe("§40 手动人员合并 e2e", () => {
  it("preview: 显示 unionedFields + edgesToMigrate", async () => {
    const { app } = makeApp();
    const A = (await request(app).post("/api/nodes/person").send({ 姓名: "张三", 邮箱: "zs@x.com" })).body;
    const B = (await request(app).post("/api/nodes/person").send({ 姓名: "张三", 工号: "E001" })).body;
    // A 作为某攻关单当前处理人 → 建 REF 入边到 A
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "单", 状态: "进行中", 当前处理人: "张三" });
    // Note: ref resolves by name → may attach to A or B (first match). Use direct preview regardless.
    const r = await request(app).get(`/api/merge/preview?fromId=${A.id}&toId=${B.id}`);
    expect(r.status).toBe(200);
    expect(r.body.unionedFields).toContain("邮箱");
    expect(typeof r.body.edgesToMigrate).toBe("number");
  });

  it("commit: from 消失、to 获并集、边迁移、审计 MERGE", async () => {
    const { app } = makeApp();
    const A = (await request(app).post("/api/nodes/person").send({ 姓名: "李四A", 邮箱: "ls@x.com" })).body;
    const B = (await request(app).post("/api/nodes/person").send({ 姓名: "李四B", 工号: "E002" })).body;
    // make an edge into A by creating a ticket whose 当前处理人 resolves to A's name
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "迁移单", 状态: "进行中", 当前处理人: "李四A" });
    const merged = await request(app).post("/api/merge/person").send({ fromId: A.id, toId: B.id });
    expect(merged.status).toBe(200);
    expect(merged.body.id).toBe(B.id);
    expect(merged.body.properties["邮箱"]).toBe("ls@x.com"); // unioned from A
    // A gone
    expect((await request(app).get(`/api/nodes/${A.id}`)).status).toBe(404);
    // audit MERGE present on B
    const audit = (await request(app).get(`/api/audit?entityId=${B.id}&action=MERGE`)).body;
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("校验：自身合并 / 非 person → 400", async () => {
    const { app } = makeApp();
    const A = (await request(app).post("/api/nodes/person").send({ 姓名: "王五" })).body;
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "T", 状态: "进行中" })).body;
    expect((await request(app).post("/api/merge/person").send({ fromId: A.id, toId: A.id })).status).toBe(400);
    expect((await request(app).post("/api/merge/person").send({ fromId: A.id, toId: t.id })).status).toBe(400);
    expect((await request(app).get(`/api/merge/preview?fromId=${A.id}&toId=${t.id}`)).status).toBe(400);
  });
});
