import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import type { Repository } from "@combat/shared";

let repo: Repository;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "combat-")), "t.sqlite"));
  repo = new SqliteRepository(db);
});

describe("SqliteRepository", () => {
  it("creates and reads a node with JSON properties (no DDL per field)", () => {
    const n = repo.createNode("attackTicket", { 标题: "断连", 状态: "进行中" }, "tester");
    expect(n.id).toBeTruthy();
    expect(repo.getNode(n.id)?.properties["标题"]).toBe("断连");
  });
  it("queryNodes filters by property equality", () => {
    repo.createNode("attackTicket", { 标题: "a", 状态: "进行中" }, "t");
    repo.createNode("attackTicket", { 标题: "b", 状态: "已解决" }, "t");
    expect(repo.queryNodes("attackTicket", { 状态: "进行中" })).toHaveLength(1);
  });
  it("appendProgress is append-only with monotonic seqNo and is audited", () => {
    const n = repo.createNode("attackTicket", { 标题: "a" }, "t");
    repo.appendProgress(n.id, "day1", "进行中", "alice");
    repo.appendProgress(n.id, "day2", "进行中", "alice");
    const seq = repo.listProgress(n.id);
    expect(seq.map(p => p.seqNo)).toEqual([1, 2]);
    expect(seq[0].content).toBe("day1");
    const audits = db.prepare("SELECT * FROM audit_log WHERE action='PROGRESS' AND entityId=?").all(n.id) as any[];
    expect(audits).toHaveLength(2);
    expect(audits[0].performedBy).toBe("alice");
  });
  it("deleteNode removes node, its progress and edges, and audits", () => {
    const n = repo.createNode("attackTicket", { 标题: "a" }, "t");
    const other = repo.createNode("person", { name: "p" }, "t");
    repo.appendProgress(n.id, "d1", "进行中", "t");
    repo.createEdge("ASSIGNED_TO", n.id, other.id, {}, "t");
    repo.deleteNode(n.id, "killer");
    expect(repo.getNode(n.id)).toBeNull();
    expect(repo.listProgress(n.id)).toHaveLength(0);
    expect(repo.queryEdges({ sourceId: n.id })).toHaveLength(0);
    const a = db.prepare("SELECT * FROM audit_log WHERE action='DELETE' AND entityId=?").all(n.id) as any[];
    expect(a).toHaveLength(1);
    expect(a[0].performedBy).toBe("killer");
    expect(repo.getNode(other.id)).not.toBeNull();
  });
  it("deleteNode removes inbound edges, leaves unrelated data, no audit for unknown id", () => {
    const a = repo.createNode("attackTicket", { 标题: "A" }, "t");
    const b = repo.createNode("person", { name: "B" }, "t");
    const c = repo.createNode("person", { name: "C" }, "t");
    repo.createEdge("BLOCKED_BY", b.id, a.id, {}, "t");   // a is TARGET (inbound)
    repo.createEdge("RELATES_TO", b.id, c.id, {}, "t");   // unrelated, must survive
    repo.deleteNode(a.id, "t");
    expect(repo.queryEdges({ targetId: a.id })).toHaveLength(0);
    expect(repo.queryEdges({ sourceId: b.id, targetId: c.id })).toHaveLength(1);
    expect(repo.getNode(b.id)).not.toBeNull();
    const before = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='DELETE'").get() as any).n;
    repo.deleteNode("ghost-does-not-exist", "t");
    const after = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='DELETE'").get() as any).n;
    expect(after).toBe(before);
  });
  it("logAudit writes an arbitrary audit row", () => {
    repo.logAudit({ action: "SCHEMA_addField", entityType: "schema", entityId: "attackTicket", changes: { x: 1 }, actor: "alice" });
    const a = db.prepare("SELECT * FROM audit_log WHERE action='SCHEMA_addField'").all() as any[];
    expect(a).toHaveLength(1);
    expect(a[0].performedBy).toBe("alice");
    expect(JSON.parse(a[0].changes)).toEqual({ x: 1 });
  });
  it("deleteEdges removes only matching edges and audits", () => {
    const a = repo.createNode("attackTicket", { 标题: "A" }, "t");
    const p = repo.createNode("person", { name: "张三" }, "t");
    const q = repo.createNode("person", { name: "李四" }, "t");
    repo.createEdge("REF", a.id, p.id, { field: "当前处理人" }, "t");
    repo.createEdge("REF", a.id, q.id, { field: "攻关组长" }, "t");
    repo.createEdge("CONTRIBUTED_TO", a.id, p.id, {}, "t");
    repo.deleteEdges({ sourceId: a.id, edgeType: "REF" }, "killer");
    expect(repo.queryEdges({ sourceId: a.id, edgeType: "REF" })).toHaveLength(0);
    expect(repo.queryEdges({ sourceId: a.id, edgeType: "CONTRIBUTED_TO" })).toHaveLength(1);
    const au = db.prepare("SELECT * FROM audit_log WHERE action='DELETE' AND entityType='edge'").all() as any[];
    expect(au.length).toBeGreaterThanOrEqual(1);
    expect(au[0].performedBy).toBe("killer");
  });
});
