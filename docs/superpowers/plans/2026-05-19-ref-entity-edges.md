# Increment 3a — ref→entity Edges + 1-hop Cross-View Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On node write, resolve `type:"ref"` fields to a target entity and create a typed `REF` edge; expose `GET /api/related/:nodeType/:id` (1-hop, both directions) and a `/related/:nodeType/:id` relations page, so "from a person, see all their work across every view" is a real traversal.

**Architecture:** Additive. `Repository` gains `deleteEdges` (for update idempotency). A focused `refs.ts` module syncs `REF` edges from ref-field values (delete-all-then-recreate per node), called one-line from the existing generic POST/PUT node routes. A read-only `related` router groups edge neighbours. Two seed fields become `type:ref refType:person`. Frontend adds a relations page + minimal entry points. The `edges` table IS the structured graph; no separate KG engine (deferred).

**Tech Stack:** Node 20 + TypeScript, npm workspaces, Express, better-sqlite3, Vite + React + Ant Design; tests = Vitest + supertest (backend) + Playwright (frontend e2e), reusing the existing deterministic harness.

---

## Spec Source

Implements PRD §18 (18.1–18.7). Decisions locked in §18.6: single `REF` edge + `properties.field`; exact resolve (identityKey/name) else create; update = deleteEdges(sourceId,REF)-then-recreate; 1-hop read-only; seed attackTicket.当前处理人 + contribution.贡献人 → ref→person; minimal FE entry points. Deferred (3b concept / 3c LLM+approval / 3d cross-granularity anchors / depth-N / conflict / standalone KG engine) — NOT built.

---

## Parallel Execution Map

```
Wave 0 (SERIAL gate): Task 1  @combat/shared Repository.deleteEdges + SqliteRepository impl
Wave 1 (PARALLEL — 2 worktrees):
  Track A → Task 2  backend: refs.ts (syncRefEdges) + POST/PUT hooks + /api/related + seed + backend e2e
  Track B → Task 3  frontend: RelatedPage + api.getRelated + EntityTable ref-cell link + AttackDetail link + Playwright e2e
Gate: Task 4  test:all green + §18.7 acceptance + tag + deploy
```

Wave-1 disjoint: Track A = `apps/backend/**` + `config/schemas/{attackTicket,contribution}.json`; Track B = `apps/frontend/src/**` + `apps/frontend/e2e/related.spec.ts`. Branch tracks off the Task-1 commit; a track imports only `@combat/shared`; T3's Playwright e2e needs T2's live backend so T3 may merge Track A first (as the alias increment did) — that is acceptable; merge at the gate. Per the standing parallelize directive dispatch Task 2 ‖ Task 3 as concurrent worktree agents.

---

## File Structure

```
packages/shared/src/repository.ts      # MOD: Repository += deleteEdges
packages/shared/src/types.test.ts      # MOD: + deleteEdges contract test
apps/backend/src/repository.ts         # MOD: SqliteRepository.deleteEdges (tx + audit)
apps/backend/test/repository.test.ts   # MOD: + deleteEdges unit tests
apps/backend/src/refs.ts               # NEW: syncRefEdges(repo, registry, node, body, actor)
apps/backend/src/related.ts            # NEW: makeRelatedRouter(repo) -> GET /related/:nodeType/:id
apps/backend/src/routes.ts             # MOD: call syncRefEdges in POST /nodes/:nodeType and PUT /nodes/:id
apps/backend/src/app.ts                # MOD: mount makeRelatedRouter before error mw
config/schemas/attackTicket.json       # MOD: 当前处理人 -> type:ref refType:person
config/schemas/contribution.json       # MOD: 贡献人 -> type:ref refType:person
apps/backend/test/refs.e2e.test.ts     # NEW: ref-resolution + /api/related e2e
apps/frontend/src/api.ts               # MOD: + getRelated
apps/frontend/src/api.test.ts          # MOD: + getRelated test
apps/frontend/src/pages/RelatedPage.tsx# NEW: relations page
apps/frontend/src/pages/RelatedPage.test.tsx # NEW: smoke export test
apps/frontend/src/pages/EntityTable.tsx# MOD: ref-cell -> <Link to=/related/:nodeType/:rowId>
apps/frontend/src/pages/AttackDetail.tsx # MOD: + 关联全景 link
apps/frontend/src/App.tsx              # MOD: + /related/:nodeType/:id route
apps/frontend/e2e/related.spec.ts      # NEW: Playwright FE-R1
```

