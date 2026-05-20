# 增量9 — 自动日报生成器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Read-only `GET /api/daily-report?date=YYYY-MM-DD` derives the day's report from ProgressLog + attackTicket (sections per touched ticket + summary); `/daily-report` page renders + copy-to-clipboard. External channels deferred (§13#2/#3 待定).

**Architecture:** Pure read-only derivation — same philosophy as 4/5/6. Backend (T2) / frontend (T3) disjoint → parallel after the shared contract gate (T1).

**Tech Stack:** Node+TS+Express+better-sqlite3, React+TS+Vite+AntD+dayjs (transitive), vitest+supertest, Playwright.

---

## File Structure

- `packages/shared/src/types.ts` — DailyReport types (T1)
- `packages/shared/src/types.test.ts` — contract test (T1)
- `apps/backend/src/daily-report.ts` — NEW route (T2)
- `apps/backend/src/app.ts` — wire (T2)
- `apps/backend/test/daily-report.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — getDailyReport (T3)
- `apps/frontend/src/pages/DailyReportPage.tsx` — NEW (T3)
- `apps/frontend/src/App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx` — route/nav/card (T3)
- `apps/frontend/e2e/daily-report.spec.ts` — NEW FE e2e (T3)

---

## Task 1: Shared contract (SERIAL GATE)

- [ ] **Step 1: Failing test** — append to `packages/shared/src/types.test.ts` (add `DailyReport, DailyReportSection, DailyReportEntry` to its `./index.js` import):

```ts
describe("daily-report contracts", () => {
  it("DailyReport shape", () => {
    const r: DailyReport = {
      date: "2026-05-20",
      sections: [{ ticketId: "t1", 标题: "T1", latestStatus: "进行中", entries: [
        { seqNo: 1, statusSnapshot: "进行中", content: "进展X", updatedBy: "甲", at: "2026-05-20T01:02:03Z" } satisfies DailyReportEntry,
      ]} satisfies DailyReportSection],
      summary: { ticketsTouched: 1, entriesTotal: 1, openByStatus: { 进行中: 1 } },
    };
    expect(r.sections[0].entries[0].statusSnapshot).toBe("进行中");
  });
});
```

- [ ] **Step 2:** `npx tsc -p packages/shared/tsconfig.json --noEmit` → FAIL (RED).

- [ ] **Step 3:** append to `packages/shared/src/types.ts` (after `DashboardSummary`):

```ts
export interface DailyReportEntry {
  seqNo: number; statusSnapshot: string; content: string; updatedBy: string; at: string;
}
export interface DailyReportSection {
  ticketId: string; 标题: string; latestStatus: string; entries: DailyReportEntry[];
}
export interface DailyReport {
  date: string;
  sections: DailyReportSection[];
  summary: { ticketsTouched: number; entriesTotal: number; openByStatus: Record<string, number> };
}
```

- [ ] **Step 4:** `npx tsc -p packages/shared/tsconfig.json --noEmit` clean (GREEN); `npm run test:shared` all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): DailyReport contracts (9-T1)"
```

---

## Task 2: Backend — daily-report derivation (PARALLEL, after T1)

- [ ] **Step 1: Failing e2e** — create `apps/backend/test/daily-report.e2e.test.ts`:

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
  const dir = mkdtempSync(join(tmpdir(), "combat-dr-"));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, db: (repo as any).db };
}

// Insert a progress_log row at a specific updatedAt (bypassing appendProgress
// to control the date — appendProgress uses now()).
function insertProgressAt(db: any, ownerId: string, seqNo: number, content: string, status: string, at: string) {
  db.prepare(`INSERT INTO progress_log VALUES (@id,@ownerId,@seqNo,@content,@s,@by,@at)`)
    .run({ id: `pr-${ownerId}-${seqNo}`, ownerId, seqNo, content, s: status, by: "seed", at });
}

