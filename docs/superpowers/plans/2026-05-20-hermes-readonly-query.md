# 增量4 — Hermes 只读数据访问契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A transport-agnostic read-only HTTP query contract over the structured + derived KG: `GET /api/query/search` (property substring search) and `GET /api/query/context/:id` (node + 1-hop derived neighborhood + progress, reusing related derivation), plus a minimal integrated 信息检索 page. Strictly read-only. Resolves PRD §13#1.

**Architecture:** Extract the existing `/api/related` derivation into a shared `buildRelated` (DRY, behavior-preserving — regression-guarded by the existing suite); `query.ts` consumes it. No write path anywhere in this increment. Backend (T2) / frontend (T3) disjoint → parallel after the shared contract gate (T1).

**Tech Stack:** Node+TS+Express+better-sqlite3, React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §22 is the basis.

---

## File Structure

- `packages/shared/src/types.ts` — `QueryHit`, `RelatedItem`, `CoAnchoredItem`, `QueryContext` (T1)
- `packages/shared/src/types.test.ts` — contract test (T1)
- `apps/backend/src/related-core.ts` — NEW `buildRelated` (extracted) (T2)
- `apps/backend/src/related.ts` — call `buildRelated` (T2)
- `apps/backend/src/query.ts` — NEW search + context routes (T2)
- `apps/backend/src/app.ts` — wire query router (T2)
- `apps/backend/test/query.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — `search`, `getContext` (T3)
- `apps/frontend/src/pages/SearchPage.tsx` — NEW (T3)
- `apps/frontend/src/App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx` — route+nav+card (T3)
- `apps/frontend/e2e/search.spec.ts` — NEW FE e2e (T3)

---

## Task 1: Shared contracts (SERIAL GATE)

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/types.test.ts`

- [ ] **Step 1: Failing test** — append to `packages/shared/src/types.test.ts` (add `QueryHit, QueryContext` to its `@combat/shared` import):

```ts
describe("query contracts", () => {
  it("QueryHit + QueryContext shapes", () => {
    const h: QueryHit = { id: "n1", nodeType: "attackTicket", summary: "断网攻关", score: 2 };
    expect(h.score).toBe(2);
    const ctx: QueryContext = {
      node: { id: "n1", nodeType: "attackTicket", properties: {}, createdAt: "t", updatedAt: "t" },
      related: { outgoing: [], incoming: [], coAnchored: [] },
      progress: [],
    };
    expect(ctx.related.coAnchored).toEqual([]);
  });
});
```

- [ ] **Step 2:** `npx tsc -p packages/shared/tsconfig.json --noEmit` → expect FAIL (RED). (`npm run test:shared` vitest doesn't typecheck — tsc is the gate.)

- [ ] **Step 3:** append to `packages/shared/src/types.ts`:

```ts
export interface QueryHit { id: string; nodeType: string; summary: string; score: number; }
export interface RelatedItem { field: string; concept: string; node: GraphNode; }
export interface CoAnchoredItem { anchorKind: string; anchorKey: string; node: GraphNode; }
export interface QueryContext {
  node: GraphNode;
  related: { outgoing: RelatedItem[]; incoming: RelatedItem[]; coAnchored: CoAnchoredItem[] };
  progress: ProgressLog[];
}
```

(`GraphNode` and `ProgressLog` are already declared in this file — place the block after `ProgressLog`.)

- [ ] **Step 4:** `npx tsc -p packages/shared/tsconfig.json --noEmit` clean (GREEN); `npm run test:shared` all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): QueryHit + QueryContext read-only query contracts (4-T1)"
```

---

## Task 2: Backend — related-core extraction + read-only query API (PARALLEL, after T1)

**Files:** Create `apps/backend/src/related-core.ts`, `apps/backend/src/query.ts`, `apps/backend/test/query.e2e.test.ts`; Modify `apps/backend/src/related.ts`, `apps/backend/src/app.ts`

- [ ] **Step 1: Failing e2e** — create `apps/backend/test/query.e2e.test.ts`:

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
  const dir = mkdtempSync(join(tmpdir(), "combat-query-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, db: (repo as any).db };
}

describe("read-only query API e2e", () => {
  it("search: substring, case-insensitive, type filter, empty→400, limit, deterministic order", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断网攻关Alpha", 当前处理人: "甲" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断网攻关Beta断网", 当前处理人: "乙" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "无关单", 当前处理人: "丙" });
    const bad = await request(app).get("/api/query/search");
    expect(bad.status).toBe(400);
    const r = await request(app).get("/api/query/search?q=" + encodeURIComponent("断网"));
    expect(r.status).toBe(200);
    const titles = r.body.map((h: any) => h.summary);
    expect(titles).toContain("断网攻关Alpha");
    expect(titles).toContain("断网攻关Beta断网");
    expect(titles).not.toContain("无关单");
    // "Beta断网" has 2 occurrences of 断网 → higher score → ranked first
    expect(r.body[0].summary).toBe("断网攻关Beta断网");
    const ci = await request(app).get("/api/query/search?q=alpha");
    expect(ci.body.map((h: any) => h.summary)).toContain("断网攻关Alpha"); // case-insensitive
    const typed = await request(app).get("/api/query/search?q=" + encodeURIComponent("断网") + "&type=person");
    expect(typed.body).toHaveLength(0); // no person matches 断网
    const lim = await request(app).get("/api/query/search?q=" + encodeURIComponent("断网") + "&limit=1");
    expect(lim.body).toHaveLength(1);
  });

  it("search is read-only: audit_log row count unchanged across calls", async () => {
    const { app, db } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "只读校验单" });
    const n0 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    await request(app).get("/api/query/search?q=" + encodeURIComponent("只读"));
    await request(app).get("/api/query/search?q=" + encodeURIComponent("只读"));
    const n1 = (db.prepare("SELECT COUNT(*) c FROM audit_log").get() as any).c;
    expect(n1).toBe(n0);
  });

  it("context: node + related(REF/coAnchored) + progress; 404 missing; matches /api/related", async () => {
    const { app } = makeApp();
    const t = await (await request(app).post("/api/nodes/attackTicket").send({ 标题: "上下文单", 当前处理人: "钱七" })).json();
    await request(app).post(`/api/nodes/${t.id}/progress`).send({ content: "进展X", statusSnapshot: "进行中", actor: "seed" });
    const miss = await request(app).get("/api/query/context/nope");
    expect(miss.status).toBe(404);
    const ctx = await request(app).get(`/api/query/context/${t.id}`);
    expect(ctx.status).toBe(200);
    expect(ctx.body.node.id).toBe(t.id);
    expect(ctx.body.progress.map((p: any) => p.content)).toContain("进展X");
    expect(ctx.body.related.outgoing.some((x: any) => x.node.nodeType === "person")).toBe(true);
    const rel = await request(app).get(`/api/related/attackTicket/${t.id}`);
    expect(ctx.body.related.outgoing.map((x: any) => x.node.id).sort())
      .toEqual(rel.body.outgoing.map((x: any) => x.node.id).sort()); // buildRelated reused → identical
  });
});
```