Existing Playwright `attack.spec.ts`/`editable.spec.ts`/`honor.spec.ts`/`export.spec.ts`/`aliases.spec.ts` must keep passing UNMODIFIED. NOTE: making `当前处理人` a ref→person changes nothing observable in attack/editable specs (they use 标题/状态, never 当前处理人; ref still renders as a value/link, status-filter & 标题 link unaffected). honor.spec uses contribution 贡献人 — see Task 2 Step 4 note.

---

## Task 1: `@combat/shared` Repository.deleteEdges + SqliteRepository impl  *(Wave 0 — serial gate)*

**Files:** Modify `packages/shared/src/repository.ts`, `packages/shared/src/types.test.ts`, `apps/backend/src/repository.ts`, `apps/backend/test/repository.test.ts`.

- [ ] **Step 1: Append failing contract test** to `packages/shared/src/types.test.ts` (reuse existing `Repository` import in the increment-1 contracts describe; do NOT duplicate imports). Append at end of file:
```ts
describe("ref-edge contracts", () => {
  it("Repository requires deleteEdges", () => {
    const keys: (keyof Repository)[] = ["deleteEdges", "createEdge", "queryEdges"];
    expect(keys).toContain("deleteEdges");
  });
});
```

- [ ] **Step 2: Append failing impl test** inside the existing `describe("SqliteRepository")` block in `apps/backend/test/repository.test.ts`:
```ts
  it("deleteEdges removes only matching edges and audits", () => {
    const a = repo.createNode("attackTicket", { 标题: "A" }, "t");
    const p = repo.createNode("person", { name: "张三" }, "t");
    const q = repo.createNode("person", { name: "李四" }, "t");
    repo.createEdge("REF", a.id, p.id, { field: "当前处理人" }, "t");
    repo.createEdge("REF", a.id, q.id, { field: "攻关组长" }, "t");
    repo.createEdge("CONTRIBUTED_TO", a.id, p.id, {}, "t");
    repo.deleteEdges({ sourceId: a.id, edgeType: "REF" }, "killer");
    expect(repo.queryEdges({ sourceId: a.id, edgeType: "REF" })).toHaveLength(0);
    expect(repo.queryEdges({ sourceId: a.id, edgeType: "CONTRIBUTED_TO" })).toHaveLength(1);
    const au = db.prepare("SELECT * FROM audit_log WHERE action='DELETE' AND entityType='edge'").all() as any[];
    expect(au.length).toBeGreaterThanOrEqual(1);
    expect(au[0].performedBy).toBe("killer");
  });
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd D:\fighting && npm run test:shared` (type error: deleteEdges not on Repository) and `cd D:\fighting/apps/backend && npx vitest run test/repository.test.ts` (FAIL: `repo.deleteEdges is not a function`).

- [ ] **Step 4: Implement contract**

In `packages/shared/src/repository.ts`, add to the `Repository` interface immediately after the existing `queryEdges(...)` line:
```ts
  deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): void;
```

- [ ] **Step 5: Implement SqliteRepository.deleteEdges**

In `apps/backend/src/repository.ts`, add this method after `queryEdges` (uses the same dynamic-filter shape as `queryEdges`; transactional + audited, mirroring `deleteNode`):
```ts
  deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): void {
    this.db.transaction(() => {
      const victims = this.queryEdges(opts);
      for (const e of victims) {
        this.db.prepare(`DELETE FROM edges WHERE id=?`).run(e.id);
        this.audit("DELETE", "edge", e.id, { edgeType: e.edgeType, sourceId: e.sourceId, targetId: e.targetId }, actor);
      }
    })();
  }
```
(`this.audit` is the private delegator to `logAudit` already in this class; `this.queryEdges(opts)` already supports `{sourceId?,targetId?,edgeType?}`.)

- [ ] **Step 6: Run, expect PASS**

Run: `cd D:\fighting && npm run test:shared` (all pass) ; `cd D:\fighting/apps/backend && npx vitest run test/repository.test.ts` (all pass incl. new) ; `cd D:\fighting/apps/backend && npx tsc -p tsconfig.json --noEmit` (zero errors) ; `cd D:\fighting/packages/shared && npx tsc -p tsconfig.json --noEmit` (zero errors).