describe("daily-report e2e", () => {
  it("groups today's entries by ticket; latestStatus is the last entry of that day; summary correct", async () => {
    const { app, repo, db } = makeApp();
    const A = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" })).body;
    const B = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "B", 状态: "已解决" })).body;
    const C = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "C", 状态: "进行中" })).body;
    const d1 = "2026-05-20", d2 = "2026-05-21";
    insertProgressAt(db, A.id, 1, "A-1", "进行中", `${d1}T01:00:00Z`);
    insertProgressAt(db, A.id, 2, "A-2", "已解决", `${d1}T05:00:00Z`);
    insertProgressAt(db, B.id, 1, "B-1", "已解决", `${d1}T02:00:00Z`);
    insertProgressAt(db, C.id, 1, "C-1", "进行中", `${d2}T03:00:00Z`);

    const r1 = await request(app).get(`/api/query/search?q=x`); // sanity that other endpoints unaffected
    void r1;

    const r = await request(app).get(`/api/daily-report?date=${d1}`);
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(d1);
    expect(r.body.sections).toHaveLength(2);
    const byTitle = Object.fromEntries(r.body.sections.map((s: any) => [s.标题, s]));
    expect(byTitle["A"].latestStatus).toBe("已解决"); // last entry of the day
    expect(byTitle["A"].entries.map((e: any) => e.seqNo)).toEqual([1, 2]); // ordered by seqNo asc
    expect(byTitle["B"].entries).toHaveLength(1);
    expect(byTitle["B"].latestStatus).toBe("已解决");
    expect(r.body.summary.ticketsTouched).toBe(2);
    expect(r.body.summary.entriesTotal).toBe(3);
    expect(r.body.summary.openByStatus["进行中"]).toBeGreaterThanOrEqual(2); // A (created 进行中) + C
    expect(r.body.summary.openByStatus["已解决"]).toBeGreaterThanOrEqual(1);

    const r2 = await request(app).get(`/api/daily-report?date=${d2}`);
    expect(r2.body.sections).toHaveLength(1);
    expect(r2.body.sections[0].标题).toBe("C");
  });

  it("empty day: sections=[]; summary still computes openByStatus over all tickets", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "E", 状态: "进行中" });
    const r = await request(app).get("/api/daily-report?date=2000-01-01");
    expect(r.body.sections).toEqual([]);
    expect(r.body.summary.ticketsTouched).toBe(0);
    expect(r.body.summary.entriesTotal).toBe(0);
    expect(r.body.summary.openByStatus["进行中"]).toBeGreaterThanOrEqual(1);
  });

  it("read-only: audit_log unchanged; idempotent body across calls", async () => {
    const { app, db } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "RO", 状态: "进行中" });
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    const a = await request(app).get("/api/daily-report?date=2026-05-20");
    const b = await request(app).get("/api/daily-report?date=2026-05-20");
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
    expect(a.body).toEqual(b.body);
  });

  it("missing or invalid date → defaults to today (UTC); does NOT 400", async () => {
    const { app } = makeApp();
    const today = new Date().toISOString().slice(0, 10);
    const r1 = await request(app).get("/api/daily-report");
    expect(r1.status).toBe(200);
    expect(r1.body.date).toBe(today);
    const r2 = await request(app).get("/api/daily-report?date=not-a-date");
    expect(r2.status).toBe(200);
    expect(r2.body.date).toBe(today);
  });
});
```

- [ ] **Step 2: Run** → FAIL (route not found).

- [ ] **Step 3: Implement** — create `apps/backend/src/daily-report.ts`:

```ts
import { Router } from "express";
import type { Repository, DailyReport, DailyReportSection } from "@combat/shared";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayUTC = () => new Date().toISOString().slice(0, 10);

