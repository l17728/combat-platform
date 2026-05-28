import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp } from "./helpers.js";

describe("PATCH /api/schema e2e", () => {
  it("addField: new id writable/readable, no DDL", async () => {
    const { app } = makeTestApp();
    const p = await request(app).patch("/api/schema/attackTicket")
      .send({ op: "addField", field: { name: "根因服务", type: "string", label: "根因服务" } });
    expect(p.status).toBe(200);
    expect(p.body.fields.some((f: any) => f.id === "根因服务")).toBe(true);
    const c = await request(app).post("/api/nodes/attackTicket")
      .send({ 标题: "x", 状态: "进行中", 根因服务: "ModelArts" });
    expect(c.status).toBe(201);
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["根因服务"]).toBe("ModelArts");
  });
  it("renameLabel: label changes, data still read by id", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "保留我", 状态: "进行中" });
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "renameLabel", id: "标题", label: "问题标题" });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "标题").label).toBe("问题标题");
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["标题"]).toBe("保留我");
  });
  it("retire: data retained, not validated; unretire restores", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "t", 状态: "进行中" });
    expect((await request(app).patch("/api/schema/attackTicket").send({ op: "retire", id: "状态" })).status).toBe(200);
    expect((await request(app).post("/api/nodes/attackTicket").send({ 标题: "no-status" })).status).toBe(201);
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["状态"]).toBe("进行中");
    const u = await request(app).patch("/api/schema/attackTicket").send({ op: "unretire", id: "状态" });
    expect(u.body.fields.find((f: any) => f.id === "状态").retired).toBe(false);
  });
  it("invalid op rolls back: bad addField leaves schema usable", async () => {
    const { app, cfgDir } = makeTestApp();
    const before = readFileSync(join(cfgDir, "attackTicket.json"), "utf8");
    const r = await request(app).patch("/api/schema/attackTicket").send({ op: "addField", field: { name: "", type: "string", label: "" } });
    expect(r.status).toBe(400);
    expect(readFileSync(join(cfgDir, "attackTicket.json"), "utf8")).toBe(before);
    expect((await request(app).post("/api/nodes/attackTicket").send({ 标题: "still ok", 状态: "进行中" })).status).toBe(201);
  });
  it("addField rejects duplicate name (name is the property/form key)", async () => {
    const { app } = makeTestApp();
    const before = (await request(app).get("/api/schema/attackTicket")).body.fields.length;
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "addField", field: { name: "标题", type: "string", label: "另一个标题" } });
    expect(p.status).toBe(400);
    const after = (await request(app).get("/api/schema/attackTicket")).body.fields.length;
    expect(after).toBe(before);
  });
  it("editEnum changes allowed values and is enforced", async () => {
    const { app } = makeTestApp();
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "editEnum", id: "状态", enumValues: ["进行中", "已归档"] });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "状态").enumValues).toEqual(["进行中", "已归档"]);
    expect((await request(app).post("/api/nodes/attackTicket").send({ 标题: "ok", 状态: "已归档" })).status).toBe(201);
    expect((await request(app).post("/api/nodes/attackTicket").send({ 标题: "bad", 状态: "已解决" })).status).toBe(400);
  });
});
