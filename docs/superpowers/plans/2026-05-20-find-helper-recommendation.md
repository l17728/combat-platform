# 增量5 — 找人推荐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A deterministic, read-only KG-evidence recommender: `GET /api/recommend/helpers/:attackTicketId` ranks persons who can help (shared-问题单 track record + contribution-level competence + capped general fallback, excluding the ticket's own current handler), each with cited Chinese reasons; surfaced in a new AttackDetail 「找帮手」section.

**Architecture:** Reuses existing KG (3a REF 当前处理人/贡献人, 3d ANCHORED_TO shared anchors, honor 贡献等级). Recommendation is a read-only derivation (no writes/audit) — same philosophy as increment-4. Backend (T2) / frontend (T3) disjoint → parallel after the shared contract gate (T1).

**Tech Stack:** Node+TS+Express+better-sqlite3, React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §23 is the basis.

---

## File Structure

- `packages/shared/src/types.ts` — `HelperRecommendation` (T1)
- `packages/shared/src/types.test.ts` — contract test (T1)
- `apps/backend/src/recommend.ts` — NEW `recommendHelpers` + router (T2)
- `apps/backend/src/app.ts` — wire recommend router (T2)
- `apps/backend/test/recommend.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — `recommendHelpers` (T3)
- `apps/frontend/src/pages/AttackDetail.tsx` — 「找帮手」section (T3)
- `apps/frontend/e2e/recommend.spec.ts` — NEW FE e2e (T3)

---

## Task 1: Shared contract (SERIAL GATE)

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/types.test.ts`

- [ ] **Step 1: Failing test** — append to `packages/shared/src/types.test.ts` (add `HelperRecommendation` to its `@combat/shared` import):

```ts
describe("helper-recommendation contract", () => {
  it("HelperRecommendation shape", () => {
    const r: HelperRecommendation = {
      person: { id: "p1", nodeType: "person", properties: { name: "张三" }, createdAt: "t", updatedAt: "t" },
      score: 6, reasons: ["曾处理共享问题单「PB-1」的攻关单「断网」"],
    };
    expect(r.score).toBe(6);
    expect(r.reasons[0]).toContain("PB-1");
  });
});
```

- [ ] **Step 2:** `npx tsc -p packages/shared/tsconfig.json --noEmit` → FAIL (RED).

- [ ] **Step 3:** append to `packages/shared/src/types.ts` (after `QueryContext`, so `GraphNode` is in scope):

```ts
export interface HelperRecommendation { person: GraphNode; score: number; reasons: string[]; }
```

