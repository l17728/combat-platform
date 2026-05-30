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
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-transition-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§41 攻关单状态流转 e2e", () => {
  it("正常流转：状态更新 + 原子追加 progress(快照=目标, 含 X→Y)", async () => {
    const { app } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "流转单", 状态: "进行中" })).body;
    const r = await request(app).post(`/api/nodes/${t.id}/transition`).send({ toStatus: "已解决" });
    expect(r.status).toBe(200);
    expect(r.body.node.properties.状态).toBe("已解决");
    expect(r.body.progress.statusSnapshot).toBe("已解决");
    expect(r.body.progress.content).toContain("进行中→已解决");
    // progress series reflects it
    const seq = (await request(app).get(`/api/nodes/${t.id}/progress`)).body;
    expect(seq[seq.length - 1].statusSnapshot).toBe("已解决");
  });

  it("带备注：note 写入 progress.content", async () => {
    const { app } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "备注单", 状态: "待响应" })).body;
    const r = await request(app).post(`/api/nodes/${t.id}/transition`).send({ toStatus: "处理中", note: "已分派给甲" });
    expect(r.status).toBe(200);
    expect(r.body.progress.content).toContain("已分派给甲");
    expect(r.body.progress.content).toContain("待响应→处理中");
  });

  it("校验：非法状态 / 非 attackTicket → 400", async () => {
    const { app } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "校验单", 状态: "进行中" })).body;
    expect((await request(app).post(`/api/nodes/${t.id}/transition`).send({ toStatus: "不存在态" })).status).toBe(400);
    expect((await request(app).post(`/api/nodes/${t.id}/transition`).send({ toStatus: "" })).status).toBe(400);
    const p = (await request(app).post("/api/nodes/person").send({ 姓名: "甲" })).body;
    expect((await request(app).post(`/api/nodes/${p.id}/transition`).send({ toStatus: "已解决" })).status).toBe(400);
    expect((await request(app).post(`/api/nodes/不存在/transition`).send({ toStatus: "已解决" })).status).toBe(404);
  });
});