- [ ] **Step 2: Run** `cd apps/backend && npx vitest run query.e2e` → FAIL.

- [ ] **Step 3: Extract `related-core.ts`** — create `apps/backend/src/related-core.ts`:

```ts
import type { Repository, GraphNode } from "@combat/shared";

export interface RelatedItem { field: string; concept: string; node: GraphNode; }
export interface CoAnchoredItem { anchorKind: string; anchorKey: string; node: GraphNode; }

export function buildRelated(repo: Repository, id: string): {
  outgoing: RelatedItem[]; incoming: RelatedItem[]; coAnchored: CoAnchoredItem[];
} {
  // /related surfaces only association edges; domain edges (CONTRIBUTED_TO,
  // ONCALL_FOR, …) have their own routes — keep this an explicit whitelist.
  const isRel = (t: string) => t === "REF" || t === "ANCHORED_TO";
  const outgoing = repo.queryEdges({ sourceId: id }).filter(e => isRel(e.edgeType))
    .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.targetId) }))
    .filter((x): x is RelatedItem => !!x.node);
  const incoming = repo.queryEdges({ targetId: id }).filter(e => isRel(e.edgeType))
    .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.sourceId) }))
    .filter((x): x is RelatedItem => !!x.node);
  const coAnchored: CoAnchoredItem[] = [];
  for (const e of repo.queryEdges({ sourceId: id, edgeType: "ANCHORED_TO" })) {
    const anchor = repo.getNode(e.targetId);
    if (!anchor) continue;
    for (const back of repo.queryEdges({ targetId: anchor.id, edgeType: "ANCHORED_TO" })) {
      if (back.sourceId === id) continue;
      const peer = repo.getNode(back.sourceId);
      if (peer) coAnchored.push({ anchorKind: String(e.properties["anchorKind"] ?? ""),
        anchorKey: String(anchor.properties["key"] ?? ""), node: peer });
    }
  }
  return { outgoing, incoming, coAnchored };
}
```

- [ ] **Step 4: Refactor `related.ts`** — replace its entire body with:

```ts
import { Router } from "express";
import type { Repository } from "@combat/shared";
import { buildRelated } from "./related-core.js";

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const { outgoing, incoming, coAnchored } = buildRelated(repo, id);
    if (req.query.includeCandidates) {
      const cand = repo.listProposals({ status: "待审批" })
        .filter(p => p.sourceNodeId === id || p.targetNodeId === id)
        .map(p => {
          const otherId = p.sourceNodeId === id ? p.targetNodeId : p.sourceNodeId;
          return { proposalId: p.id, relationType: p.relationType,
            confidence: p.confidence, rationale: p.rationale, node: repo.getNode(otherId) };
        }).filter(x => x.node);
      return res.json({ outgoing, incoming, candidates: cand, coAnchored });
    }
    res.json({ outgoing, incoming, coAnchored });
  });
  return r;
}
```