- [ ] **Step 7: Commit**

```
git add packages/shared/src/repository.ts packages/shared/src/types.test.ts apps/backend/src/repository.ts apps/backend/test/repository.test.ts
git commit -m "feat(shared+storage): Repository.deleteEdges (tx + audited)"
```

---

## Task 2: Backend — refs.ts + route hooks + /api/related + seed + e2e  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:** Create `apps/backend/src/refs.ts`, `apps/backend/src/related.ts`, `apps/backend/test/refs.e2e.test.ts`; Modify `apps/backend/src/routes.ts`, `apps/backend/src/app.ts`, `config/schemas/attackTicket.json`, `config/schemas/contribution.json`.

- [ ] **Step 1: Write the failing e2e** `apps/backend/test/refs.e2e.test.ts`:
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
  const dir = mkdtempSync(join(tmpdir(), "combat-refs-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person" },
    ],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [
      { name: "贡献人", type: "ref", label: "贡献人", refType: "person", required: true },
      { name: "贡献类型", type: "string", label: "贡献类型" },
    ],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId", "email"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true },
             { name: "employeeId", type: "string", label: "工号" }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("refs e2e", () => {
  it("creating a node with a ref field resolves/creates the person and makes a REF edge", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连", 当前处理人: "张三" });
    expect(c.status).toBe(201);
    const persons = repo.queryNodes("person");
    expect(persons).toHaveLength(1);
    expect(persons[0].properties["name"]).toBe("张三");
    const edges = repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(persons[0].id);
    expect(edges[0].properties["field"]).toBe("当前处理人");
  });
  it("/api/related/person/:id returns nodes across views (attackTicket + contribution) referencing the person", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "张三" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献类型: "实施" });
    const pid = repo.queryNodes("person")[0].id;
    const r = await request(app).get(`/api/related/person/${pid}`);
    expect(r.status).toBe(200);
    const inTypes = r.body.incoming.map((x: any) => x.node.nodeType).sort();
    expect(inTypes).toEqual(["attackTicket", "contribution"]);
    const fields = r.body.incoming.map((x: any) => x.field).sort();
    expect(fields).toEqual(["当前处理人", "贡献人"]);
    expect(r.body.incoming.find((x: any) => x.node.nodeType === "attackTicket").node.id).toBe(c.body.id);
  });
  it("updating the ref field reuses existing person, deletes old REF edge, makes new — no dup/dangling", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T", 当前处理人: "张三" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "张三" }); // reuse 张三
    expect(repo.queryNodes("person")).toHaveLength(1);
    await request(app).put(`/api/nodes/${c.body.id}`).send({ 当前处理人: "李四" });
    const persons = repo.queryNodes("person");
    expect(persons.map(p => p.properties["name"]).sort()).toEqual(["张三", "李四"].sort());
    const edges = repo.queryEdges({ sourceId: c.body.id, edgeType: "REF" });
    expect(edges).toHaveLength(1);
    const li = persons.find(p => p.properties["name"] === "李四")!;
    expect(edges[0].targetId).toBe(li.id);
  });
  it("related unknown id -> 404", async () => {
    const { app } = makeApp();
    expect((await request(app).get("/api/related/person/nope")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting/apps/backend && npx vitest run test/refs.e2e.test.ts`
Expected: FAIL — no REF edge created on POST; `/api/related` 404 (route missing).

- [ ] **Step 3: Implement `apps/backend/src/refs.ts`**

```ts
import type { Repository, SchemaRegistry, GraphNode } from "@combat/shared";

export function syncRefEdges(
  repo: Repository, registry: SchemaRegistry, node: GraphNode,
  body: Record<string, unknown>, actor: string,
): void {
  const schema = registry.getNodeSchema(node.nodeType);
  if (!schema) return;
  repo.deleteEdges({ sourceId: node.id, edgeType: "REF" }, actor);
  for (const f of schema.fields) {
    if (f.type !== "ref" || !f.refType) continue;
    const raw = body[f.id];
    const v = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!v) continue;
    const candidates = repo.queryNodes(f.refType);
    const idKeys = registry.getNodeSchema(f.refType)?.identityKeys ?? [];
    let target = candidates.find(n => idKeys.some(k => String(n.properties[k] ?? "") === v))
      ?? candidates.find(n => String(n.properties["name"] ?? "") === v);
    if (!target) target = repo.createNode(f.refType, { name: v }, actor);
    repo.createEdge("REF", node.id, target.id, { field: f.id, refType: f.refType }, actor);
  }
}
```

- [ ] **Step 4: Implement `apps/backend/src/related.ts`**

```ts
import { Router } from "express";
import type { Repository } from "@combat/shared";

export function makeRelatedRouter(repo: Repository): Router {
  const r = Router();
  r.get("/related/:nodeType/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    const id = node.id;
    const out = repo.queryEdges({ sourceId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), node: repo.getNode(e.targetId) }))
      .filter(x => x.node);
    const inc = repo.queryEdges({ targetId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), node: repo.getNode(e.sourceId) }))
      .filter(x => x.node);
    res.json({ outgoing: out, incoming: inc });
  });
  return r;
}
```

- [ ] **Step 5: Wire routes + mount + seed.**

In `apps/backend/src/routes.ts`: add `import { syncRefEdges } from "./refs.js";` at top with the other imports. In the `POST /nodes/:nodeType` handler, after `const node = repo.createNode(nodeType, req.body, "api");` and after the existing contribution `CONTRIBUTED_TO` block, before `res.status(201).json(node);`, add:
```ts
    syncRefEdges(repo, registry, node, req.body, "api");
