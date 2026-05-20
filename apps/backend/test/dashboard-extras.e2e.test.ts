import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-dash-extras-"));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§36 dashboard 升级 e2e", () => {
  it("空 db → 新字段 0/空数组", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.conflicts).toEqual({ count: 0, topReasons: [] });
    expect(r.body.today).toEqual({ progressEntries: 0, ticketsTouched: 0 });
    expect(r.body.recentActivity).toEqual([]);
  });

  it("同人 2 active → conflicts.count ≥ 1, reason 含「同负责人多并发」", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中", 当前处理人: "甲" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "B", 状态: "进行中", 当前处理人: "甲" });
    await request(app).post("/api/conflicts/scan");
    const r = await request(app).get("/api/dashboard");
    expect(r.body.conflicts.count).toBeGreaterThanOrEqual(1);
    expect(r.body.conflicts.topReasons.some((s: string) => s.includes("同负责人多并发"))).toBe(true);
  });

  it("追加 progress → today.progressEntries 计入；recentActivity 按 updatedAt 倒序", async () => {
    const { app } = makeApp();
    const t1 = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "早", 状态: "进行中" })).body;
    const t2 = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "晚", 状态: "进行中" })).body;
    // append 2 progress entries on t2 to bump its updatedAt and rotate it to top
    await request(app).post(`/api/nodes/${t2.id}/progress`).send({ content: "进展1", statusSnapshot: "进行中", actor: "甲" });
    await request(app).post(`/api/nodes/${t2.id}/progress`).send({ content: "进展2", statusSnapshot: "进行中", actor: "甲" });
    const r = await request(app).get("/api/dashboard");
    expect(r.body.today.progressEntries).toBeGreaterThanOrEqual(2);
    expect(r.body.today.ticketsTouched).toBeGreaterThanOrEqual(1);
    expect(r.body.recentActivity.length).toBeGreaterThanOrEqual(2);
    // most recently updated (t2) should be at position 0
    expect(r.body.recentActivity[0].ticketId).toBe(t2.id);
    void t1;
  });
});
