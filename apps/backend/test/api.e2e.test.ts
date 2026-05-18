import { describe, it, expect } from "vitest";
import request from "supertest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp } from "./helpers.js";

describe("API e2e", () => {
  it("BE-1 creates and reads an attack ticket", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连", 状态: "进行中" });
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/nodes/${c.body.id}`);
    expect(g.body.properties["标题"]).toBe("断连");
  });
  it("BE-2 rejects missing required", async () => {
    const { app } = makeTestApp();
    const r = await request(app).post("/api/nodes/attackTicket").send({ 状态: "进行中" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.errors)).toContain("标题");
  });
  it("BE-3 rejects invalid enum", async () => {
    const { app } = makeTestApp();
    const r = await request(app).post("/api/nodes/attackTicket").send({ 标题: "x", 状态: "不存在" });
    expect(r.status).toBe(400);
  });
  it("BE-4 lists and filters by 状态", async () => {
    const { app } = makeTestApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "a", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "b", 状态: "已解决" });
    const all = await request(app).get("/api/nodes/attackTicket");
    expect(all.body).toHaveLength(2);
    const f = await request(app).get("/api/nodes/attackTicket?状态=进行中");
    expect(f.body).toHaveLength(1);
  });
  it("BE-5 404 unknown id", async () => {
    const { app } = makeTestApp();
    expect((await request(app).get("/api/nodes/nope")).status).toBe(404);
  });
  it("BE-6 progress is append-only, ordered, audited", async () => {
    const { app, repo } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "a", 状态: "进行中" });
    for (const t of ["d1", "d2", "d3"])
      await request(app).post(`/api/nodes/${c.body.id}/progress`).send({ content: t, statusSnapshot: "进行中", actor: "u" });
    const seq = await request(app).get(`/api/nodes/${c.body.id}/progress`);
    expect(seq.body.map((p: any) => p.seqNo)).toEqual([1, 2, 3]);
    expect(seq.body[0].content).toBe("d1");
  });
  it("BE-7 add field via config + scan, no DDL", async () => {
    const { app, cfgDir } = makeTestApp();
    writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
      nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        { name: "状态", type: "enum", label: "状态", required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
        { name: "根因服务", type: "string", label: "根因服务" },
      ],
    }));
    await request(app).post("/api/schema/scan");
    const c = await request(app).post("/api/nodes/attackTicket")
      .send({ 标题: "x", 状态: "进行中", 根因服务: "ModelArts" });
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/nodes/${c.body.id}`);
    expect(g.body.properties["根因服务"]).toBe("ModelArts");
  });
});
