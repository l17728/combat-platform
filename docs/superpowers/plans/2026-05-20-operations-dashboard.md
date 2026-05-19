# 增量6 — 数据大盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A read-only `GET /api/dashboard` aggregate snapshot (attackTickets total/byStatus/open/resolved, contributions total + top contributors by count, pending proposals) surfaced as an integrated stats panel on the HomePage above the module cards; homepage must not break if the dashboard call fails.

**Architecture:** Pure read-only aggregation over existing nodes (reader primitives only — no writes/audit), same philosophy as increments 4/5. Backend (T2) / frontend (T3) disjoint → parallel after the shared contract gate (T1).

**Tech Stack:** Node+TS+Express+better-sqlite3, React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §24 is the basis.

---

## File Structure

- `packages/shared/src/types.ts` — `DashboardSummary` (T1)
- `packages/shared/src/types.test.ts` — contract test (T1)
- `apps/backend/src/dashboard.ts` — NEW `makeDashboardRouter` (T2)
- `apps/backend/src/app.ts` — wire dashboard router (T2)
- `apps/backend/test/dashboard.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — `getDashboard` (T3)
- `apps/frontend/src/pages/HomePage.tsx` — dashboard panel (T3)
- `apps/frontend/e2e/dashboard.spec.ts` — NEW FE e2e (T3)

---

## Task 1: Shared contract (SERIAL GATE)

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/types.test.ts`

- [ ] **Step 1: Failing test** — append to `packages/shared/src/types.test.ts` (add `DashboardSummary` to its `@combat/shared` / `./index.js` import, matching the file's existing import convention):

```ts
describe("dashboard contract", () => {
  it("DashboardSummary shape", () => {
    const d: DashboardSummary = {
      tickets: { total: 3, byStatus: { 进行中: 2, 已解决: 1 }, open: 2, resolved: 1 },
      contributions: { total: 4, topContributors: [{ 贡献人: "张三", count: 3 }] },
      proposalsPending: 1,
    };
    expect(d.tickets.open).toBe(2);
    expect(d.contributions.topContributors[0].贡献人).toBe("张三");
  });
});
```

- [ ] **Step 2:** `npx tsc -p packages/shared/tsconfig.json --noEmit` → FAIL (RED).

- [ ] **Step 3:** append to `packages/shared/src/types.ts` (after `HelperRecommendation`):

```ts
export interface DashboardSummary {
  tickets: { total: number; byStatus: Record<string, number>; open: number; resolved: number };
  contributions: { total: number; topContributors: { 贡献人: string; count: number }[] };
  proposalsPending: number;
}
```

- [ ] **Step 4:** `npx tsc -p packages/shared/tsconfig.json --noEmit` clean (GREEN); `npm run test:shared` all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): DashboardSummary contract (6-T1)"
```

---

## Task 2: Backend — read-only aggregate (PARALLEL, after T1)

**Files:** Create `apps/backend/src/dashboard.ts`, `apps/backend/test/dashboard.e2e.test.ts`; Modify `apps/backend/src/app.ts`

- [ ] **Step 1: Failing e2e** — create `apps/backend/test/dashboard.e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-dash-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "string", label: "状态" },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" },
      { name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [{ name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true },
      { name: "贡献等级", type: "string", label: "贡献等级" },
      { name: "关联问题单", type: "string", label: "关联问题单", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, db: (repo as any).db };
}

describe("dashboard e2e", () => {
  it("aggregates tickets/contributions/proposals correctly + deterministic top contributors", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "B", 状态: "进行中", 问题单号: "PB-1" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "C", 状态: "已解决" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "D", 状态: "已关闭" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "E", 状态: "待响应" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献等级: "核心", 关联问题单: "PB-1" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献等级: "关键" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "李四", 贡献等级: "普通" });
    await request(app).post("/api/proposals/scan").send({}); // PB-1 shared by ticket B + contrib → SAME_AS? no (different kinds); ensure pending exists via near-dup persons:
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "F", 状态: "进行中", 当前处理人: "张伟" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "G", 状态: "进行中", 当前处理人: "张玮" });
    await request(app).post("/api/proposals/scan").send({});

    const r = await request(app).get("/api/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.tickets.total).toBe(7);
    expect(r.body.tickets.byStatus["进行中"]).toBe(4);
    expect(r.body.tickets.byStatus["已解决"]).toBe(1);
    expect(r.body.tickets.byStatus["已关闭"]).toBe(1);
    expect(r.body.tickets.byStatus["待响应"]).toBe(1);
    expect(r.body.tickets.open).toBe(5);     // 进行中×4 + 待响应×1
    expect(r.body.tickets.resolved).toBe(2); // 已解决 + 已关闭
    expect(r.body.contributions.total).toBe(3);
    expect(r.body.contributions.topContributors[0]).toEqual({ 贡献人: "张三", count: 2 });
    expect(r.body.contributions.topContributors[1]).toEqual({ 贡献人: "李四", count: 1 });
    expect(r.body.proposalsPending).toBeGreaterThanOrEqual(1); // 张伟≈张玮 SAME_AS pending
  });

  it("read-only: audit_log row count unchanged across calls; deterministic", async () => {
    const { app, db } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "X", 状态: "进行中" });
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    const a = await request(app).get("/api/dashboard");
    const b = await request(app).get("/api/dashboard");
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
    expect(a.body).toEqual(b.body);
  });

  it("empty system → zeroed summary", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/dashboard");
    expect(r.body).toEqual({
      tickets: { total: 0, byStatus: {}, open: 0, resolved: 0 },
      contributions: { total: 0, topContributors: [] },
      proposalsPending: 0,
    });
  });
});
```

- [ ] **Step 2: Run** `cd apps/backend && npx vitest run dashboard.e2e` → FAIL.

- [ ] **Step 3: Implement** — create `apps/backend/src/dashboard.ts`:

```ts
import { Router } from "express";
import type { Repository, DashboardSummary } from "@combat/shared";

