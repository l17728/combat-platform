import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-query-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, db: (repo as any).db };
}

describe("read-only query API e2e", () => {
  it("search: substring, case-insensitive, type filter, empty→400, limit, deterministic order", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断网攻关Alpha", 当前处理人: "甲" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断网攻关Beta断网", 当前处理人: "乙" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "无关单", 当前处理人: "丙" });
    const bad = await request(app).get("/api/query/search");
    expect(bad.status).toBe(400);
    const r = await request(app).get("/api/query/search?q=" + encodeURIComponent("断网"));
    expect(r.status).toBe(200);
    const titles = r.body.map((h: any) => h.summary);
    expect(titles).toContain("断网攻关Alpha");
    expect(titles).toContain("断网攻关Beta断网");
    expect(titles).not.toContain("无关单");
    expect(r.body[0].summary).toBe("断网攻关Beta断网");
    const ci = await request(app).get("/api/query/search?q=alpha");
    expect(ci.body.map((h: any) => h.summary)).toContain("断网攻关Alpha");
    const typed = await request(app).get("/api/query/search?q=" + encodeURIComponent("断网") + "&type=person");
    expect(typed.body).toHaveLength(0);
    const lim = await request(app).get("/api/query/search?q=" + encodeURIComponent("断网") + "&limit=1");
    expect(lim.body).toHaveLength(1);
  });

  it("search is read-only: audit_log row count unchanged across calls", async () => {
    const { app, db } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "只读校验单" });
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    await request(app).get("/api/query/search?q=" + encodeURIComponent("只读"));
    await request(app).get("/api/query/search?q=" + encodeURIComponent("只读"));
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
  });

  it("context: node + related(REF/coAnchored) + progress; 404 missing; matches /api/related", async () => {
    const { app } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "上下文单", 当前处理人: "钱七" })).body;
    await request(app).post(`/api/nodes/${t.id}/progress`).send({ content: "进展X", statusSnapshot: "进行中", actor: "seed" });
    const miss = await request(app).get("/api/query/context/nope");
    expect(miss.status).toBe(404);
    const ctx = await request(app).get(`/api/query/context/${t.id}`);
    expect(ctx.status).toBe(200);
    expect(ctx.body.node.id).toBe(t.id);
    expect(ctx.body.progress.map((p: any) => p.content)).toContain("进展X");
    expect(ctx.body.related.outgoing.some((x: any) => x.node.nodeType === "person")).toBe(true);
    const rel = await request(app).get(`/api/related/attackTicket/${t.id}`);
    expect(ctx.body.related.outgoing.map((x: any) => x.node.id).sort())
      .toEqual(rel.body.outgoing.map((x: any) => x.node.id).sort());
  });
});
