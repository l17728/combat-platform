import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-anchor-"));
  const cfg = join(dir, "schemas");
  mkdirSync(cfg);
  writeFileSync(
    join(cfg, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        { name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" },
      ],
    })
  );
  writeFileSync(
    join(cfg, "contribution.json"),
    JSON.stringify({
      nodeType: "contribution",
      label: "贡献记录",
      identityKeys: [],
      derivedToKG: true,
      fields: [
        { name: "贡献人", type: "string", label: "贡献人", required: true },
        { name: "关联问题单", type: "string", label: "关联问题单", anchor: "问题单号" },
      ],
    })
  );
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, cfg };
}

describe("cross-granularity anchor e2e", () => {
  it("anchor field → shared anchor node + ANCHORED_TO edge with anchorKind", async () => {
    const { app, repo } = await makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 问题单号: "PB-1" });
    expect(c.status).toBe(201);
    const anchors = await repo.queryNodes("问题单号");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].properties["key"]).toBe("PB-1");
    const e = (await repo.queryEdges({ sourceId: c.body.id, edgeType: "ANCHORED_TO" }))[0];
    expect(e.targetId).toBe(anchors[0].id);
    expect(e.properties["anchorKind"]).toBe("问题单号");
  });

  it("differently-named anchor fields, same value → ONE shared anchor; no direct coarse-coarse edge; coAnchored derived & symmetric", async () => {
    const { app, repo } = await makeApp();
    const at = await request(app).post("/api/nodes/attackTicket").send({ 标题: "AT", 问题单号: "PB-9" });
    const co = await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 关联问题单: "PB-9" });
    expect(await repo.queryNodes("问题单号")).toHaveLength(1);
    expect(await repo.queryEdges({ sourceId: at.body.id, targetId: co.body.id })).toHaveLength(0);
    expect(await repo.queryEdges({ sourceId: co.body.id, targetId: at.body.id })).toHaveLength(0);
    const relAt = await request(app).get(`/api/related/attackTicket/${at.body.id}`);
    expect(relAt.body.coAnchored.map((x: any) => x.node.id)).toContain(co.body.id);
    expect(relAt.body.coAnchored[0].anchorKind).toBe("问题单号");
    expect(relAt.body.coAnchored[0].anchorKey).toBe("PB-9");
    const relCo = await request(app).get(`/api/related/contribution/${co.body.id}`);
    expect(relCo.body.coAnchored.map((x: any) => x.node.id)).toContain(at.body.id);
  });

  it("no anchor data → coAnchored []; ANCHORED_TO foldable into related outgoing", async () => {
    const { app } = await makeApp();
    const at = await request(app).post("/api/nodes/attackTicket").send({ 标题: "noAnchor" });
    const rel = await request(app).get(`/api/related/attackTicket/${at.body.id}`);
    expect(rel.body.coAnchored).toEqual([]);
    const at2 = await request(app).post("/api/nodes/attackTicket").send({ 标题: "withA", 问题单号: "PB-2" });
    const rel2 = await request(app).get(`/api/related/attackTicket/${at2.body.id}`);
    expect(rel2.body.outgoing.some((x: any) => x.node.nodeType === "问题单号")).toBe(true);
  });

  it("PATCH setAnchor persists + reload; non-string → 400 + config unchanged; update re-syncs idempotently", async () => {
    const { app, cfg } = await makeApp();
    const p = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "setAnchor", id: "标题", anchor: "问题单号" });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "标题").anchor).toBe("问题单号");
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const bad = await request(app).patch("/api/schema/attackTicket").send({ op: "setAnchor", id: "标题" });
    expect(bad.status).toBe(400);
    const bad2 = await request(app).patch("/api/schema/attackTicket").send({ op: "setAnchor", id: "标题", anchor: 7 });
    expect(bad2.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);
    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "U", 问题单号: "PB-A" });
    await request(app).put(`/api/nodes/${t.body.id}`).send({ 问题单号: "PB-B" });
    const rel = await request(app).get(`/api/related/attackTicket/${t.body.id}`);
    const anchorOut = rel.body.outgoing.filter((x: any) => x.node.nodeType === "问题单号");
    // delete-first idempotency: exactly ONE ANCHORED_TO survives (old PB-A gone)
    expect(anchorOut).toHaveLength(1);
    expect(anchorOut.map((x: any) => x.node.properties["key"])).toEqual(["PB-B"]);
  });
});
