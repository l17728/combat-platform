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
});