(Behavior-preserving: the `outgoing`/`incoming`/`coAnchored`/`candidates` payloads are byte-identical to before. The existing related/anchor/concept/ref/proposals e2e MUST stay green — that is the zero-regression gate.)

- [ ] **Step 5: `query.ts`** — create `apps/backend/src/query.ts`:

```ts
import { Router } from "express";
import type { Repository, SchemaRegistry, QueryHit } from "@combat/shared";
import { buildRelated } from "./related-core.js";

function summarize(p: Record<string, unknown>, id: string): string {
  return String(p["标题"] ?? p["name"] ?? p["贡献人"] ?? p["key"] ?? id);
}

export function makeQueryRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();

  r.get("/query/search", (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "q 必填" });
    const type = req.query.type ? String(req.query.type) : undefined;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const needle = q.toLowerCase();
    const types = type ? [type] : registry.getConfig().nodeTypes.map(n => n.nodeType);
    const hits: (QueryHit & { _u: string })[] = [];
    for (const nt of types)
      for (const n of repo.queryNodes(nt)) {
        const hay = Object.values(n.properties).map(v => String(v)).join(" ").toLowerCase();
        let score = 0, i = hay.indexOf(needle);
        while (i !== -1) { score++; i = hay.indexOf(needle, i + needle.length); }
        if (score > 0) hits.push({ id: n.id, nodeType: n.nodeType,
          summary: summarize(n.properties, n.id), score, _u: n.updatedAt });
      }
    hits.sort((a, b) => b.score - a.score || (a._u < b._u ? 1 : a._u > b._u ? -1 : (a.id < b.id ? -1 : 1)));
    res.json(hits.slice(0, limit).map(({ _u, ...h }) => h));
  });

  r.get("/query/context/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    res.json({ node, related: buildRelated(repo, node.id), progress: repo.listProgress(node.id) });
  });

  return r;
}
```

- [ ] **Step 6: Wire** — `apps/backend/src/app.ts`: add `import { makeQueryRouter } from "./query.js";` and `app.use("/api", makeQueryRouter(deps.repo, deps.registry));` after the related router line, before the error middleware.

- [ ] **Step 7: Run** `cd apps/backend && npx vitest run` → ALL green (prior 63 + query.e2e 3 = 66; existing related/anchor/concept/ref/proposals unchanged). Then `npx tsc -p tsconfig.json --noEmit` clean. Fix logic only (never weaken tests) until green.

- [ ] **Step 8: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/related-core.ts apps/backend/src/related.ts apps/backend/src/query.ts apps/backend/src/app.ts apps/backend/test/query.e2e.test.ts
git commit -m "feat(backend): extract related-core; read-only /api/query search + context (4-T2)"
```

---

## Task 3: Frontend — 信息检索 page + integration (PARALLEL, after T1)

**Files:** Modify `apps/frontend/src/api.ts`, `App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx`; Create `pages/SearchPage.tsx`, `e2e/search.spec.ts`

- [ ] **Step 1: api.ts** — add `QueryHit, QueryContext` to the `@combat/shared` import; add two methods to `class Api`:

```ts
  search(q: string, type?: string): Promise<QueryHit[]> {
    const qs = new URLSearchParams({ q, ...(type ? { type } : {}) }).toString();
    return this.req<QueryHit[]>(`/api/query/search?${qs}`, {});
  }
  getContext(id: string): Promise<QueryContext> {
    return this.req<QueryContext>(`/api/query/context/${id}`, {});
  }
