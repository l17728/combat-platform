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
async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-dr-"));
  const db = openDb(join(dir, "t.sqlite"));
  const repo = new SqliteRepository(new SqliteAdapter(db));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, db };
}

function insertProgressAt(db: any, ownerId: string, seqNo: number, content: string, status: string, at: string) {
  db.prepare(`INSERT INTO progress_log VALUES (@id,@ownerId,@seqNo,@content,@s,@by,@at)`).run({
    id: `pr-${ownerId}-${seqNo}`,
    ownerId,
    seqNo,
    content,
    s: status,
    by: "seed",
    at,
  });
}

describe("daily-report e2e", () => {
  it("groups today's entries by ticket; latestStatus is the last entry of that day; summary correct", async () => {
    const { app, db } = await makeApp();
    const A = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" })).body;
    const B = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "B", 状态: "已解决" })).body;
    const C = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "C", 状态: "进行中" })).body;
    const d1 = "2026-05-20",
      d2 = "2026-05-21";
    insertProgressAt(db, A.id, 1, "A-1", "进行中", `${d1}T01:00:00Z`);
    insertProgressAt(db, A.id, 2, "A-2", "已解决", `${d1}T05:00:00Z`);
    insertProgressAt(db, B.id, 1, "B-1", "已解决", `${d1}T02:00:00Z`);
    insertProgressAt(db, C.id, 1, "C-1", "进行中", `${d2}T03:00:00Z`);

    const r = await request(app).get(`/api/daily-report?date=${d1}`);
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(d1);
    expect(r.body.sections).toHaveLength(2);
    const byTitle = Object.fromEntries(r.body.sections.map((s: any) => [s.标题, s]));
    expect(byTitle["A"].latestStatus).toBe("已解决");
    expect(byTitle["A"].entries.map((e: any) => e.seqNo)).toEqual([1, 2]);
    expect(byTitle["B"].entries).toHaveLength(1);
    expect(byTitle["B"].latestStatus).toBe("已解决");
    expect(r.body.summary.ticketsTouched).toBe(2);
    expect(r.body.summary.entriesTotal).toBe(3);
    expect(r.body.summary.openByStatus["进行中"]).toBeGreaterThanOrEqual(2);
    expect(r.body.summary.openByStatus["已解决"]).toBeGreaterThanOrEqual(1);

    const r2 = await request(app).get(`/api/daily-report?date=${d2}`);
    expect(r2.body.sections).toHaveLength(1);
    expect(r2.body.sections[0].标题).toBe("C");
  });

  it("empty day: sections=[]; summary still computes openByStatus over all tickets", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "E", 状态: "进行中" });
    const r = await request(app).get("/api/daily-report?date=2000-01-01");
    expect(r.body.sections).toEqual([]);
    expect(r.body.summary.ticketsTouched).toBe(0);
    expect(r.body.summary.entriesTotal).toBe(0);
    expect(r.body.summary.openByStatus["进行中"]).toBeGreaterThanOrEqual(1);
  });

  it("read-only: audit_log unchanged; idempotent body across calls", async () => {
    const { app, db } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "RO", 状态: "进行中" });
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    const a = await request(app).get("/api/daily-report?date=2026-05-20");
    const b = await request(app).get("/api/daily-report?date=2026-05-20");
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
    expect(a.body).toEqual(b.body);
  });

  it("missing or invalid date → defaults to today (Asia/Shanghai); does NOT 400", async () => {
    const { app } = await makeApp();
    // Server uses Asia/Shanghai (UTC+8) calendar date — match that here to avoid
    // false failure when UTC and CST are on different calendar days (16:00-24:00 UTC).
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const r1 = await request(app).get("/api/daily-report");
    expect(r1.status).toBe(200);
    expect(r1.body.date).toBe(today);
    const r2 = await request(app).get("/api/daily-report?date=not-a-date");
    expect(r2.status).toBe(200);
    expect(r2.body.date).toBe(today);
  });
});
