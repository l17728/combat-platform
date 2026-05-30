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

// Resolve the repo's `config/schemas` absolutely from THIS test file's location,
// not via process.cwd() (which differs between vitest invocations and would
// require a cwd-shim that breaks the existing registry.test.ts relative path).
const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

async function makeApp() {
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-arc-")), "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("archive (release/weight) e2e — config-driven, zero backend code", () => {
  it("releasePackage CRUD + required guard + ref→person + anchor→问题单号", async () => {
    const { app, repo } = await makeApp();
    const bad = await request(app).post("/api/nodes/releasePackage").send({ 产品: "X" });
    expect(bad.status).toBe(400);
    const c = await request(app).post("/api/nodes/releasePackage").send({
      版本号: "v1.0.0-RC", 产品: "ModelArts", 责任人: "张归档", 关联问题单: "ARC-1", 链接: "https://x/v1.0.0",
    });
    expect(c.status).toBe(201);
    expect(c.body.properties["版本号"]).toBe("v1.0.0-RC");
    const refs = await repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" });
    expect(refs.length).toBe(1);
    expect(refs[0].properties["field"]).toBe("责任人");
    const anchors = await repo.queryEdges({ sourceId: c.body.id, edgeType: "ANCHORED_TO" });
    expect(anchors.length).toBe(1);
    expect(anchors[0].properties["anchorKind"]).toBe("问题单号");
    const lst = await request(app).get("/api/nodes/releasePackage");
    expect(lst.body.map((n: any) => n.properties["版本号"])).toContain("v1.0.0-RC");
    const up = await request(app).put(`/api/nodes/${c.body.id}`).send({ 描述: "RC 候选" });
    expect(up.status).toBe(200);
    const del = await request(app).delete(`/api/nodes/${c.body.id}`);
    expect(del.status).toBe(200);
  });

  it("weightFile happy path + same generic CRUD reuse", async () => {
    const { app } = await makeApp();
    const bad = await request(app).post("/api/nodes/weightFile").send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post("/api/nodes/weightFile").send({
      名称: "BERT-base-v3.2", 模型: "BERT", 责任人: "李训", 关联问题单: "ARC-2", 链接: "s3://x/y",
    });
    expect(c.status).toBe(201);
    expect(c.body.properties["名称"]).toBe("BERT-base-v3.2");
  });

  it("cross-view cross-nodeType coAnchored — attackTicket + releasePackage + weightFile via shared 问题单号", async () => {
    const { app } = await makeApp();
    const PB = "ARC-X-" + Date.now();
    const at = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "归档关联攻关", 状态: "进行中", 问题单号: PB })).body;
    const rp = (await request(app).post("/api/nodes/releasePackage").send({ 版本号: "归档v9", 关联问题单: PB })).body;
    const wf = (await request(app).post("/api/nodes/weightFile").send({ 名称: "归档W9", 关联问题单: PB })).body;
    const relAt = await request(app).get(`/api/related/attackTicket/${at.id}`);
    const ids = relAt.body.coAnchored.map((x: any) => x.node.id);
    expect(ids).toContain(rp.id);
    expect(ids).toContain(wf.id);
    const relRp = await request(app).get(`/api/related/releasePackage/${rp.id}`);
    const idsRp = relRp.body.coAnchored.map((x: any) => x.node.id);
    expect(idsRp).toContain(at.id);
    expect(idsRp).toContain(wf.id);
  });

  it("/api/query/search finds new nodeTypes by property substring", async () => {
    const { app } = await makeApp();
    const tag = "ARC检索X-" + Date.now();
    await request(app).post("/api/nodes/releasePackage").send({ 版本号: tag, 产品: "搜得到" });
    await request(app).post("/api/nodes/weightFile").send({ 名称: "W-" + tag, 模型: "搜得到W" });
    const hits = (await request(app).get(`/api/query/search?q=${encodeURIComponent(tag)}`)).body;
    const types = new Set(hits.map((h: any) => h.nodeType));
    expect(types.has("releasePackage")).toBe(true);
    expect(types.has("weightFile")).toBe(true);
  });
});