- [ ] **Step 4:** `npx tsc -p packages/shared/tsconfig.json --noEmit` clean (GREEN); `npm run test:shared` all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): HelperRecommendation contract (5-T1)"
```

---

## Task 2: Backend — deterministic read-only recommender (PARALLEL, after T1)

**Files:** Create `apps/backend/src/recommend.ts`, `apps/backend/test/recommend.e2e.test.ts`; Modify `apps/backend/src/app.ts`

- [ ] **Step 1: Failing e2e** — create `apps/backend/test/recommend.e2e.test.ts`:

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
  const dir = mkdtempSync(join(tmpdir(), "combat-rec-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" },
      { name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [{ name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true },
      { name: "贡献类型", type: "string", label: "贡献类型" },
      { name: "贡献等级", type: "string", label: "贡献等级" },
      { name: "贡献描述", type: "string", label: "贡献描述" },
      { name: "关联问题单", type: "string", label: "关联问题单", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, db: (repo as any).db };
}

describe("find-helper recommendation e2e", () => {
  it("ranks shared-anchor handler + core contributor, excludes self, fallback last; reasons cite 问题单", async () => {
    const { app } = makeApp();
    const T = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "主攻关单", 问题单号: "PB-1", 当前处理人: "甲" })).body;
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "同域攻关单", 问题单号: "PB-1", 当前处理人: "乙" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "丙", 关联问题单: "PB-1", 贡献等级: "核心", 贡献描述: "定位根因" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "丁", 贡献等级: "关键", 贡献描述: "无关贡献" });

    const r = await request(app).get(`/api/recommend/helpers/${T.id}`);
    expect(r.status).toBe(200);
    const names = r.body.map((h: any) => String(h.person.properties["name"]));
    expect(names).not.toContain("甲");          // self excluded
    expect(names).toContain("乙");               // shared-anchor handler (+3)
    expect(names).toContain("丙");               // shared-anchor core contrib (+3)
    expect(names).toContain("丁");               // general fallback (+1), ranked last
    expect(names.indexOf("丁")).toBeGreaterThan(names.indexOf("乙"));
    expect(names.indexOf("丁")).toBeGreaterThan(names.indexOf("丙"));
    const reasonsAll = r.body.flatMap((h: any) => h.reasons).join(" ");
    expect(reasonsAll).toContain("PB-1");
    // deterministic: same input → same output
    const r2 = await request(app).get(`/api/recommend/helpers/${T.id}`);
    expect(r2.body.map((h: any) => h.person.id)).toEqual(r.body.map((h: any) => h.person.id));
  });

  it("404 unknown id; 400 non-attackTicket; read-only (audit_log unchanged)", async () => {
    const { app, db } = makeApp();
    const c = (await request(app).post("/api/nodes/contribution").send({ 贡献人: "戊" })).body;
    expect((await request(app).get("/api/recommend/helpers/nope")).status).toBe(404);
    expect((await request(app).get(`/api/recommend/helpers/${c.id}`)).status).toBe(400);
    const T = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "只读单", 问题单号: "PB-9" })).body;
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    await request(app).get(`/api/recommend/helpers/${T.id}`);
    await request(app).get(`/api/recommend/helpers/${T.id}`);
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
  });

  it("limit caps result count", async () => {
    const { app } = makeApp();
    const T = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "限量单", 问题单号: "PB-L" })).body;
    for (const p of ["A","B","C","D"])
      await request(app).post("/api/nodes/attackTicket").send({ 标题: "同域"+p, 问题单号: "PB-L", 当前处理人: p });
    const r = await request(app).get(`/api/recommend/helpers/${T.id}?limit=2`);
    expect(r.body).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `cd apps/backend && npx vitest run recommend.e2e` → FAIL.

- [ ] **Step 3: Implement `recommend.ts`** — create `apps/backend/src/recommend.ts`:

```ts
import { Router } from "express";
import type { Repository, GraphNode, HelperRecommendation } from "@combat/shared";

const LEVEL: Record<string, number> = { 核心: 3, 关键: 2, 普通: 1 };

// person ids referenced by `field` REF edges out of node `srcId`
function refPersons(repo: Repository, srcId: string, field: string): string[] {
  return repo.queryEdges({ sourceId: srcId, edgeType: "REF" })
    .filter(e => String(e.properties["field"] ?? "") === field)
    .map(e => e.targetId);
}

export function recommendHelpers(repo: Repository, ticketId: string, limit = 10): HelperRecommendation[] {
  const T = repo.getNode(ticketId);
  if (!T) return [];
  const self = new Set(refPersons(repo, T.id, "当前处理人"));
  const acc = new Map<string, { score: number; reasons: string[]; fb: number }>();
  const add = (pid: string, s: number, reason: string) => {
    if (self.has(pid)) return;
    const e = acc.get(pid) ?? { score: 0, reasons: [], fb: 0 };
    e.score += s; e.reasons.push(reason); acc.set(pid, e);
  };

  // shared-问题单 evidence (via ANCHORED_TO)
  for (const ae of repo.queryEdges({ sourceId: T.id, edgeType: "ANCHORED_TO" })) {
    const anchor = repo.getNode(ae.targetId);
    if (!anchor) continue;
    const key = String(anchor.properties["key"] ?? "");
    for (const back of repo.queryEdges({ targetId: anchor.id, edgeType: "ANCHORED_TO" })) {
      if (back.sourceId === T.id) continue;
      const s = repo.getNode(back.sourceId);
      if (!s) continue;
      if (s.nodeType === "attackTicket")
        for (const pid of refPersons(repo, s.id, "当前处理人"))
          add(pid, 3, `曾处理共享问题单「${key}」的攻关单「${String(s.properties["标题"] ?? s.id)}」`);
      else if (s.nodeType === "contribution") {
        const lvl = String(s.properties["贡献等级"] ?? "普通");
        const desc = String(s.properties["贡献描述"] ?? s.properties["贡献类型"] ?? "");
        for (const pid of refPersons(repo, s.id, "贡献人"))
          add(pid, LEVEL[lvl] ?? 1, `在共享问题单「${key}」相关贡献「${desc}」（${lvl}）`);
      }
    }
  }

  // capped general competence fallback
  const fbCount = new Map<string, number>();
  for (const c of repo.queryNodes("contribution")) {
    const lvl = String(c.properties["贡献等级"] ?? "");
    if (lvl !== "核心" && lvl !== "关键") continue;
    for (const pid of refPersons(repo, c.id, "贡献人")) {
      if (self.has(pid)) continue;
      fbCount.set(pid, (fbCount.get(pid) ?? 0) + 1);
    }
  }
  for (const [pid, n] of fbCount) {
    const capped = Math.min(n, 3);
    const e = acc.get(pid) ?? { score: 0, reasons: [], fb: 0 };
    e.score += capped; e.fb = n; e.reasons.push(`历史核心/关键贡献 ${n} 次`); acc.set(pid, e);
  }

  const name = (n: GraphNode) => String(n.properties["name"] ?? n.id);
  const out = [...acc.entries()]
    .map(([pid, e]) => ({ person: repo.getNode(pid), score: e.score, reasons: e.reasons }))
    .filter((x): x is HelperRecommendation => !!x.person);
  out.sort((a, b) => b.score - a.score
    || (name(a.person) < name(b.person) ? -1 : name(a.person) > name(b.person) ? 1
    : (a.person.id < b.person.id ? -1 : 1)));
  return out.slice(0, Math.max(1, Math.min(50, limit)));
}

