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
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-rec-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, registry: new FileSchemaRegistry(CFG) };
}

describe("增量41 跨 view 记录对账分析（§55）", () => {
  it("55.1 完全同名 person（无 employeeId）→ 提 SAME_AS 候选", async () => {
    const { app } = make();
    await request(app).post("/api/nodes/person").send({ name: "周强" });
    await request(app).post("/api/nodes/person").send({ name: "周强" });
    await request(app).post("/api/proposals/scan");
    const props = (await request(app).get("/api/proposals?status=待审批")).body;
    expect(props.length).toBe(1);
    expect(props[0].relationType).toBe("SAME_AS");
    expect(props[0].confidence).toBe(1);
  });

  it("55.1 完全同名但 employeeId 均存在且不同 → 判定不同人，不提", async () => {
    const { app } = make();
    await request(app).post("/api/nodes/person").send({ name: "陈明", employeeId: "E1" });
    await request(app).post("/api/nodes/person").send({ name: "陈明", employeeId: "E2" });
    await request(app).post("/api/proposals/scan");
    const props = (await request(app).get("/api/proposals?status=待审批")).body;
    expect(props.length).toBe(0);
  });

  it("55.2 tickScheduledJobs 汇总含 proposals（对账纳入定期/手动任务）", async () => {
    const { app, repo, registry } = make();
    await request(app).post("/api/nodes/person").send({ name: "孙丽" });
    await request(app).post("/api/nodes/person").send({ name: "孙丽" });
    const sum = tickScheduledJobs(repo, registry);
    expect(sum.proposals).toBeGreaterThanOrEqual(1);
    // HTTP 触发也带 proposals 字段
    const r = await request(app).post("/api/jobs/tick");
    expect(r.status).toBe(200);
    expect(typeof r.body.proposals).toBe("number");
  });

  it("55.4 端到端：两 view 各自引用同一人(近似名) → tick 对账 → 管理者通过 → 合并去重", async () => {
    const { app, repo, registry } = make();
    // view A（攻关单）与 view B（现网问题）各自录入同一人的不同写法
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连攻关", 状态: "进行中", 当前处理人: "杨虹雨" });
    await request(app).post("/api/nodes/incidentTracking").send({ 问题说明: "断连现象", 运维责任人: "杨红雨" });
    const before = repo.queryNodes("person").length;
    expect(before).toBe(2); // 两个近似名的人各建一个
    // 后台对账（手动 tick）→ 候选入队
    tickScheduledJobs(repo, registry);
    const prop = (await request(app).get("/api/proposals?status=待审批")).body[0];
    expect(prop.relationType).toBe("SAME_AS");
    // 管理者确认通过 → 合并
    const d = await request(app).post(`/api/proposals/${prop.id}/decide`).send({ decision: "通过", decidedBy: "管理员" });
    expect(d.status).toBe(200);
    expect(repo.queryNodes("person").length).toBe(before - 1);
    // 合并后存活的人被两个 view 的记录共同引用（跨 view 关联统一）
    const rel = await request(app).get(`/api/related/person/${prop.targetNodeId}`);
    const titles = rel.body.incoming.map((x: any) => x.node.properties["标题"] ?? x.node.properties["问题说明"]).sort();
    expect(titles).toEqual(["断连攻关", "断连现象"]);
  });
});
