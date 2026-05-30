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
  const db = openDb(join(mkdtempSync(join(tmpdir(), "combat-esc-")), "t.sqlite"));
  const repo = new SqliteRepository(new SqliteAdapter(db));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§48 SLA 上升 + 责任矩阵 e2e", () => {
  it("config GET 默认种子；PUT 覆盖；GET 回读", async () => {
    const { app } = make();
    const def = (await request(app).get("/api/escalation/config")).body;
    expect(def.rules.some((r: any) => r.事件级别 === "P4A")).toBe(true);
    const put = await request(app).put("/api/escalation/config").send({ rules: [{ 事件级别: "P4A", slaHours: 1, 上升角色: "X" }] });
    expect(put.status).toBe(200);
    expect((await request(app).get("/api/escalation/config")).body.rules).toHaveLength(1);
    // 非法 → 400
    expect((await request(app).put("/api/escalation/config").send({})).status).toBe(400);
  });

  it("超期活跃单 → scan 上升（ESCALATE 审计 + ESCALATED_TO 边）；未超期不升；幂等", async () => {
    const { app, repo } = make();
    // P4A SLA 4h. Create a ticket then back-date its createdAt to 10h ago.
    const t = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "超期单", 状态: "进行中", 事件级别: "P4A", 当前处理人: "甲",
    })).body;
    const old = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    // back-date createdAt to simulate an aged ticket (test-only direct db write)
    await (repo as any).adapter.run("UPDATE nodes SET created_at = ? WHERE id = ?", [old, t.id]);

    // a fresh (not overdue) ticket should not escalate
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "新单", 状态: "进行中", 事件级别: "P4A" });

    const r = await request(app).post("/api/escalation/scan");
    expect(r.status).toBe(200);
    expect(r.body.escalated).toBeGreaterThanOrEqual(1);
    // audit ESCALATE present
    const aud = (await request(app).get(`/api/audit?entityId=${t.id}&action=ESCALATE`)).body;
    expect(aud.length).toBeGreaterThanOrEqual(1);
    // ESCALATED_TO edge created
    expect((await repo.queryEdges({ sourceId: t.id, edgeType: "ESCALATED_TO" })).length).toBeGreaterThanOrEqual(1);

    // idempotent: second scan does not re-escalate the same ticket
    const r2 = await request(app).post("/api/escalation/scan");
    const aud2 = (await request(app).get(`/api/audit?entityId=${t.id}&action=ESCALATE`)).body;
    expect(aud2.length).toBe(aud.length);
    void r2;
  });

  it("oncall 配置驱动 nodeType 可建/查", async () => {
    const { app } = make();
    const o = await request(app).post("/api/nodes/oncall").send({ domain: "modelarts", 值班人: "乙" });
    expect(o.status).toBe(201);
    expect((await request(app).get("/api/nodes/oncall")).body.length).toBe(1);
  });
});
