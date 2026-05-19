# 增量7 — 发布包 / 权重文件归档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Deliver two new domain entities (`releasePackage` / `weightFile`) as metadata + link registries — **almost entirely via JSON config** (zero backend code), validating §0.4 config-driven architecture. Frontend adds 2 routes + nav + home cards. Resolves PRD §13#6.

**Architecture:** No shared contracts change. Backend is pure config — generic CRUD / refs / anchors / related / search / import / export already work for any configured nodeType. T2 = config + e2e proof; T3 = frontend integration. Disjoint, parallel. No T1 (no shared changes).

**Tech Stack:** Node+TS+Express+better-sqlite3, React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §25 is the basis.

---

## File Structure

- `config/schemas/releasePackage.json` — NEW (T2)
- `config/schemas/weightFile.json` — NEW (T2)
- `apps/backend/test/archive.e2e.test.ts` — NEW (T2)
- `apps/frontend/src/App.tsx` — `/releases` `/weights` routes (T3)
- `apps/frontend/src/pages/AppShell.tsx` — nav (T3)
- `apps/frontend/src/pages/HomePage.tsx` — cards (T3)
- `apps/frontend/e2e/archive.spec.ts` — NEW (T3)

---

## Task 2: Backend — schema config + e2e (PARALLEL with T3)

**Files:** Create `config/schemas/releasePackage.json`, `config/schemas/weightFile.json`, `apps/backend/test/archive.e2e.test.ts`

- [ ] **Step 1: Create `config/schemas/releasePackage.json`** with EXACTLY:

```json
{
  "nodeType": "releasePackage",
  "label": "发布包",
  "identityKeys": ["版本号"],
  "derivedToKG": true,
  "fields": [
    { "id": "版本号", "name": "版本号", "type": "string", "label": "版本号", "required": true },
    { "id": "产品", "name": "产品", "type": "string", "label": "产品" },
    { "id": "发布日期", "name": "发布日期", "type": "date", "label": "发布日期" },
    { "id": "链接", "name": "链接", "type": "string", "label": "下载/仓库链接" },
    { "id": "责任人", "name": "责任人", "type": "ref", "refType": "person", "label": "责任人", "concept": "负责人" },
    { "id": "关联问题单", "name": "关联问题单", "type": "string", "label": "关联问题单", "anchor": "问题单号" },
    { "id": "描述", "name": "描述", "type": "string", "label": "描述" },
    { "id": "备注", "name": "备注", "type": "string", "label": "备注" }
  ]
}
```

- [ ] **Step 2: Create `config/schemas/weightFile.json`** with EXACTLY:

```json
{
  "nodeType": "weightFile",
  "label": "权重文件",
  "identityKeys": ["名称"],
  "derivedToKG": true,
  "fields": [
    { "id": "名称", "name": "名称", "type": "string", "label": "名称/版本", "required": true },
    { "id": "模型", "name": "模型", "type": "string", "label": "模型" },
    { "id": "链接", "name": "链接", "type": "string", "label": "存储链接" },
    { "id": "责任人", "name": "责任人", "type": "ref", "refType": "person", "label": "责任人", "concept": "负责人" },
    { "id": "训练日期", "name": "训练日期", "type": "date", "label": "训练日期" },
    { "id": "关联问题单", "name": "关联问题单", "type": "string", "label": "关联问题单", "anchor": "问题单号" },
    { "id": "备注", "name": "备注", "type": "string", "label": "备注" }
  ]
}
```