export function makeDailyReportRouter(repo: Repository): Router {
  const r = Router();
  r.get("/daily-report", (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const raw = String(first(req.query.date) ?? "");
    const date = ISO_DATE.test(raw) ? raw : todayUTC();
    const tickets = repo.queryNodes("attackTicket");
    const sections: DailyReportSection[] = [];
    for (const t of tickets) {
      const todays = repo.listProgress(t.id)
        .filter(p => p.updatedAt.startsWith(date))
        .sort((a, b) => a.seqNo - b.seqNo);
      if (todays.length === 0) continue;
      const last = todays[todays.length - 1];
      sections.push({
        ticketId: t.id,
        标题: String(t.properties["标题"] ?? t.id),
        latestStatus: String(last.statusSnapshot ?? t.properties["状态"] ?? ""),
        entries: todays.map(p => ({
          seqNo: p.seqNo, statusSnapshot: String(p.statusSnapshot ?? ""),
          content: p.content, updatedBy: p.updatedBy, at: p.updatedAt,
        })),
      });
    }
    const openByStatus: Record<string, number> = {};
    for (const t of tickets) {
      const s = String(t.properties["状态"] ?? "").trim();
      if (s) openByStatus[s] = (openByStatus[s] ?? 0) + 1;
    }
    const out: DailyReport = {
      date, sections,
      summary: {
        ticketsTouched: sections.length,
        entriesTotal: sections.reduce((a, s) => a + s.entries.length, 0),
        openByStatus,
      },
    };
    res.json(out);
  });
  return r;
}
```

- [ ] **Step 4: Wire** — `apps/backend/src/app.ts`: add `import { makeDailyReportRouter } from "./daily-report.js";` and `app.use("/api", makeDailyReportRouter(deps.repo));` after the dashboard router line, before error middleware.

- [ ] **Step 5: Run** `cd apps/backend && npx vitest run` → expect ALL green (83 + 4 = 87). Then `npx tsc -p tsconfig.json --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/daily-report.ts apps/backend/src/app.ts apps/backend/test/daily-report.e2e.test.ts
git commit -m "feat(backend): read-only /api/daily-report (9-T2)"
```

---

## Task 3: Frontend — DailyReportPage (PARALLEL, after T1)

- [ ] **Step 1: api.ts** — add `DailyReport` to `@combat/shared` type import; add:

```ts
  getDailyReport(date?: string): Promise<DailyReport> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    return this.req<DailyReport>(`/api/daily-report${qs}`, {});
  }
```

- [ ] **Step 2: DailyReportPage** — create `apps/frontend/src/pages/DailyReportPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { DatePicker, Statistic, Row, Col, Descriptions, Card, List, Button, message, Typography } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api.js";
import type { DailyReport } from "@combat/shared";

function reportToText(r: DailyReport): string {
  const lines: string[] = [];
  lines.push(`攻关日报 - ${r.date}`);
  lines.push(`被触达攻关单 ${r.summary.ticketsTouched} · 进展条目 ${r.summary.entriesTotal}`);
  const status = Object.entries(r.summary.openByStatus).map(([s, n]) => `${s}:${n}`).join(" / ");
  if (status) lines.push(`状态分布: ${status}`);
  lines.push("");
  for (const s of r.sections) {
    lines.push(`【${s.标题}】（${s.latestStatus}）`);
    for (const e of s.entries) {
      lines.push(`  #${e.seqNo} [${e.statusSnapshot}] ${e.content} — ${e.updatedBy} @ ${e.at}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function DailyReportPage() {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [r, setR] = useState<DailyReport | null>(null);
  useEffect(() => {
    api.getDailyReport(date.format("YYYY-MM-DD")).then(setR)
      .catch(() => message.error("日报加载失败"));
  }, [date]);

  const copy = async () => {
    if (!r) return;
    try { await navigator.clipboard.writeText(reportToText(r)); message.success("已复制"); }
    catch { message.error("复制失败"); }
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>攻关日报</Typography.Title>
      <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
        <Col>日期：</Col>
        <Col><DatePicker aria-label="report-date" value={date} onChange={(d) => d && setDate(d)} /></Col>
        <Col><Button aria-label="copy-report" type="primary" onClick={copy} disabled={!r}>复制到剪贴板</Button></Col>
      </Row>
      {r && (
        <>
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col><Statistic title="被触达攻关单" value={r.summary.ticketsTouched} /></Col>
            <Col><Statistic title="进展条目数" value={r.summary.entriesTotal} /></Col>
          </Row>
          <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="状态分布">
              {Object.entries(r.summary.openByStatus).map(([s, n]) => `${s}: ${n}`).join("　") || "无"}
            </Descriptions.Item>
          </Descriptions>
          {r.sections.length === 0 && <p role="status">该日无进展记录</p>}
          {r.sections.map(s => (
            <Card key={s.ticketId} size="small" style={{ marginBottom: 12 }}
              title={`【${s.标题}】（${s.latestStatus}）`}>
              <List size="small" dataSource={s.entries} rowKey={(e) => `${s.ticketId}-${e.seqNo}`}
                renderItem={(e) => (
                  <List.Item>
                    #{e.seqNo} [{e.statusSnapshot}] {e.content}
                    <span style={{ marginLeft: 8, color: "#888" }}>— {e.updatedBy} @ {e.at}</span>
                  </List.Item>
                )} />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: route + nav + card** —
  - `App.tsx`: `import { DailyReportPage } from "./pages/DailyReportPage.js";` + `<Route path="/daily-report" element={<DailyReportPage />} />` (after `/weights`).
  - `AppShell.tsx`: `{ key: "/daily-report", label: <Link to="/daily-report">攻关日报</Link> }` (after weights).
  - `HomePage.tsx`: `{ to: "/daily-report", title: "攻关日报", desc: "自动汇总当日各攻关单进展，复制到剪贴板（待外发渠道接入）" }`.

- [ ] **Step 4: Run** `cd apps/frontend && npx vitest run` (13 green) and `npx vite build` (green).

- [ ] **Step 5: e2e** — create `apps/frontend/e2e/daily-report.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("FE-DR1 daily-report: nav, mocked render, copy-to-clipboard", async ({ page }) => {
  // Mock the API to keep this test deterministic regardless of seeded data
  await page.route("**/api/daily-report**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      date: "2026-05-20",
      sections: [{ ticketId: "t1", 标题: "日报演示单DR", latestStatus: "进行中",
        entries: [{ seqNo: 1, statusSnapshot: "进行中", content: "进展甲DR", updatedBy: "用户DR", at: "2026-05-20T01:00:00Z" }],
      }],
      summary: { ticketsTouched: 1, entriesTotal: 1, openByStatus: { 进行中: 5 } },
    }),
  }));
  await page.addInitScript(() => {
    (navigator as any).clipboard = { writeText: async () => {} };
  });
  await page.goto("/");
  await page.getByRole("link", { name: "攻关日报", exact: true }).first().click();
  await expect(page).toHaveURL(/\/daily-report$/);
  await expect(page.getByText("日报演示单DR")).toBeVisible();
  await expect(page.getByText("进展甲DR", { exact: false })).toBeVisible();
  await page.getByLabel("copy-report").click();
  // success toast text — substring match because antd message is brief
  await expect(page.getByText("已复制")).toBeVisible();
});

