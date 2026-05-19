import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-concept-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person", concept: "负责人" },
      { name: "协办人", type: "ref", label: "协办人", refType: "person" },
    ],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [
      { name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true, concept: "负责人" },
      { name: "贡献类型", type: "string", label: "贡献类型" },
    ],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId", "email"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true },
             { name: "employeeId", type: "string", label: "工号" }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, cfg };
}

describe("concept e2e", () => {
  it("REF edge carries the field's concept and /api/related surfaces it", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连", 当前处理人: "张三" });
    expect(c.status).toBe(201);
    const edge = repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" })[0];
    expect(edge.properties["concept"]).toBe("负责人");
    const pid = repo.queryNodes("person")[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.status).toBe(200);
    expect(r.body.incoming[0].concept).toBe("负责人");
    expect(r.body.incoming[0].field).toBe("当前处理人");
  });
  it("same person referenced via two differently-named ref fields → both relations concept=负责人", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "李四" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "李四", 贡献类型: "实施" });
    const pid = repo.queryNodes("person")[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.body.incoming).toHaveLength(2);
    expect(r.body.incoming.map((x: any) => x.concept).sort()).toEqual(["负责人", "负责人"]);
    expect(r.body.incoming.map((x: any) => x.field).sort()).toEqual(["当前处理人", "贡献人"]);
  });
  it("ref field WITHOUT concept → related item concept is '' (RelatedPage falls back to nodeType)", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "无concept边", 当前处理人: "钱七", 协办人: "钱七" });
    const pid = repo.queryNodes("person")[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.body.incoming).toHaveLength(2);
    const byField = Object.fromEntries(r.body.incoming.map((x: any) => [x.field, x.concept]));
    expect(byField["当前处理人"]).toBe("负责人");
    expect(byField["协办人"]).toBe(""); // empty concept → frontend `x.concept || x.node.nodeType` → nodeType group
  });
  it("PATCH setConcept persists to config + reload; non-string -> 400, config unchanged", async () => {
    const { app, cfg } = makeApp();
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "setConcept", id: "标题", concept: "标识" });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "标题").concept).toBe("标识");
    const onDisk = JSON.parse(readFileSync(join(cfg, "attackTicket.json"), "utf8"));
    expect(onDisk.fields.find((f: any) => f.id === "标题").concept).toBe("标识");
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const bad = await request(app).patch("/api/schema/attackTicket").send({ op: "setConcept", id: "标题" });
    expect(bad.status).toBe(400);
    const bad2 = await request(app).patch("/api/schema/attackTicket").send({ op: "setConcept", id: "标题", concept: 42 });
    expect(bad2.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);
  });
});
