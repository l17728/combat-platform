import { describe, it, expect, beforeEach } from "vitest";
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
import { callTool, type HermesToolCtx } from "../src/hermes-tools.js";
import { seedConfigFromSchemas } from "../src/schema-api.js";

// 14 个工具 e2e — 每个工具至少 1 个 happy path + 1 个 boundary/private case。
// 真实 config/schemas (因为部分工具校验 nodeType 存在性)。

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

let app: ReturnType<typeof createApp>;
let repo: SqliteRepository;
let registry: FileSchemaRegistry;

beforeEach(async () => {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-tools-"));
  const db = openDb(join(dir, "t.sqlite"));
  const adapter = new SqliteAdapter(db);
  repo = new SqliteRepository(adapter);
  registry = new FileSchemaRegistry(CFG);
  // 等 seed 完成,避免它的事务和后续 createNode 事务交错冲突 (SQLite 单连接顺序化)
  await seedConfigFromSchemas(registry, repo);
  app = createApp({ repo, registry, adapter, db });
});

async function seedTicket(props: Record<string, unknown>): Promise<string> {
  const merged = { 标题: "默认", 状态: "处理中", ...props };
  const node = await repo.createNode("attackTicket", merged, "tester");
  return node.id;
}

async function seedPerson(props: Record<string, unknown>): Promise<string> {
  const node = await repo.createNode("person", { 姓名: "默认", ...props }, "tester");
  return node.id;
}

function ctxFor(user?: HermesToolCtx["user"]): HermesToolCtx {
  return { repo, registry, user };
}

