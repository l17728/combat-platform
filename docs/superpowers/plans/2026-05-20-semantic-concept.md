# Increment 3b — Semantic `concept` (cross-view same-concept merge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `FieldSchema.concept` so REF edges carry a semantic role; `/api/related` returns it and `RelatedPage` groups by `concept ‖ nodeType`, so differently-named ref fields (当前处理人 / 贡献人) merge under one "负责人" group cross-view.

**Architecture:** Mirrors increment-2 (aliases) exactly: additive `concept?: string` on `FieldSchema`, a `setConcept` `FieldOp` reusing `applyFieldOp` persist→reload→rollback, an EntityTable column-header concept editor reusing the existing `api.patchSchema` path, a seed on two person-ref fields, `concept` written onto the `REF` edge by `syncRefEdges` and surfaced by `/api/related`, RelatedPage grouped by concept. Existing FE-R1/coverage RelatedPage grouping assertions are intentionally updated; the comprehensive e2e coverage-audit gate + twice-green re-verify.

**Tech Stack:** Node 20 + TypeScript, npm workspaces, Express, better-sqlite3, Vite + React + Ant Design; tests = Vitest + supertest (backend) + Playwright (frontend e2e), reusing the existing deterministic harness.

---

## Spec Source

Implements PRD §19 (19.1–19.6). Decisions locked in §19.5. Deferred (NOT built): dedicated concept-query API, concept registry/taxonomy management UI, fuzzy concept inference (3c/later).

---

## Parallel Execution Map

```
Wave 0 (SERIAL gate): Task 1  @combat/shared FieldSchema.concept + FieldOp setConcept
Wave 1 (PARALLEL — 2 worktrees):
  Track A → Task 2  backend: applyFieldOp setConcept + syncRefEdges concept + related concept + seed + backend e2e
  Track B → Task 3  frontend: api RelatedResult+concept, EntityTable 概念 editor, RelatedPage group-by-concept, update FE-R1/coverage assertions, concept.spec
Gate: Task 4  comprehensive e2e coverage-audit gate + test:all green twice + §19.6 acceptance + tag + deploy
```

Wave-1 disjoint: Track A = `apps/backend/**` + `config/schemas/{attackTicket,contribution}.json`; Track B = `apps/frontend/**`. T3's `concept.spec.ts` + updated FE-R1/coverage need T2's live backend (concept on edge + /api/related concept) — if parallel, T3 merges Track A before its Playwright steps (as prior increments did) or run e2e at the gate. Per the standing parallelize directive dispatch Task 2 ‖ Task 3 as concurrent worktree agents.

---

## File Structure

```
packages/shared/src/types.ts            # MOD: FieldSchema += concept?: string
packages/shared/src/registry.ts         # MOD: FieldOp += { op:"setConcept"; id; concept }
packages/shared/src/types.test.ts       # MOD: + concept/setConcept contract test
apps/backend/src/registry.ts            # MOD: applyFieldOp setConcept branch (typed guard)
apps/backend/src/refs.ts                # MOD: REF edge props += concept
apps/backend/src/related.ts             # MOD: relation item += concept
config/schemas/attackTicket.json        # MOD: 当前处理人 += "concept":"负责人"
config/schemas/contribution.json        # MOD: 贡献人 += "concept":"负责人"
apps/backend/test/concept.e2e.test.ts   # NEW: setConcept + edge-concept + related-concept e2e
apps/frontend/src/api.ts                # MOD: RelatedResult item += concept
apps/frontend/src/api.test.ts           # MOD: + patchSchema setConcept url/body test
apps/frontend/src/pages/EntityTable.tsx # MOD: + 概念 column-header button + Modal
apps/frontend/src/pages/RelatedPage.tsx # MOD: group key concept ‖ nodeType
apps/frontend/e2e/related.spec.ts       # MOD: FE-R1 assertions -> concept grouping
apps/frontend/e2e/coverage.spec.ts      # MOD: RelatedPage test -> concept grouping
apps/frontend/e2e/concept.spec.ts       # NEW: FE-C1 concept editor + cross-view merge
```

