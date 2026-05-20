# 增量10 — 跟催/提醒引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Notification outbox + pluggable ChannelAdapter (default stub) + 2 rules (问题单跟催 / FE Deadline) + `/reminders` queue UI. Architecture mirrors increment-3c proposals (scan → 待发送 → send/ignore decision) — refer to `apps/backend/src/proposals.ts` and `apps/frontend/src/pages/ProposalsPage.tsx` as canonical sibling patterns.

**Tech Stack:** Same as prior. PRD §28 is the basis.

---

## File Structure

- `packages/shared/src/types.ts` — `ReminderStatus`, `ReminderKind`, `Reminder` (T1)
- `packages/shared/src/repository.ts` — 4 Repository reminder method sigs + `ChannelAdapter` (T1)
- `packages/shared/src/types.test.ts` — contract test (T1)
- `apps/backend/src/db.ts` — `notifications` table DDL (T2)
- `apps/backend/src/repository.ts` — 4 reminder methods on SqliteRepository (T2)
- `apps/backend/src/rules.ts` — NEW `scanReminders` (T2)
- `apps/backend/src/channel.ts` — NEW `StubChannelAdapter` (T2)
- `apps/backend/src/reminders.ts` — NEW router (T2)
- `apps/backend/src/app.ts` — wire (T2)
- `apps/backend/test/reminders.e2e.test.ts` — NEW e2e (T2)
- `apps/frontend/src/api.ts` — 4 methods (T3)
- `apps/frontend/src/pages/RemindersPage.tsx` — NEW (T3)
- `apps/frontend/src/App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx` — route/nav/card (T3)
- `apps/frontend/e2e/reminders.spec.ts` — NEW (T3)

---

## Task 1: Shared contract (SERIAL GATE)

- [ ] **Step 1: Failing test** — append to `packages/shared/src/types.test.ts` (add `Reminder, ReminderStatus, ReminderKind, ChannelAdapter, Repository` to its `./index.js` import):

```ts
describe("reminder contracts", () => {
  it("Reminder shape + status enum + ChannelAdapter interface", () => {
    const r: Reminder = {
      id: "r1", kind: "问题单跟催", ticketId: "t1",
      recipientPersonId: "p1", recipientName: "甲",
      subject: "跟催: T1", body: "已停滞 5 天",
      status: "待发送", createdAt: new Date().toISOString(),
    };
    const all: ReminderStatus[] = ["待发送", "已发送", "已忽略"];
    expect(all).toContain(r.status);
    const ch: ChannelAdapter = { send: () => ({ sentAt: "t" }) };
    expect(ch.send(r, "actor").sentAt).toBe("t");
  });
});
```

- [ ] **Step 2:** `npx tsc -p packages/shared/tsconfig.json --noEmit` → FAIL.

- [ ] **Step 3: types.ts** — append (after `DailyReport`):

```ts
export type ReminderStatus = "待发送" | "已发送" | "已忽略";
export type ReminderKind = "问题单跟催" | "FE Deadline 提醒";
export interface Reminder {
  id: string;
  kind: ReminderKind;
  ticketId: string;
  recipientPersonId?: string;
  recipientName: string;
  subject: string;
  body: string;
  status: ReminderStatus;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}
```

- [ ] **Step 4: repository.ts** — add `Reminder, ReminderStatus` to the type-import line; append inside `interface Repository { ... }` just before closing brace:

```ts
  createReminder(p: Omit<Reminder, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">, actor: string): Reminder;
  listReminders(opts?: { status?: ReminderStatus }): Reminder[];
  getReminder(id: string): Reminder | undefined;
  updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Reminder;
```

After the interface, append:

```ts
export interface ChannelAdapter {
  send(r: Reminder, actor: string): { sentAt: string };
}
```