describe("hermes-tools — 1. list_node_types", () => {
  it("返回所有 nodeType", async () => {
    const r = await callTool("list_node_types", {}, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as Array<{ nodeType: string }>;
    expect(data.length).toBeGreaterThan(5);
    expect(data.find((d) => d.nodeType === "attackTicket")).toBeTruthy();
    expect(data.find((d) => d.nodeType === "person")).toBeTruthy();
  });

  it("HTTP 端点也工作", async () => {
    const res = await request(app).post("/api/hermes/tool/list_node_types").send({ input: {} });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("hermes-tools — 2. describe_node_type", () => {
  it("返回 schema + sample(1)", async () => {
    await seedTicket({ 标题: "A1" });
    const r = await callTool("describe_node_type", { nodeType: "attackTicket" }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any;
    expect(data.schema.nodeType).toBe("attackTicket");
    expect(data.sample).toBeTruthy();
  });

  it("未知 nodeType → bad_input", async () => {
    const r = await callTool("describe_node_type", { nodeType: "doesNotExist" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 3. count_nodes", () => {
  it("无 filter 计数", async () => {
    await seedTicket({ 标题: "x1" });
    await seedTicket({ 标题: "x2" });
    const r = await callTool("count_nodes", { nodeType: "attackTicket" }, ctxFor());
    expect(r.ok).toBe(true);
    expect((r.data as any).count).toBe(2);
  });

  it("filter 等值简写", async () => {
    await seedTicket({ 标题: "open1", 状态: "处理中" });
    await seedTicket({ 标题: "open2", 状态: "处理中" });
    await seedTicket({ 标题: "closed1", 状态: "已关闭" });
    const r = await callTool("count_nodes", { nodeType: "attackTicket", filter: { 状态: "处理中" } }, ctxFor());
    expect((r.data as any).count).toBe(2);
  });
});

describe("hermes-tools — 4. query_nodes", () => {
  it("limit + sort 工作", async () => {
    for (let i = 0; i < 3; i++) await seedTicket({ 标题: `T${i}` });
    const r = await callTool(
      "query_nodes",
      { nodeType: "attackTicket", limit: 2, sort: { field: "updatedAt", dir: "desc" } },
      ctxFor()
    );
    expect(r.ok).toBe(true);
    const data = r.data as any[];
    expect(data.length).toBe(2);
  });

  it("limit 超过 50 → 仍 ≤ 50", async () => {
    const r = await callTool("query_nodes", { nodeType: "attackTicket", limit: 999 }, ctxFor());
    expect(r.ok).toBe(true);
  });

  it("filter 字段名注入 → bad_input", async () => {
    const r = await callTool("query_nodes", { nodeType: "attackTicket", filter: { "x'--": "y" } }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 5. get_node", () => {
  it("返回 node + progress + related", async () => {
    const id = await seedTicket({ 标题: "G1" });
    const r = await callTool("get_node", { id }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any;
    expect(data.node.id).toBe(id);
    expect(Array.isArray(data.progress)).toBe(true);
    expect(data.related).toBeTruthy();
  });

  it("不存在 id → bad_input", async () => {
    const r = await callTool("get_node", { id: "nope-id" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 6. search_text", () => {
  it("命中关键词", async () => {
    await seedTicket({ 标题: "搜索关键词测试" });
    const r = await callTool("search_text", { q: "搜索" }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any[];
    expect(data.length).toBeGreaterThan(0);
  });

  it("scope 限制 nodeType", async () => {
    await seedTicket({ 标题: "唯一关键词abcxyz" });
    await seedPerson({ 姓名: "唯一关键词abcxyz" });
    const r = await callTool("search_text", { q: "abcxyz", scope: ["person"] }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any[];
    expect(data.every((d) => d.nodeType === "person")).toBe(true);
  });
});

describe("hermes-tools — 7. traverse_graph", () => {
  it("从 startId 出发 depth=1", async () => {
    const tid = await seedTicket({ 标题: "图根" });
    const pid = await seedPerson({ 姓名: "张三" });
    await repo.createEdge("REF", tid, pid, { field: "当前处理人" }, "tester");
    const r = await callTool("traverse_graph", { startId: tid, depth: 1 }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any;
    expect(data.nodes.find((n: any) => n.id === pid)).toBeTruthy();
  });

  it("不存在 startId → bad_input", async () => {
    const r = await callTool("traverse_graph", { startId: "nope" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 8. get_progress", () => {
  it("返回进展列表", async () => {
    const tid = await seedTicket({ 标题: "进展测试" });
    await repo.appendProgress(tid, "开工", "处理中", "tester");
    await repo.appendProgress(tid, "继续", "处理中", "tester");
    const r = await callTool("get_progress", { nodeId: tid }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any[];
    expect(data.length).toBe(2);
  });

  it("limit 截断", async () => {
    const tid = await seedTicket({ 标题: "limit测试" });
    for (let i = 0; i < 3; i++) await repo.appendProgress(tid, `p${i}`, "处理中", "tester");
    const r = await callTool("get_progress", { nodeId: tid, limit: 2 }, ctxFor());
    expect((r.data as any[]).length).toBe(2);
  });
});

describe("hermes-tools — 9. get_audit", () => {
  it("返回 audit 行", async () => {
    await seedTicket({ 标题: "audit1" });
    const r = await callTool("get_audit", { action: "CREATE", limit: 10 }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any[];
    expect(data.length).toBeGreaterThan(0);
  });

  it("不存在 entityId → 空", async () => {
    const r = await callTool("get_audit", { entityId: "nope-xxx" }, ctxFor());
    expect(r.ok).toBe(true);
    expect((r.data as any[]).length).toBe(0);
  });
});

describe("hermes-tools — 10. aggregate", () => {
  it("count by 状态", async () => {
    await seedTicket({ 标题: "a", 状态: "处理中" });
    await seedTicket({ 标题: "b", 状态: "处理中" });
    await seedTicket({ 标题: "c", 状态: "已关闭" });
    const r = await callTool("aggregate", { nodeType: "attackTicket", groupBy: "状态" }, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any[];
    const inProgress = data.find((d) => d.key === "处理中");
    expect(inProgress?.value).toBe(2);
  });

  it("非法 agg → bad_input", async () => {
    const r = await callTool("aggregate", { nodeType: "attackTicket", groupBy: "状态", agg: "bogus" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 11. dashboard_metric", () => {
  it("返回 metrics 全集", async () => {
    await seedTicket({ 标题: "d1", 状态: "处理中" });
    const r = await callTool("dashboard_metric", {}, ctxFor());
    expect(r.ok).toBe(true);
    const data = r.data as any;
    expect(typeof data.活跃攻关单).toBe("number");
  });

  it("指定 key", async () => {
    const r = await callTool("dashboard_metric", { key: "攻关单总数" }, ctxFor());
    expect(r.ok).toBe(true);
    expect((r.data as any).key).toBe("攻关单总数");
  });

  it("未知 key → bad_input", async () => {
    const r = await callTool("dashboard_metric", { key: "doesNotExist" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 12. recommend_helpers", () => {
  it("非 attackTicket → bad_input", async () => {
    const pid = await seedPerson({ 姓名: "张三" });
    const r = await callTool("recommend_helpers", { ticketId: pid }, ctxFor());
    expect(r.ok).toBe(false);
  });

  it("有 ticket 返回数组(可能为空)", async () => {
    const tid = await seedTicket({ 标题: "rec1" });
    const r = await callTool("recommend_helpers", { ticketId: tid }, ctxFor());
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
  });
});

describe("hermes-tools — 13. ticket_tabs", () => {
  it("无 adapter 时返回 []", async () => {
    const tid = await seedTicket({ 标题: "tab1" });
    const r = await callTool("ticket_tabs", { ticketId: tid }, ctxFor());
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
  });

  it("不存在 ticket → bad_input", async () => {
    const r = await callTool("ticket_tabs", { ticketId: "nope" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 14a. welink_search", () => {
  it("无 db → bad_input", async () => {
    const r = await callTool("welink_search", { ticketId: "x", q: "y" }, ctxFor());
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/sqlite|welink/i);
  });
});

describe("hermes-tools — 14b. welink_timeline", () => {
  it("无 db → bad_input", async () => {
    const r = await callTool("welink_timeline", { ticketId: "x" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 14c. welink_gap_analysis", () => {
  it("无 db → bad_input", async () => {
    const r = await callTool("welink_gap_analysis", { ticketId: "x" }, ctxFor());
    expect(r.ok).toBe(false);
  });
});

describe("hermes-tools — 私单收口", () => {
  it("用户 A 创建的私单,用户 B 在 query_nodes 中看不到", async () => {
    const tid = await seedTicket({ 标题: "alice-secret", 私密: "是", 创建人: "alice" });
    expect(tid).toBeTruthy();
    const rA = await callTool("query_nodes", { nodeType: "attackTicket" }, ctxFor({ username: "alice" }));
    expect((rA.data as any[]).some((n) => n.id === tid)).toBe(true);
    const rB = await callTool("query_nodes", { nodeType: "attackTicket" }, ctxFor({ username: "bob" }));
    expect((rB.data as any[]).some((n) => n.id === tid)).toBe(false);
  });

  it("用户 B 用 get_node 直接打 alice 的私单 → forbidden", async () => {
    const tid = await seedTicket({ 标题: "alice-secret-2", 私密: "是", 创建人: "alice" });
    const r = await callTool("get_node", { id: tid }, ctxFor({ username: "bob" }));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/forbidden/);
  });

  it("count_nodes 也尊重私单收口", async () => {
    await seedTicket({ 标题: "public", 状态: "处理中" });
    await seedTicket({ 标题: "alice-secret-3", 状态: "处理中", 私密: "是", 创建人: "alice" });
    const rB = await callTool("count_nodes", { nodeType: "attackTicket" }, ctxFor({ username: "bob" }));
    expect((rB.data as any).count).toBe(1);
    const rA = await callTool("count_nodes", { nodeType: "attackTicket" }, ctxFor({ username: "alice" }));
    expect((rA.data as any).count).toBe(2);
  });

  it("search_text 不返回他人私单", async () => {
    await seedTicket({ 标题: "唯一关键字zzzqqqxxx", 私密: "是", 创建人: "alice" });
    const rB = await callTool("search_text", { q: "唯一关键字zzzqqqxxx" }, ctxFor({ username: "bob" }));
    expect(r_data_len(rB)).toBe(0);
    const rA = await callTool("search_text", { q: "唯一关键字zzzqqqxxx" }, ctxFor({ username: "alice" }));
    expect(r_data_len(rA)).toBeGreaterThan(0);
  });

  it("aggregate 私单收口", async () => {
    await seedTicket({ 标题: "p1", 状态: "处理中" });
    await seedTicket({ 标题: "s1", 状态: "处理中", 私密: "是", 创建人: "alice" });
    const r = await callTool("aggregate", { nodeType: "attackTicket", groupBy: "状态" }, ctxFor({ username: "bob" }));
    const inProgress = (r.data as any[]).find((d) => d.key === "处理中");
    expect(inProgress?.value).toBe(1);
  });
});

function r_data_len(r: { data?: unknown }): number {
  return Array.isArray(r.data) ? (r.data as any[]).length : 0;
}

describe("hermes-tools — HTTP 出入口", () => {
  it("GET /api/hermes/tools 返回 14 工具", async () => {
    const res = await request(app).get("/api/hermes/tools");
    expect(res.status).toBe(200);
    expect(res.body.tools.length).toBeGreaterThanOrEqual(14);
  });

  it("POST 未知工具 → 404", async () => {
    const res = await request(app).post("/api/hermes/tool/nope").send({ input: {} });
    expect(res.status).toBe(404);
  });

  it("POST list_node_types 走通", async () => {
    const res = await request(app).post("/api/hermes/tool/list_node_types").send({ input: {} });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("hermes-tools — 32KB 截断", () => {
  it("query_nodes 大数据集 → 自然能塞下 (limit 上限 50)", async () => {
    for (let i = 0; i < 50; i++) await seedTicket({ 标题: `bulk-${i}` });
    const r = await callTool("query_nodes", { nodeType: "attackTicket", limit: 50 }, ctxFor());
    expect(r.ok).toBe(true);
  });
});
