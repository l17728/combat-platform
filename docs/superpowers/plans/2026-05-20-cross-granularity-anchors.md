# 增量3d — 跨颗粒度共享最细锚点派生关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Config-tagged anchor fields derive shared atomic anchor entities + typed `ANCHORED_TO` edges at write time (idempotent); coarse view rows are NOT interconnected directly — cross-granularity association is DERIVED from sharing the same anchor (node→anchor→other-view-node), surfaced as a separate `coAnchored` group + 2-hop drill, plus a UI 锚点 field editor. Resolves PRD §13#8.

**Architecture:** Mirrors 3a (`refs.ts syncRefEdges` → new `anchors.ts syncAnchorEdges`) + 3b (`setConcept` → `setAnchor`, 概念 editor → 锚点 editor). KG stays derived/authoritative-write-only/audited. Backend (T2) and frontend (T3) are disjoint → parallel after the shared contract gate (T1).

**Tech Stack:** Node+TS+Express+better-sqlite3, React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §21 is the basis.

---

## File Structure

- `packages/shared/src/types.ts` — `FieldSchema.anchor?` (T1)
- `packages/shared/src/registry.ts` — `FieldOp` `setAnchor` variant (T1)
- `packages/shared/src/types.test.ts` — contract test (T1)
- `apps/backend/src/registry.ts` — `applyFieldOp` setAnchor branch (T2)
- `apps/backend/src/anchors.ts` — NEW `syncAnchorEdges` (T2)
- `apps/backend/src/routes.ts` — call `syncAnchorEdges` after each `syncRefEdges` (T2)
- `apps/backend/src/related.ts` — fold `ANCHORED_TO` into outgoing/incoming + derive `coAnchored` (T2)
- `config/schemas/attackTicket.json`, `config/schemas/contribution.json` — seed anchor fields (T2)
- `apps/backend/test/anchor.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — `RelatedResult.coAnchored?` (T3)
- `apps/frontend/src/pages/RelatedPage.tsx` — 跨颗粒度（共享锚点）group (T3)
- `apps/frontend/src/pages/EntityTable.tsx` — 锚点 column-header editor (T3)
- `apps/frontend/e2e/anchor.spec.ts` — NEW FE e2e (T3)

---

## Task 1: Shared contracts (SERIAL GATE)

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/registry.ts`, `packages/shared/src/types.test.ts`

- [ ] **Step 1: Failing test** — append to `packages/shared/src/types.test.ts` (add `FieldSchema, FieldOp` to imports if absent):

```ts
describe("anchor contracts", () => {
  it("FieldSchema.anchor? + FieldOp setAnchor", () => {
    const f: FieldSchema = { id: "问题单号", name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" };
    expect(f.anchor).toBe("问题单号");
    const op: FieldOp = { op: "setAnchor", id: "问题单号", anchor: "问题单号" };
    expect(op.op).toBe("setAnchor");
  });
});
```

- [ ] **Step 2: Run `npm run test:shared`** — expect tsc/type FAIL (run `npx tsc -p packages/shared/tsconfig.json --noEmit` to confirm RED, since vitest alone does not typecheck).

- [ ] **Step 3:** in `packages/shared/src/types.ts` `FieldSchema` interface, append after `concept?: string;`:

```ts
  anchor?: string;
```

- [ ] **Step 4:** in `packages/shared/src/registry.ts` `FieldOp` union, append after the `setConcept` member:

```ts
  | { op: "setAnchor"; id: string; anchor: string };
```

(the `setConcept` line currently ends the union with `;` — change it to `}` continuation: ensure final union member ends with `;`. Concretely the union becomes: `... | { op: "setConcept"; id: string; concept: string } | { op: "setAnchor"; id: string; anchor: string };`)

- [ ] **Step 5:** `npm run test:shared` green; `npx tsc -p packages/shared/tsconfig.json --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/registry.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): FieldSchema.anchor + FieldOp setAnchor (3d-T1)"
```

---

## Task 2: Backend — anchor derivation + typed edges + coAnchored (PARALLEL, after T1)

