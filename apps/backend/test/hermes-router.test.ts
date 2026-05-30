import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { makeHermesRouter } from "../src/hermes.js";
import type { AgentRunner } from "../src/hermes-agent.js";

function makeRepoReg() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-router-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "enum", label: "状态", required: true,
        enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
    ],
  }));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  const registry = new FileSchemaRegistry(cfgDir);
  return { repo, registry };
}

function appWith(repo: SqliteRepository, registry: FileSchemaRegistry, runner?: AgentRunner) {
  const app = express();
  app.use(express.json());
  app.use("/api", makeHermesRouter(repo, registry, runner));
  return app;
}

describe("makeHermesRouter — agent 接入 + 回退", () => {
  it("agent 成功 → intent=agent,引用经校验回填(编造 ID 丢弃)", async () => {
    const { repo, registry } = makeRepoReg();
    const t = await repo.createNode("attackTicket", { 标题: "断网攻关", 状态: "待响应" }, "test");
    const runner: AgentRunner = {
      run: async () => `《断网攻关》当前待响应。\nCITATIONS: ${t.id}, 编造ID`,
    };
    const res = await request(appWith(repo, registry, runner))
      .post("/api/hermes/ask").send({ question: "断网攻关 状态" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("agent");
    expect(res.body.citations).toHaveLength(1);
    expect(res.body.citations[0].nodeId).toBe(t.id);
    expect(res.body.citations[0].link).toBe(`/attack/${t.id}`);
  });

  it("agent 抛错 → 静默回退规则引擎(仍 200,intent≠agent)", async () => {
    const { repo, registry } = makeRepoReg();
    await repo.createNode("attackTicket", { 标题: "回退测试单", 状态: "处理中" }, "test");
    const runner: AgentRunner = { run: async () => { throw new Error("opencode down"); } };
    const res = await request(appWith(repo, registry, runner))
      .post("/api/hermes/ask").send({ question: "回退测试单 状态" });
    expect(res.status).toBe(200);
    expect(res.body.intent).not.toBe("agent");
    expect(typeof res.body.answer).toBe("string");
  });

  it("未配置 runner → 规则引擎(intent≠agent)", async () => {
    const { repo, registry } = makeRepoReg();
    const res = await request(appWith(repo, registry))
      .post("/api/hermes/ask").send({ question: "随便问问" });
    expect(res.status).toBe(200);
    expect(res.body.intent).not.toBe("agent");
  });

  it("question 缺失 → 400", async () => {
    const { repo, registry } = makeRepoReg();
    const res = await request(appWith(repo, registry)).post("/api/hermes/ask").send({});
    expect(res.status).toBe(400);
  });
});