```
In the `PUT /nodes/:id` handler, after the `repo.updateNode(...)` call, capture the updated node and sync. The current PUT handler is:
```ts
  r.put("/nodes/:id", (req, res) => {
    const cur = repo.getNode(req.params.id);
    if (!cur) return res.status(404).json({ error: "not found" });
    const v = registry.validateNode(cur.nodeType, { ...cur.properties, ...req.body });
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    res.json(repo.updateNode(req.params.id, req.body, "api"));
  });
```
Replace its last line `res.json(repo.updateNode(req.params.id, req.body, "api"));` with:
```ts
    const updated = repo.updateNode(req.params.id, req.body, "api");
    syncRefEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");
    res.json(updated);
```
(Pass the MERGED props so a PUT that omits a ref field keeps resolving from the persisted value; `updateNode` already merges into storage, but `syncRefEdges` reads the passed body — give it the merged view.)

In `apps/backend/src/app.ts`: add `import { makeRelatedRouter } from "./related.js";` and mount `app.use("/api", makeRelatedRouter(deps.repo));` AFTER the existing makeRouter/makeImportRouter/makeHonorRouter/makeExportRouter mounts and BEFORE the global error middleware.

In `config/schemas/attackTicket.json`: the `当前处理人` field object — change its `"type"` from `"string"` to `"ref"` and add `"refType": "person"` (keep `id`/`name`/`label`/any `aliases`). In `config/schemas/contribution.json`: the `贡献人` field object — change `"type"` to `"ref"`, add `"refType": "person"` (keep `id`/`name`/`label`/`required`). Change ONLY those two field objects; all other JSON byte-identical; UTF-8 no BOM; Chinese intact.

- [ ] **Step 6: Run, expect PASS + full backend + tsc**

Run: `cd D:\fighting/apps/backend && npx vitest run test/refs.e2e.test.ts && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: refs 4/4 PASS; full backend suite all green. **Regression note:** `honor.e2e.test.ts` posts contributions with `贡献人` and asserts CONTRIBUTED_TO + leaderboard; making `贡献人` a ref additionally creates a person + REF edge but does NOT remove/alter CONTRIBUTED_TO (different edgeType) nor change `contribution.properties["贡献人"]` (the string value is still stored by createNode before syncRefEdges runs). Honor leaderboard reads `c.properties["贡献人"]` — still the string. So honor.e2e must still pass unchanged. If it regresses, the cause is real (e.g. validateNode rejecting ref) — fix refs.ts/seed, never the honor tests. tsc zero errors.

- [ ] **Step 7: Commit**

```
git add apps/backend/src/refs.ts apps/backend/src/related.ts apps/backend/src/routes.ts apps/backend/src/app.ts config/schemas/attackTicket.json config/schemas/contribution.json apps/backend/test/refs.e2e.test.ts
git commit -m "feat(refs): ref-field -> entity REF edge sync on write + GET /api/related 1-hop + seed ref fields"
```

---

## Task 3: Frontend — RelatedPage + api.getRelated + entry points + e2e  *(Wave 1 — Track B)*