export function makeRecommendRouter(repo: Repository): Router {
  const r = Router();
  r.get("/recommend/helpers/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    if (node.nodeType !== "attackTicket") return res.status(400).json({ error: "仅支持 attackTicket" });
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const limit = Number(first(req.query.limit)) || 10;
    res.json(recommendHelpers(repo, node.id, limit));
  });
  return r;
}
```

- [ ] **Step 4: Wire** — `apps/backend/src/app.ts`: add `import { makeRecommendRouter } from "./recommend.js";` and `app.use("/api", makeRecommendRouter(deps.repo));` after the query router line, before the error middleware.

- [ ] **Step 5: Run** `cd apps/backend && npx vitest run` → ALL green (prior 66 + recommend.e2e 3 = 69). Then `npx tsc -p tsconfig.json --noEmit` clean. Fix logic only (never weaken tests). If a provided test is genuinely impossible, STOP and report BLOCKED with precise reasoning.

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/recommend.ts apps/backend/src/app.ts apps/backend/test/recommend.e2e.test.ts
git commit -m "feat(backend): deterministic read-only find-helper recommender (5-T2)"
```

---

## Task 3: Frontend — AttackDetail 找帮手 section (PARALLEL, after T1)

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/pages/AttackDetail.tsx`; Create `apps/frontend/e2e/recommend.spec.ts`

- [ ] **Step 1: api.ts** — add `HelperRecommendation` to the `@combat/shared` import; add to class `Api`:

```ts
  recommendHelpers(id: string, limit?: number): Promise<HelperRecommendation[]> {
    const qs = limit ? `?limit=${limit}` : "";
    return this.req<HelperRecommendation[]>(`/api/recommend/helpers/${id}${qs}`, {});
  }
```

- [ ] **Step 2: AttackDetail** — in `apps/frontend/src/pages/AttackDetail.tsx`:
  - imports: add `List` to the antd import; add `HelperRecommendation` to the `@combat/shared` type import.
  - add state: `const [helpers, setHelpers] = useState<HelperRecommendation[] | null>(null);`
  - in `refresh`, after the existing two calls, add: `api.recommendHelpers(id).then(setHelpers).catch(() => setHelpers([]));`
  - render a new section between the `关联全景` `<p>` and the `<Descriptions>`:

```tsx
      <div aria-label="find-helpers" style={{ margin: "12px 0" }}>
        <h3 style={{ marginBottom: 8 }}>找帮手</h3>
        {helpers !== null && helpers.length === 0 && <p role="status">暂无可推荐人选</p>}
        {helpers && helpers.length > 0 && (
          <List size="small" dataSource={helpers} rowKey={(h) => h.person.id}
            renderItem={(h) => (
              <List.Item>
                <Link to={`/related/person/${h.person.id}`}>
                  {String(h.person.properties["name"] ?? h.person.id)}
                </Link>
                <span style={{ marginLeft: 8, color: "#888" }}>
                  [{h.score}] {h.reasons.join("；")}
                </span>
              </List.Item>
            )} />
        )}
      </div>
