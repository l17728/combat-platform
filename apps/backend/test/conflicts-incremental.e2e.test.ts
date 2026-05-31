import { describe, it, expect } from "vitest";
import { makeTestApp } from "./helpers.js";
import { syncConflicts, syncConflictsForOne, listConflictRows } from "../src/conflicts.js";

describe("syncConflictsForOne (v2.2 P1 §3 — 增量算法)", () => {
  it("creates CONFLICTS_WITH for same owner active tickets", async () => {
    const { repo } = await makeTestApp();
    const t1 = await repo.createNode("attackTicket", { 标题: "T1", 状态: "进行中", 当前处理人: "Alice" }, "test");
    const t2 = await repo.createNode("attackTicket", { 标题: "T2", 状态: "进行中", 当前处理人: "Alice" }, "test");
    await syncConflictsForOne(repo, t1.id);
    const rows = await listConflictRows(repo);
    expect(rows.length).toBe(1);
    expect(rows[0].edgeType).toBe("CONFLICTS_WITH");
    expect(rows[0].reason).toBe("同负责人多并发：Alice");
    // 双向边都建了 (listConflictRows dedup 后返回 1 条)
    expect([rows[0].source.id, rows[0].target.id].sort()).toEqual([t1.id, t2.id].sort());
  });

  it("creates OVERLAPS_WITH for same 问题单号", async () => {
    const { repo } = await makeTestApp();
    const t1 = await repo.createNode("attackTicket", { 标题: "T1", 状态: "进行中", 问题单号: "PB-100" }, "test");
    const t2 = await repo.createNode("attackTicket", { 标题: "T2", 状态: "已解决", 问题单号: "PB-100" }, "test");
    await syncConflictsForOne(repo, t1.id);
    const rows = await listConflictRows(repo);
    expect(rows.length).toBe(1);
    expect(rows[0].edgeType).toBe("OVERLAPS_WITH");
  });

  it("only touches edges for the given ticket (does not delete others)", async () => {
    const { repo } = await makeTestApp();
    // Group A: 3 tickets same owner = 3 pairs of CONFLICTS_WITH
    const a1 = await repo.createNode("attackTicket", { 标题: "A1", 状态: "进行中", 当前处理人: "Alice" }, "test");
    const a2 = await repo.createNode("attackTicket", { 标题: "A2", 状态: "进行中", 当前处理人: "Alice" }, "test");
    const a3 = await repo.createNode("attackTicket", { 标题: "A3", 状态: "进行中", 当前处理人: "Alice" }, "test");
    // Group B: 2 tickets same owner (unrelated)
    const b1 = await repo.createNode("attackTicket", { 标题: "B1", 状态: "进行中", 当前处理人: "Bob" }, "test");
    const b2 = await repo.createNode("attackTicket", { 标题: "B2", 状态: "进行中", 当前处理人: "Bob" }, "test");

    // Full sync first
    await syncConflicts(repo);
    let rows = await listConflictRows(repo);
    expect(rows.length).toBe(4); // C(3,2)=3 in group A + C(2,2)=1 in group B

    // Now mutate a1 to a different owner — incremental should only adjust a1's edges
    await repo.updateNode(a1.id, { 当前处理人: "Charlie" }, "test");
    await syncConflictsForOne(repo, a1.id);

    rows = await listConflictRows(repo);
    // Group A: a2-a3 still conflict; a1 no longer
    // Group B: b1-b2 unchanged
    // Expected: a2-a3 + b1-b2 = 2 conflicts
    expect(rows.length).toBe(2);
    const pairs = rows.map((r) => [r.source.id, r.target.id].sort().join("-")).sort();
    expect(pairs).toEqual([[a2.id, a3.id].sort().join("-"), [b1.id, b2.id].sort().join("-")].sort());
  });

  it("ticket with non-active status does NOT cause CONFLICTS_WITH (still does OVERLAPS_WITH)", async () => {
    const { repo } = await makeTestApp();
    const t1 = await repo.createNode(
      "attackTicket",
      { 标题: "T1", 状态: "已解决", 当前处理人: "Alice", 问题单号: "PB-1" },
      "test"
    );
    const t2 = await repo.createNode(
      "attackTicket",
      { 标题: "T2", 状态: "进行中", 当前处理人: "Alice", 问题单号: "PB-1" },
      "test"
    );
    await syncConflictsForOne(repo, t1.id);
    const rows = await listConflictRows(repo);
    // No CONFLICTS_WITH (t1 not active) but OVERLAPS_WITH on PB-1
    expect(rows.length).toBe(1);
    expect(rows[0].edgeType).toBe("OVERLAPS_WITH");
  });

  it("matches full syncConflicts result for a fresh dataset", async () => {
    const { repo } = await makeTestApp();
    const a = await repo.createNode("attackTicket", { 标题: "A", 状态: "进行中", 当前处理人: "X" }, "test");
    const b = await repo.createNode("attackTicket", { 标题: "B", 状态: "进行中", 当前处理人: "X" }, "test");
    const c = await repo.createNode("attackTicket", { 标题: "C", 状态: "进行中", 当前处理人: "X" }, "test");

    // Full sync as baseline
    await syncConflicts(repo);
    const baseRows = await listConflictRows(repo);
    const baseSet = new Set(baseRows.map((r) => [r.source.id, r.target.id].sort().join("|") + ":" + r.edgeType));

    // Reset and call incremental for each ticket in succession
    await repo.deleteEdges({ edgeType: "CONFLICTS_WITH" }, "test");
    await repo.deleteEdges({ edgeType: "OVERLAPS_WITH" }, "test");
    await syncConflictsForOne(repo, a.id);
    await syncConflictsForOne(repo, b.id);
    await syncConflictsForOne(repo, c.id);

    const incRows = await listConflictRows(repo);
    const incSet = new Set(incRows.map((r) => [r.source.id, r.target.id].sort().join("|") + ":" + r.edgeType));

    expect(incSet).toEqual(baseSet);
  });
});