const OPEN = new Set(["待响应", "处理中", "进行中"]);
const RESOLVED = new Set(["已解决", "已关闭"]);

export function makeDashboardRouter(repo: Repository): Router {
  const r = Router();
  r.get("/dashboard", (_req, res) => {
    const tks = repo.queryNodes("attackTicket");
    const byStatus: Record<string, number> = {};
    let open = 0, resolved = 0;
    for (const t of tks) {
      const s = String(t.properties["状态"] ?? "");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (OPEN.has(s)) open++;
      else if (RESOLVED.has(s)) resolved++;
    }
    const cs = repo.queryNodes("contribution");
    const cc = new Map<string, number>();
    for (const c of cs) {
      const p = String(c.properties["贡献人"] ?? "").trim();
      if (p) cc.set(p, (cc.get(p) ?? 0) + 1);
    }
    const topContributors = [...cc.entries()]
      .map(([贡献人, count]) => ({ 贡献人, count }))
      .sort((a, b) => b.count - a.count || (a.贡献人 < b.贡献人 ? -1 : a.贡献人 > b.贡献人 ? 1 : 0))
      .slice(0, 5);
    const summary: DashboardSummary = {
      tickets: { total: tks.length, byStatus, open, resolved },
      contributions: { total: cs.length, topContributors },
      proposalsPending: repo.listProposals({ status: "待审批" }).length,
    };
    res.json(summary);
  });
  return r;
}
```

- [ ] **Step 4: Wire** — `apps/backend/src/app.ts`: add `import { makeDashboardRouter } from "./dashboard.js";` and `app.use("/api", makeDashboardRouter(deps.repo));` after the recommend router line, before the error middleware.

- [ ] **Step 5: Run** `cd apps/backend && npx vitest run` → ALL green (prior 69 + dashboard.e2e 3 = 72). Then `npx tsc -p tsconfig.json --noEmit` clean. Fix logic only (never weaken tests). If a provided test is genuinely impossible, STOP and report BLOCKED with precise reasoning.

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/dashboard.ts apps/backend/src/app.ts apps/backend/test/dashboard.e2e.test.ts
git commit -m "feat(backend): read-only /api/dashboard aggregate (6-T2)"
```

---

## Task 3: Frontend — HomePage dashboard panel (PARALLEL, after T1)

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/pages/HomePage.tsx`; Create `apps/frontend/e2e/dashboard.spec.ts`

- [ ] **Step 1: api.ts** — add `DashboardSummary` to the `@combat/shared` type import; add to class `Api`:

```ts
  getDashboard(): Promise<DashboardSummary> {
    return this.req<DashboardSummary>(`/api/dashboard`, {});
  }
```

- [ ] **Step 2: HomePage** — replace `apps/frontend/src/pages/HomePage.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Card, Row, Col, Statistic, Descriptions, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { DashboardSummary } from "@combat/shared";

const MODULES = [
  { to: "/attack", title: "攻关作战台", desc: "攻关单跟踪、进展、可编辑表格" },
  { to: "/honor", title: "荣誉殿堂", desc: "贡献加权排行榜与个人档案" },
  { to: "/contributions", title: "贡献录入", desc: "记录贡献并关联攻关单" },
  { to: "/import", title: "导入", desc: "从 Excel 导入数据" },
  { to: "/proposals", title: "关系审批", desc: "候选关系扫描与人工审批" },
  { to: "/search", title: "信息检索", desc: "跨攻关/贡献/关联的只读检索（Hermes 契约）" },
];