**Depends on:** Task 1 (contract). For the Playwright e2e (Step 7) it needs Task 2's live backend — if running tracks truly in parallel, merge Track A into this track before Step 7 (as the alias increment did) or run the e2e at the gate.

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/api.test.ts`, `apps/frontend/src/pages/EntityTable.tsx`, `apps/frontend/src/pages/AttackDetail.tsx`, `apps/frontend/src/App.tsx`; Create `apps/frontend/src/pages/RelatedPage.tsx`, `apps/frontend/src/pages/RelatedPage.test.tsx`, `apps/frontend/e2e/related.spec.ts`.

- [ ] **Step 1: Write failing unit tests.**

Append to `apps/frontend/src/api.test.ts` inside `describe("Api client")`:
```ts
  it("getRelated hits the related endpoint", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify({ outgoing: [], incoming: [] }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.getRelated("person", "p1");
    expect(calls[0]).toBe("http://x/api/related/person/p1");
  });
```
Create `apps/frontend/src/pages/RelatedPage.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { RelatedPage } from "./RelatedPage.js";
describe("RelatedPage", () => {
  it("is exported as a component function", () => {
    expect(typeof RelatedPage).toBe("function");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting/apps/frontend && npx vitest run src/api.test.ts src/pages/RelatedPage.test.tsx`
Expected: FAIL — `api.getRelated` not a function / `./RelatedPage.js` missing.

- [ ] **Step 3: Implement api.getRelated + types**

In `apps/frontend/src/api.ts`: add a `RelatedResult` type and a method. Add near the top type imports (the file imports types from `@combat/shared`; `GraphNode` is already imported there). Add this exported interface above the `Api` class:
```ts
export interface RelatedResult {
  outgoing: { field: string; node: GraphNode }[];
  incoming: { field: string; node: GraphNode }[];
}
```
Add this method to the `Api` class (before `importXlsx`):
```ts
  getRelated(nodeType: string, id: string): Promise<RelatedResult> {
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}`, {});
  }
```

- [ ] **Step 4: Implement `apps/frontend/src/pages/RelatedPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { List, Typography } from "antd";
import { api } from "../api.js";
import type { RelatedResult } from "../api.js";
import type { GraphNode } from "@combat/shared";

function detailLink(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
function label(n: GraphNode): string {
  return String(n.properties["标题"] ?? n.properties["name"] ?? n.properties["贡献人"] ?? n.id);
}

export function RelatedPage() {
  const { nodeType = "", id = "" } = useParams();
  const [data, setData] = useState<RelatedResult | null>(null);
  useEffect(() => { api.getRelated(nodeType, id).then(setData); }, [nodeType, id]);
  const all = [
    ...(data?.incoming ?? []).map(x => ({ ...x, dir: "← 引用本节点" })),
    ...(data?.outgoing ?? []).map(x => ({ ...x, dir: "→ 本节点引用" })),
  ];
  const groups: Record<string, typeof all> = {};
  for (const x of all) (groups[x.node.nodeType] ??= []).push(x);
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>关联全景：{nodeType} / {id}</Typography.Title>
      {Object.keys(groups).length === 0 && <p role="status">暂无关联</p>}
      {Object.entries(groups).map(([nt, items]) => (
        <div key={nt} style={{ marginBottom: 16 }}>
          <Typography.Title level={5}>{nt}（{items.length}）</Typography.Title>
          <List size="small" dataSource={items} rowKey={(x) => x.node.id + x.field + x.dir}
            renderItem={(x) => (
              <List.Item>
                <Link to={detailLink(x.node)}>{label(x.node)}</Link>
                <span style={{ marginLeft: 8, color: "#888" }}>[{x.field}] {x.dir}</span>
              </List.Item>
            )} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire route + entry points**

In `apps/frontend/src/App.tsx`: add `import { RelatedPage } from "./pages/RelatedPage.js";` with the other page imports, and add a route inside `<Routes>` (after the `/honor/:name` route, before `/import`):
```tsx
          <Route path="/related/:nodeType/:id" element={<RelatedPage />} />
```

In `apps/frontend/src/pages/EntityTable.tsx`: the per-field cell `render` non-editing branch currently is:
```tsx
        const val = String(r.properties[f.id] ?? "");
        return linkField && linkTo && f.id === linkField ? <Link to={linkTo(r.id)}>{val}</Link> : val;
```
Replace those two lines with (ref fields become a link to this row's relations page; existing linkField behavior preserved; otherwise plain value):
```tsx
        const val = String(r.properties[f.id] ?? "");
        if (linkField && linkTo && f.id === linkField) return <Link to={linkTo(r.id)}>{val}</Link>;
        if (f.type === "ref") return <Link aria-label={`ref-${f.id}`} to={`/related/${nodeType}/${r.id}`}>{val}</Link>;
        return val;
```
(`Link` and `nodeType` are already in scope in EntityTable.)

In `apps/frontend/src/pages/AttackDetail.tsx`: it renders an attack ticket detail using `useParams` `id`. Add a relations link near its heading. Locate the JSX return; immediately after the page title/heading element add:
```tsx
      <p><Link to={`/related/attackTicket/${id}`} aria-label="related-link">关联全景</Link></p>
```
Ensure `Link` is imported from `react-router-dom` in AttackDetail.tsx (it already imports `useParams` from there — extend the import to `{ useParams, Link }` if `Link` is not already imported; do not change anything else).

- [ ] **Step 6: Run unit + build**

Run: `cd D:\fighting/apps/frontend && npx vitest run && npx vite build`
Expected: all frontend unit green (api getRelated + RelatedPage smoke + existing); vite build succeeds (antd chunk warning OK).

- [ ] **Step 7: Playwright e2e**

Create `apps/frontend/e2e/related.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-R1 ref field creates a cross-view relation reachable from the relations page", async ({ page, request }) => {
  // seed: an attack ticket whose 当前处理人 (ref->person) is 王五, and a contribution by 王五
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "关联攻关单", 状态: "进行中", 当前处理人: "王五" } })).json();
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "王五", 贡献类型: "实施", 贡献等级: "核心" } });
  // from the attack ticket's relations page, the ref points out to 王五
  await page.goto(`/related/attackTicket/${t.id}`);
  await expect(page.getByText("关联全景", { exact: false })).toBeVisible();
  await expect(page.getByText("person", { exact: false })).toBeVisible();
  // drill into 王五 -> sees both the attackTicket and the contribution (cross-view)
  await page.getByRole("link", { name: "王五" }).first().click();
  await expect(page).toHaveURL(/\/related\/person\//);
  await expect(page.getByText("attackTicket", { exact: false })).toBeVisible();
  await expect(page.getByText("contribution", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "关联攻关单" })).toBeVisible();
});
```
Run: `cd D:\fighting/apps/frontend && npx playwright test related.spec.ts` → FAIL first (until Task 2 backend present in this worktree — if parallel, merge Track A here first). Then make it pass. Then run the WHOLE suite: `npx playwright test` → ALL pass (attack 2 + editable 2 + export 1 + honor 2 + aliases 1 + related 1 = 9). Run again immediately → all pass (determinism). If a stale :3001/:5173 process holds the port, kill it (`netstat -ano | grep LISTENING | grep :PORT` → `taskkill //F //PID <pid>`) and retry; never weaken assertions; never edit other specs. After runs, `cd D:\fighting && git checkout -- config/schemas/` (e2e mutates by design — but the ref seed is committed; restore brings back the committed seed).

