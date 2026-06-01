/**
 * §v2.3.3 桶 B (r-agent) router 集成测试 — HermesMode 三路 + fallback
 */
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
import type { ToolCallingRunner, LlmTurnResult } from "../src/hermes-agent.js";

function makeRepoReg() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-router-v25-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeFileSync(
    join(cfgDir, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        {
          name: "状态",
          type: "enum",
          label: "状态",
          required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"],
        },
      ],
    })
  );
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  const registry = new FileSchemaRegistry(cfgDir);
  return { repo, registry };
}

function scriptedTool(turns: LlmTurnResult[]): ToolCallingRunner {
  let i = 0;
  return {
    chat: async () => {
      if (i >= turns.length) throw new Error("exhausted");
      return turns[i++];
    },
  };
}

describe("makeHermesRouter §v2.3.3 — HermesMode dispatch", () => {
  it("mode=tool 走 tool-calling agent,engine='tool',trace 透传", async () => {
    const { repo, registry } = makeRepoReg();
    const t = await repo.createNode("attackTicket", { 标题: "测试", 状态: "处理中" }, "test");
    const toolRunner = scriptedTool([
      { toolCalls: [{ id: "c1", name: "list_node_types", arguments: {} }] },
      { content: `OK\nCITATIONS: ${t.id}` },
    ]);
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, { toolRunner }));
    const res = await request(app).post("/api/hermes/ask").send({ question: "随意一问", mode: "tool" });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("tool");
    expect(res.body.trace).toHaveLength(1);
    expect(res.body.trace[0].tool).toBe("list_node_types");
    expect(res.body.citations[0].nodeId).toBe(t.id);
  });

  it("mode=intent 强制走规则引擎(忽略 toolRunner)", async () => {
    const { repo, registry } = makeRepoReg();
    await repo.createNode("attackTicket", { 标题: "断网攻关", 状态: "处理中" }, "test");
    const toolRunner: ToolCallingRunner = {
      chat: async () => {
        throw new Error("tool runner should not be called in mode=intent");
      },
    };
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, { toolRunner }));
    const res = await request(app).post("/api/hermes/ask").send({ question: "断网攻关 状态", mode: "intent" });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("intent");
    expect(res.body.trace).toBeUndefined();
  });

  it("mode=auto 短问题+intent 正则 → intent 路径", async () => {
    const { repo, registry } = makeRepoReg();
    await repo.createNode("attackTicket", { 标题: "断网", 状态: "处理中" }, "test");
    const toolRunner: ToolCallingRunner = {
      chat: async () => {
        throw new Error("should not be called");
      },
    };
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, { toolRunner }));
    // 短(<30)+ 命中"状态"正则
    const res = await request(app).post("/api/hermes/ask").send({ question: "断网 状态如何", mode: "auto" });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("intent");
  });

  it("mode=auto 长问题 → tool 路径", async () => {
    const { repo, registry } = makeRepoReg();
    const toolRunner = scriptedTool([{ content: "处理中。\nCITATIONS: 空" }]);
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, { toolRunner }));
    const longQ = "这是一个不命中任何 intent 关键字而且超过 30 个字符长度的复杂自由问题来触发 tool 路径吧";
    const res = await request(app).post("/api/hermes/ask").send({ question: longQ, mode: "auto" });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("tool");
    expect(res.body.trace).toEqual([]);
  });

  it("mode=tool + LLM 抛错 → fallback intent + fallback_reason 标记", async () => {
    const { repo, registry } = makeRepoReg();
    await repo.createNode("attackTicket", { 标题: "X", 状态: "处理中" }, "test");
    const toolRunner: ToolCallingRunner = {
      chat: async () => {
        throw new Error("opencode_down");
      },
    };
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, { toolRunner }));
    const res = await request(app).post("/api/hermes/ask").send({ question: "随便问问", mode: "tool" });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("intent");
    expect(res.body.fallback_reason).toBe("opencode_down");
  });

  it("mode=tool + max_hops_exceeded → fallback intent", async () => {
    const { repo, registry } = makeRepoReg();
    // LLM 一直叫工具 → 触顶
    const turns: LlmTurnResult[] = Array.from({ length: 20 }, () => ({
      toolCalls: [{ id: "c", name: "list_node_types", arguments: {} }],
    }));
    const toolRunner = scriptedTool(turns);
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, { toolRunner }));
    const res = await request(app).post("/api/hermes/ask").send({ question: "X", mode: "tool" });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("intent");
    expect(res.body.fallback_reason).toBe("max_hops_exceeded");
  });

  it("question 缺失 → 400", async () => {
    const { repo, registry } = makeRepoReg();
    const app = express();
    app.use(express.json());
    app.use("/api", makeHermesRouter(repo, registry, {}));
    const res = await request(app).post("/api/hermes/ask").send({});
    expect(res.status).toBe(400);
  });
});
