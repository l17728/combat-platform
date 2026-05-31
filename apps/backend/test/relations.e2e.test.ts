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

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function make() {
  const repo = new SqliteRepository(
    new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-rel-")), "t.sqlite")))
  );
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§52 手工备注关联线（ad-hoc KG link, 并集呈现）", () => {
  it("人工拉线：任意两记录 + 备注 → 边存入 KG；related 并集呈现 manualLinks", async () => {
    const { app } = make();
    const tk = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连攻关", 状态: "进行中" })).body;
    const exp = (await request(app).post("/api/nodes/experience").send({ 经验: "断连排查经验" })).body;
    // manager draws a line: this attackTicket's 标题 relates to that experience, with a note
    const link = await request(app).post("/api/relations/manual").send({
      sourceId: tk.id,
      targetId: exp.id,
      sourceField: "标题",
      reason: "同一断连问题的历史经验",
    });
    expect(link.status).toBe(201);
    expect(link.body.edgeId).toBeTruthy();
    // surfaced in related union (out direction from ticket)
    const rk = await request(app).get(`/api/related/attackTicket/${tk.id}`);
    expect((rk.body.manualLinks ?? []).map((m: any) => m.node.id)).toContain(exp.id);
    const ml = (rk.body.manualLinks ?? [])[0];
    expect(ml.reason).toContain("历史经验");
    expect(ml.sourceField).toBe("标题");
    expect(ml.direction).toBe("out");
    // reverse direction visible from the experience side
    const re = await request(app).get(`/api/related/experience/${exp.id}`);
    const back = (re.body.manualLinks ?? [])[0];
    expect(back.node.id).toBe(tk.id);
    expect(back.direction).toBe("in");
  });

  it("GET list + DELETE unlink", async () => {
    const { app } = make();
    const a = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" })).body;
    const b = (await request(app).post("/api/nodes/experience").send({ 经验: "B" })).body;
    const link = (
      await request(app).post("/api/relations/manual").send({ sourceId: a.id, targetId: b.id, reason: "x" })
    ).body;
    expect((await request(app).get(`/api/relations/manual?nodeId=${a.id}`)).body.length).toBe(1);
    expect((await request(app).delete(`/api/relations/manual/${link.edgeId}`)).status).toBe(200);
    expect((await request(app).get(`/api/relations/manual?nodeId=${a.id}`)).body.length).toBe(0);
    // delete non-existent → 404
    expect((await request(app).delete(`/api/relations/manual/nope`)).status).toBe(404);
  });

  it("校验：自身/不存在节点 → 400/404", async () => {
    const { app } = make();
    const a = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" })).body;
    expect(
      (await request(app).post("/api/relations/manual").send({ sourceId: a.id, targetId: a.id, reason: "x" })).status
    ).toBe(400);
    expect(
      (await request(app).post("/api/relations/manual").send({ sourceId: a.id, targetId: "nope", reason: "x" })).status
    ).toBe(404);
    expect((await request(app).post("/api/relations/manual").send({ targetId: a.id, reason: "x" })).status).toBe(400);
  });
});
