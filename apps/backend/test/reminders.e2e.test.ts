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
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-rem-"));
  const db = openDb(join(dir, "t.sqlite"));
  const repo = new SqliteRepository(new SqliteAdapter(db));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, db };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

describe("reminder engine e2e", () => {
  it("scan: 问题单跟催 fires for tickets with no progress in >= 3 days", async () => {
    const { app, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "停滞单", 状态: "进行中", 当前处理人: "甲" })).body;
    db.prepare(`UPDATE nodes SET updated_at=? WHERE id=?`).run(daysAgo(7), t.id);
    const s = await request(app).post("/api/reminders/scan").send({});
    expect(s.status).toBe(200);
    expect(s.body.created).toBeGreaterThanOrEqual(1);
    const list = (await request(app).get("/api/reminders?status=待发送")).body;
    const stale = list.find((r: any) => r.kind === "问题单跟催" && r.ticketId === t.id);
    expect(stale).toBeTruthy();
    expect(stale.recipientName).toBe("甲");
    expect(stale.body).toContain("停滞");
  });

  it("scan: FE Deadline 提醒 fires for deadlines within 3 days", async () => {
    const { app } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({
      标题: "临期单", 状态: "进行中", 当前处理人: "乙",
      客户要求解决时间: daysAhead(2),
    })).body;
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders?status=待发送")).body;
    const dl = list.find((r: any) => r.kind === "FE Deadline 提醒" && r.ticketId === t.id);
    expect(dl).toBeTruthy();
    expect(dl.recipientName).toBe("乙");
  });

  it("scan is idempotent — same (kind,ticketId,recipient) within 7 days not duplicated", async () => {
    const { app, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "重复单", 状态: "进行中", 当前处理人: "丙" })).body;
    db.prepare(`UPDATE nodes SET updated_at=? WHERE id=?`).run(daysAgo(5), t.id);
    const s1 = await request(app).post("/api/reminders/scan").send({});
    const c1 = s1.body.created;
    const s2 = await request(app).post("/api/reminders/scan").send({});
    expect(s2.body.created).toBe(0);
    expect(c1).toBeGreaterThanOrEqual(1);
  });

  it("send (stub channel) → 已发送 + audit; non-待发送 → 409; unknown id → 404", async () => {
    const { app, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "发送单", 状态: "进行中", 当前处理人: "丁" })).body;
    db.prepare(`UPDATE nodes SET updated_at=? WHERE id=?`).run(daysAgo(7), t.id);
    await request(app).post("/api/reminders/scan").send({});
    const pending = (await request(app).get("/api/reminders?status=待发送")).body[0];
    const before = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    const r = await request(app).post(`/api/reminders/${pending.id}/send`).send({ decidedBy: "运营" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("已发送");
    expect(r.body.decidedBy).toBe("运营");
    const after = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(after).toBeGreaterThan(before);
    const again = await request(app).post(`/api/reminders/${pending.id}/send`).send({ decidedBy: "运营" });
    expect(again.status).toBe(409);
    const miss = await request(app).post(`/api/reminders/nope/send`).send({ decidedBy: "运营" });
    expect(miss.status).toBe(404);
  });

  it("ignore → 已忽略; non-待发送 → 409", async () => {
    const { app, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "忽略单", 状态: "进行中", 当前处理人: "戊" })).body;
    db.prepare(`UPDATE nodes SET updated_at=? WHERE id=?`).run(daysAgo(7), t.id);
    await request(app).post("/api/reminders/scan").send({});
    const pending = (await request(app).get("/api/reminders?status=待发送")).body[0];
    const r = await request(app).post(`/api/reminders/${pending.id}/ignore`).send({ decidedBy: "运营" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("已忽略");
    const again = await request(app).post(`/api/reminders/${pending.id}/ignore`).send({ decidedBy: "运营" });
    expect(again.status).toBe(409);
  });

  it("tickets without 当前处理人 are skipped by both rules (no recipient → no reminder)", async () => {
    const { app, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "无处理人单", 状态: "进行中", 客户要求解决时间: daysAhead(1) })).body;
    db.prepare(`UPDATE nodes SET updated_at=? WHERE id=?`).run(daysAgo(7), t.id);
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders")).body;
    expect(list.filter((r: any) => r.ticketId === t.id)).toHaveLength(0);
  });
});
