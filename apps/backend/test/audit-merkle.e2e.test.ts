import { describe, it, expect } from "vitest";
import { makeTestApp } from "./helpers.js";
import { verifyAuditChain, computeAuditHash } from "../src/audit-chain.js";

describe("audit_log Merkle 链 — 完整性校验", () => {
  it("每条 audit row 都有 prev_hash 和 hash", async () => {
    const { repo, adapter } = await makeTestApp();
    await repo.logAudit({ action: "TEST", entityType: "node", entityId: "n1", changes: { a: 1 }, actor: "test" });
    await repo.logAudit({ action: "TEST", entityType: "node", entityId: "n2", changes: { a: 2 }, actor: "test" });

    const rows = await adapter.query<{ id: string; prev_hash: string; hash: string }>(
      'SELECT id, prev_hash, hash FROM audit_log ORDER BY "performedAt", id'
    );
    expect(rows.length).toBe(2);
    expect(rows[0].hash).toBeTruthy();
    expect(rows[0].prev_hash).toBe(""); // 首条 prev_hash = 空字符串
    expect(rows[1].prev_hash).toBe(rows[0].hash); // 链式连接
    expect(rows[1].hash).toBeTruthy();
    expect(rows[1].hash).not.toBe(rows[0].hash);
  });

  it("computeAuditHash 是稳定的", async () => {
    const h1 = computeAuditHash({
      prevHash: "",
      action: "CREATE",
      entityType: "node",
      entityId: "abc",
      changes: { x: 1 },
      performedAt: "2026-05-30T00:00:00.000Z",
    });
    const h2 = computeAuditHash({
      prevHash: "",
      action: "CREATE",
      entityType: "node",
      entityId: "abc",
      changes: { x: 1 },
      performedAt: "2026-05-30T00:00:00.000Z",
    });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("verifyAuditChain 在未被改的链上返回 ok", async () => {
    const { repo, adapter } = await makeTestApp();
    for (let i = 0; i < 5; i++) {
      await repo.logAudit({ action: "TEST", entityType: "node", entityId: `n${i}`, changes: { i }, actor: "test" });
    }
    const result = await verifyAuditChain(adapter);
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(5);
    expect(result.brokenAt).toBeUndefined();
  });

  it("verifyAuditChain 检测到 changes 被篡改", async () => {
    const { repo, adapter } = await makeTestApp();
    await repo.logAudit({ action: "A1", entityType: "node", entityId: "n1", changes: { v: 1 }, actor: "test" });
    await repo.logAudit({ action: "A2", entityType: "node", entityId: "n2", changes: { v: 2 }, actor: "test" });
    await repo.logAudit({ action: "A3", entityType: "node", entityId: "n3", changes: { v: 3 }, actor: "test" });

    // 直接改 SQLite 第 2 条 changes (绕过 logAudit)
    const rows = await adapter.query<{ id: string }>('SELECT id FROM audit_log ORDER BY "performedAt", id LIMIT 100');
    const targetId = rows[1].id;
    await adapter.run(`UPDATE audit_log SET changes = ? WHERE id = ?`, ['{"v":999}', targetId]);

    const result = await verifyAuditChain(adapter);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(targetId);
  });

  it("verifyAuditChain 检测到 action 被改写", async () => {
    const { repo, adapter } = await makeTestApp();
    await repo.logAudit({ action: "CREATE", entityType: "node", entityId: "n1", changes: {}, actor: "test" });
    await repo.logAudit({ action: "UPDATE", entityType: "node", entityId: "n1", changes: {}, actor: "test" });
    const rows = await adapter.query<{ id: string }>('SELECT id FROM audit_log ORDER BY "performedAt", id');
    await adapter.run(`UPDATE audit_log SET action = ? WHERE id = ?`, ["DELETE", rows[0].id]);

    const result = await verifyAuditChain(adapter);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(rows[0].id);
  });

  it("verifyAuditChain 检测到一条被删除(链断)", async () => {
    const { repo, adapter } = await makeTestApp();
    await repo.logAudit({ action: "A1", entityType: "node", entityId: "n1", changes: {}, actor: "test" });
    await repo.logAudit({ action: "A2", entityType: "node", entityId: "n2", changes: {}, actor: "test" });
    await repo.logAudit({ action: "A3", entityType: "node", entityId: "n3", changes: {}, actor: "test" });
    const rows = await adapter.query<{ id: string }>('SELECT id FROM audit_log ORDER BY "performedAt", id');
    await adapter.run(`DELETE FROM audit_log WHERE id = ?`, [rows[1].id]);

    const result = await verifyAuditChain(adapter);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(rows[2].id); // 第3条的 prev_hash 不再匹配
  });
});