- [ ] **Step 8: Commit**

```
git add apps/frontend/src/api.ts apps/frontend/src/api.test.ts apps/frontend/src/pages/RelatedPage.tsx apps/frontend/src/pages/RelatedPage.test.tsx apps/frontend/src/pages/EntityTable.tsx apps/frontend/src/pages/AttackDetail.tsx apps/frontend/src/App.tsx apps/frontend/e2e/related.spec.ts
git commit -m "feat(ui): RelatedPage + api.getRelated + ref-cell/AttackDetail relations links + Playwright FE-R1"
```

---

## Task 4: Gate — test:all + acceptance + tag + deploy

- [ ] **Step 1: Full aggregate**

Run: `cd D:\fighting` then kill any stale :3001/:5173 listeners (`netstat -ano | grep LISTENING | grep -E ":3001|:5173"` → `taskkill //F //PID <pid>`), then `git checkout -- config/schemas/` (ensure committed seed, clean tree), then `npm run test:all`.
Expected ALL green: shared (+ref-edge contract) + backend (+repository deleteEdges +refs.e2e 4) + frontend-unit (+getRelated +RelatedPage smoke) + frontend-e2e 9. Then `git checkout -- config/schemas/`. If any suite red → STOP, report BLOCKED with root cause; do not weaken tests.