Existing specs `attack.spec.ts`/`editable.spec.ts`/`honor.spec.ts`/`export.spec.ts`/`aliases.spec.ts`/`coverage-schema.spec.ts` must keep passing UNMODIFIED. Only `related.spec.ts` + `coverage.spec.ts` RelatedPage assertions change (intentional, §19.3).

---

## Task 1: `@combat/shared` — FieldSchema.concept + FieldOp setConcept  *(Wave 0 — serial gate)*

**Files:** Modify `packages/shared/src/types.ts`, `packages/shared/src/registry.ts`, `packages/shared/src/types.test.ts`.

- [ ] **Step 1: Append failing test** at END of `packages/shared/src/types.test.ts` (reuse existing `FieldSchema`/`FieldOp` imports already at top — do NOT duplicate imports):
```ts
describe("concept contracts", () => {
  it("FieldSchema has optional concept and FieldOp has setConcept", () => {
    const f: FieldSchema = { id: "当前处理人", name: "当前处理人", type: "ref", label: "当前处理人", refType: "person", concept: "负责人" };
    const ops: FieldOp[] = [{ op: "setConcept", id: "当前处理人", concept: "负责人" }];
    expect(f.concept).toBe("负责人");
    expect(ops[0].op).toBe("setConcept");
    if (ops[0].op === "setConcept") expect(ops[0].concept).toBe("负责人");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting && npm run test:shared` (and/or `cd D:\fighting/packages/shared && npx tsc -p tsconfig.json --noEmit`)
Expected: tsc/type error — `concept` not on `FieldSchema`; `setConcept` not in `FieldOp`.

- [ ] **Step 3: Implement**

In `packages/shared/src/types.ts`, the `FieldSchema` interface currently ends with `aliases?: string[];`. Add `concept?: string;` as the LAST member so it reads exactly:
```ts
export interface FieldSchema {
  id: string;
  name: string;
  type: FieldType;
  label: string;
  required?: boolean;
  enumValues?: string[];
  refType?: string;
  retired?: boolean;
  aliases?: string[];
  concept?: string;
}
```

In `packages/shared/src/registry.ts`, the `FieldOp` union currently ends with `| { op: "setAliases"; id: string; aliases: string[] };`. Change that final line to:
```ts
  | { op: "setAliases"; id: string; aliases: string[] }
  | { op: "setConcept"; id: string; concept: string };
```
(`index.ts` already re-exports both modules — no change.)

- [ ] **Step 4: Run, expect PASS**

Run: `cd D:\fighting && npm run test:shared` → all pass (prior + new concept-contracts).

- [ ] **Step 5: Tsc-clean + commit**

Run: `cd D:\fighting/packages/shared && npx tsc -p tsconfig.json --noEmit` → zero errors. Then:
```
git add packages/shared/src/types.ts packages/shared/src/registry.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): FieldSchema.concept + FieldOp setConcept"
```

---

## Task 2: Backend — applyFieldOp setConcept + edge concept + related concept + seed + e2e  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:** Modify `apps/backend/src/registry.ts`, `apps/backend/src/refs.ts`, `apps/backend/src/related.ts`, `config/schemas/attackTicket.json`, `config/schemas/contribution.json`; Create `apps/backend/test/concept.e2e.test.ts`.

- [ ] **Step 1: Write the failing e2e** `apps/backend/test/concept.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-concept-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person", concept: "负责人" },
    ],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [
      { name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true, concept: "负责人" },
      { name: "贡献类型", type: "string", label: "贡献类型" },
    ],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId", "email"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true },
             { name: "employeeId", type: "string", label: "工号" }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, cfg };
}

describe("concept e2e", () => {
  it("REF edge carries the field's concept and /api/related surfaces it", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连", 当前处理人: "张三" });
    expect(c.status).toBe(201);
    const edge = repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" })[0];
    expect(edge.properties["concept"]).toBe("负责人");
    const pid = repo.queryNodes("person")[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.status).toBe(200);
    expect(r.body.incoming[0].concept).toBe("负责人");
    expect(r.body.incoming[0].field).toBe("当前处理人");
  });
  it("same person referenced via two differently-named ref fields → both relations concept=负责人", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "李四" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "李四", 贡献类型: "实施" });
    const pid = repo.queryNodes("person")[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.body.incoming.map((x: any) => x.concept).sort()).toEqual(["负责人", "负责人"]);
    expect(r.body.incoming.map((x: any) => x.field).sort()).toEqual(["当前处理人", "贡献人"]);
  });
  it("PATCH setConcept persists to config + reload; non-string -> 400, config unchanged", async () => {
    const { app, cfg } = makeApp();
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "setConcept", id: "标题", concept: "标识" });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "标题").concept).toBe("标识");
    const onDisk = JSON.parse(readFileSync(join(cfg, "attackTicket.json"), "utf8"));
    expect(onDisk.fields.find((f: any) => f.id === "标题").concept).toBe("标识");
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const bad = await request(app).patch("/api/schema/attackTicket").send({ op: "setConcept", id: "标题" });
    expect(bad.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting/apps/backend && npx vitest run test/concept.e2e.test.ts`
