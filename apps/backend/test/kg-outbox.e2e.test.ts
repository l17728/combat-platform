import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";
import {
  ensureKgOutboxTable,
  enqueueKgOutbox,
  listKgOutbox,
  countKgOutboxByStatus,
  processKgOutbox,
  replayFailed,
  KG_OUTBOX_MAX_RETRIES,
} from "../src/kg-outbox.js";

describe("kg_outbox — durable replacement for setImmediate(syncToKG)", () => {
  it("enqueues and lists pending events", async () => {
    const { adapter } = await makeTestApp();
    await ensureKgOutboxTable(adapter);

    await enqueueKgOutbox(adapter, "attackTicket.escalation", {});
    await enqueueKgOutbox(adapter, "attackTicket.reminders", {});
    await enqueueKgOutbox(adapter, "attackTicket.saved", { ticketId: "abc" });

    const all = await listKgOutbox(adapter);
    expect(all.length).toBe(3);
    const pending = await listKgOutbox(adapter, { status: "pending" });
    expect(pending.length).toBe(3);
    const counts = await countKgOutboxByStatus(adapter);
    expect(counts.pending).toBe(3);
    expect(counts.done).toBe(0);
    expect(counts.failed).toBe(0);
  });

  it("processKgOutbox marks events done on success", async () => {
    const { adapter, repo, registry } = await makeTestApp();
    await ensureKgOutboxTable(adapter);

    await enqueueKgOutbox(adapter, "attackTicket.escalation", {});
    await enqueueKgOutbox(adapter, "attackTicket.reminders", {});

    const n = await processKgOutbox(adapter, repo, registry);
    expect(n).toBe(2);

    const counts = await countKgOutboxByStatus(adapter);
    expect(counts.done).toBe(2);
    expect(counts.pending).toBe(0);
  });

  it("retries failed events with exponential backoff, then marks failed", async () => {
    const { adapter, repo, registry } = await makeTestApp();
    await ensureKgOutboxTable(adapter);

    // Inject an event type the processor doesn't know → forces error path.
    await enqueueKgOutbox(adapter, "attackTicket.escalation" as any, {});
    // Re-write to a bogus eventType so processOne throws.
    const eventCol = adapter.kind === "postgres" ? `"eventType"` : "eventType";
    await adapter.run(`UPDATE kg_outbox SET ${eventCol} = ?`, ["bogus"]);

    // First attempt → retries=1, status stays pending, next_run_at pushed back
    await processKgOutbox(adapter, repo, registry);
    let rows = await listKgOutbox(adapter);
    expect(rows[0].retries).toBe(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].lastError).toContain("bogus");

    // Force nextRunAt back to now so subsequent passes pick it up
    for (let i = 2; i <= KG_OUTBOX_MAX_RETRIES; i++) {
      await adapter.run(`UPDATE kg_outbox SET next_run_at = ?`, [new Date().toISOString()]);
      await processKgOutbox(adapter, repo, registry);
    }

    rows = await listKgOutbox(adapter);
    expect(rows[0].retries).toBe(KG_OUTBOX_MAX_RETRIES);
    expect(rows[0].status).toBe("failed");
  });

  it("replayFailed resets failed → pending and re-processes", async () => {
    const { adapter, repo, registry } = await makeTestApp();
    await ensureKgOutboxTable(adapter);

    await enqueueKgOutbox(adapter, "attackTicket.escalation" as any, {});
    const eventCol = adapter.kind === "postgres" ? `"eventType"` : "eventType";
    await adapter.run(`UPDATE kg_outbox SET ${eventCol} = ?`, ["bogus"]);

    // Burn through retries to make it failed
    for (let i = 0; i < KG_OUTBOX_MAX_RETRIES; i++) {
      await adapter.run(`UPDATE kg_outbox SET next_run_at = ?`, [new Date().toISOString()]);
      await processKgOutbox(adapter, repo, registry);
    }
    let counts = await countKgOutboxByStatus(adapter);
    expect(counts.failed).toBe(1);

    // Now fix the bogus row to a real event type and replay
    await adapter.run(`UPDATE kg_outbox SET ${eventCol} = ?`, ["attackTicket.escalation"]);
    const reset = await replayFailed(adapter);
    expect(reset).toBe(1);

    await processKgOutbox(adapter, repo, registry);
    counts = await countKgOutboxByStatus(adapter);
    expect(counts.done).toBe(1);
    expect(counts.failed).toBe(0);
  });

  it("HTTP /api/kg-outbox/status returns counts", async () => {
    const { app, adapter } = await makeTestApp();
    await ensureKgOutboxTable(adapter);
    await enqueueKgOutbox(adapter, "attackTicket.escalation", {});

    const r = await request(app).get("/api/kg-outbox/status");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("pending");
    expect(r.body.pending).toBeGreaterThanOrEqual(1);
  });

  it("HTTP /api/kg-outbox/replay drains failed queue", async () => {
    const { app, adapter, repo, registry } = await makeTestApp();
    await ensureKgOutboxTable(adapter);

    await enqueueKgOutbox(adapter, "attackTicket.escalation" as any, {});
    const eventCol = adapter.kind === "postgres" ? `"eventType"` : "eventType";
    await adapter.run(`UPDATE kg_outbox SET ${eventCol} = ?`, ["bogus"]);
    for (let i = 0; i < KG_OUTBOX_MAX_RETRIES; i++) {
      await adapter.run(`UPDATE kg_outbox SET next_run_at = ?`, [new Date().toISOString()]);
      await processKgOutbox(adapter, repo, registry);
    }
    expect((await countKgOutboxByStatus(adapter)).failed).toBe(1);
    await adapter.run(`UPDATE kg_outbox SET ${eventCol} = ?`, ["attackTicket.escalation"]);

    const r = await request(app).post("/api/kg-outbox/replay");
    expect(r.status).toBe(200);
    expect(r.body.reset).toBe(1);
    expect(r.body.processed).toBe(1);

    expect((await countKgOutboxByStatus(adapter)).done).toBe(1);
  });
});
