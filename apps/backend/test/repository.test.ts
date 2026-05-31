import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import type { Repository } from "@combat/shared";

let repo: Repository;
let db: ReturnType<typeof openDb>;
beforeEach(async () => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "combat-")), "t.sqlite"));
  repo = new SqliteRepository(new SqliteAdapter(db));
});

describe("SqliteRepository", () => {
  it("creates and reads a node with JSON properties (no DDL per field)", async () => {
    const n = await repo.createNode("attackTicket", { 标题: "断连", 状态: "进行中" }, "tester");
    expect(n.id).toBeTruthy();
    expect((await repo.getNode(n.id))?.properties["标题"]).toBe("断连");
  });
  it("queryNodes filters by property equality", async () => {
    await repo.createNode("attackTicket", { 标题: "a", 状态: "进行中" }, "t");
    await repo.createNode("attackTicket", { 标题: "b", 状态: "已解决" }, "t");
    expect(await repo.queryNodes("attackTicket", { 状态: "进行中" })).toHaveLength(1);
  });
  it("appendProgress is append-only with monotonic seqNo and is audited", async () => {
    const n = await repo.createNode("attackTicket", { 标题: "a" }, "t");
    await repo.appendProgress(n.id, "day1", "进行中", "alice");
    await repo.appendProgress(n.id, "day2", "进行中", "alice");
    const seq = await repo.listProgress(n.id);
    expect(seq.map((p) => p.seqNo)).toEqual([1, 2]);
    expect(seq[0].content).toBe("day1");
    const audits = db.prepare("SELECT * FROM audit_log WHERE action='PROGRESS' AND entityId=?").all(n.id) as any[];
    expect(audits).toHaveLength(2);
    expect(audits[0].performedBy).toBe("alice");
  });
  it("deleteNode removes node, its progress and edges, and audits", async () => {
    const n = await repo.createNode("attackTicket", { 标题: "a" }, "t");
    const other = await repo.createNode("person", { name: "p" }, "t");
    await repo.appendProgress(n.id, "d1", "进行中", "t");
    await repo.createEdge("ASSIGNED_TO", n.id, other.id, {}, "t");
    await repo.deleteNode(n.id, "killer");
    expect(await repo.getNode(n.id)).toBeNull();
    expect(await repo.listProgress(n.id)).toHaveLength(0);
    expect(await repo.queryEdges({ sourceId: n.id })).toHaveLength(0);
    const a = db.prepare("SELECT * FROM audit_log WHERE action='DELETE' AND entityId=?").all(n.id) as any[];
    expect(a).toHaveLength(1);
    expect(a[0].performedBy).toBe("killer");
    expect(await repo.getNode(other.id)).not.toBeNull();
  });
  it("deleteNode removes inbound edges, leaves unrelated data, no audit for unknown id", async () => {
    const a = await repo.createNode("attackTicket", { 标题: "A" }, "t");
    const b = await repo.createNode("person", { name: "B" }, "t");
    const c = await repo.createNode("person", { name: "C" }, "t");
    await repo.createEdge("BLOCKED_BY", b.id, a.id, {}, "t"); // a is TARGET (inbound)
    await repo.createEdge("RELATES_TO", b.id, c.id, {}, "t"); // unrelated, must survive
    await repo.deleteNode(a.id, "t");
    expect(await repo.queryEdges({ targetId: a.id })).toHaveLength(0);
    expect(await repo.queryEdges({ sourceId: b.id, targetId: c.id })).toHaveLength(1);
    expect(await repo.getNode(b.id)).not.toBeNull();
    const before = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='DELETE'").get() as any).n;
    await repo.deleteNode("ghost-does-not-exist", "t");
    const after = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='DELETE'").get() as any).n;
    expect(after).toBe(before);
  });
  it("logAudit writes an arbitrary audit row", async () => {
    await repo.logAudit({
      action: "SCHEMA_addField",
      entityType: "schema",
      entityId: "attackTicket",
      changes: { x: 1 },
      actor: "alice",
    });
    const a = db.prepare("SELECT * FROM audit_log WHERE action='SCHEMA_addField'").all() as any[];
    expect(a).toHaveLength(1);
    expect(a[0].performedBy).toBe("alice");
    expect(JSON.parse(a[0].changes)).toEqual({ x: 1 });
  });
  it("deleteEdges removes only matching edges and audits", async () => {
    const a = await repo.createNode("attackTicket", { 标题: "A" }, "t");
    const p = await repo.createNode("person", { name: "张三" }, "t");
    const q = await repo.createNode("person", { name: "李四" }, "t");
    await repo.createEdge("REF", a.id, p.id, { field: "当前处理人" }, "t");
    await repo.createEdge("REF", a.id, q.id, { field: "攻关组长" }, "t");
    await repo.createEdge("CONTRIBUTED_TO", a.id, p.id, {}, "t");
    await repo.deleteEdges({ sourceId: a.id, edgeType: "REF" }, "killer");
    expect(await repo.queryEdges({ sourceId: a.id, edgeType: "REF" })).toHaveLength(0);
    expect(await repo.queryEdges({ sourceId: a.id, edgeType: "CONTRIBUTED_TO" })).toHaveLength(1);
    const au = db.prepare("SELECT * FROM audit_log WHERE action='DELETE' AND entityType='edge'").all() as any[];
    expect(au).toHaveLength(2);
    expect(au[0].performedBy).toBe("killer");
  });

  it("updateNode 合并字段（patch 语义，保留原有字段）", async () => {
    const node = await repo.createNode("attackTicket", { a: "1", b: "2" }, "t");
    await repo.updateNode(node.id, { b: "new" }, "t");
    const updated = await repo.getNode(node.id);
    expect(updated?.properties.a).toBe("1");
    expect(updated?.properties.b).toBe("new");
  });

  it("getNode 未知 id 返回 null", async () => {
    expect(await repo.getNode("not-a-real-id")).toBeNull();
  });

  it("getSetting/setSetting 读写与更新", async () => {
    expect(await repo.getSetting("testKey")).toBeNull();
    await repo.setSetting("testKey", "value1", "t");
    expect(await repo.getSetting("testKey")).toBe("value1");
    await repo.setSetting("testKey", "updated", "t");
    expect(await repo.getSetting("testKey")).toBe("updated");
  });

  it("queryNodes 无过滤返回同类型所有节点", async () => {
    await repo.createNode("attackTicket", { 标题: "A" }, "t");
    await repo.createNode("attackTicket", { 标题: "B" }, "t");
    await repo.createNode("person", { 姓名: "X" }, "t");
    const tickets = await repo.queryNodes("attackTicket");
    expect(tickets).toHaveLength(2);
    const persons = await repo.queryNodes("person");
    expect(persons).toHaveLength(1);
  });
});