- [ ] **Step 5:** `npx tsc -p packages/shared/tsconfig.json --noEmit` clean; `npm run test:shared` all green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/repository.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): Reminder contracts + ChannelAdapter (10-T1)"
```

---

## Task 2: Backend — table + repo + rules + stub channel + router (PARALLEL, after T1)

- [ ] **Step 1: DDL** — in `apps/backend/src/db.ts` add inside `db.exec(\`...\`)` (after proposals, before CREATE INDEX):

```sql
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT NOT NULL,
      recipient_person_id TEXT, recipient_name TEXT,
      subject TEXT, body TEXT,
      status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
```

- [ ] **Step 2: Failing e2e** — create `apps/backend/test/reminders.e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-rem-"));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, db: (repo as any).db };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

describe("reminder engine e2e", () => {
  it("scan: 问题单跟催 fires for tickets with no progress in >= 3 days", async () => {
    const { app, repo, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "停滞单", 状态: "进行中", 当前处理人: "甲" })).body;
    // backdate the ticket's updatedAt and skip progress entirely
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
    const { app, repo, db } = makeApp();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "重复单", 状态: "进行中", 当前处理人: "丙" })).body;
    db.prepare(`UPDATE nodes SET updated_at=? WHERE id=?`).run(daysAgo(5), t.id);
    void repo;
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
```

- [ ] **Step 3: SqliteRepository** — in `apps/backend/src/repository.ts`, add `Reminder, ReminderStatus` to imports; mirror the proposals methods exactly:

```ts
  createReminder(p: Omit<Reminder,"id"|"status"|"decidedBy"|"decidedAt"|"createdAt">, actor: string): Reminder {
    const now = new Date().toISOString();
    const row: Reminder = { ...p, id: randomUUID(), status: "待发送", createdAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO notifications VALUES (@id,@k,@t,@rpid,@rn,@sub,@body,@st,@db,@da,@ca)`)
        .run({ id: row.id, k: row.kind, t: row.ticketId,
          rpid: row.recipientPersonId ?? null, rn: row.recipientName,
          sub: row.subject, body: row.body, st: row.status, db: null, da: null, ca: now });
      this.audit("CREATE", "reminder", row.id, { kind: row.kind, ticketId: row.ticketId }, actor);
    })();
    return row;
  }
  private mapReminder(r: any): Reminder {
    return { id: r.id, kind: r.kind, ticketId: r.ticket_id,
      recipientPersonId: r.recipient_person_id ?? undefined, recipientName: r.recipient_name ?? "",
      subject: r.subject ?? "", body: r.body ?? "",
      status: r.status, decidedBy: r.decided_by ?? undefined,
      decidedAt: r.decided_at ?? undefined, createdAt: r.created_at };
  }
  listReminders(opts: { status?: ReminderStatus } = {}): Reminder[] {
    const rows = this.db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC`).all() as any[];
    return rows.map(r => this.mapReminder(r)).filter(p => !opts.status || p.status === opts.status);
  }
  getReminder(id: string): Reminder | undefined {
    const r = this.db.prepare(`SELECT * FROM notifications WHERE id=?`).get(id) as any;
    return r ? this.mapReminder(r) : undefined;
  }
  updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Reminder {
    const cur = this.getReminder(id);
    if (!cur) throw new Error(`reminder ${id} not found`);
    const at = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE notifications SET status=?, decided_by=?, decided_at=? WHERE id=?`)
        .run(status, decidedBy, at, id);
      this.audit("UPDATE", "reminder", id, { status, decidedBy }, actor);
    })();
    return { ...cur, status, decidedBy, decidedAt: at };
  }
```

- [ ] **Step 4: rules.ts** — create `apps/backend/src/rules.ts`:

```ts
import type { Repository, SchemaRegistry, ReminderKind } from "@combat/shared";

const STALE_DAYS = 3;
const DEADLINE_WARN_DAYS = 3;
const OPEN = new Set(["待响应", "处理中", "进行中"]);

export interface ReminderDraft {
  kind: ReminderKind; ticketId: string;
  recipientPersonId?: string; recipientName: string;
  subject: string; body: string;
}

// Resolve the ticket's 当前处理人 via REF edge (3a syncRefEdges) → person id + name.
function currentHandler(repo: Repository, ticketId: string): { id: string; name: string } | undefined {
  const e = repo.queryEdges({ sourceId: ticketId, edgeType: "REF" })
    .find(e => String(e.properties["field"] ?? "") === "当前处理人");
  if (!e) return undefined;
  const p = repo.getNode(e.targetId);
  if (!p) return undefined;
  return { id: p.id, name: String(p.properties["name"] ?? p.id) };
}

