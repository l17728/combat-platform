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

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-prop-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person", concept: "负责人" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("relation proposals e2e", () => {
  it("scan proposes SAME_AS for near (non-exact) persons; exact not proposed; idempotent", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "张伟" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "张玮" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T3", 当前处理人: "李雷" });
    const s1 = await request(app).post("/api/proposals/scan").send({});
    expect(s1.status).toBe(200);
    expect(s1.body.created).toBe(1);
    const s2 = await request(app).post("/api/proposals/scan").send({});
    expect(s2.body.created).toBe(0);
    const list = await request(app).get("/api/proposals?status=待审批");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].relationType).toBe("SAME_AS");
    expect(list.body[0].status).toBe("待审批");
  });

  it("decide 通过 merges persons authoritatively: edge migration + 原引用可达 + audit; re-decide → 409", async () => {
    const { app, repo } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "王芳" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T3", 当前处理人: "王萍" });
    await request(app).post("/api/proposals/scan").send({});
    const prop = (await request(app).get("/api/proposals?status=待审批")).body[0];
    const pid = prop.id;
    const before = (await repo.queryNodes("person")).length;
    const d = await request(app).post(`/api/proposals/${pid}/decide`).send({ decision: "通过", decidedBy: "运营" });
    expect(d.status).toBe(200);
    expect((await repo.queryNodes("person")).length).toBe(before - 1);
    // merged-away source gone; surviving target = proposal.targetNodeId
    expect(await repo.getNode(prop.sourceNodeId)).toBeNull();
    const survivor = await repo.getNode(prop.targetNodeId);
    expect(survivor).not.toBeNull();
    // §20.4 边迁移 + 原引用可达: BOTH tickets' REF edges now resolve to the survivor
    const rel = await request(app).get(`/api/related/person/${prop.targetNodeId}`);
    const titles = rel.body.incoming.map((x: any) => x.node.properties["标题"]).sort();
    expect(titles).toEqual(["T1", "T3"]);
    const got = (await request(app).get("/api/proposals?status=已通过")).body;
    expect(got.find((x: any) => x.id === pid)?.decidedBy).toBe("运营");
    const again = await request(app).post(`/api/proposals/${pid}/decide`).send({ decision: "通过", decidedBy: "运营" });
    expect(again.status).toBe(409);
  });

  it("decide 拒绝 → 已拒绝 + subsequent scan suppresses that triple", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "陈晨" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "陈辰" });
    await request(app).post("/api/proposals/scan").send({});
    const pid = (await request(app).get("/api/proposals?status=待审批")).body[0].id;
    const r = await request(app).post(`/api/proposals/${pid}/decide`).send({ decision: "拒绝", decidedBy: "运营" });
    expect(r.status).toBe(200);
    const s = await request(app).post("/api/proposals/scan").send({});
    expect(s.body.created).toBe(0);
    expect((await request(app).get("/api/proposals?status=待审批")).body).toHaveLength(0);
  });

  it("/api/related?includeCandidates=1 adds candidates; authoritative lists never contain them; no-param == 3b", async () => {
    const { app, repo } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "刘洋" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "刘阳" });
    await request(app).post("/api/proposals/scan").send({});
    const persons = await repo.queryNodes("person");
    const pid = persons[0].id;
    const plain = await request(app).get(`/api/related/person/${pid}`);
    expect(plain.body.candidates).toBeUndefined();
    expect(Array.isArray(plain.body.incoming)).toBe(true);
    const withC = await request(app).get(`/api/related/person/${pid}?includeCandidates=1`);
    expect(Array.isArray(withC.body.candidates)).toBe(true);
    expect(withC.body.candidates.length).toBeGreaterThanOrEqual(1);
    const allAuth = [...withC.body.outgoing, ...withC.body.incoming];
    expect(allAuth.every((x: any) => x.proposalId === undefined)).toBe(true);
  });

  it("HeuristicRelationProposer is deterministic (same input → same output)", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "赵敏" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "赵明" });
    const a = await request(app).post("/api/proposals/scan").send({});
    expect(a.body.created).toBe(1);
    const list1 = (await request(app).get("/api/proposals")).body.map((x: any) => x.rationale).sort();
    const { app: app2 } = await makeApp();
    await request(app2).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "赵敏" });
    await request(app2).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "赵明" });
    await request(app2).post("/api/proposals/scan").send({});
    const list2 = (await request(app2).get("/api/proposals")).body.map((x: any) => x.rationale).sort();
    expect(list2).toEqual(list1);
  });
});
