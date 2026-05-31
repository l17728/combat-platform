import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { NotificationsRepo } from "../src/notifications.js";

function makeApp() {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-notif-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeFileSync(
    join(cfgDir, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        {
          name: "状态",
          type: "enum",
          label: "状态",
          required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"],
        },
        { name: "事件级别", type: "string", label: "事件级别" },
        { name: "当前处理人", type: "string", label: "当前处理人" },
        { name: "创建人", type: "string", label: "创建人" },
      ],
    })
  );
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(cfgDir);
  const app = createApp({ repo, registry, db, dbPath, adapter });
  return { app, repo, adapter, db };
}

describe("notifications inbox e2e", () => {
  beforeEach(() => {
    process.env.COMBAT_NO_AUTH = "1";
  });

  it("create + list + unread count + mark read", async () => {
    const { adapter } = makeApp();
    const repo = new NotificationsRepo(adapter);
    await repo.create({
      userId: "alice",
      kind: "system",
      title: "欢迎",
      body: "首次登录",
      link: "/",
    });
    await repo.create({ userId: "alice", kind: "mention", title: "@你" });
    await repo.create({ userId: "bob", kind: "system", title: "其他人" });

    const aliceItems = await repo.list("alice");
    expect(aliceItems).toHaveLength(2);
    expect(await repo.unreadCount("alice")).toBe(2);
    expect(await repo.unreadCount("bob")).toBe(1);

    // mark one
    const marked = await repo.markRead("alice", aliceItems[0].id);
    expect(marked?.readAt).toBeTruthy();
    expect(await repo.unreadCount("alice")).toBe(1);

    // can not mark another user's notification
    expect(await repo.markRead("alice", (await repo.list("bob"))[0].id)).toBeNull();

    // mark all
    const n = await repo.markAllRead("alice");
    expect(n).toBe(1);
    expect(await repo.unreadCount("alice")).toBe(0);
  });

  it("GET /api/notifications returns isolated to current user", async () => {
    const { app, adapter } = makeApp();
    const repo = new NotificationsRepo(adapter);
    await repo.create({ userId: "admin", kind: "system", title: "给 admin 的" });
    await repo.create({ userId: "other", kind: "system", title: "给别人的" });

    const r = await request(app).get("/api/notifications");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].title).toBe("给 admin 的");
    expect(r.body.unreadCount).toBe(1);
  });

  it("POST /api/notifications/read-all marks every unread for current user", async () => {
    const { app, adapter } = makeApp();
    const repo = new NotificationsRepo(adapter);
    await repo.create({ userId: "admin", kind: "system", title: "a" });
    await repo.create({ userId: "admin", kind: "system", title: "b" });

    const r = await request(app).post("/api/notifications/read-all");
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(2);

    const after = await request(app).get("/api/notifications");
    expect(after.body.unreadCount).toBe(0);
  });

  it("POST /api/notifications creates (admin path, COMBAT_NO_AUTH bypass)", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/notifications").send({ userId: "u1", kind: "system", title: "manual" });
    expect(r.status).toBe(201);
    expect(r.body.userId).toBe("u1");

    // missing fields → 400
    const bad = await request(app).post("/api/notifications").send({ userId: "u1" });
    expect(bad.status).toBe(400);
  });

  it("escalation scan creates an inbox notification for owner + creator", async () => {
    const { app, repo, adapter } = makeApp();
    // create overdue P4A ticket
    const t = (
      await request(app)
        .post("/api/nodes/attackTicket")
        .send({ 标题: "测试单", 状态: "进行中", 事件级别: "P4A", 当前处理人: "owner_user", 创建人: "creator_user" })
    ).body;
    const old = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    await (repo as any).adapter.run("UPDATE nodes SET created_at = ? WHERE id = ?", [old, t.id]);

    const scan = await request(app).post("/api/escalation/scan");
    expect(scan.status).toBe(200);
    expect(scan.body.escalated).toBeGreaterThanOrEqual(1);

    // owner_user 收件箱应有一条 escalation 通知
    const nrepo = new NotificationsRepo(adapter);
    const ownerInbox = await nrepo.list("owner_user");
    expect(ownerInbox.find((n) => n.kind === "escalation")).toBeTruthy();
    const creatorInbox = await nrepo.list("creator_user");
    expect(creatorInbox.find((n) => n.kind === "escalation")).toBeTruthy();
  });

  it("bug status change emits a bug_update notification for the reporter", async () => {
    const { app, adapter } = makeApp();
    // create bug as 'tester'
    const b = (await request(app).post("/api/bug-reports").send({ title: "页面崩溃", reporter: "tester" })).body;
    expect(b.id).toBeTruthy();

    // change status
    const upd = await request(app).patch(`/api/bug-reports/${b.id}`).send({ status: "处理中" });
    expect(upd.status).toBe(200);

    const nrepo = new NotificationsRepo(adapter);
    const inbox = await nrepo.list("tester");
    const update = inbox.find((n) => n.kind === "bug_update");
    expect(update).toBeTruthy();
    expect(update!.title).toContain("处理中");
  });
});