test("FE-DR2 daily-report: empty day shows role=status", async ({ page }) => {
  await page.route("**/api/daily-report**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      date: "2000-01-01", sections: [],
      summary: { ticketsTouched: 0, entriesTotal: 0, openByStatus: {} },
    }),
  }));
  await page.goto("/daily-report");
  await expect(page.getByRole("status")).toHaveText("该日无进展记录");
});
```

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/App.tsx apps/frontend/src/pages/AppShell.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/DailyReportPage.tsx apps/frontend/e2e/daily-report.spec.ts
git commit -m "feat(ui): /daily-report page (Phase 3.2 generator + copy-to-clipboard) (9-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3; integrated verify: backend 87, tsc clean, FE unit 13, vite build green.
- [ ] Concurrent spec + code-quality reviews (or controller self-review on rate limit).
- [ ] Pre-clear stale :3001/:5173 (PowerShell); `test:all` green twice.
- [ ] Map §27.6 (7 items) → evidence; flip checkboxes; acceptance commit.
- [ ] `git tag -a increment-9-daily-report -m "increment-9 …"`; deploy; verify live.

---

## Self-Review

1. **§27.6 coverage:** ① shared contracts → T1. ② section grouping/latestStatus/sort/summary → T2 e2e #1. ③ empty day → #2. ④ read-only audit unchanged + idempotent → #3. ⑤ missing/invalid date defaults today → #4. ⑥ DatePicker + render + role=status + nav/home → FE-DR1/DR2 + Step 3. ⑦ copy-to-clipboard message → FE-DR1.
2. **Determinism / shared-backend safety:** backend e2e uses tmpdir + direct SQL inserts to control updatedAt (controlled by ISO date prefix, avoiding "today" non-determinism); FE e2e uses page.route mocking to isolate from any seeded data and `addInitScript` to stub clipboard. No schema mutation. ISO_DATE regex prevents path-injection via date param.
3. **Read-only invariant:** daily-report.ts calls only `queryNodes`/`listProgress`; no create/update/delete/logAudit. e2e #3 asserts audit_log unchanged.