**Files:** Modify `apps/backend/src/registry.ts`, `apps/backend/src/routes.ts`, `apps/backend/src/related.ts`, `config/schemas/attackTicket.json`, `config/schemas/contribution.json`; Create `apps/backend/src/anchors.ts`, `apps/backend/test/anchor.e2e.test.ts`

- [ ] **Step 1: Failing e2e** — create `apps/backend/test/anchor.e2e.test.ts`:

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
  const dir = mkdtempSync(join(tmpdir(), "combat-anchor-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "问题单号", type: "string", label: "问题单号", anchor: "问题单号" }],
  }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [{ name: "贡献人", type: "string", label: "贡献人", required: true },
      { name: "关联问题单", type: "string", label: "关联问题单", anchor: "问题单号" }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, cfg };
}

describe("cross-granularity anchor e2e", () => {
  it("anchor field → shared anchor node + ANCHORED_TO edge with anchorKind", async () => {
    const { app, repo } = makeApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 问题单号: "PB-1" });
    expect(c.status).toBe(201);
    const anchors = repo.queryNodes("问题单号");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].properties["key"]).toBe("PB-1");
    const e = repo.queryEdges({ sourceId: c.body.id, edgeType: "ANCHORED_TO" })[0];
    expect(e.targetId).toBe(anchors[0].id);
    expect(e.properties["anchorKind"]).toBe("问题单号");
  });

  it("differently-named anchor fields, same value → ONE shared anchor; no direct coarse-coarse edge; coAnchored derived & symmetric", async () => {
    const { app, repo } = makeApp();
    const at = await request(app).post("/api/nodes/attackTicket").send({ 标题: "AT", 问题单号: "PB-9" });
    const co = await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 关联问题单: "PB-9" });
    expect(repo.queryNodes("问题单号")).toHaveLength(1); // shared atom
    // no direct coarse↔coarse edge
    expect(repo.queryEdges({ sourceId: at.body.id, targetId: co.body.id })).toHaveLength(0);
    expect(repo.queryEdges({ sourceId: co.body.id, targetId: at.body.id })).toHaveLength(0);
    const relAt = await request(app).get(`/api/related/attackTicket/${at.body.id}`);
    expect(relAt.body.coAnchored.map((x: any) => x.node.id)).toContain(co.body.id);
    expect(relAt.body.coAnchored[0].anchorKind).toBe("问题单号");
    expect(relAt.body.coAnchored[0].anchorKey).toBe("PB-9");
    const relCo = await request(app).get(`/api/related/contribution/${co.body.id}`);
    expect(relCo.body.coAnchored.map((x: any) => x.node.id)).toContain(at.body.id); // symmetric
  });

  it("no anchor data → coAnchored []; ANCHORED_TO foldable into related outgoing", async () => {
    const { app } = makeApp();
    const at = await request(app).post("/api/nodes/attackTicket").send({ 标题: "noAnchor" });
    const rel = await request(app).get(`/api/related/attackTicket/${at.body.id}`);
    expect(rel.body.coAnchored).toEqual([]);
    const at2 = await request(app).post("/api/nodes/attackTicket").send({ 标题: "withA", 问题单号: "PB-2" });
    const rel2 = await request(app).get(`/api/related/attackTicket/${at2.body.id}`);
    // anchor node appears in outgoing (2-hop drill, reuses 3a/3b shape)
    expect(rel2.body.outgoing.some((x: any) => x.node.nodeType === "问题单号")).toBe(true);
  });

  it("PATCH setAnchor persists + reload; non-string → 400 + config unchanged; update re-syncs idempotently", async () => {
    const { app, cfg } = makeApp();
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "setAnchor", id: "标题", anchor: "问题单号" });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "标题").anchor).toBe("问题单号");
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const bad = await request(app).patch("/api/schema/attackTicket").send({ op: "setAnchor", id: "标题" });
    expect(bad.status).toBe(400);
    const bad2 = await request(app).patch("/api/schema/attackTicket").send({ op: "setAnchor", id: "标题", anchor: 7 });
    expect(bad2.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);

    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "U", 问题单号: "PB-A" });
    await request(app).put(`/api/nodes/${t.body.id}`).send({ 问题单号: "PB-B" });
    const rel = await request(app).get(`/api/related/attackTicket/${t.body.id}`);
    const keys = rel.body.outgoing.filter((x: any) => x.node.nodeType === "问题单号").map((x: any) => x.node.properties["key"]);
    expect(keys).toEqual(["PB-B"]); // old ANCHORED_TO removed, new one only (idempotent)
  });
});
```

- [ ] **Step 2: Run** `cd apps/backend && npx vitest run anchor.e2e` → FAIL.

- [ ] **Step 3: registry setAnchor** — in `apps/backend/src/registry.ts` `applyFieldOp`, after the `setConcept` branch and before the final `else`:

```ts
    } else if (op.op === "setAnchor") {
      if (typeof op.anchor !== "string") throw new Error("setAnchor 需要 anchor 字符串");
      find(op.id).anchor = op.anchor;
```

- [ ] **Step 4: anchors.ts** — create `apps/backend/src/anchors.ts`:

```ts
import type { Repository, SchemaRegistry, GraphNode } from "@combat/shared";

export function syncAnchorEdges(
  repo: Repository, registry: SchemaRegistry, node: GraphNode,
  body: Record<string, unknown>, actor: string,
): void {
  const schema = registry.getNodeSchema(node.nodeType);
  if (!schema) return;
  repo.deleteEdges({ sourceId: node.id, edgeType: "ANCHORED_TO" }, actor);
  for (const f of schema.fields) {
    if (!f.anchor) continue;
    const raw = body[f.id];
    const v = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!v) continue;
    const existing = repo.queryNodes(f.anchor).find(n => String(n.properties["key"] ?? "") === v);
    const anchor = existing ?? repo.createNode(f.anchor, { key: v }, actor);
    repo.createEdge("ANCHORED_TO", node.id, anchor.id, { anchorKind: f.anchor, field: f.id }, actor);
  }
}
```

- [ ] **Step 5: wire in routes.ts** — add `import { syncAnchorEdges } from "./anchors.js";`. After the `syncRefEdges(repo, registry, node, req.body, "api");` line (POST), add:

```ts
    syncAnchorEdges(repo, registry, node, req.body, "api");
