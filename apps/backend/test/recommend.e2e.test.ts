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
  const dir = mkdtempSync(join(tmpdir(), "combat-rec-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" },
      { name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [{ name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true },
      { name: "贡献类型", type: "string", label: "贡献类型" },
      { name: "贡献等级", type: "string", label: "贡献等级" },
      { name: "贡献描述", type: "string", label: "贡献描述" },
      { name: "关联问题单", type: "string", label: "关联问题单", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, db: (repo as any).db };
}

describe("find-helper recommendation e2e", () => {
  it("ranks shared-anchor handler + core contributor, excludes self, fallback last; reasons cite 问题单", async () => {
    const { app } = makeApp();
    const T = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "主攻关单", 问题单号: "PB-1", 当前处理人: "甲" })).body;
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "同域攻关单", 问题单号: "PB-1", 当前处理人: "乙" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "丙", 关联问题单: "PB-1", 贡献等级: "核心", 贡献描述: "定位根因" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "丁", 贡献等级: "关键", 贡献描述: "无关贡献" });

    const r = await request(app).get(`/api/recommend/helpers/${T.id}`);
    expect(r.status).toBe(200);
    const names = r.body.map((h: any) => String(h.person.properties["name"]));
    expect(names).not.toContain("甲");
    expect(names).toContain("乙");
    expect(names).toContain("丙");
    expect(names).toContain("丁");
    expect(names.indexOf("丁")).toBeGreaterThan(names.indexOf("乙"));
    expect(names.indexOf("丁")).toBeGreaterThan(names.indexOf("丙"));
    const reasonsAll = r.body.flatMap((h: any) => h.reasons).join(" ");
    expect(reasonsAll).toContain("PB-1");
    // fallback is last-resort: 乙(anchor handler)=丙(anchor 核心 contrib)=3
    // (丙 NOT double-credited by the general fallback); 丁(fallback only)=1
    const byName = Object.fromEntries(r.body.map((h: any) => [String(h.person.properties["name"]), h.score]));
    expect(byName["乙"]).toBe(3);
    expect(byName["丙"]).toBe(3);
    expect(byName["丁"]).toBe(1);
    // structural proof 丙 not double-credited: exactly the anchor reason, no fallback reason
    const bing = r.body.find((h: any) => String(h.person.properties["name"]) === "丙");
    expect(bing.reasons).toHaveLength(1);
    const r2 = await request(app).get(`/api/recommend/helpers/${T.id}`);
    expect(r2.body.map((h: any) => h.person.id)).toEqual(r.body.map((h: any) => h.person.id));
  });

  it("404 unknown id; 400 non-attackTicket; read-only (audit_log unchanged)", async () => {
    const { app, db } = makeApp();
    const c = (await request(app).post("/api/nodes/contribution").send({ 贡献人: "戊" })).body;
    expect((await request(app).get("/api/recommend/helpers/nope")).status).toBe(404);
    expect((await request(app).get(`/api/recommend/helpers/${c.id}`)).status).toBe(400);
    const T = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "只读单", 问题单号: "PB-9" })).body;
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    await request(app).get(`/api/recommend/helpers/${T.id}`);
    await request(app).get(`/api/recommend/helpers/${T.id}`);
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
  });

  it("limit caps result count", async () => {
    const { app } = makeApp();
    const T = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "限量单", 问题单号: "PB-L" })).body;
    for (const p of ["A","B","C","D"])
      await request(app).post("/api/nodes/attackTicket").send({ 标题: "同域"+p, 问题单号: "PB-L", 当前处理人: p });
    const r = await request(app).get(`/api/recommend/helpers/${T.id}?limit=2`);
    expect(r.body).toHaveLength(2);
  });
});