export function scanReminders(repo: Repository, _registry: SchemaRegistry, nowMs: number = Date.now()): ReminderDraft[] {
  const drafts: ReminderDraft[] = [];
  for (const t of repo.queryNodes("attackTicket")) {
    const status = String(t.properties["状态"] ?? "").trim();
    if (!OPEN.has(status)) continue;
    const handler = currentHandler(repo, t.id);
    if (!handler) continue; // no recipient → skip
    const title = String(t.properties["标题"] ?? t.id);

    // Rule ① 问题单跟催: last progress (or node update) >= STALE_DAYS ago
    const progresses = repo.listProgress(t.id);
    const lastAt = progresses.length
      ? progresses[progresses.length - 1].updatedAt
      : t.updatedAt;
    const lastMs = Date.parse(lastAt);
    if (Number.isFinite(lastMs) && (nowMs - lastMs) >= STALE_DAYS * 86400000) {
      const days = Math.floor((nowMs - lastMs) / 86400000);
      drafts.push({
        kind: "问题单跟催", ticketId: t.id,
        recipientPersonId: handler.id, recipientName: handler.name,
        subject: `[跟催] 攻关单「${title}」已停滞 ${days} 天`,
        body: `攻关单「${title}」（${t.properties["攻关单号"] ?? t.id}）状态「${status}」自 ${lastAt} 起停滞 ${days} 天，请关注。`,
      });
    }

    // Rule ③ FE Deadline: 客户要求解决时间 in [now, now+DEADLINE_WARN_DAYS]
    const dl = String(t.properties["客户要求解决时间"] ?? "").trim();
    if (dl) {
      const dlMs = Date.parse(dl);
      if (Number.isFinite(dlMs)) {
        const delta = dlMs - nowMs;
        if (delta >= 0 && delta <= DEADLINE_WARN_DAYS * 86400000) {
          const left = Math.ceil(delta / 86400000);
          drafts.push({
            kind: "FE Deadline 提醒", ticketId: t.id,
            recipientPersonId: handler.id, recipientName: handler.name,
            subject: `[Deadline] 攻关单「${title}」客户期限 ${left} 天内`,
            body: `攻关单「${title}」状态「${status}」客户要求解决时间 ${dl}，剩余约 ${left} 天，请尽快推进。`,
          });
        }
      }
    }
  }
  return drafts;
}
```

- [ ] **Step 5: channel.ts** — create `apps/backend/src/channel.ts`:

```ts
import type { Reminder, ChannelAdapter } from "@combat/shared";

// Default stub: records that a 'send' happened (via repo.updateReminderStatus +
// audit in the calling router) but does NOT actually email/IM the recipient.
// Real SMTP / eSpace / welink adapters can implement ChannelAdapter and be
// injected once §13#2/#3 credentials are provided.
export class StubChannelAdapter implements ChannelAdapter {
  send(_r: Reminder, _actor: string) {
    return { sentAt: new Date().toISOString() };
  }
}
```

- [ ] **Step 6: reminders.ts** — create `apps/backend/src/reminders.ts`:

```ts
import { Router } from "express";
import type { Repository, SchemaRegistry, ChannelAdapter } from "@combat/shared";
import { scanReminders } from "./rules.js";
import { StubChannelAdapter } from "./channel.js";

const WINDOW_MS = 7 * 86400000;