- [ ] **Step 3: Create e2e** — `apps/backend/test/archive.e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeApp() {
  // use the real committed config/schemas/ — this e2e specifically validates
  // §25.1 (releasePackage + weightFile schemas land via config and just work)
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-arc-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry("config/schemas") }), repo };
}

describe("archive (release/weight) e2e — config-driven, zero backend code", () => {
  it("releasePackage CRUD + required guard + ref→person + anchor→问题单号", async () => {
    const { app, repo } = makeApp();
    // required 版本号 violation → 400
    const bad = await request(app).post("/api/nodes/releasePackage").send({ 产品: "X" });
    expect(bad.status).toBe(400);
    // happy create
    const c = await request(app).post("/api/nodes/releasePackage").send({
      版本号: "v1.0.0-RC", 产品: "ModelArts", 责任人: "张归档", 关联问题单: "ARC-1", 链接: "https://x/v1.0.0",
    });
    expect(c.status).toBe(201);
    expect(c.body.properties["版本号"]).toBe("v1.0.0-RC");
    // REF→person built (3a syncRefEdges reused)
    const refs = repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" });
    expect(refs.length).toBe(1);
    expect(refs[0].properties["field"]).toBe("责任人");
    // ANCHORED_TO 问题单号 built (3d syncAnchorEdges reused)
    const anchors = repo.queryEdges({ sourceId: c.body.id, edgeType: "ANCHORED_TO" });
    expect(anchors.length).toBe(1);
    expect(anchors[0].properties["anchorKind"]).toBe("问题单号");
    // list
    const lst = await request(app).get("/api/nodes/releasePackage");
    expect(lst.body.map((n: any) => n.properties["版本号"])).toContain("v1.0.0-RC");
    // update + delete
    const up = await request(app).put(`/api/nodes/${c.body.id}`).send({ 描述: "RC 候选" });
    expect(up.status).toBe(200);
    const del = await request(app).delete(`/api/nodes/${c.body.id}`);
    expect(del.status).toBe(200);
  });

  it("weightFile happy path + same generic CRUD reuse", async () => {
    const { app } = makeApp();
    const bad = await request(app).post("/api/nodes/weightFile").send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post("/api/nodes/weightFile").send({
      名称: "BERT-base-v3.2", 模型: "BERT", 责任人: "李训", 关联问题单: "ARC-2", 链接: "s3://x/y",
    });
    expect(c.status).toBe(201);
    expect(c.body.properties["名称"]).toBe("BERT-base-v3.2");
  });

  it("cross-view cross-nodeType coAnchored — attackTicket + releasePackage + weightFile via shared 问题单号", async () => {
    const { app } = makeApp();
    const PB = "ARC-X-" + Date.now();
    const at = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "归档关联攻关", 状态: "进行中", 问题单号: PB })).body;
    const rp = (await request(app).post("/api/nodes/releasePackage").send({ 版本号: "归档v9", 关联问题单: PB })).body;
    const wf = (await request(app).post("/api/nodes/weightFile").send({ 名称: "归档W9", 关联问题单: PB })).body;
    // attackTicket's coAnchored must include the release + the weight (cross-nodeType derivation)
    const relAt = await request(app).get(`/api/related/attackTicket/${at.id}`);
    const ids = relAt.body.coAnchored.map((x: any) => x.node.id);
    expect(ids).toContain(rp.id);
    expect(ids).toContain(wf.id);
    // and symmetric: releasePackage's coAnchored includes the attackTicket + the weight
    const relRp = await request(app).get(`/api/related/releasePackage/${rp.id}`);
    const idsRp = relRp.body.coAnchored.map((x: any) => x.node.id);
    expect(idsRp).toContain(at.id);
    expect(idsRp).toContain(wf.id);
  });

  it("/api/query/search finds new nodeTypes by property substring", async () => {
    const { app } = makeApp();
    const tag = "ARC检索X-" + Date.now();
    await request(app).post("/api/nodes/releasePackage").send({ 版本号: tag, 产品: "搜得到" });
    await request(app).post("/api/nodes/weightFile").send({ 名称: "W-" + tag, 模型: "搜得到W" });
    const hits = (await request(app).get(`/api/query/search?q=${encodeURIComponent(tag)}`)).body;
    const types = new Set(hits.map((h: any) => h.nodeType));
    expect(types.has("releasePackage")).toBe(true);
    expect(types.has("weightFile")).toBe(true);
  });
});
```

- [ ] **Step 4: Run** `cd apps/backend && npx vitest run archive.e2e` → expect FAIL on test 1 first ("nodeType releasePackage not found" or similar — schema not loaded). Add the two JSON configs (Steps 1/2 already done) and rerun: ALL green.

- [ ] **Step 5:** Full suite: `cd apps/backend && npx vitest run` → expect 76 (72 prior + 4 new). `npx tsc -p tsconfig.json --noEmit` clean.

- [ ] **Step 6: Commit** — the two seed JSONs are INTENTIONAL committed config; the e2e is new test.

```bash
git add config/schemas/releasePackage.json config/schemas/weightFile.json apps/backend/test/archive.e2e.test.ts
git diff --cached --stat
git commit -m "feat(config): releasePackage + weightFile schemas (李嘉⑤⑥; zero backend code — config-driven) (7-T2)"
```

---

## Task 3: Frontend — routes + nav + cards (PARALLEL with T2)

**Files:** Modify `apps/frontend/src/App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx`; Create `apps/frontend/e2e/archive.spec.ts`

- [ ] **Step 1: App.tsx routes** — add 2 routes right after the `/search` route:

```tsx
<Route path="/releases" element={<EntityTable nodeType="releasePackage" />} />
<Route path="/weights" element={<EntityTable nodeType="weightFile" />} />
```

(`EntityTable` is already imported.)

- [ ] **Step 2: AppShell nav** — append to `ITEMS`:

