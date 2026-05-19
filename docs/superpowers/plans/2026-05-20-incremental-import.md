# 增量8 — 增量导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Upgrade `POST /api/import` to identityKey upsert (re-imports update existing rows, don't duplicate), parameterize to any nodeType (`?type=`), and surface `{created, updated}` in the ImportPage UI. Resolves PRD §10 Phase 3.6 增量导入.

**Architecture:** Pure additive on the existing `/api/import` route — same parse pipeline (xlsx → mapColumns → validateNode), but the create-or-update branch is decided by identityKey lookup; REF/ANCHORED_TO derivation auto-fires on both create and update via existing sync helpers. Backend (T2) / frontend (T3) disjoint → parallel. No T1 (response shape adds field; no shared-contract change).

**Tech Stack:** Node+TS+Express+xlsx+multer, React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §26 is the basis.

---

## File Structure

- `apps/backend/src/import.ts` — rewrite for upsert + ?type= (T2)
- `apps/backend/test/import-upsert.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — `importXlsx(file, type?)` returns `{created, updated}` (T3)
- `apps/frontend/src/pages/ImportPage.tsx` — nodeType Select + new message (T3)
- `apps/frontend/e2e/coverage.spec.ts` — update GAP-Import title assertion + GAP nav heading (T3, surgical)
- `apps/frontend/e2e/import-upsert.spec.ts` — NEW FE e2e (T3)

---

## Task 2: Backend — upsert + multi-nodeType (PARALLEL with T3)

**Files:** Modify `apps/backend/src/import.ts`; Create `apps/backend/test/import-upsert.e2e.test.ts`

- [ ] **Step 1: Failing e2e** — create `apps/backend/test/import-upsert.e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
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
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-imp-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}
function xlsxBuf(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("incremental import (upsert) e2e", () => {
  it("first import creates; same identityKey re-import updates (no duplicates); 攻关单号 idem", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([
      { 标题: "T1", 攻关单号: "HK-1", 状态: "进行中" },
      { 标题: "T2", 攻关单号: "HK-2", 状态: "进行中" },
    ]);
    const r1 = await request(app).post("/api/import").attach("file", buf, "x.xlsx");
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ created: 2, updated: 0 });
    expect(repo.queryNodes("attackTicket")).toHaveLength(2);

    // re-import same identityKeys + one property changed
    const buf2 = xlsxBuf([
      { 标题: "T1-改", 攻关单号: "HK-1", 状态: "已解决" },
      { 标题: "T2", 攻关单号: "HK-2", 状态: "进行中" },
    ]);
    const r2 = await request(app).post("/api/import").attach("file", buf2, "x.xlsx");
    expect(r2.body).toEqual({ created: 0, updated: 2 });
    expect(repo.queryNodes("attackTicket")).toHaveLength(2); // NO duplicates
    const t1 = repo.queryNodes("attackTicket", { 攻关单号: "HK-1" })[0];
    expect(t1.properties["标题"]).toBe("T1-改");
    expect(t1.properties["状态"]).toBe("已解决");
  });

  it("mixed: some rows new, some matching → created+updated counted separately", async () => {
    const { app } = makeApp();
    await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "A", 攻关单号: "MX-1" }]), "x.xlsx");
    const r = await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "A2", 攻关单号: "MX-1" }, { 标题: "B", 攻关单号: "MX-2" }]), "x.xlsx");
    expect(r.body).toEqual({ created: 1, updated: 1 });
  });

  it("?type=releasePackage upserts by 版本号; ?type=weightFile by 名称 (config-driven, new nodeTypes)", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([{ 版本号: "v9", 产品: "A" }, { 版本号: "v10", 产品: "B" }]);
    const r1 = await request(app).post("/api/import?type=releasePackage").attach("file", buf, "r.xlsx");
    expect(r1.body).toEqual({ created: 2, updated: 0 });
    const r2 = await request(app).post("/api/import?type=releasePackage").attach("file",
      xlsxBuf([{ 版本号: "v9", 产品: "A改" }]), "r.xlsx");
    expect(r2.body).toEqual({ created: 0, updated: 1 });
    expect(repo.queryNodes("releasePackage", { 版本号: "v9" })[0].properties["产品"]).toBe("A改");

    const wf = await request(app).post("/api/import?type=weightFile").attach("file",
      xlsxBuf([{ 名称: "W1", 模型: "BERT" }]), "w.xlsx");
    expect(wf.body).toEqual({ created: 1, updated: 0 });
  });

  it("unknown ?type= → 400", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/import?type=__none__").attach("file",
      xlsxBuf([{ x: 1 }]), "x.xlsx");
    expect(r.status).toBe(400);
  });

  it("validateNode-failing rows are skipped (no count, no node)", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([
      { 标题: "ok", 攻关单号: "VL-1" }, // ok
      { 攻关单号: "VL-2" }, // missing required 标题 → skipped
    ]);
    const r = await request(app).post("/api/import").attach("file", buf, "x.xlsx");
    expect(r.body).toEqual({ created: 1, updated: 0 });
    expect(repo.queryNodes("attackTicket")).toHaveLength(1);
  });

  it("UPDATE re-fires syncRefEdges (changing 当前处理人 re-creates REF) + syncAnchorEdges (问题单号 changing reassigns anchor)", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "T", 攻关单号: "RA-1", 当前处理人: "甲", 问题单号: "PB-A" }]), "x.xlsx");
    const t = repo.queryNodes("attackTicket", { 攻关单号: "RA-1" })[0];
    expect(repo.queryEdges({ sourceId: t.id, edgeType: "REF" }).find(e => String(e.properties["field"]) === "当前处理人")).toBeTruthy();
    expect(repo.queryEdges({ sourceId: t.id, edgeType: "ANCHORED_TO" })[0].targetId).toBeTruthy();
    // update changes both
    await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "T", 攻关单号: "RA-1", 当前处理人: "乙", 问题单号: "PB-B" }]), "x.xlsx");
    const refs = repo.queryEdges({ sourceId: t.id, edgeType: "REF" }).filter(e => String(e.properties["field"]) === "当前处理人");
    expect(refs).toHaveLength(1); // delete-first + recreate (idempotent)
    const newPerson = repo.getNode(refs[0].targetId)!;
    expect(newPerson.properties["name"]).toBe("乙");
    const anchors = repo.queryEdges({ sourceId: t.id, edgeType: "ANCHORED_TO" });
    expect(anchors).toHaveLength(1);
    expect(repo.getNode(anchors[0].targetId)!.properties["key"]).toBe("PB-B");
  });

  it("attackTicket ASSIGNED_TO 攻关申请人 edge is idempotent across re-imports (exactly 1 per node)", async () => {
    const { app, repo } = makeApp();
    const row = { 标题: "AT", 攻关单号: "AS-1", 攻关申请人: "申请甲", 攻关申请人工号: "E001" };
    await request(app).post("/api/import").attach("file", xlsxBuf([row]), "x.xlsx");
    await request(app).post("/api/import").attach("file", xlsxBuf([row]), "x.xlsx");
    const t = repo.queryNodes("attackTicket", { 攻关单号: "AS-1" })[0];
    expect(repo.queryEdges({ sourceId: t.id, edgeType: "ASSIGNED_TO" })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** `cd apps/backend && npx vitest run import-upsert.e2e` → expect FAIL (current import.ts is create-only, ignores ?type, response is `{created}` not `{created,updated}`).

- [ ] **Step 3: Rewrite import.ts** — replace the entire body of `apps/backend/src/import.ts` with:

```ts
import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import type { Repository, SchemaRegistry, NodeSchema } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";

const upload = multer({ storage: multer.memoryStorage() });

function mapColumns(row: Record<string, unknown>, schema: NodeSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    const aliases = (f.aliases ?? []).map(a => a.trim());
    const hit = Object.keys(row).find(k => {
      const kt = k.trim();
      return kt === f.name || kt === f.label || aliases.includes(kt);
    });
    if (hit !== undefined) out[f.id] = row[hit];
  }
  return out;
}

function resolvePerson(repo: Repository, name?: string, employeeId?: string): string | null {
  if (!name && !employeeId) return null;
  if (employeeId) {
    const hit = repo.queryNodes("person", { employeeId }).at(0);
    if (hit) return hit.id;
  }
  return repo.createNode("person", { name: name ?? employeeId, employeeId }, "import").id;
}

// find an existing node whose identityKey value matches a non-empty value in props.
// schema.identityKeys is tried in order; first match wins (deterministic).
function findByIdentity(repo: Repository, schema: NodeSchema, props: Record<string, unknown>) {
  for (const k of schema.identityKeys) {
    const v = props[k];
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    if (!s) continue;
    const hit = repo.queryNodes(schema.nodeType, { [k]: s }).at(0);
    if (hit) return hit;
  }
  return undefined;
}

export function makeImportRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/import", upload.single("file"), (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const nodeType = String(first(req.query.type) ?? "attackTicket");
    const schema = registry.getNodeSchema(nodeType);
    if (!schema) return res.status(400).json({ error: `unknown nodeType: ${nodeType}` });
    const wb = XLSX.read(req.file!.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    let created = 0, updated = 0;
    for (const raw of rows) {
      const props = mapColumns(raw, schema);
      const v = registry.validateNode(nodeType, props);
      if (!v.ok) continue;
      const existing = findByIdentity(repo, schema, props);
      const node = existing
        ? repo.updateNode(existing.id, props, "import")
        : repo.createNode(nodeType, props, "import");
      if (existing) updated++; else created++;
      // Re-derive REF and ANCHORED_TO edges (both create and update paths;
      // delete-first inside the helpers keeps it idempotent).
      syncRefEdges(repo, registry, node, props, "import");
      syncAnchorEdges(repo, registry, node, props, "import");
      // Legacy attackTicket ASSIGNED_TO 攻关申请人 edge (backward compat):
      if (nodeType === "attackTicket") {
        repo.deleteEdges({ sourceId: node.id, edgeType: "ASSIGNED_TO" }, "import");
        const personId = resolvePerson(repo,
          raw["攻关申请人"] as string, raw["攻关申请人工号"] as string);
        if (personId) repo.createEdge("ASSIGNED_TO", node.id, personId, { role: "攻关申请人" }, "import");
      }
    }
    res.json({ created, updated });
  });
  return r;
}
```

- [ ] **Step 4: Run** `cd apps/backend && npx vitest run` → expect ALL green (prior 76 + import-upsert 7 = 83). Then `npx tsc -p tsconfig.json --noEmit` clean. Fix logic only; never weaken provided tests.

- [ ] **Step 5: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/import.ts apps/backend/test/import-upsert.e2e.test.ts
git commit -m "feat(backend): /api/import?type=<nodeType> identityKey upsert + REF/ANCHORED_TO re-sync + ASSIGNED_TO idempotent (8-T2)"
```

---

## Task 3: Frontend — ImportPage nodeType + message (PARALLEL with T2)

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/pages/ImportPage.tsx`, `apps/frontend/e2e/coverage.spec.ts`; Create `apps/frontend/e2e/import-upsert.spec.ts`

- [ ] **Step 1: api.ts** — change `importXlsx`:

```ts
  importXlsx(file: File, type?: string): Promise<{ created: number; updated: number }> {
    const fd = new FormData(); fd.append("file", file);
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    return this.req<{ created: number; updated: number }>(`/api/import${qs}`, { method: "POST", body: fd });
  }
```

- [ ] **Step 2: ImportPage** — replace `apps/frontend/src/pages/ImportPage.tsx`:

```tsx
import { useState } from "react";
import { Upload, Button, message, Select, Space } from "antd";
import { api } from "../api.js";

const TYPES = [
  { value: "attackTicket", label: "攻关单" },
  { value: "contribution", label: "贡献记录" },
  { value: "releasePackage", label: "发布包" },
  { value: "weightFile", label: "权重文件" },
  { value: "person", label: "人员" },
];

export function ImportPage() {
  const [done, setDone] = useState(false);
  const [type, setType] = useState("attackTicket");
  return (
    <div style={{ padding: 16 }}>
      <h2>导入数据</h2>
      <Space style={{ marginBottom: 12 }}>
        <span>导入类型：</span>
        <Select aria-label="import-type" value={type} onChange={setType}
          options={TYPES} style={{ width: 200 }} />
      </Space>
      <div>
        <Upload beforeUpload={async (file) => {
          try {
            const r = await api.importXlsx(file as unknown as File, type);
            message.success(`导入新增 ${r.created} · 已更新 ${r.updated}`); setDone(true);
          } catch {
            message.error("导入失败，请重试");
          }
          return false;
        }}>
          <Button>选择 Excel 文件</Button>
        </Upload>
      </div>
      {done && <p role="status">导入完成</p>}
    </div>
  );
}
```

- [ ] **Step 3: Update existing coverage.spec.ts assertions** — find every `"导入攻关单"` reference and change to `"导入数据"` (new generic title). Concretely:
  - GAP nav test (currently `await expect(page.getByText("导入攻关单")).toBeVisible(); // GAP-17 IM-1 heading`) → `await expect(page.getByText("导入数据")).toBeVisible();`
  - GAP Import test (currently `await expect(page.getByText("导入攻关单")).toBeVisible();`) → `await expect(page.getByText("导入数据")).toBeVisible();`
  
  This is an intentional documented update (mirrors the 3b precedent where existing assertions were updated for a re-grouped/renamed UI element).

- [ ] **Step 4: New e2e** — create `apps/frontend/e2e/import-upsert.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-IU1 ImportPage shows 新增/已更新 message (route-mocked, deterministic)", async ({ page }) => {
  // Deterministically exercise the message format by mocking the API response;
  // xlsx upload semantics are covered exhaustively by backend e2e.
  await page.route("**/api/import**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ created: 3, updated: 2 }),
  }));
  await page.goto("/import");
  await expect(page.getByText("导入数据")).toBeVisible();
  await expect(page.getByLabel("import-type")).toBeVisible();
  await page.setInputFiles("input[type=file]", {
    name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x"),
  });
  await expect(page.getByText("导入新增 3 · 已更新 2", { exact: false })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("导入完成");
});
```

- [ ] **Step 5: Run** `cd apps/frontend && npx vitest run` (13 green) and `npx vite build` (green).

- [ ] **Step 6: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/pages/ImportPage.tsx apps/frontend/e2e/coverage.spec.ts apps/frontend/e2e/import-upsert.spec.ts
git commit -m "feat(ui): ImportPage nodeType select + 新增/已更新 message; api.importXlsx(type?) (8-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (`--no-ff`); integrated verify: backend `npx vitest run` (expect 83), backend tsc clean, frontend `npx vitest run` (13), frontend `npx vite build` green.
- [ ] Spec-compliance + code-quality review (concurrent agents; if rate-limited, controller-driven self-review per established precedent).
- [ ] Pre-clear stale :3001/:5173 (PowerShell), `git checkout -- config/schemas/`, then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §26.5 (8 items) → evidence; flip `- [ ]`→`- [x]`; acceptance commit.
- [ ] `git tag -a increment-8-incremental-import -m "increment-8 …"`.
- [ ] Deploy `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ 200 + deploy.log backend=200 frontend=200.

---

## Self-Review

1. **§26.5 coverage:** ① `?type=` + 400 unknown → T2 e2e #4. ② create/update counters → T2 #1 #2. ③ UPDATE merges + REF re-sync → T2 #6. ④ ?type=releasePackage/weightFile upsert → T2 #3. ⑤ validate-fail skip → T2 #5. ⑥ ASSIGNED_TO idempotent → T2 #7. ⑦ ImportPage select + message → T3 FE-IU1 + Step 2 implementation. ⑧ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none.
3. **Backward compat:** existing ImportPage callers without `type` arg use the new method signature with optional type → falls through to default `attackTicket`. Response `{created, updated}` is a superset of the old `{created}` — old usage `r.created` still works.
4. **Determinism / shared-backend safety:** import-upsert.spec uses route mocking (deterministic, no real xlsx); coverage.spec changes are exact string updates (not weakening — same heading, new text); backend e2e uses tmpdir + real config — fully isolated.
5. **Architecture validation reinforcement:** T2 e2e #3 proves the generic `?type=` works for the increment-7 nodeTypes — incremental import is automatically valuable for the new resource registries.