export function makeRemindersRouter(repo: Repository, registry: SchemaRegistry,
                                    channel: ChannelAdapter = new StubChannelAdapter()): Router {
  const r = Router();

  r.post("/reminders/scan", (_req, res) => {
    const now = Date.now();
    const existing = repo.listReminders();
    const recent = new Set(existing
      .filter(e => (now - Date.parse(e.createdAt)) <= WINDOW_MS)
      .map(e => `${e.kind}|${e.ticketId}|${e.recipientPersonId ?? ""}`));
    let created = 0;
    for (const d of scanReminders(repo, registry, now)) {
      const k = `${d.kind}|${d.ticketId}|${d.recipientPersonId ?? ""}`;
      if (recent.has(k)) continue;
      recent.add(k);
      repo.createReminder(d, "scan");
      created++;
    }
    res.json({ created });
  });

  r.get("/reminders", (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(repo.listReminders(status ? { status: status as any } : {}));
  });

  function decide(id: string, action: "send" | "ignore", decidedBy: string, res: any) {
    const p = repo.getReminder(id);
    if (!p) return res.status(404).json({ error: "reminder not found" });
    if (p.status !== "待发送") return res.status(409).json({ error: `已决策(${p.status})不可重复` });
    if (!decidedBy || typeof decidedBy !== "string")
      return res.status(400).json({ error: "decidedBy 必填" });
    if (action === "send") {
      channel.send(p, decidedBy); // stub: just returns sentAt; no external I/O
      return res.json(repo.updateReminderStatus(p.id, "已发送", decidedBy, decidedBy));
    }
    return res.json(repo.updateReminderStatus(p.id, "已忽略", decidedBy, decidedBy));
  }

  r.post("/reminders/:id/send", (req, res) =>
    decide(req.params.id, "send", String(req.body?.decidedBy ?? ""), res));
  r.post("/reminders/:id/ignore", (req, res) =>
    decide(req.params.id, "ignore", String(req.body?.decidedBy ?? ""), res));

  return r;
}
```

- [ ] **Step 7: Wire** — `apps/backend/src/app.ts`: add `import { makeRemindersRouter } from "./reminders.js";` and `app.use("/api", makeRemindersRouter(deps.repo, deps.registry));` after daily-report router line, before error middleware.

- [ ] **Step 8: Run** `cd apps/backend && npx vitest run` → expect ALL green (87 + 6 = 93). `npx tsc -p tsconfig.json --noEmit` clean.

- [ ] **Step 9: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/db.ts apps/backend/src/repository.ts apps/backend/src/rules.ts apps/backend/src/channel.ts apps/backend/src/reminders.ts apps/backend/src/app.ts apps/backend/test/reminders.e2e.test.ts
git commit -m "feat(backend): reminder rules engine + outbox + stub channel + API (10-T2)"
```

---

## Task 3: Frontend — RemindersPage + integration (PARALLEL, after T1)

- [ ] **Step 1: api.ts** — add `Reminder` to the `@combat/shared` import; add methods (mirror ProposalsPage's api shape):

```ts
  listReminders(status?: string): Promise<Reminder[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req<Reminder[]>(`/api/reminders${qs}`, {});
  }
  scanReminders(): Promise<{ created: number }> {
    return this.req<{ created: number }>(`/api/reminders/scan`, { method: "POST" });
  }
  sendReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/send`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decidedBy }) });
  }
  ignoreReminder(id: string, decidedBy: string): Promise<Reminder> {
    return this.req<Reminder>(`/api/reminders/${id}/ignore`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decidedBy }) });
  }
```

- [ ] **Step 2: RemindersPage** — create `apps/frontend/src/pages/RemindersPage.tsx` (mirrors `ProposalsPage`):

```tsx
import { useEffect, useState, useCallback } from "react";
import { Table, Button, Space, message, Typography } from "antd";
import { api } from "../api.js";
import type { Reminder } from "@combat/shared";