Expected: FAIL — edge has no `concept`; related item has no `concept`; setConcept is unknown op (applyFieldOp throws 未知操作 → 400 where test 3 expects 200).

- [ ] **Step 3: Implement.**

In `apps/backend/src/registry.ts` `applyFieldOp`: the if/else chain has `} else if (op.op === "setAliases") { ... } else { throw new Error(\`未知操作: ${(op as { op: string }).op}\`); }`. Add a `setConcept` branch immediately AFTER the `setAliases` branch and BEFORE the final `else`. The chain becomes (showing the setAliases tail → new branch → unknown-op else):
```ts
    } else if (op.op === "setAliases") {
      if (!Array.isArray(op.aliases)) throw new Error("setAliases 需要 aliases 数组");
      find(op.id).aliases = op.aliases;
    } else if (op.op === "setConcept") {
      if (typeof op.concept !== "string") throw new Error("setConcept 需要 concept 字符串");
      find(op.id).concept = op.concept;
    } else {
      throw new Error(`未知操作: ${(op as { op: string }).op}`);
    }
```
(No other change to applyFieldOp — `find(op.id)` throws pre-writeFileSync for unknown id; the existing writeFileSync→reload→rollback tail persists/rolls back.)

In `apps/backend/src/refs.ts`, the `createEdge` call currently is `repo.createEdge("REF", node.id, target.id, { field: f.id, refType: f.refType }, actor);`. Change its properties object to also carry concept:
```ts
    repo.createEdge("REF", node.id, target.id, { field: f.id, refType: f.refType, concept: f.concept ?? "" }, actor);
```
(Only that object literal changes; rest of refs.ts unchanged.)

In `apps/backend/src/related.ts`, the `out`/`inc` maps currently produce `{ field: String(e.properties["field"] ?? ""), node: ... }`. Add `concept`:
```ts
    const out = repo.queryEdges({ sourceId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.targetId) }))
      .filter(x => x.node);
    const inc = repo.queryEdges({ targetId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.sourceId) }))
      .filter(x => x.node);
```
(Replace the two existing `.map(...)` bodies with these; nothing else changes.)

In `config/schemas/attackTicket.json`: the `当前处理人` field object currently is `{ "id": "当前处理人", "name": "当前处理人", "type": "ref", "refType": "person", "label": "当前处理人", "aliases": [...] }`. Add `"concept": "负责人"` to it (insert the key; keep all other keys). In `config/schemas/contribution.json`: the `贡献人` field object currently is `{ "id": "贡献人", "name": "贡献人", "type": "ref", "refType": "person", "label": "贡献人", "required": true }`. Add `"concept": "负责人"`. Change ONLY those two field objects; all other JSON byte-identical; UTF-8 no BOM; Chinese intact.

- [ ] **Step 4: Run, expect PASS + full backend + tsc**