```

After the `syncRefEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");` line (PUT), add:

```ts
    syncAnchorEdges(repo, registry, updated, { ...cur.properties, ...req.body }, "api");
```

- [ ] **Step 6: related.ts ANCHORED_TO + coAnchored** — replace the body of the `/related/:nodeType/:id` handler's edge section. Replace:

```ts
    const out = repo.queryEdges({ sourceId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.targetId) }))
      .filter(x => x.node);
    const inc = repo.queryEdges({ targetId: id, edgeType: "REF" })
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.sourceId) }))
      .filter(x => x.node);
```

with:

```ts
    const isRel = (t: string) => t === "REF" || t === "ANCHORED_TO";
    const out = repo.queryEdges({ sourceId: id }).filter(e => isRel(e.edgeType))
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.targetId) }))
      .filter(x => x.node);
    const inc = repo.queryEdges({ targetId: id }).filter(e => isRel(e.edgeType))
      .map(e => ({ field: String(e.properties["field"] ?? ""), concept: String(e.properties["concept"] ?? ""), node: repo.getNode(e.sourceId) }))
      .filter(x => x.node);
    const coAnchored: { anchorKind: string; anchorKey: string; node: unknown }[] = [];
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
```

Then change BOTH `res.json(...)` calls to include `coAnchored`:
- the `includeCandidates` branch: `return res.json({ outgoing: out, incoming: inc, candidates: cand, coAnchored });`
- the default: `res.json({ outgoing: out, incoming: inc, coAnchored });`

- [ ] **Step 7: seed** — in `config/schemas/attackTicket.json` add to `fields` array a new object `{ "id": "问题单号", "name": "问题单号", "type": "string", "label": "问题单号", "anchor": "问题单号" }`. In `config/schemas/contribution.json` add `{ "id": "关联问题单", "name": "关联问题单", "type": "string", "label": "关联问题单", "anchor": "问题单号" }`. Append only; do not reformat or alter other fields/bytes; keep Chinese verbatim.