```ts
{ key: "/releases", label: <Link to="/releases">发布包</Link> },
{ key: "/weights", label: <Link to="/weights">权重文件</Link> },
```

- [ ] **Step 3: HomePage cards** — append to `MODULES`:

```ts
{ to: "/releases", title: "发布包", desc: "版本发布包元数据 + 下载链接登记（李嘉⑤）" },
{ to: "/weights", title: "权重文件", desc: "模型权重文件元数据 + 存储链接登记（李嘉⑥）" },
```

- [ ] **Step 4: Run** `cd apps/frontend && npx vitest run` (13 green) and `npx vite build` (green).

- [ ] **Step 5: e2e** — create `apps/frontend/e2e/archive.spec.ts` (NOT run here):

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-AR1 发布包: nav → create row → 信息检索 hit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "发布包", exact: true }).first().click();
  await expect(page).toHaveURL(/\/releases$/);
  await page.getByLabel("new-row").click();
  const ver = "vAR-" + Date.now();
  await page.getByLabel("draft-版本号").fill(ver);
  await page.getByLabel("draft-产品").fill("ModelArts-AR");
  await page.getByLabel("create-row").click();
  await expect(page.getByText(ver)).toBeVisible();
  // searchable via Hermes read-only query
  await page.goto("/search");
  await page.getByLabel("query-input").fill(ver);
  await page.getByLabel("query-input").press("Enter");
  await expect(page.getByRole("link", { name: ver })).toBeVisible();
});

test("FE-AR2 权重文件: home card → create row + export button present", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("home-card-/weights").click();
  await expect(page).toHaveURL(/\/weights$/);
  await page.getByLabel("new-row").click();
  const nm = "wfAR-" + Date.now();
  await page.getByLabel("draft-名称").fill(nm);
  await page.getByLabel("draft-模型").fill("BERT-AR");
  await page.getByLabel("create-row").click();
  await expect(page.getByText(nm)).toBeVisible();
  // generic export button present (1.5 reuse)
  await expect(page.getByLabel("export-excel")).toBeVisible();
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/src/pages/AppShell.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/e2e/archive.spec.ts
git commit -m "feat(ui): /releases + /weights routes + nav + cards (7-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (`--no-ff`); integrated verify: backend `npx vitest run` (expect 76), backend tsc clean, frontend `npx vitest run` (13), frontend `npx vite build` green.
- [ ] Spec-compliance review (T2, T3) vs PRD §25 concurrently; then code-quality review; implementer-fix loop until both ✅. (Attention: zero backend code — verify the e2e GENUINELY exercises generic CRUD/refs/anchors/related/search reuse, not just config presence.)
- [ ] Coverage-audit (§18): every §25 user-visible feature × spec; ensure release/weight nav + create + search hit + export covered; cross-nodeType coAnchored covered (backend e2e).
- [ ] Pre-clear stale :3001/:5173, `git checkout -- config/schemas/` (config is now committed seed including releasePackage/weightFile — restore from git keeps them), then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §25.6 (7 items) → evidence; flip `- [ ]`→`- [x]`; acceptance commit.
- [ ] `git tag -a increment-7-archive -m "increment-7 …"`.
- [ ] Deploy `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ 200 + deploy.log backend=200 frontend=200.
- [ ] Final code-review whole branch; finishing-a-development-branch.

---

## Self-Review

1. **§25.6 coverage:** ① config loaded + zero backend code → file presence + T2 backend tests pass without app.ts/routes/repository changes. ② CRUD + required guard → T2 e2e #1 (bad/happy/list/update/delete) + #2 (weightFile bad/happy). ③ ref→person → T2 e2e #1 REF edge assertion. ④ anchor + cross-nodeType coAnchored → T2 e2e #3 (3-way attackTicket+release+weight share PB-x; relAt.coAnchored ⊇ {rp,wf}; relRp.coAnchored ⊇ {at,wf}). ⑤ /api/query/search hits → T2 e2e #4. ⑥ FE routes/nav/cards + EntityTable reuse + export reuse → T3 FE-AR1/AR2. ⑦ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none; all configs/code/tests literal.
3. **Determinism / shared-backend safety:** archive.spec uses Date.now()-suffixed unique 版本号/名称, no schema mutation → safe under shared single-backend Playwright run. Backend e2e uses tmpdir sqlite + real `config/schemas` (which now includes the two new ones after they're committed). The cross-nodeType coAnchored test uses a unique PB tag to avoid collision with other tests.
4. **Architecture validation (the meta-goal):** if backend tests pass WITHOUT touching apps/backend/src/*.ts or apps/frontend/src/pages/EntityTable.tsx, §0.4 config-driven architecture is proven end-to-end for new domain entities — REF, ANCHORED_TO, coAnchored derivation, search, CRUD, export, import all generic.