export function RemindersPage() {
  const [rows, setRows] = useState<Reminder[]>([]);
  const refresh = useCallback(async () => {
    try { setRows(await api.listReminders("待发送")); }
    catch (e) { message.error(String((e as Error).message)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const scan = async () => {
    try { const r = await api.scanReminders(); message.success(`扫描完成，新增 ${r.created} 条提醒`); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const send = async (id: string) => {
    try { await api.sendReminder(id, "运营"); message.success("已发送（stub）"); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const ignore = async (id: string) => {
    try { await api.ignoreReminder(id, "运营"); message.success("已忽略"); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };

  const columns = [
    { title: "类型", dataIndex: "kind" },
    { title: "攻关单", dataIndex: "ticketId" },
    { title: "收件人", dataIndex: "recipientName" },
    { title: "主题", dataIndex: "subject" },
    { title: "正文", dataIndex: "body" },
    { title: "创建时间", dataIndex: "createdAt" },
    { title: "操作", dataIndex: "__act",
      render: (_: unknown, r: Reminder) => (
        <Space>
          <Button aria-label={`send-${r.id}`} type="primary" onClick={() => send(r.id)}>发送(stub)</Button>
          <Button aria-label={`ignore-${r.id}`} danger onClick={() => ignore(r.id)}>忽略</Button>
        </Space>
      ) },
  ];
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>跟催/提醒队列</Typography.Title>
      <Typography.Paragraph type="secondary">
        当前为 stub 渠道：点「发送(stub)」仅记录已发送并写审计，不真实外发。接入 SMTP/eSpace/welink 后真实发送。
      </Typography.Paragraph>
      <Button aria-label="scan-reminders" type="primary" onClick={scan} style={{ marginBottom: 12 }}>扫描提醒</Button>
      {rows.length === 0
        ? <p role="status">暂无待发送提醒</p>
        : <Table rowKey="id" columns={columns} pagination={false} dataSource={rows} />}
    </div>
  );
}
```

- [ ] **Step 3: route + nav + card** —
  - `App.tsx`: `import { RemindersPage } from "./pages/RemindersPage.js";` + `<Route path="/reminders" element={<RemindersPage />} />` after `/daily-report`.
  - `AppShell.tsx`: `{ key: "/reminders", label: <Link to="/reminders">跟催提醒</Link> }` (after daily-report).
  - `HomePage.tsx`: `{ to: "/reminders", title: "跟催提醒", desc: "问题单跟催 / FE Deadline 提醒（当前为 stub 渠道）" }`.

- [ ] **Step 4: Run** `cd apps/frontend && npx vitest run` (13) and `npx vite build` (green).

- [ ] **Step 5: e2e** — create `apps/frontend/e2e/reminders.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("FE-RM1 reminders queue: render + send (stub)", async ({ page }) => {
  let calledSend = false;
  await page.route("**/api/reminders**", async (route) => {
    const url = route.request().url();
    if (url.includes("/send")) { calledSend = true;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ id: "r1", kind: "问题单跟催", ticketId: "t1",
          recipientName: "甲", subject: "[跟催]", body: "停滞 5 天",
          status: "已发送", decidedBy: "运营", decidedAt: "t", createdAt: "t" }) });
    }
    if (route.request().method() === "POST" && url.endsWith("/scan")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ created: 0 }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(calledSend ? [] : [{
        id: "r1", kind: "问题单跟催", ticketId: "t1",
        recipientName: "甲", subject: "[跟催]", body: "停滞 5 天",
        status: "待发送", createdAt: "2026-05-20T00:00:00Z",
      }]) });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "跟催提醒", exact: true }).first().click();
  await expect(page).toHaveURL(/\/reminders$/);
  await expect(page.getByText("问题单跟催")).toBeVisible();
  await page.getByLabel("send-r1").click();
  // after refresh, row gone → empty-state visible
  await expect(page.getByRole("status")).toHaveText("暂无待发送提醒");
});

test("FE-RM2 empty queue shows status", async ({ page }) => {
  await page.route("**/api/reminders**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([]),
  }));
  await page.goto("/reminders");
  await expect(page.getByRole("status")).toHaveText("暂无待发送提醒");
});
```

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/App.tsx apps/frontend/src/pages/AppShell.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/RemindersPage.tsx apps/frontend/e2e/reminders.spec.ts
git commit -m "feat(ui): /reminders queue (Phase 3.4 stub channel) (10-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3; verify integrated: backend 93, tsc clean, FE unit 13, shared 17, build green.
- [ ] Spec + code-quality review (or controller self-review under rate limit).
- [ ] Ports clear; `test:all` green twice.
- [ ] Map §28.6 (7 items) → evidence; flip checkboxes; acceptance commit.
- [ ] `git tag -a increment-10-reminders -m "increment-10 …"`; deploy; verify live.

---

## Self-Review

1. **§28.6 coverage:** ① contracts → T1. ② scan rules + idempotent + skip → T2 e2e #1/#2/#3/#6. ③ list+filter → #1 (list via ?status=待发送). ④ send stub → #4. ⑤ ignore → #5. ⑥ page + scan + send/ignore + empty + integrated → T3 FE-RM1/RM2 + Step 3. ⑦ coverage + test:all twice + deploy → Task 4.
2. **Determinism:** backend e2e uses `daysAgo`/`daysAhead` relative to `Date.now()`; rules.ts takes `nowMs` parameter (used as `Date.now()` default — production passes default, tests don't override here but the relative-day approach gives deterministic windows). FE e2e route-mocks with a `calledSend` flag toggling list response post-send.
3. **Read-only invariant on scan:** rules.ts does not write (only `queryEdges/queryNodes/getNode/listProgress`); the only write path is `createReminder` (in the router) which IS an authoritative write (the outbox is the structured persisted record), audited.
4. **§13 honesty:** StubChannelAdapter explicitly does NOT contact external systems — documented in §28.5 + on the page itself. The outbox + audit fully record what was "sent".
