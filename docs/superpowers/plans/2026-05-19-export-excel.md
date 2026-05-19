# Server-Side Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/export/:nodeType` returning an xlsx of all records of that nodeType (active fields, label headers, id-keyed values) and an "导出 Excel" download button in EntityTable.

**Architecture:** Reuse the existing backend `xlsx` (SheetJS) dependency. A new `makeExportRouter(repo, registry)` flattens `queryNodes(nodeType)` rows to `{ [field.label]: properties[field.id] }` over non-retired schema fields, writes a workbook buffer, and streams it as an attachment. Frontend adds a plain `<a href download>` button to the shared `EntityTable`, so `/attack` and `/contributions` both get export with zero new frontend deps.

**Tech Stack:** Node 20 + TypeScript, Express, xlsx (SheetJS), Vite + React + Ant Design; tests = Vitest + supertest (backend) + Playwright (frontend e2e), reusing the existing deterministic harness.

---

## Spec Source

Implements PRD §16 (16.1–16.5). Decisions locked in §16.4: server endpoint; full export (ignore UI filter); header=active field label, value by field.id; retired fields excluded; no auth; no client-side/styled export (YAGNI).

---

## Parallel Execution Map

Two tasks with a true dependency (frontend e2e in Task 2 needs the live endpoint from Task 1). Sequential; no worktree split warranted for a 2-task increment.

```
Task 1 (backend): export router + mount + backend e2e        [serial]
Task 2 (frontend): EntityTable export button + Playwright e2e [needs Task 1]
Gate:  test:all green + §16.5 acceptance + tag + deploy
```

---

## File Structure

```
apps/backend/src/export.ts          # NEW: makeExportRouter(repo, registry)
apps/backend/src/app.ts             # MOD: mount export router before error mw
apps/backend/test/export.e2e.test.ts# NEW: backend export e2e
apps/frontend/src/pages/EntityTable.tsx # MOD: add 导出 Excel anchor button
apps/frontend/e2e/export.spec.ts    # NEW: Playwright download e2e
```

Existing Playwright `attack.spec.ts`/`editable.spec.ts`/`honor.spec.ts` must keep passing UNMODIFIED.

---

## Task 1: Backend export router + mount + e2e

**Files:**
- Create: `apps/backend/src/export.ts`
- Modify: `apps/backend/src/app.ts`
- Test: `apps/backend/test/export.e2e.test.ts`

- [ ] **Step 1: Write the failing e2e**

`apps/backend/test/export.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-export-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "enum", label: "状态", enumValues: ["进行中", "已解决"] },
      { name: "退休字段", type: "string", label: "退休字段", retired: true },
    ],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("export e2e", () => {
  it("GET /api/export/:nodeType returns an xlsx attachment of all rows, label headers, id values, no retired", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "单A", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "单B", 状态: "已解决" });
    const r = await request(app).get("/api/export/attackTicket").buffer().parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="attackTicket-.*\.xlsx"/);
    const wb = XLSX.read(r.body, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(2);
    expect(rows.map(x => x["标题"]).sort()).toEqual(["单A", "单B"]);
    expect(rows[0]).toHaveProperty("状态");
    expect(rows.some(x => "退休字段" in x)).toBe(false);
  });
  it("unknown nodeType -> 404", async () => {
    const { app } = makeApp();
    const r = await request(app).get("/api/export/nope");
    expect(r.status).toBe(404);
    expect(r.body.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting/apps/backend && npx vitest run test/export.e2e.test.ts`
Expected: FAIL — `/api/export/attackTicket` 404 (route not mounted).

- [ ] **Step 3: Implement export router + mount**

`apps/backend/src/export.ts`:
```ts
import { Router } from "express";
import * as XLSX from "xlsx";
import type { Repository, SchemaRegistry } from "@combat/shared";

export function makeExportRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.get("/export/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    const schema = registry.getNodeSchema(nodeType);
    if (!schema) return res.status(404).json({ error: `unknown nodeType: ${nodeType}` });
    const fields = schema.fields.filter(f => !f.retired);
    const rows = repo.queryNodes(nodeType).map(n => {
      const row: Record<string, unknown> = {};
      for (const f of fields) row[f.label] = n.properties[f.id] ?? "";
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: fields.map(f => f.label) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      `attachment; filename="${nodeType}-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx"`);
    res.send(buf);
  });
  return r;
}
```
Note: `json_to_sheet(rows, { header })` guarantees the column order and that all active-field columns appear even when the first row is missing a key; empty data still yields a sheet with the header row.