- [ ] **Step 8: Run** `cd apps/backend && npx vitest run` → ALL green (prior 59 + anchor.e2e 4 = 63), then `npx tsc -p tsconfig.json --noEmit` clean. Fix logic (never weaken tests) until green.

- [ ] **Step 9: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true   # discard e2e seed mutations only; keep your intentional Step-7 edits staged explicitly:
git add apps/backend/src/registry.ts apps/backend/src/anchors.ts apps/backend/src/routes.ts apps/backend/src/related.ts apps/backend/test/anchor.e2e.test.ts config/schemas/attackTicket.json config/schemas/contribution.json
git commit -m "feat(backend): config anchor fields → shared-anchor nodes + ANCHORED_TO edges + derived coAnchored (3d-T2)"
```

(Note: run the `git checkout` BEFORE re-adding, OR simply `git add` only the listed files — the Step-7 seed edits to attackTicket.json/contribution.json ARE intentional and must be committed; verify with `git diff --cached config/schemas/` that exactly the two anchor-field additions are staged.)

---

## Task 3: Frontend — 跨颗粒度 group + 锚点 editor (PARALLEL, after T1)

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/pages/RelatedPage.tsx`, `apps/frontend/src/pages/EntityTable.tsx`; Create `apps/frontend/e2e/anchor.spec.ts`

- [ ] **Step 1: api.ts** — extend `RelatedResult`:

```ts
  coAnchored?: { anchorKind: string; anchorKey: string; node: GraphNode }[];
```

(append inside the `RelatedResult` interface; no method changes — `patchSchema` is a generic passthrough already covering `setAnchor`.)

- [ ] **Step 2: RelatedPage 跨颗粒度 group** — in `apps/frontend/src/pages/RelatedPage.tsx`, after the candidate block `)}` and before the outer `</div>`, add:

```tsx
      {data?.coAnchored && data.coAnchored.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #1677ff", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#1677ff" }}>跨颗粒度（共享锚点）</Typography.Title>
          <List size="small" dataSource={data.coAnchored}
            rowKey={(c) => c.node.id + c.anchorKind + c.anchorKey}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#1677ff" }}>[{c.anchorKind}:{c.anchorKey}]</span>
              </List.Item>
            )} />
        </div>
      )}
```

(`getRelated` already returns `coAnchored` by default — no call-site change needed. `List`, `Typography`, `Link`, `detailLink`, `label` already imported/defined.)

- [ ] **Step 3: EntityTable 锚点 editor** — in `apps/frontend/src/pages/EntityTable.tsx`:
  - add state next to `cp`: `const [an, setAn] = useState<{ id: string; text: string } | null>(null);`
  - in the column-header `<Space>`, after the 概念 Button, add:

```tsx
          <Button aria-label={`anchor-${f.id}`} size="small" type="link"
            onClick={() => setAn({ id: f.id, text: f.anchor ?? "" })}>锚点</Button>
```

  - after the 概念 `<Modal>`, add:

```tsx
      <Modal title="编辑锚点" open={an !== null} okText="确定" onCancel={() => setAn(null)}
        onOk={async () => {
          if (an) await patch({ op: "setAnchor", id: an.id, anchor: an.text.trim() });
          setAn(null);
        }}>
        <Input aria-label="anchor-input" value={an?.text ?? ""}
          onChange={e => setAn(s => (s ? { ...s, text: e.target.value } : s))} />
      </Modal>
```

- [ ] **Step 4: Run** `cd apps/frontend && npx vitest run` (expect 13 still green) and `npx vite build` (green).

- [ ] **Step 5: e2e** — create `apps/frontend/e2e/anchor.spec.ts` (NOT run here; runs at gate):

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-AN1 cross-granularity: shared anchor surfaces a separate 跨颗粒度 group", async ({ page, request }) => {
  const at = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "锚点攻关单", 状态: "进行中", 问题单号: "PBX-1" } })).json();
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "锚点贡献人", 关联问题单: "PBX-1" } });
  await page.goto(`/related/attackTicket/${at.id}`);
  await expect(page.getByRole("heading", { name: "跨颗粒度（共享锚点）" })).toBeVisible();
  await expect(page.getByText("[问题单号:PBX-1]", { exact: false })).toBeVisible();
});