export function HomePage() {
  const [dash, setDash] = useState<DashboardSummary | null>(null);
  useEffect(() => {
    api.getDashboard().then(setDash).catch(() => message.error("大盘加载失败"));
  }, []);
  return (
    <div style={{ padding: 24 }}>
      <h1>作战平台</h1>
      {dash && (
        <div aria-label="dashboard" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col><Statistic title="攻关单总数" value={dash.tickets.total} /></Col>
            <Col><Statistic title="进行中" value={dash.tickets.open} /></Col>
            <Col><Statistic title="已闭环" value={dash.tickets.resolved} /></Col>
            <Col><Statistic title="贡献总数" value={dash.contributions.total} /></Col>
            <Col><Statistic title="待审批提议" value={dash.proposalsPending} /></Col>
          </Row>
          <Descriptions size="small" column={1} style={{ marginTop: 12 }}>
            <Descriptions.Item label="状态分布">
              {Object.entries(dash.tickets.byStatus).map(([s, n]) => `${s || "(空)"}: ${n}`).join("　") || "无"}
            </Descriptions.Item>
            <Descriptions.Item label="Top 贡献人">
              {dash.contributions.topContributors.map(c => `${c.贡献人}×${c.count}`).join("　") || "无"}
            </Descriptions.Item>
          </Descriptions>
        </div>
      )}
      <Row gutter={[16, 16]}>
        {MODULES.map(m => (
          <Col span={8} key={m.to}>
            <Link to={m.to}>
              <Card hoverable title={m.title} aria-label={`home-card-${m.to}`}>{m.desc}</Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
```

(The dashboard panel renders only when `dash` is loaded — on failure `message.error` fires and the module cards still render, so the homepage never breaks. Module cards and their `home-card-*` aria-labels are unchanged.)

- [ ] **Step 3: Run** `cd apps/frontend && npx vitest run` (13 green; if a HomePage unit test exists it should still pass — module cards unchanged, panel is additive & null-gated) and `npx vite build` (green).

- [ ] **Step 4: e2e** — create `apps/frontend/e2e/dashboard.spec.ts` (NOT run here):

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-D1 homepage dashboard reflects data; module cards still present/usable", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "大盘单D1", 状态: "进行中" } });
  await page.goto("/");
  const dash = page.getByLabel("dashboard");
  await expect(dash.getByText("攻关单总数")).toBeVisible();
  await expect(dash.getByText("进行中", { exact: false })).toBeVisible();
  await expect(dash.getByText("状态分布", { exact: false })).toBeVisible();
  // module cards still all present + navigable
  await expect(page.getByLabel("home-card-/attack")).toBeVisible();
  await expect(page.getByLabel("home-card-/search")).toBeVisible();
  await page.getByRole("link", { name: "攻关作战台", exact: true }).first().click();
  await expect(page).toHaveURL(/\/attack$/);
});
```

- [ ] **Step 5: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/pages/HomePage.tsx apps/frontend/e2e/dashboard.spec.ts
git commit -m "feat(ui): HomePage operations dashboard panel (6-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (`--no-ff`); integrated verify: backend `npx vitest run` (expect 72), backend tsc clean, frontend `npx vitest run` (13), `npm run test:shared` (15), frontend `npx vite build` green. Clean worktrees; `git checkout -- config/schemas/`.
- [ ] Spec-compliance review (T2, T3) vs PRD §24 concurrently; then code-quality review; implementer-fix loop until both ✅. (Attention: read-only invariant; deterministic topContributors order; homepage-must-not-break-on-dashboard-failure; existing home-card-* unchanged so coverage/honor nav specs stay green.)
- [ ] Coverage-audit (§18): every §24 user-visible feature × spec; ensure dashboard panel + module-cards-still-usable + (degradation path is hard to e2e deterministically — backend has the read-only/empty tests; the FE failure path is defensive, acceptable to leave to unit/visual).
- [ ] Pre-clear stale :3001/:5173 (PowerShell `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen | Stop-Process -Force`), `git checkout -- config/schemas/`, then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §24.6 (7 items) → evidence; flip `- [ ]`→`- [x]`; acceptance commit.
- [ ] `git tag -a increment-6-dashboard -m "increment-6 …"`.
- [ ] Deploy `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ 200 + deploy.log backend=200 frontend=200.
- [ ] Final code-review whole branch; finishing-a-development-branch.

---

## Self-Review

1. **§24.6 coverage:** ① shared DashboardSummary → T1. ② tickets total/byStatus/open/resolved → T2 e2e #1. ③ contributions total + topContributors order → T2 e2e #1. ④ proposalsPending → T2 e2e #1. ⑤ read-only audit unchanged + deterministic → T2 e2e #2; empty system → T2 e2e #3. ⑥ HomePage panel reflects data + cards still usable + home-card-* unchanged → T3 FE-D1. ⑦ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none; full aggregation logic + open/resolved sets + ordering concrete.
3. **Type consistency:** `DashboardSummary` (T1) used by dashboard.ts (T2) + api.ts/HomePage (T3); `topContributors` key `贡献人` (Chinese) consistent across backend emit, shared type, frontend render. open/resolved enum literals verbatim from §2.3.
4. **Read-only:** dashboard.ts calls only `queryNodes`/`listProposals`; no create/update/delete/createEdge/logAudit. e2e #2 asserts audit_log unchanged + response idempotent. §0.3/§6.1 held.
5. **Determinism / shared-backend safety:** dashboard.spec uses a unique 标题 and only asserts presence of labels/structure (not absolute counts, which vary in the shared multi-spec DB) → robust under the shared single-backend Playwright run; no schema mutation. Backend topContributors order `count desc, 贡献人 asc` fully deterministic. HomePage panel null-gated so a dashboard failure cannot break the homepage / its module-card nav (existing coverage/honor specs depend on cards).