```

- [ ] **Step 2: SearchPage** — create `apps/frontend/src/pages/SearchPage.tsx`:

```tsx
import { useState } from "react";
import { Input, List, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { QueryHit } from "@combat/shared";

function detailLink(h: QueryHit): string {
  return h.nodeType === "attackTicket" ? `/attack/${h.id}` : `/related/${h.nodeType}/${h.id}`;
}

export function SearchPage() {
  const [hits, setHits] = useState<QueryHit[] | null>(null);
  const run = async (q: string) => {
    if (!q.trim()) { setHits(null); return; }
    try { setHits(await api.search(q.trim())); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>信息检索</Typography.Title>
      <Input.Search aria-label="query-input" placeholder="检索攻关/贡献/关联信息（Hermes 只读契约）"
        allowClear enterButton onSearch={run} style={{ maxWidth: 480, marginBottom: 12 }} />
      {hits !== null && hits.length === 0 && <p role="status">无匹配结果</p>}
      {hits && hits.length > 0 && (
        <List size="small" dataSource={hits} rowKey={(h) => h.id}
          renderItem={(h) => (
            <List.Item>
              <Link to={detailLink(h)}>{h.summary}</Link>
              <span style={{ marginLeft: 8, color: "#888" }}>（{h.nodeType}）</span>
            </List.Item>
          )} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: route + nav + card** —
  - `App.tsx`: `import { SearchPage } from "./pages/SearchPage.js";` + `<Route path="/search" element={<SearchPage />} />` (after `/proposals`).
  - `AppShell.tsx`: add to `ITEMS` `{ key: "/search", label: <Link to="/search">信息检索</Link> },`.
  - `HomePage.tsx`: add to `MODULES` `{ to: "/search", title: "信息检索", desc: "跨攻关/贡献/关联的只读检索（Hermes 契约）" }`.

- [ ] **Step 4: Run** `cd apps/frontend && npx vitest run` (13 green) and `npx vite build` (green).

- [ ] **Step 5: e2e** — create `apps/frontend/e2e/search.spec.ts` (NOT run here; runs at gate):

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-S1 search: nav, query, result link navigates; empty/no-result states", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "检索目标单SX", 状态: "进行中" } });
  await page.goto("/");
  await page.getByRole("link", { name: "信息检索", exact: true }).first().click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByLabel("query-input").fill("检索目标单SX");
  await page.getByLabel("query-input").press("Enter");
  const link = page.getByRole("link", { name: "检索目标单SX" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/attack\//);
  // no-result state
  await page.goto("/search");
  await page.getByLabel("query-input").fill("绝不存在的关键词ZZZ");
  await page.getByLabel("query-input").press("Enter");
  await expect(page.getByRole("status")).toHaveText("无匹配结果");
});
```

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/App.tsx apps/frontend/src/pages/AppShell.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/SearchPage.tsx apps/frontend/e2e/search.spec.ts
git commit -m "feat(ui): 信息检索 page (Hermes read-only query) + nav/home integration (4-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (`--no-ff`); integrated verify: backend `npx vitest run` (expect 66), backend tsc clean, frontend `npx vitest run` (13), `npm run test:shared` (13), frontend `npx vite build` green. Clean worktrees; `git checkout -- config/schemas/`.
- [ ] Spec-compliance review (T2, T3) vs PRD §22 concurrently; then code-quality review; implementer-fix loop until both ✅. (Pay attention to the related-core extraction = zero behavior change; read-only invariant.)
- [ ] Coverage-audit (§18): every §22 user-visible feature × spec; fill gaps (esp. type-filter UI not in MVP scope is fine; ensure search nav + result-link + empty + no-result covered; context endpoint backend-only).
- [ ] Pre-clear stale :3001/:5173 (PowerShell `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen | Stop-Process -Force`), `git checkout -- config/schemas/`, then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §22.6 (7 items) → evidence; flip `- [ ]`→`- [x]`; acceptance commit.
- [ ] `git tag -a increment-4-hermes-query -m "increment-4 …"`.
- [ ] Deploy `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ 200 + deploy.log backend=200 frontend=200.
- [ ] Final code-review whole branch; finishing-a-development-branch.

---

## Self-Review

1. **§22.6 coverage:** ① shared QueryHit/QueryContext → T1. ② search substring/ci/type/empty-400/limit/order → T2 e2e #1. ③ search read-only (audit count unchanged) → T2 e2e #2. ④ context node+related+progress / 404 / == /api/related → T2 e2e #3. ⑤ related-core zero-regression → existing suite stays green at Step 7 + Gate. ⑥ /search page query→result→navigate + empty/no-result + nav/home → T3 FE-S1 + Step 3. ⑦ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none; all code complete; summary precedence + ordering concrete.
3. **Type consistency:** `QueryHit` (T1) used in query.ts (T2) + api.ts/SearchPage (T3). `RelatedItem`/`CoAnchoredItem` declared in T1 shared AND independently in related-core.ts (T2) — these MUST be structurally identical; related-core defines its own (backend-local) but shapes match the shared `QueryContext.related`. `buildRelated` return shape identical to the old inline related payload (zero behavior change). `QueryContext` shape = query.ts context response.
4. **Read-only invariant:** query.ts calls only `repo.queryNodes/getNode/listProgress/listProposals` + `registry.getConfig` + `buildRelated` (which only reads). No create/update/delete/createEdge/applyFieldOp. e2e #2 asserts audit_log unchanged. §0.3/§6.1 boundary held.
5. **Determinism / shared-backend safety:** search.spec uses a unique 标题 ("检索目标单SX") and a guaranteed-absent keyword; no schema mutation → inherently safe under the shared single-backend Playwright run; deterministic ordering in query.ts (score, then updatedAt desc, then id).
