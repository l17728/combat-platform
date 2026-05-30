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

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-refs-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" },
    ],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [
      { name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true },
      { name: "贡献类型", type: "string", label: "贡献类型" },
    ],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId", "email"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true },
             { name: "employeeId", type: "string", label: "工号" }],
  }));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("refs e2e", () => {
  it("creating a node with a ref field resolves/creates the person and makes a REF edge", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连", 当前处理人: "张三" });
    expect(c.status).toBe(201);
    const persons = await repo.queryNodes("person");
    expect(persons).toHaveLength(1);
    expect(persons[0].properties["name"]).toBe("张三");
    const edges = await repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(persons[0].id);
    expect(edges[0].properties["field"]).toBe("当前处理人");
  });
  it("/api/related/person/:id returns nodes across views (attackTicket + contribution) referencing the person", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "张三" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献类型: "实施" });
    const pid = (await repo.queryNodes("person"))[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.status).toBe(200);
    const inTypes = r.body.incoming.map((x: any) => x.node.nodeType).sort();
    expect(inTypes).toEqual(["attackTicket", "contribution"]);
    const fields = r.body.incoming.map((x: any) => x.field).sort();
    expect(fields).toEqual(["当前处理人", "贡献人"]);
    expect(r.body.incoming.find((x: any) => x.node.nodeType === "attackTicket").node.id).toBe(c.body.id);
  });
  it("updating the ref field reuses existing person, deletes old REF edge, makes new — no dup/dangling", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T", 当前处理人: "张三" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "张三" });
    expect(await repo.queryNodes("person")).toHaveLength(1);
    await request(app).put(`/api/nodes/${c.body.id}`).send({ 当前处理人: "李四" });
    const persons = await repo.queryNodes("person");
    expect(persons.map(p => p.properties["name"]).sort()).toEqual(["张三", "李四"].sort());
    const edges = await repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" });
    expect(edges).toHaveLength(1);
    const li = persons.find(p => p.properties["name"] === "李四")!;
    expect(edges[0].targetId).toBe(li.id);
  });
  it("related unknown id -> 404", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/related/person/nope")).status).toBe(404);
  });
});