```

- [ ] **Step 3: Run** `cd apps/frontend && npx vitest run` (13 green) and `npx vite build` (green). Note: an existing `AttackDetail` unit test (if any) must still pass — if it asserts exact DOM, the additive section uses a distinct `aria-label="find-helpers"` and does not alter existing labels; fix only if the additive markup breaks an existing assertion (it should not).

- [ ] **Step 4: e2e** — create `apps/frontend/e2e/recommend.spec.ts` (NOT run here):

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-RC1 find-helpers: AttackDetail shows ranked helper with reason, links to person", async ({ page, request }) => {
  const T = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "推荐主单RC", 状态: "进行中", 问题单号: "RC-1", 当前处理人: "处理甲RC" } })).json();
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "推荐同域单RC", 状态: "进行中", 问题单号: "RC-1", 当前处理人: "能帮乙RC" } });
  await page.goto(`/attack/${T.id}`);
  const panel = page.getByLabel("find-helpers");
  await expect(panel.getByRole("heading", { name: "找帮手" })).toBeVisible();
  await expect(panel.getByText("RC-1", { exact: false })).toBeVisible();
  const link = panel.getByRole("link", { name: "能帮乙RC" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/related\/person\//);
});

test("FE-RC2 no-evidence ticket → 暂无可推荐人选", async ({ page, request }) => {
  const T = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "孤立推荐单RC", 状态: "进行中" } })).json();
  await page.goto(`/attack/${T.id}`);
  await expect(page.getByLabel("find-helpers").getByRole("status")).toHaveText("暂无可推荐人选");
});
```

- [ ] **Step 5: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/pages/AttackDetail.tsx apps/frontend/e2e/recommend.spec.ts
git commit -m "feat(ui): AttackDetail 找帮手 section (find-helper recommendation) (5-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (`--no-ff`); integrated verify: backend `npx vitest run` (expect 69), backend tsc clean, frontend `npx vitest run` (13), `npm run test:shared` (14), frontend `npx vite build` green. Clean worktrees; `git checkout -- config/schemas/`.
- [ ] Spec-compliance review (T2, T3) vs PRD §23 concurrently; then code-quality review; implementer-fix loop until both ✅. (Attention: read-only invariant; deterministic ordering; self-exclusion; reason text cites 问题单.)
- [ ] Coverage-audit (§18): every §23 user-visible feature × spec; fill gaps (find-helpers panel populated + empty state + person link; 404/400/read-only are backend-only).
- [ ] Pre-clear stale :3001/:5173 (PowerShell `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen | Stop-Process -Force`), `git checkout -- config/schemas/`, then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §23.6 (7 items) → evidence; flip `- [ ]`→`- [x]`; acceptance commit.
- [ ] `git tag -a increment-5-find-helper -m "increment-5 …"`.
- [ ] Deploy `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ 200 + deploy.log backend=200 frontend=200.
- [ ] Final code-review whole branch; finishing-a-development-branch.

---

## Self-Review

1. **§23.6 coverage:** ① shared HelperRecommendation → T1. ② shared-anchor handler+contrib scoring + general fallback cap + self-exclusion → T2 e2e #1. ③ deterministic order/limit/reasons cite 问题单/same-input-same-output → T2 e2e #1,#3. ④ 404 unknown / 400 non-attackTicket → T2 e2e #2. ⑤ read-only audit unchanged → T2 e2e #2. ⑥ AttackDetail 找帮手 panel + reasons + person link + empty state → T3 FE-RC1/FE-RC2. ⑦ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none; full algorithm + weights + reason strings concrete.
3. **Type consistency:** `HelperRecommendation` (T1) used by recommend.ts (T2) + api.ts/AttackDetail (T3). recommend.ts `out.filter((x): x is HelperRecommendation => !!x.person)` narrows `person: GraphNode|null`→GraphNode. Endpoint shapes match.
4. **Read-only:** recommend.ts calls only `getNode/queryEdges/queryNodes`; no create/update/delete/createEdge/logAudit. e2e #2 asserts audit_log unchanged. §0.3/§6.1 boundary held.
5. **Determinism / shared-backend safety:** recommend.spec uses unique 标题/问题单 (RC-1) + a no-evidence ticket; no schema mutation → safe under shared single-backend run; backend ordering is `score desc, name asc, id asc` (fully deterministic). Note: `贡献人`/`当前处理人` are ref→person so REF edges exist (3a syncRefEdges) — recommend resolves persons via REF edges, consistent with the seed/fixtures.