Run: `cd D:\fighting/apps/backend && npx vitest run test/concept.e2e.test.ts && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: concept 3/3 PASS; full backend suite all green (prior 50 + 3 = 53) — refs.e2e/honor.e2e/aliases.e2e/import.e2e/api.e2e NOT regressed (concept is an additive edge property + additive related field; existing assertions don't read it). tsc zero errors. If a prior backend test regresses, the cause is a real defect — fix refs.ts/related.ts/registry.ts/seed, not the tests.

- [ ] **Step 5: Commit**

```
git add apps/backend/src/registry.ts apps/backend/src/refs.ts apps/backend/src/related.ts config/schemas/attackTicket.json config/schemas/contribution.json apps/backend/test/concept.e2e.test.ts
git commit -m "feat(concept): applyFieldOp setConcept + concept on REF edge + /api/related concept + seed 负责人"
```

---

## Task 3: Frontend — api concept, EntityTable 概念 editor, RelatedPage group-by-concept, assertion updates + e2e  *(Wave 1 — Track B)*

**Depends on:** Task 1. Playwright steps need Task 2's backend (concept on edge/related) — if parallel, merge Track A into this worktree before Steps 7-8 (as prior increments did) or run at the gate.

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/api.test.ts`, `apps/frontend/src/pages/EntityTable.tsx`, `apps/frontend/src/pages/RelatedPage.tsx`, `apps/frontend/e2e/related.spec.ts`, `apps/frontend/e2e/coverage.spec.ts`; Create `apps/frontend/e2e/concept.spec.ts`.

- [ ] **Step 1: Write the failing unit test.** Append to `apps/frontend/src/api.test.ts` inside `describe("Api client")`:
```ts
  it("patchSchema setConcept PATCHes the schema endpoint with the op", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ nodeType: "attackTicket", label: "攻关单", fields: [], identityKeys: [], derivedToKG: true }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.patchSchema("attackTicket", { op: "setConcept", id: "当前处理人", concept: "负责人" });
    expect(calls[0][0]).toBe("http://x/api/schema/attackTicket");
    expect(calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(calls[0][1].body)).toEqual({ op: "setConcept", id: "当前处理人", concept: "负责人" });
  });
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting/apps/frontend && npx vitest run src/api.test.ts`
Expected: FAIL — `RelatedResult` type/`FieldOp` mismatch surfaces only at tsc; the runtime test will actually PASS because `patchSchema` already forwards any op. So ALSO run `cd D:\fighting/apps/frontend && npx tsc -p tsconfig.json --noEmit` (if a frontend tsconfig exists) OR rely on Step 3's `RelatedResult` change being required by `RelatedPage` group-by-concept (Step 6) which WON'T compile until concept is on the type. To get a real RED now: this unit test passes (patchSchema is generic over FieldOp from Task 1 — already widened). Treat Step 1's test as a regression guard; the genuine TDD RED for this task is the RelatedPage concept grouping (Step 6 fails to typecheck / e2e fails) and `concept.spec.ts` (Step 7). Proceed.

- [ ] **Step 3: api RelatedResult += concept**

In `apps/frontend/src/api.ts`, the `RelatedResult` interface currently is:
```ts
export interface RelatedResult {
  outgoing: { field: string; node: GraphNode }[];
  incoming: { field: string; node: GraphNode }[];
}
```
Change both item shapes to include `concept`:
```ts
export interface RelatedResult {
  outgoing: { field: string; concept: string; node: GraphNode }[];
  incoming: { field: string; concept: string; node: GraphNode }[];
}
```

- [ ] **Step 4: EntityTable 概念 column-header editor (mirror the 别名 editor)**

