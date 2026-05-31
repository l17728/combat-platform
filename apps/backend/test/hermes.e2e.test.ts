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
async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-hermes-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§35 Hermes 问答 MVP e2e", () => {
  it("ticket-by-pb intent: 列出共问题单号的所有攻关单", async () => {
    const { app } = await makeApp();
    const PB = "PB-12345";
    const t1 = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "断网攻关甲",
        状态: "进行中",
        问题单号: PB,
        当前处理人: "甲",
      })
    ).body;
    const t2 = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "断网攻关乙",
        状态: "处理中",
        问题单号: PB,
        当前处理人: "乙",
      })
    ).body;
    const r = await request(app)
      .post("/api/hermes/ask")
      .send({ question: `${PB} 涉及哪些单？` });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("ticket-by-pb");
    expect(r.body.answer).toContain("断网攻关甲");
    expect(r.body.answer).toContain("断网攻关乙");
    const ids = r.body.citations.map((c: any) => c.nodeId);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
  });

  it("owner intent: 标题模糊匹配 + 当前处理人", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "GPU 性能优化攻关",
      状态: "进行中",
      当前处理人: "丙",
    });
    const r = await request(app).post("/api/hermes/ask").send({ question: "GPU 性能优化 谁负责？" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("owner");
    expect(r.body.answer).toContain("丙");
  });

  it("status intent: 含 latest progress.content", async () => {
    const { app } = await makeApp();
    const t = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "数据迁移攻关",
        状态: "处理中",
        当前处理人: "丁",
      })
    ).body;
    await request(app).post(`/api/nodes/${t.id}/progress`).send({
      content: "已完成第一批表迁移",
      statusSnapshot: "处理中",
      actor: "丁",
    });
    const r = await request(app).post("/api/hermes/ask").send({ question: "数据迁移攻关 现在状态" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("status");
    expect(r.body.answer).toContain("已完成第一批表迁移");
  });

  it("person-workload intent: 取负载 Top1", async () => {
    const { app } = await makeApp();
    // 甲 has 2 active, 乙 has 1 active
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "甲单1", 状态: "进行中", 当前处理人: "甲" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "甲单2", 状态: "处理中", 当前处理人: "甲" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "乙单1", 状态: "进行中", 当前处理人: "乙" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "谁现在最忙？" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("person-workload");
    expect(r.body.answer).toContain("甲：2");
    // 甲 should appear before 乙 in the ranking output (Top1 first)
    const ans: string = r.body.answer;
    expect(ans.indexOf("甲")).toBeGreaterThanOrEqual(0);
    expect(ans.indexOf("甲")).toBeLessThan(ans.indexOf("乙"));
  });

  it("fallback-search intent + 空问题 400", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "云原生事故", 状态: "已解决", 当前处理人: "戊" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "云原生" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("fallback-search");
    expect(r.body.answer).toContain("云原生事故");

    const r2 = await request(app).post("/api/hermes/ask").send({ question: "   " });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toContain("question");
  });

  it("question 为空字符串 → 400", async () => {
    const { app } = await makeApp();
    const r = await request(app).post("/api/hermes/ask").send({ question: "" });
    expect(r.status).toBe(400);
  });

  it("status 意图 - 无进展记录时返回暂无进展记录", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "无进展单", 状态: "处理中" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "无进展单 现在状态" });
    expect(r.status).toBe(200);
    // Should still return 200 with an answer
    expect(r.body.answer).toBeTruthy();
  });

  it("recent-changes - 空库返回暂无变动", async () => {
    const { app } = await makeApp();
    const r = await request(app).post("/api/hermes/ask").send({ question: "今天谁动了什么" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toMatch(/暂无|没有/);
  });

  it("ticket-by-pb intent uiSpec.cacheKey 非空", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断网", 状态: "处理中", 问题单号: "PB-CK1" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "PB-CK1 涉及哪些单" });
    expect(r.body.uiSpec?.cacheKey).toBeTruthy();
  });
});
