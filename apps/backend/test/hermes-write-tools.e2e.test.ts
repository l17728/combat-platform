import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp } from "./helpers.js";
import { callTool } from "../src/hermes-tools.js";
import type { HermesToolCtx } from "../src/hermes-tools.js";
import type { Repository, SchemaRegistry } from "@combat/shared";

const originalEnv = process.env.HERMES_ENABLE_WRITE;

function adminCtx(repo: Repository, registry: SchemaRegistry): HermesToolCtx {
  return { repo, registry, user: { username: "admin", displayName: "Admin", role: "admin" } };
}
function normalCtx(repo: Repository, registry: SchemaRegistry): HermesToolCtx {
  return { repo, registry, user: { username: "normal", displayName: "Normal", role: "normal" } };
}
function hasDetail(r: { detail?: string }, code: string) {
  return r.detail && r.detail.startsWith(code);
}

describe("Hermes write tools", () => {
  let repo: Repository;
  let registry: SchemaRegistry;

  beforeAll(async () => {
    const app = await makeTestApp();
    repo = app.repo;
    registry = app.registry;
    process.env.HERMES_ENABLE_WRITE = "1";
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.HERMES_ENABLE_WRITE;
    else process.env.HERMES_ENABLE_WRITE = originalEnv;
  });

  it("create_node creates a person", async () => {
    const r = await callTool(
      "create_node",
      {
        nodeType: "person",
        properties: { 姓名: "测试人员", 部门: "测试部" },
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(true);
    expect((r.data as any).nodeType).toBe("person");
    expect((r.data as any).properties["姓名"]).toBe("测试人员");
  });

  it("create_node rejects unknown nodeType", async () => {
    const r = await callTool(
      "create_node",
      {
        nodeType: "nonexistent_type",
        properties: {},
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "unknown_node_type")).toBe(true);
  });

  it("create_node rejects without admin/leader role", async () => {
    const r = await callTool(
      "create_node",
      {
        nodeType: "person",
        properties: { 姓名: "被拒" },
        _confirm: "yes",
      },
      normalCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "permission_denied")).toBe(true);
  });

  it("create_node rejects without _confirm", async () => {
    const r = await callTool(
      "create_node",
      {
        nodeType: "person",
        properties: { 姓名: "未确认" },
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "confirm_required")).toBe(true);
  });

  it("update_node updates a field", async () => {
    const node = await repo.createNode("person", { 姓名: "改前", 部门: "旧" }, "admin");
    const r = await callTool(
      "update_node",
      {
        id: node.id,
        properties: { 部门: "新" },
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(true);
    expect((r.data as any).updatedFields).toContain("部门");
    const updated = await repo.getNode(node.id);
    expect(updated!.properties["部门"]).toBe("新");
  });

  it("update_node rejects non-existent id", async () => {
    const r = await callTool(
      "update_node",
      {
        id: "00000000-0000-0000-0000-000000000000",
        properties: { 部门: "X" },
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "node_not_found")).toBe(true);
  });

  it("update_node rejects without role", async () => {
    const node = await repo.createNode("person", { 姓名: "角色测试" }, "admin");
    const r = await callTool(
      "update_node",
      {
        id: node.id,
        properties: { 姓名: "改" },
        _confirm: "yes",
      },
      normalCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "permission_denied")).toBe(true);
  });

  it("add_progress appends to attack ticket", async () => {
    const ticket = await repo.createNode("attackTicket", { 标题: "进展测试", 状态: "处理中" }, "admin");
    const r = await callTool(
      "add_progress",
      {
        nodeId: ticket.id,
        content: "已完成初步排查",
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(true);
    expect((r.data as any).seqNo).toBe(1);
    expect((r.data as any).ownerId).toBe(ticket.id);
  });

  it("add_progress rejects non-attackTicket", async () => {
    const person = await repo.createNode("person", { 姓名: "非单" }, "admin");
    const r = await callTool(
      "add_progress",
      {
        nodeId: person.id,
        content: "不应追加",
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "wrong_type")).toBe(true);
  });

  it("add_progress rejects without confirm", async () => {
    const ticket = await repo.createNode("attackTicket", { 标题: "确认测试", 状态: "待响应" }, "admin");
    const r = await callTool(
      "add_progress",
      {
        nodeId: ticket.id,
        content: "未确认进展",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(hasDetail(r, "confirm_required")).toBe(true);
  });

  it("callTool gate: write tools disabled when env not set", async () => {
    delete process.env.HERMES_ENABLE_WRITE;
    const r = await callTool(
      "create_node",
      {
        nodeType: "person",
        properties: { 姓名: "禁用测试" },
        _confirm: "yes",
      },
      adminCtx(repo, registry)
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("write_tools_disabled");
    process.env.HERMES_ENABLE_WRITE = "1";
  });
});
