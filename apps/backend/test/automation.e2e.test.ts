import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { tickScheduledJobs } from "../src/jobs.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function make() {
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-auto-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, registry: new FileSchemaRegistry(CFG) };
}

describe("增量34 后台自动化机制（§51, 仅后端）", () => {
  it("51.1 日报发布：当日有进展的单 日报发布数量+1，二次累加，审计留痕", async () => {
    const { app, repo } = make();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "日报单", 状态: "进行中" })).body;
    await request(app).post(`/api/nodes/${t.id}/progress`).send({ content: "今日进展", statusSnapshot: "进行中" });
    // 另造一个当日无进展的单 → 不应被计入
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "无进展单", 状态: "进行中" });

    // 不传 date → 默认按 Asia/Shanghai 当天；进展也是"此刻"记录，落在同一本地日
    const r1 = await request(app).post(`/api/daily-report/publish`);
    expect(r1.status).toBe(200);
    expect(r1.body.ticketsTouched).toBe(1);
    expect(r1.body.published).toBe(1);
    expect(Number((await request(app).get(`/api/nodes/${t.id}`)).body.properties["日报发布数量"])).toBe(1);

    const r2 = await request(app).post(`/api/daily-report/publish`);
    expect(r2.body.published).toBe(1);
    expect(Number((await request(app).get(`/api/nodes/${t.id}`)).body.properties["日报发布数量"])).toBe(2);

    expect(repo.listAuditLog({ action: "DAILY_REPORT_PUBLISH", entityId: t.id }).length).toBeGreaterThanOrEqual(2);
  });

  it("51.2 jobs:tick 汇总跑 conflicts/escalation/reminders", async () => {
    const { app, repo, registry } = make();
    // 两个同负责人活跃单 → 1 对 CONFLICTS_WITH
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "并发1", 状态: "进行中", 当前处理人: "赵六" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "并发2", 状态: "进行中", 当前处理人: "赵六" });
    const sum = tickScheduledJobs(repo, registry);
    expect(sum.conflicts).toBeGreaterThanOrEqual(1);
    expect(typeof sum.overlaps).toBe("number");
    expect(typeof sum.escalated).toBe("number");
    expect(typeof sum.reminders).toBe("number");
    // HTTP 触发
    const r = await request(app).post("/api/jobs/tick");
    expect(r.status).toBe(200);
    expect(r.body.conflicts).toBeGreaterThanOrEqual(1);
  });

  it("51.3 oncall:current 仅返回今天落在 [起,止] 区间的值班人", async () => {
    const { app } = make();
    const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    await request(app).post("/api/nodes/oncall").send({ domain: "ModelArts", 值班人: "张三", 起: day(-1), 止: day(1) });
    await request(app).post("/api/nodes/oncall").send({ domain: "ModelArts", 值班人: "李四", 起: day(5), 止: day(7) });
    const r = await request(app).get("/api/oncall/current?domain=ModelArts");
    expect(r.status).toBe(200);
    const row = r.body.find((x: any) => x.domain === "ModelArts");
    expect(row.值班人).toContain("张三");
    expect(row.值班人).not.toContain("李四");
  });

  it("51.4 荣誉 groupBy=team 按团队加权聚合", async () => {
    const { app } = make();
    await request(app).post("/api/nodes/person").send({ name: "甲", employeeId: "P1", 团队: "A组" });
    await request(app).post("/api/nodes/person").send({ name: "乙", employeeId: "P2", 团队: "B组" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "甲", 贡献类型: "实施", 贡献等级: "核心" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "乙", 贡献类型: "实施", 贡献等级: "普通" });
    const r = await request(app).get("/api/honor/leaderboard?groupBy=team");
    expect(r.status).toBe(200);
    const a = r.body.find((x: any) => x.team === "A组");
    const b = r.body.find((x: any) => x.team === "B组");
    expect(a.score).toBe(8); // 核心=8
    expect(b.score).toBe(1); // 普通=1
    // 向后兼容：无 groupBy 仍按人
    const byPerson = (await request(app).get("/api/honor/leaderboard")).body;
    expect(byPerson.find((x: any) => x.贡献人 === "甲")).toBeTruthy();
  });
});