In `apps/frontend/src/pages/EntityTable.tsx`:
(a) There is `const [al, setAl] = useState<{ id: string; text: string } | null>(null);`. Add right after it:
```tsx
  const [cp, setCp] = useState<{ id: string; text: string } | null>(null);
```
(b) In the per-field column `title` `<Space size={4}>`, there is a `<Button aria-label={\`aliases-${f.id}\`} ...>别名</Button>`. Add immediately after that aliases Button (still inside the same `<Space>`):
```tsx
          <Button aria-label={`concept-${f.id}`} size="small" type="link"
            onClick={() => setCp({ id: f.id, text: f.concept ?? "" })}>概念</Button>
```
(c) There is an aliases `<Modal title="编辑别名（每行/逗号一个）" open={al !== null} ...>`. Add immediately AFTER that aliases `</Modal>` (before the component's closing `</div>`):
```tsx
      <Modal title="编辑语义概念" open={cp !== null} okText="确定" onCancel={() => setCp(null)}
        onOk={async () => {
          if (cp) await patch({ op: "setConcept", id: cp.id, concept: cp.text.trim() });
          setCp(null);
        }}>
        <Input aria-label="concept-input" value={cp?.text ?? ""}
          onChange={e => setCp(s => (s ? { ...s, text: e.target.value } : s))} />
      </Modal>
```
(`Input`, `Modal`, `Button`, `patch`, `useState` all already in scope. `f.concept` is on the FieldSchema type from Task 1. Change NOTHING else — no existing aria-label/behavior altered.)

- [ ] **Step 5: Run unit + build**

Run: `cd D:\fighting/apps/frontend && npx vitest run && npx vite build`
Expected: frontend unit all green (api setConcept test + existing); vite build succeeds (antd chunk warning OK).

- [ ] **Step 6: RelatedPage group by concept ‖ nodeType**

In `apps/frontend/src/pages/RelatedPage.tsx`, the grouping currently is `for (const x of all) (groups[x.node.nodeType] ??= []).push(x);`. Change the group key to concept-or-nodeType:
```tsx
  for (const x of all) (groups[x.concept || x.node.nodeType] ??= []).push(x);
```
(`x.concept` now exists on the item type from Step 3. `label`/`detailLink`/`dir`/render unchanged. The per-item line already shows `[{x.field}] {x.dir}` — keep it; the field name still appears so the merge is legible.)

- [ ] **Step 7: Update FE-R1 + coverage RelatedPage assertions (intentional, §19.3)**

In `apps/frontend/e2e/related.spec.ts` FE-R1: it currently navigates to `/related/attackTicket/:id`, asserts `getByText("person", { exact: false })` (the outgoing group heading), clicks 王五, then on `/related/person/...` asserts `getByText("attackTicket", ...)` and `getByText("contribution", ...)` group headings. Because 当前处理人 (attackTicket) now has concept 负责人, the attackTicket's outgoing group heading becomes "负责人" (not "person"); and on the person page the incoming edge from the attackTicket groups under "负责人". The contribution in FE-R1 is created with `贡献人: "王五"` — `贡献人` is seeded concept 负责人 too, so it ALSO groups under "负责人". Replace those heading assertions accordingly. The full updated FE-R1 (replace the file contents EXACTLY):
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-R1 ref field creates a cross-view relation reachable from the relations page", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "关联攻关单", 状态: "进行中", 当前处理人: "王五" } })).json();
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "王五", 贡献类型: "实施", 贡献等级: "核心" } });
  await page.goto(`/related/attackTicket/${t.id}`);
  await expect(page.getByText("关联全景", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: /负责人/ })).toBeVisible(); // concept group (was "person")
  await page.getByRole("link", { name: "王五" }).first().click();
  await expect(page).toHaveURL(/\/related\/person\//);
  // both the attackTicket (当前处理人) and the contribution (贡献人) reference 王五
  // with concept 负责人 -> they merge under one "负责人" group (cross-view semantic merge)
  await expect(page.getByRole("heading", { name: /负责人/ })).toBeVisible();
  await expect(page.getByText("关联攻关单", { exact: false })).toBeVisible(); // the attackTicket node label
  await expect(page.getByRole("link", { name: "关联攻关单" })).toBeVisible();
});
```
In `apps/frontend/e2e/coverage.spec.ts`, the test `GAP RelatedPage: direction labels, incoming edge, and empty state` asserts `getByText("→ 本节点引用")`, then on the person page `getByText("← 引用本节点")` and `getByText("attackTicket", { exact: false })`. The direction labels (`x.dir`) are per-item and UNCHANGED. Only the `getByText("attackTicket", { exact: false })` group-heading assertion must change: 覆盖人乙 is referenced by an attackTicket via `当前处理人` (concept 负责人) → on the person page the group heading is "负责人". Replace just that one assertion line:
- Old: `await expect(page.getByText("attackTicket", { exact: false })).toBeVisible();`
- New: `await expect(page.getByRole("heading", { name: /负责人/ })).toBeVisible();`
Leave every other line in coverage.spec.ts (and all other specs) UNCHANGED. (The empty-state `暂无关联` and direction-label assertions are unaffected by concept grouping.)

- [ ] **Step 8: New Playwright** `apps/frontend/e2e/concept.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-C1 concept editor persists + cross-view same-concept merge in RelatedPage", async ({ page, request }) => {
  // concept editor: set 标题's concept and verify it persisted via the schema endpoint
  await page.goto("/attack");
  await page.getByLabel("concept-标题").click();
  await page.getByLabel("concept-input").fill("标识符");
  await page.getByRole("button", { name: "确定" }).click();
  await expect.poll(async () => {
    const s = await (await page.request.get(`${API}/api/schema/attackTicket`)).json();
    return s.fields.find((f: any) => f.id === "标题")?.concept ?? "";
  }).toBe("标识符");

  // cross-view merge: an attackTicket (当前处理人) and a contribution (贡献人), both
  // concept 负责人, referencing the same person -> one "负责人" group on the person page
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "概念攻关单", 状态: "进行中", 当前处理人: "概念人" } });
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "概念人", 贡献类型: "设计" } });
  // reach the person via the attackTicket's relations page
  const list = await (await page.request.get(`${API}/api/nodes/attackTicket`)).json();
  const at = list.find((n: any) => n.properties["标题"] === "概念攻关单");
  await page.goto(`/related/attackTicket/${at.id}`);
  await page.getByRole("link", { name: "概念人" }).first().click();
  await expect(page).toHaveURL(/\/related\/person\//);
  const grp = page.getByRole("heading", { name: /负责人/ });
  await expect(grp).toBeVisible();
  // the 负责人 group contains BOTH the attackTicket and the contribution (异名同concept归并)
  await expect(page.getByText("概念攻关单", { exact: false })).toBeVisible();
  await expect(page.getByText("[当前处理人]", { exact: false })).toBeVisible();
  await expect(page.getByText("[贡献人]", { exact: false })).toBeVisible();
});
```

- [ ] **Step 9: Run e2e until green twice**

Run: `cd D:\fighting/apps/frontend && npx playwright test` → ALL pass (attack 2 + editable 2 + export 1 + honor 2 + aliases 1 + related 1 + coverage 5 + coverage-schema 4 + concept 1 = 19). Run again immediately → all pass (determinism). If a stale :3001/:5173 process holds the port, kill it (`netstat -ano | grep LISTENING | grep :PORT` → `taskkill //F //PID <pid>`) and retry; never weaken assertions; never edit specs other than the two §19.3 updates. After runs, `cd D:\fighting && git checkout -- config/schemas/` (e2e mutates by design; committed seed restored).