In `apps/backend/src/app.ts`: add `import { makeExportRouter } from "./export.js";` and mount `app.use("/api", makeExportRouter(deps.repo, deps.registry));` AFTER the existing `makeRouter`/`makeImportRouter`/`makeHonorRouter` mounts and BEFORE the global error middleware (`app.use((err, ...) => ...)`).

- [ ] **Step 4: Run test, verify it passes + full backend green + tsc**

Run: `cd D:\fighting/apps/backend && npx vitest run test/export.e2e.test.ts && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: export 2/2 PASS; full backend suite all green (prior 38 + 2 = 40); tsc zero errors. Fix only export.ts/app.ts if anything fails (never @combat/shared/locked files).

- [ ] **Step 5: Commit**

```
git add apps/backend/src/export.ts apps/backend/src/app.ts apps/backend/test/export.e2e.test.ts
git commit -m "feat(export): GET /api/export/:nodeType xlsx of all rows (label headers, id values, retired excluded)"
```

---

## Task 2: Frontend export button + Playwright e2e

**Depends on:** Task 1. **Files:**
- Modify: `apps/frontend/src/pages/EntityTable.tsx`
- Test: `apps/frontend/e2e/export.spec.ts`

- [ ] **Step 1: Write the failing e2e**

`apps/frontend/e2e/export.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-X1 export button downloads an xlsx for the current nodeType", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "导出单", 状态: "进行中" } });
  await page.goto("/attack");
  await expect(page.getByLabel("export-excel")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByLabel("export-excel").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^attackTicket-.*\.xlsx$/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting/apps/frontend && npx playwright test export.spec.ts`
Expected: FAIL — no element with aria-label `export-excel`.

- [ ] **Step 3: Add the export button to EntityTable**

In `apps/frontend/src/pages/EntityTable.tsx`, the header currently renders a title `<h2>` then a `Space` with the new-row button (and a search box when `filterField`). Add an export anchor styled as a button next to the new-row control. Locate the `<Space style={{ marginBottom: 12 }}>` block and add, as its FIRST child (before the `{draft === null ? ... }` expression), this anchor:
```tsx
        <a aria-label="export-excel" href={`/api/export/${nodeType}`} download
           style={{ marginRight: 8 }}>
          <Button>导出 Excel</Button>
        </a>
```
So the block becomes:
```tsx
      <Space style={{ marginBottom: 12 }}>
        <a aria-label="export-excel" href={`/api/export/${nodeType}`} download
           style={{ marginRight: 8 }}>
          <Button>导出 Excel</Button>
        </a>
        {draft === null
          ? <Button aria-label="new-row" type="primary" onClick={() => setDraft({})}>新增行</Button>
          : <>
              {fields.map(f => <Input key={f.id} aria-label={`draft-${f.id}`} placeholder={f.label}
                style={{ width: 140 }} value={draft[f.id] ?? ""}
                onChange={e => setDraft(d => ({ ...d, [f.id]: e.target.value }))} />)}
              <Button aria-label="create-row" type="primary" onClick={createDraft}>创建</Button>
              <Button onClick={() => setDraft(null)}>取消</Button>
            </>}
      </Space>
```
(`Button` is already imported from "antd" in this file. The Vite dev server proxies `/api` → `:3001`, so the relative `href` works in dev and in the deployed dev-server. No api.ts change, no new import.)

- [ ] **Step 4: Run e2e, verify it passes; then full e2e suite twice**

Run: `cd D:\fighting/apps/frontend && npx playwright test export.spec.ts`
Expected: PASS (download event fires, filename matches).
Then run the WHOLE suite and confirm no regression to existing specs:
Run: `cd D:\fighting/apps/frontend && npx playwright test`
Expected: ALL pass (attack 2 + editable 2 + honor 2 + export 1 = 7). Run again immediately → all pass again (determinism). If a stale process holds :3001/:5173, kill it (`netstat -ano | grep LISTENING | grep :PORT` → `taskkill //F //PID <pid>`) and retry; do not weaken assertions. Also confirm `cd D:\fighting/apps/frontend && npx vitest run` still green (button add shouldn't affect EntityTable.test) and `npx vite build` succeeds.

- [ ] **Step 5: Commit**

```
git add apps/frontend/src/pages/EntityTable.tsx apps/frontend/e2e/export.spec.ts
git commit -m "feat(ui): EntityTable 导出 Excel download button (server export endpoint)"
```

---

## Gate: test:all + acceptance + tag + deploy

- [ ] **Step 1: Full aggregate**

Run: `cd D:\fighting && npm run test:all`
Expected ALL green: shared 6 + backend 40 + frontend-unit 8 + frontend-e2e 7. Then `git checkout -- config/schemas/` (e2e mutates by design). If any fail → STOP, report BLOCKED with root cause; do not weaken tests.

- [ ] **Step 2: Verify PRD §16.5 acceptance**

Confirm each box maps to a green test:
- xlsx attachment, full rows, label headers, id values, retired excluded, unknown→404 → `export.e2e.test.ts` (both tests)
- EntityTable 导出 Excel button triggers download on /attack (and /contributions via the same component) → `export.spec.ts` FE-X1 + the button rendering unconditionally for any nodeType in EntityTable
- test:all green → Step 1
State explicitly: all covered & green (yes/no).

- [ ] **Step 3: Tag**

```
cd D:\fighting
git commit --allow-empty -m "chore: increment-1.5 (export) acceptance verified — test:all green (PRD §16.5)"
git tag increment-1.5-export
```

- [ ] **Step 4: Deploy**

Run: `cd D:\fighting/scripts/deploy && node deploy.mjs deploy`
Confirm runner ends `DEPLOY_DONE` with health `backend=200 frontend=200`. Report the open URL. (Standing deploy principle; creds from gitignored `.env.deploy`.)

- [ ] **Step 5: Report** — increment complete; test:all counts; deploy health.

---

## Self-Review

**1. Spec coverage (PRD §16):**
- 16.1 export.ts `makeExportRouter` GET /api/export/:nodeType, 404 unknown, queryNodes all, non-retired flatten `{label: properties[id]}`, xlsx buffer, content-type + attachment filename; app.ts mount before error mw → Task 1 ✓
- 16.2 EntityTable 导出 Excel anchor button aria-label `export-excel`, `<a href download>` to `/api/export/${nodeType}`, both /attack & /contributions via shared component → Task 2 ✓
- 16.3 backend e2e (content-type, XLSX.read rows, label headers, id values, retired excluded, 404) + Playwright download (waitForEvent download, suggestedFilename) → Tasks 1 & 2 ✓; reset-db.cjs unchanged (export is read-only, no schema mutation) ✓
- 16.4 decisions reflected; 16.5 acceptance mapped → Gate ✓
- Deferred (client-side/styled export) correctly NOT built ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". The supertest `.buffer().parse(...)` binary-body capture is fully spelled out (supertest does not buffer binary by default). Frontend change shows the exact final JSX block. All identifiers (`makeExportRouter`, `/api/export/:nodeType`, `export-excel`) defined in Task 1 and used consistently in Task 2/Gate.

**3. Type consistency:** `makeExportRouter(repo: Repository, registry: SchemaRegistry)` matches the existing `makeHonorRouter`/`makeRouter` mount style in app.ts. `schema.fields.filter(f => !f.retired)` and `n.properties[f.id]` match the `FieldSchema` (`id`/`label`/`retired`) and `GraphNode.properties` contracts used everywhere since Increment-1. Endpoint path `/api/export/:nodeType` identical in export.ts, backend test, frontend href, Playwright spec.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-export-excel.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec then quality), then Gate.
**2. Inline Execution** — executing-plans with checkpoints.

Which approach?