- [ ] **Step 2: Verify PRD §18.7 acceptance** — map each box to a green test:
  - `Repository.deleteEdges` (tx+audit) → Task 1 shared + repository.test deleteEdges
  - write ref field → resolve/create person + REF edge → `refs.e2e` test 1
  - cross-view `/api/related/person/:id` returns attackTicket + contribution → `refs.e2e` test 2
  - update ref → old edge deleted, new made, reuse person, no dup; unknown id 404 → `refs.e2e` tests 3 & 4
  - relations page grouped + drill-down; AttackDetail & ref-cell entry → `related.spec` FE-R1
  - test:all green → Step 1
  State explicitly: all covered & green (yes/no).

- [ ] **Step 3: Tag**

```
cd D:\fighting
git checkout -- config/schemas/ 2>/dev/null || true
git commit --allow-empty -m "chore: increment-3a (ref->entity edges + cross-view relations) acceptance verified — test:all green (PRD §18.7)"
git tag increment-3a-ref-edges
```

- [ ] **Step 4: Deploy**

Run: `cd D:\fighting/scripts/deploy && node deploy.mjs deploy`
Confirm runner ends `DEPLOY_DONE` with health `backend=200 frontend=200`. Verify live via `http://www.catown.cloud:5173/`. (Standing deploy principle; creds from gitignored `.env.deploy`.)

- [ ] **Step 5: Report** — increment complete; test:all counts; deploy health; the open URL.

---

## Self-Review

**1. Spec coverage (PRD §18):**
- 18.1 `Repository.deleteEdges` (tx+audit) → Task 1 ✓
- 18.2 `refs.ts syncRefEdges` (deleteEdges-first, ref fields, exact identityKey/name resolve else create, single REF edge w/ properties.field/refType) + POST/PUT one-line hooks (PUT passes merged props; contribution CONTRIBUTED_TO untouched) → Task 2 ✓
- 18.3 `GET /api/related/:nodeType/:id` (404 unknown; outgoing/incoming {field,node}) + mount before error mw → Task 2 ✓
- 18.4 seed attackTicket.当前处理人 + contribution.贡献人 → ref/person; others byte-identical; validateNode unaffected → Task 2 ✓ (regression reasoning for honor.e2e documented)
- 18.5 `/related/:nodeType/:id` page grouped-by-nodeType + drill; entry: AttackDetail 关联全景 link + EntityTable ref-cell link to `/related/${nodeType}/${rowId}` → Task 3 ✓
- 18.6 decisions reflected; 18.7 acceptance → Task 4 maps each ✓
- 18.0 decomposition: 3b/3c/3d/depth-N/conflict/standalone-KG explicitly NOT built ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Full code shown for refs.ts, related.ts, RelatedPage.tsx, the exact route-hook edits (with current handler text quoted), seed field edits, every test. Contingency in Task 3 Step 7 (merge Track A if parallel) is a concrete instruction mirroring the alias increment, not a placeholder; the e2e is real and the suite must be green twice.

**3. Type consistency:** `deleteEdges(opts:{sourceId?,targetId?,edgeType?}, actor)` identical in Task 1 shared decl, SqliteRepository impl, refs.ts call. `REF` edge with `properties:{field,refType}` consistent across refs.ts (write), related.ts (`e.properties["field"]` read), refs.e2e assertions, RelatedPage (`x.field`), api `RelatedResult` ({outgoing,incoming}:{field,node}[]) matches related.ts response and RelatedPage consumption and api.test. `syncRefEdges(repo,registry,node,body,actor)` signature identical in refs.ts def and both route call sites. `getRelated(nodeType,id)` identical in api.ts, api.test, RelatedPage. Route `/api/related/:nodeType/:id` identical in related.ts, refs.e2e, api.ts, RelatedPage param usage, related.spec. `f.type==="ref"`/`f.refType` consistent with `FieldSchema` (Increment-1 type, `refType?` already present). EntityTable ref-cell uses in-scope `nodeType`/`Link`. App route param names `:nodeType/:id` match `useParams()` in RelatedPage.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-ref-entity-edges.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, parallel Wave-1 worktrees (Task 2 ‖ Task 3).
**2. Inline Execution** — executing-plans with checkpoints.

Which approach?
