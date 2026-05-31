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
    new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-uicache-")), "t.sqlite")))
  );
  const registry = new FileSchemaRegistry(CFG);
  return { app: createApp({ repo, registry }), repo };
}

const SAMPLE_UI_SPEC = {
  widget: "TABLE",
  params: { title: "攻关单", columns: ["标题", "状态"], rows: [{ 标题: "T1", 状态: "处理中" }] },
  cacheKey: "ticket-by-pb:pb12345",
};

describe("增量57 动态 UI 固定（ui-cache）", () => {
  it("GET /api/ui-cache/pinned — 初始为空数组", async () => {
    const { app } = make();
    const r = await request(app).get("/api/ui-cache/pinned");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("POST /api/ui-cache/pin — 固定一个 UI，返回带 id 的 pin 对象", async () => {
    const { app } = make();
    const r = await request(app).post("/api/ui-cache/pin").send({
      label: "PB-12345 攻关单列表",
      question: "PB-12345 涉及哪些单",
      intent: "ticket-by-pb",
      uiSpec: SAMPLE_UI_SPEC,
    });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    expect(r.body.label).toBe("PB-12345 攻关单列表");
    expect(r.body.uiSpec.widget).toBe("TABLE");
  });

  it("POST 缺少 uiSpec — 返回 400", async () => {
    const { app } = make();
    const r = await request(app).post("/api/ui-cache/pin").send({ label: "no spec" });
    expect(r.status).toBe(400);
  });

  it("固定后 GET 返回该 pin；DELETE 后消失", async () => {
    const { app } = make();
    const pin = (
      await request(app).post("/api/ui-cache/pin").send({
        label: "测试固定",
        question: "谁负责",
        intent: "owner",
        uiSpec: SAMPLE_UI_SPEC,
      })
    ).body;
    const list = (await request(app).get("/api/ui-cache/pinned")).body;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(pin.id);
    await request(app).delete(`/api/ui-cache/pinned/${pin.id}`);
    const after = (await request(app).get("/api/ui-cache/pinned")).body;
    expect(after).toHaveLength(0);
  });

  it("PATCH /api/ui-cache/pinned/:id — 修改 label", async () => {
    const { app } = make();
    const pin = (
      await request(app).post("/api/ui-cache/pin").send({
        label: "旧标题",
        question: "q",
        intent: "owner",
        uiSpec: SAMPLE_UI_SPEC,
      })
    ).body;
    const r = await request(app).patch(`/api/ui-cache/pinned/${pin.id}`).send({ label: "新标题" });
    expect(r.status).toBe(200);
    expect(r.body.label).toBe("新标题");
  });

  // ── hermes uiSpec ──────────────────────────────────────────────────────────

  it("POST /api/hermes/ask 问题单号 → 回答含 uiSpec TABLE", async () => {
    const { app, repo } = make();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断网攻关", 状态: "处理中", 问题单号: "PB-999" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "PB-999 涉及哪些单" });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe("ticket-by-pb");
    expect(r.body.uiSpec).toBeDefined();
    expect(r.body.uiSpec.widget).toBe("TABLE");
    expect(r.body.uiSpec.params.columns).toContain("标题");
  });

  it("POST /api/hermes/ask 负责人查询 → uiSpec TABLE 含当前处理人列", async () => {
    const { app } = make();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "数据迁移", 状态: "处理中", 当前处理人: "张三" });
    const r = await request(app).post("/api/hermes/ask").send({ question: "数据迁移 谁负责" });
    expect(r.status).toBe(200);
    expect(r.body.uiSpec).toBeDefined();
    expect(r.body.uiSpec.widget).toBe("TABLE");
    expect(r.body.uiSpec.params.columns).toContain("当前处理人");
  });

  // ── 用户场景 ────────────────────────────────────────────────────────────────

  it("场景：运维通过问答获取数据，固定到侧栏，重启后仍可访问", async () => {
    const { app } = make();
    // 1. 问答得到含 uiSpec 的回答
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "告警风暴", 状态: "处理中", 问题单号: "PB-2025" });
    const ans = (await request(app).post("/api/hermes/ask").send({ question: "PB-2025 涉及哪些单" })).body;
    expect(ans.uiSpec).toBeDefined();
    // 2. 固定该 UI
    const pin = (
      await request(app).post("/api/ui-cache/pin").send({
        label: "告警风暴追踪",
        question: ans.question,
        intent: ans.intent,
        uiSpec: ans.uiSpec,
      })
    ).body;
    // 3. 下次重进页面可以读到该固定项
    const list = (await request(app).get("/api/ui-cache/pinned")).body;
    expect(list[0].id).toBe(pin.id);
    expect(list[0].uiSpec.widget).toBe("TABLE");
  });

  it("固定超过50个时只保留最新50个", async () => {
    const { app } = make();
    const spec = { widget: "TABLE", params: { columns: ["标题"], rows: [] }, cacheKey: "limit-test" };
    for (let i = 0; i < 51; i++) {
      await request(app)
        .post("/api/ui-cache/pin")
        .send({
          label: `pin-${i}`,
          question: `q${i}`,
          intent: "owner",
          uiSpec: { ...spec, cacheKey: `key-${i}` },
        });
    }
    const list = (await request(app).get("/api/ui-cache/pinned")).body;
    expect(list).toHaveLength(50);
  }, 30000);

  it("PATCH 不存在的 pin → 404", async () => {
    const { app } = make();
    const r = await request(app).patch("/api/ui-cache/pinned/ghost-id-xyz").send({ label: "新名" });
    expect(r.status).toBe(404);
  });

  it("DELETE 不存在的 pin → 200 幂等", async () => {
    const { app } = make();
    const r = await request(app).delete("/api/ui-cache/pinned/ghost-id-xyz");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("POST uiSpec 缺少 widget → 400", async () => {
    const { app } = make();
    const r = await request(app)
      .post("/api/ui-cache/pin")
      .send({
        label: "坏spec",
        question: "q",
        intent: "owner",
        uiSpec: { params: { columns: [], rows: [] }, cacheKey: "k" },
      });
    expect(r.status).toBe(400);
  });
});