test("FE-AN2 锚点 editor persists via schema endpoint", async ({ page }) => {
  await page.goto("/attack");
  await page.getByLabel("anchor-标题").click();
  await page.getByLabel("anchor-input").fill("问题单号");
  await page.getByRole("button", { name: "确定" }).click();
  await expect.poll(async () => {
    const s = await (await page.request.get(`${API}/api/schema/attackTicket`)).json();
    return s.fields.find((f: any) => f.id === "标题")?.anchor ?? "";
  }).toBe("问题单号");
  // teardown: clear so the shared single-backend run can't leak this seed mutation
  await page.request.patch(`${API}/api/schema/attackTicket`, { data: { op: "setAnchor", id: "标题", anchor: "" } });
});
```

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/pages/RelatedPage.tsx apps/frontend/src/pages/EntityTable.tsx apps/frontend/e2e/anchor.spec.ts
git commit -m "feat(ui): 跨颗粒度（共享锚点）related group + 锚点 field editor (3d-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (`--no-ff`); integrated verify: backend `npx vitest run` (expect 63), backend tsc clean, frontend `npx vitest run` (13), `npm run test:shared` (12), frontend `npx vite build` green. Clean worktrees; `git checkout -- config/schemas/` (the COMMITTED seed anchor fields persist via git; only e2e runtime mutations are discarded).
- [ ] Spec-compliance review (T2, T3) vs PRD §21 concurrently; then code-quality review; implementer-fix loop until both ✅.
- [ ] Coverage-audit (§18): every 3d user-visible feature × spec; fill gaps (e.g. setAnchor non-string→400 already backend-tested; ensure FE 锚点 editor + 跨颗粒度 group + 2-hop drill covered; no-anchor empty case).
- [ ] Pre-clear stale :3001/:5173 (PowerShell `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen | Stop-Process -Force`), `git checkout -- config/schemas/`, then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §21.6 (8 items) → evidence; flip `- [ ]`→`- [x]`; acceptance commit.
- [ ] `git tag -a increment-3d-anchors -m "increment-3d …"`.
- [ ] Deploy `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ 200 + deploy.log backend=200 frontend=200.
- [ ] Final code-review of whole 3d branch; finishing-a-development-branch.

---

## Self-Review

1. **§21.6 coverage:** ① shared anchor?/setAnchor → T1. ② anchor write → shared node+ANCHORED_TO+anchorKind / idempotent re-sync → T2 e2e #1,#4. ③ differently-named same value → one shared anchor + no coarse-coarse edge → T2 #2. ④ derived coAnchored symmetric / [] when none → T2 #2,#3. ⑤ PATCH setAnchor persist+reload, non-string→400 → T2 #4. ⑥ EntityTable 锚点 editor persists → T3 FE-AN2. ⑦ RelatedPage separate 跨颗粒度 group + 2-hop drill (anchor in outgoing) → T3 FE-AN1 + T2 #3. ⑧ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none; all code complete; anchor kinds locked in §21.1.
3. **Type consistency:** `FieldSchema.anchor?` (T1) used by anchors.ts/registry (T2) + EntityTable (T3); `RelatedResult.coAnchored?` shape `{anchorKind,anchorKey,node}` identical in related.ts emit (T2) and api.ts (T3) and RelatedPage render. `setAnchor` op shape identical in registry FieldOp (T1), applyFieldOp branch (T2), patch call (T3). `key` is the anchor node's identity property in anchors.ts and asserted in T2 #1/#4.
4. **Determinism / shared-backend safety:** anchor.spec FE-AN2 mutates a seed field's anchor but self-restores in teardown (mirrors 3b FE-C1 lesson); FE-AN1 uses unique data; deterministic. §0.3 invariant: coAnchored derived at read (not persisted); ANCHORED_TO derived at write from structured field (single authoritative path, audited via repo primitives) — coarse objects never directly interconnected.
