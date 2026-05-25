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
  const dir = mkdtempSync(join(tmpdir(), "combat-hermes-v2-"));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("§37 Hermes 意图扩展 v2", () => {
  it("contribution-by-person: 列出该人的贡献 Top5", async () => {
    const { app } = makeApp();
    // 贡献类型 enum is {发现, 设计, 实施, 协调, 公关}
    await request(app).post("/api/nodes/contribution").send({
      贡献人: "张三", 贡献等级: "核心", 贡献类型: "发现", 贡献描述: "解决断网根因",
    });
    await request(app).post("/api/nodes/contribution").send({
      贡献人: "张三", 贡献等级: "关键", 贡献类型: "设计", 贡献描述: "重构推理路径",
    });
    const r = await request(app).post("/api/hermes/ask").send({ question: "张三 贡献了什么？" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("contribution-by-person");
    expect(r.body.answer).toContain("解决断网根因");
    expect(r.body.answer).toContain("重构推理路径");
    expect(r.body.citations.length).toBeGreaterThanOrEqual(2);
  });

  it("recent-changes 今天：含变动 ticket + 进展计数", async () => {
    const { app } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "今日动单", 状态: "进行中",
    })).body;
    await request(app).post(`/api/nodes/${t.id}/progress`).send({
      content: "今日进展A", statusSnapshot: "进行中", actor: "甲",
    });
    const r = await request(app).post("/api/hermes/ask").send({ question: "今天 谁动了什么？" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("recent-changes");
    expect(r.body.answer).toContain("今天");
    expect(r.body.answer).toContain("今日动单");
  });

  it("find-helpers: 推荐基于共享问题单号的帮手", async () => {
    const { app } = makeApp();
    const PB = "PB-FH-001";
    // 历史共享问题单号的另一单（带 owner→自动建 person）
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "FH 历史单", 状态: "已解决", 问题单号: PB, 当前处理人: "老李",
    });
    // person 节点（被 ref 创建）— 后建，DESC 排序时被 findTicketsByPB 优先选中
    const t1 = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "FH 求助单", 状态: "进行中", 问题单号: PB,
    })).body;
    void t1;
    const r = await request(app).post("/api/hermes/ask").send({ question: `${PB} 找谁帮忙？` });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("find-helpers");
    expect(r.body.answer).toContain("老李");
  });

  it("find-helpers 无定位：友好提示", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/hermes/ask").send({ question: "找谁帮忙？" });
    expect(r.body.intent).toBe("find-helpers");
    expect(r.body.answer).toContain("未定位到");
  });
});