- [ ] **Step 10: Commit**

```
git add apps/frontend/src/api.ts apps/frontend/src/api.test.ts apps/frontend/src/pages/EntityTable.tsx apps/frontend/src/pages/RelatedPage.tsx apps/frontend/e2e/related.spec.ts apps/frontend/e2e/coverage.spec.ts apps/frontend/e2e/concept.spec.ts
git commit -m "feat(ui): EntityTable 概念 editor + RelatedPage group-by-concept + FE-C1; FE-R1/coverage assertions updated to concept grouping"
```

---

## Task 4: Gate — comprehensive e2e coverage audit + test:all green twice + acceptance + tag + deploy

- [ ] **Step 1: Comprehensive e2e coverage-audit gate** (the standard gate established in increment-3a / task #75). Re-audit: enumerate every user-facing capability/route/API (now incl. the 概念 editor + concept grouping), map to existing Playwright specs, and identify any NEW gap introduced by 3b. If a genuine zero-coverage gap exists for the new concept capability beyond `concept.spec.ts` FE-C1 (e.g. concept editor on `/contributions`, or a no-concept node still grouping by nodeType post-change), add the minimal deterministic Playwright case (own-data, self-restoring if schema-mutating, per the harness rules). Re-run full Playwright suite green twice after any addition.

- [ ] **Step 2: Full aggregate**

Run: `cd D:\fighting`; kill stale :3001/:5173 listeners; `git checkout -- config/schemas/`; `npm run test:all`.
Expected ALL green: shared (+concept contract) + backend (+concept.e2e 3 = 53) + frontend-unit (+api setConcept) + frontend-e2e (19, or +N from Step 1). Then `git checkout -- config/schemas/`. If any suite red → STOP, report BLOCKED with root cause; do not weaken tests.

- [ ] **Step 3: Verify PRD §19.6 acceptance** — map each box to a green test:
  - FieldSchema.concept + FieldOp.setConcept contract → Task 1 shared test (tsc-clean)
  - REF edge concept + /api/related concept → `concept.e2e` test 1
  - same person via two异名 fields → both concept 负责人 → `concept.e2e` test 2
  - PATCH setConcept persist/reload + non-string 400 + config unchanged → `concept.e2e` test 3
  - EntityTable 概念 editor persists → `concept.spec` FE-C1 (schema-endpoint poll)
  - RelatedPage merges two异名 fields under one 负责人 group; no-concept still nodeType → `concept.spec` FE-C1 + (no-concept path) existing coverage/related green under updated assertions
  - coverage-audit gate passed; test:all twice green
  State explicitly: all covered & green (yes/no).

- [ ] **Step 4: Tag**

```
cd D:\fighting
git checkout -- config/schemas/ 2>/dev/null || true
git commit --allow-empty -m "chore: increment-3b (semantic concept) acceptance verified — test:all green + e2e coverage-audit gate (PRD §19.6)"
git tag increment-3b-concept
```

- [ ] **Step 5: Deploy**

Run: `cd D:\fighting/scripts/deploy && node deploy.mjs deploy`. Confirm runner ends `DEPLOY_DONE` with health `backend=200 frontend=200`. Verify live via `http://www.catown.cloud:5173/` (e.g. `GET /api/schema/attackTicket` shows `当前处理人` with `"concept":"负责人"`). (Standing deploy principle; creds from gitignored `.env.deploy`.)

- [ ] **Step 6: Report** — increment complete; test:all counts; deploy health; the open URL.

---

## Self-Review

**1. Spec coverage (PRD §19):**
- 19.1 `FieldSchema.concept?` + `FieldOp.setConcept` → Task 1 ✓
- 19.2 applyFieldOp setConcept (typed guard, reuse persist/reload/rollback) + refs.ts edge concept + related.ts item concept + seed 负责人 on the 2 person-ref fields → Task 2 ✓
- 19.3 api RelatedResult+concept; EntityTable 概念 editor (mirror 别名); RelatedPage group `concept‖nodeType`; intentional FE-R1/coverage assertion updates → Task 3 ✓
- 19.4 TDD + backend concept.e2e + Playwright concept.spec + updated FE-R1/coverage + coverage-audit gate + twice-green → Tasks 2,3,4 ✓
- 19.5 decisions reflected; 19.6 acceptance → Task 4 maps each ✓
- Deferred (concept query API, registry UI, fuzzy concept) correctly NOT built ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Full code shown: applyFieldOp branch with surrounding context, exact createEdge props, exact related .map bodies, exact seed field edits, full RelatedPage group-key line, full updated FE-R1 file, the single coverage.spec line swap (old→new quoted), full concept.spec, full EntityTable editor mirror. Task 3 Step 2 honestly flags that the api unit test won't hard-RED (patchSchema is generic) and identifies the genuine RED (RelatedPage concept grouping typecheck + concept.spec) — not a placeholder, an accurate TDD note.

**3. Type consistency:** `concept?: string` on FieldSchema (Task1) → read as `f.concept ?? ""` in refs.ts (Task2), `f.concept ?? ""` in EntityTable editor (Task3); `setConcept`{id,concept:string} identical in Task1 union, applyFieldOp branch (Task2), concept.e2e PATCH body (Task2), api.test (Task3), EntityTable patch call (Task3). `RelatedResult` item `{field,concept,node}` identical in api.ts (Task3), related.ts response (Task2), RelatedPage consumption (Task3 Step6), concept.e2e assertions (Task2). REF edge `properties.concept` written in refs.ts (Task2), read in related.ts (Task2), asserted in concept.e2e (Task2). Group key `x.concept || x.node.nodeType` (Task3 Step6) consumes the Step3 type. `concept-${id}` / `concept-input` aria-labels consistent between EntityTable (Task3 Step4) and concept.spec (Task3 Step8). Seed concept "负责人" consistent across Task2 seed, concept.e2e fixture, FE-R1/coverage/concept specs.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-semantic-concept.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, parallel Wave-1 worktrees (Task 2 ‖ Task 3).
**2. Inline Execution** — executing-plans with checkpoints.

Which approach?
