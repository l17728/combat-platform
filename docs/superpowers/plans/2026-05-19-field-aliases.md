# Field Alias Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `FieldSchema.aliases` so import column-mapping unifies cross-table divergent column names (研发责任人/owner/当前处理人 → one canonical field), with a `setAliases` FieldOp and an EntityTable column-header "别名" editor that writes back to config.

**Architecture:** Additive contract change (`aliases?: string[]`, like `retired?`). `import.ts mapColumns` extends its match to include aliases. A new `FieldOp` variant `setAliases` reuses the existing `applyFieldOp` persist→reload→rollback machinery and the existing `PATCH /api/schema/:nodeType` route. Frontend adds one column-header button + Modal calling the existing `api.patchSchema`. Minimal real-alias seed on `attackTicket.json`.

**Tech Stack:** Node 20 + TypeScript, npm workspaces, Express, better-sqlite3, xlsx, Vite + React + Ant Design; tests = Vitest + supertest (backend) + Playwright (frontend e2e), reusing the existing deterministic harness.

---

## Spec Source

Implements PRD §17 (17.1–17.6). Decisions locked in §17.5: field-level `aliases[]`; exact-equality (trim) match; `setAliases` replaces the whole array; seed only `attackTicket` from real `req.md` column names; fuzzy-recommend + human-approval gate explicitly DEFERRED; cross-view query unification DEFERRED to increment 3.

---

## Parallel Execution Map

```
Wave 0 (SERIAL gate): Task 1  @combat/shared FieldSchema.aliases + FieldOp setAliases
Wave 1 (PARALLEL — 2 worktrees):
  Track A → Task 2  backend: mapColumns alias match + applyFieldOp setAliases + seed + backend e2e
  Track B → Task 3  frontend: EntityTable 别名 column-header Modal + Playwright e2e
Gate: test:all green + §17.6 acceptance + tag + deploy
```

Wave-1 file sets are disjoint (Track A: `apps/backend/**`, `config/schemas/attackTicket.json`; Track B: `apps/frontend/src/**`, `apps/frontend/e2e/aliases.spec.ts`). Branch tracks off the Task-1 commit; a track imports only `@combat/shared`; merge at the gate. Per the standing parallelize directive, dispatch Task 2 ‖ Task 3 as concurrent worktree agents.

---

## File Structure

```
packages/shared/src/types.ts          # MOD: FieldSchema += aliases?: string[]
packages/shared/src/registry.ts       # MOD: FieldOp += { op:"setAliases"; id; aliases:string[] }
packages/shared/src/types.test.ts     # MOD: + aliases/setAliases type test
apps/backend/src/import.ts            # MOD: mapColumns also matches f.aliases
apps/backend/src/registry.ts          # MOD: applyFieldOp handles "setAliases"
config/schemas/attackTicket.json      # MOD: seed aliases on a few fields (req.md column names)
apps/backend/test/aliases.e2e.test.ts # NEW: import-via-alias + setAliases persist/rollback e2e
apps/frontend/src/pages/EntityTable.tsx # MOD: + 别名 column-header button + Modal
apps/frontend/e2e/aliases.spec.ts     # NEW: Playwright alias-editor e2e
```

Existing Playwright `attack.spec.ts`/`editable.spec.ts`/`honor.spec.ts`/`export.spec.ts` must keep passing UNMODIFIED.

---

## Task 1: `@combat/shared` — FieldSchema.aliases + FieldOp setAliases  *(Wave 0 — serial gate)*

**Files:** Modify `packages/shared/src/types.ts`, `packages/shared/src/registry.ts`, `packages/shared/src/types.test.ts`.

- [ ] **Step 1: Append failing test** to `packages/shared/src/types.test.ts` (add the import to the top import block if `FieldSchema`/`FieldOp` not already imported there — they are imported in the increment-1 contracts describe; reuse; do NOT duplicate the vitest import). Append at end of file:
```ts
describe("alias contracts", () => {
  it("FieldSchema has optional aliases and FieldOp has setAliases", () => {
    const f: FieldSchema = { id: "标题", name: "标题", type: "string", label: "标题", aliases: ["title", "问题标题"] };
    const ops: FieldOp[] = [{ op: "setAliases", id: "标题", aliases: ["title"] }];
    expect(f.aliases).toEqual(["title", "问题标题"]);
    expect(ops[0].op).toBe("setAliases");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting && npm run test:shared`
Expected: FAIL — `aliases` not on `FieldSchema` / `setAliases` not in `FieldOp` (type errors on the new describe).

- [ ] **Step 3: Implement**

In `packages/shared/src/types.ts`, the `FieldSchema` interface currently ends with `retired?: boolean;`. Add `aliases?: string[];` so it reads exactly:
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
}
```

In `packages/shared/src/registry.ts`, add a variant to the `FieldOp` union. It currently is:
```ts
export type FieldOp =
  // addField: server derives the field id from name (id = name; "#2","#3"… on collision). Callers do not supply id.
  | { op: "addField"; field: { name: string; type: FieldType; label: string; required?: boolean; enumValues?: string[] } }
  | { op: "renameLabel"; id: string; label: string }
  | { op: "editEnum"; id: string; enumValues: string[] }
  | { op: "retire"; id: string }
  | { op: "unretire"; id: string };
```
Add `| { op: "setAliases"; id: string; aliases: string[] }` as the last member:
```ts
export type FieldOp =
  // addField: server derives the field id from name (id = name; "#2","#3"… on collision). Callers do not supply id.
  | { op: "addField"; field: { name: string; type: FieldType; label: string; required?: boolean; enumValues?: string[] } }
  | { op: "renameLabel"; id: string; label: string }
  | { op: "editEnum"; id: string; enumValues: string[] }
  | { op: "retire"; id: string }
  | { op: "unretire"; id: string }
  | { op: "setAliases"; id: string; aliases: string[] };
```
(`index.ts` already re-exports both modules — no change.)

- [ ] **Step 4: Run, expect PASS**

Run: `cd D:\fighting && npm run test:shared`
Expected: all pass (prior + the new alias-contracts test).

- [ ] **Step 5: Tsc-clean the shared package + commit**

Run: `cd D:\fighting/packages/shared && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.
Then:
```
git add packages/shared/src/types.ts packages/shared/src/registry.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): FieldSchema.aliases + FieldOp setAliases"
```

---

## Task 2: Backend — mapColumns alias match + applyFieldOp setAliases + seed + e2e  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:** Modify `apps/backend/src/import.ts`, `apps/backend/src/registry.ts`, `config/schemas/attackTicket.json`; Create `apps/backend/test/aliases.e2e.test.ts`.

- [ ] **Step 1: Write the failing e2e** `apps/backend/test/aliases.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-alias-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "string", label: "当前处理人", aliases: ["研发责任人", "owner"] },
    ],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, cfg };
}

function xlsxBuf(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("alias e2e", () => {
  it("import: a divergent column name matched via alias lands in the canonical field", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([{ 标题: "断连", 研发责任人: "张三" }]);
    const r = await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
    const t = repo.queryNodes("attackTicket")[0];
    expect(t.properties["当前处理人"]).toBe("张三"); // 研发责任人 alias -> 当前处理人
  });
  it("setAliases persists to config json + reload; then import uses the new alias", async () => {
    const { app, repo, cfg } = makeApp();
    const p = await request(app).patch("/api/schema/attackTicket")
      .send({ op: "setAliases", id: "当前处理人", aliases: ["处理人", "PIC"] });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "当前处理人").aliases).toEqual(["处理人", "PIC"]);
    const onDisk = JSON.parse(readFileSync(join(cfg, "attackTicket.json"), "utf8"));
    expect(onDisk.fields.find((f: any) => f.id === "当前处理人").aliases).toEqual(["处理人", "PIC"]);
    const buf = xlsxBuf([{ 标题: "T2", PIC: "李四" }]);
    await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    const t = repo.queryNodes("attackTicket").find(n => n.properties["标题"] === "T2");
    expect(t!.properties["当前处理人"]).toBe("李四");
  });
  it("setAliases on unknown field id -> 400 and config unchanged", async () => {
    const { app, cfg } = makeApp();
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const r = await request(app).patch("/api/schema/attackTicket")
      .send({ op: "setAliases", id: "不存在", aliases: ["x"] });
    expect(r.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd D:\fighting/apps/backend && npx vitest run test/aliases.e2e.test.ts`
Expected: FAIL — alias not matched by mapColumns (test 1 `当前处理人` undefined); `setAliases` unknown op → applyFieldOp throws "未知操作" → 400 but test 2 expects 200 and persisted aliases.

- [ ] **Step 3: Implement.**

In `apps/backend/src/import.ts`, replace the `mapColumns` function with EXACTLY:
```ts
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
```

In `apps/backend/src/registry.ts`, inside `applyFieldOp`, there is an if/else chain over `op.op` ending with `else { throw new Error(\`未知操作: ${(op as { op: string }).op}\`); }`. Add a `setAliases` branch BEFORE that final `else` (alongside `retire`/`unretire`). Insert exactly:
```ts
    } else if (op.op === "setAliases") {
      find(op.id).aliases = op.aliases;
```
so the chain reads (context — the `unretire` branch then the new branch then the unknown-op else):
```ts
    } else if (op.op === "unretire") {
      find(op.id).retired = false;
    } else if (op.op === "setAliases") {
      find(op.id).aliases = op.aliases;
    } else {
      throw new Error(`未知操作: ${(op as { op: string }).op}`);
    }
```
(`find(id)` already throws `字段 id 不存在: <id>` for unknown ids — that propagates to the route's 400 + rollback, satisfying test 3. No other change to applyFieldOp; the existing writeFileSync→reload→rollback tail handles persistence.)

In `config/schemas/attackTicket.json`, add `"aliases"` to a few fields using real `req.md` divergent column names. Add to the `当前处理人` field object `"aliases": ["研发责任人", "运维责任人", "责任人", "owner"]` and to the `标题` field object `"aliases": ["title", "问题标题", "事件标题"]`. Change ONLY those two field objects (insert the `aliases` key); leave every other field and all other JSON byte-identical; UTF-8 no BOM; verify Chinese intact.

- [ ] **Step 4: Run, expect PASS + full backend + tsc**

Run: `cd D:\fighting/apps/backend && npx vitest run test/aliases.e2e.test.ts && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: aliases 3/3 PASS; full backend suite all green (prior 41 + 3 = 44 — note `git checkout -- config/schemas/` is NOT needed here since these vitest tests use temp configs, but the real `attackTicket.json` seed change is intentional & committed); tsc zero errors. If the existing `import.e2e.test.ts`/`api.e2e.test.ts` regress, it is a real mapColumns defect — fix import.ts, not the tests.

- [ ] **Step 5: Commit**

```
git add apps/backend/src/import.ts apps/backend/src/registry.ts config/schemas/attackTicket.json apps/backend/test/aliases.e2e.test.ts
git commit -m "feat(alias): mapColumns matches field aliases + applyFieldOp setAliases + seed attackTicket aliases"
```

---

## Task 3: Frontend — EntityTable 别名 column-header editor + Playwright e2e  *(Wave 1 — Track B)*

**Depends on:** Task 1. **Files:** Modify `apps/frontend/src/pages/EntityTable.tsx`; Create `apps/frontend/e2e/aliases.spec.ts`.

- [ ] **Step 1: Write the failing e2e** `apps/frontend/e2e/aliases.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-A1 column-header 别名 editor sets aliases and persists", async ({ page }) => {
  await page.goto("/attack");
  // open the 别名 editor for the 标题 column
  await page.getByLabel("aliases-标题").click();
  const box = page.getByLabel("aliases-input");
  await box.fill("title\n问题标题\n事件标题");
  await page.getByRole("button", { name: "确定" }).click();
  // verify persisted via the schema endpoint
  await expect.poll(async () => {
    const s = await (await page.request.get(`${API}/api/schema/attackTicket`)).json();
    return s.fields.find((f: any) => f.id === "标题")?.aliases ?? [];
  }).toEqual(["title", "问题标题", "事件标题"]);
});
```

- [ ] **Step 2: Run, expect FAIL/diagnose**

Run: `cd D:\fighting/apps/frontend && npx playwright test aliases.spec.ts`
Expected: FAIL — no element with aria-label `aliases-标题`.

- [ ] **Step 3: Implement.**

In `apps/frontend/src/pages/EntityTable.tsx`: there is a `[rn, setRn]` state and a rename Modal. Add a parallel aliases-editor state + Modal.

(a) Add state next to `const [rn, setRn] = useState<{ id: string; label: string } | null>(null);`:
```tsx
  const [al, setAl] = useState<{ id: string; text: string } | null>(null);
```

(b) In the per-field column `title` JSX, there is a `<Space size={4}>` with the field label, a `rename-${f.id}` Button, and a `retire-${f.id}` Popconfirm Button. Add a third button (after the retire Popconfirm, still inside the same `<Space>`):
```tsx
          <Button aria-label={`aliases-${f.id}`} size="small" type="link"
            onClick={() => setAl({ id: f.id, text: (f.aliases ?? []).join("\n") })}>别名</Button>
```

(c) Next to the existing rename `<Modal title="重命名字段" ...>`, add the aliases Modal (place right after it, before the component's closing `</div>`):
```tsx
      <Modal title="编辑别名（每行/逗号一个）" open={al !== null} okText="确定" onCancel={() => setAl(null)}
        onOk={async () => {
          if (al) {
            const aliases = al.text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
            await patch({ op: "setAliases", id: al.id, aliases });
          }
          setAl(null);
        }}>
        <Input.TextArea aria-label="aliases-input" rows={4} value={al?.text ?? ""}
          onChange={e => setAl(s => (s ? { ...s, text: e.target.value } : s))} />
      </Modal>
```
(`Input`, `Modal`, `Button`, `patch` are all already in scope in EntityTable. `patch` already does try/catch→message + refresh. `f.aliases` is now on the `FieldSchema` type from Task 1, so `(f.aliases ?? [])` typechecks.)

- [ ] **Step 4: Run e2e, verify pass; then full suite twice + unit + build**

Run: `cd D:\fighting/apps/frontend && npx playwright test aliases.spec.ts`
Expected: PASS.
Then: `cd D:\fighting/apps/frontend && npx playwright test` → ALL pass (attack 2 + editable 2 + export 1 + honor 2 + aliases 1 = 8). Run again immediately → all pass again (determinism). If a stale process holds :3001/:5173, kill it (`netstat -ano | grep LISTENING | grep :PORT` → `taskkill //F //PID <pid>`) and retry; never weaken assertions; never edit the other specs. Then `cd D:\fighting/apps/frontend && npx vitest run` (still green — EntityTable.test smoke unaffected) and `npx vite build` (succeeds, antd chunk warning OK).

- [ ] **Step 5: Commit**

```
git add apps/frontend/src/pages/EntityTable.tsx apps/frontend/e2e/aliases.spec.ts
git commit -m "feat(ui): EntityTable column-header 别名 editor (setAliases) + Playwright e2e FE-A1"
```

---

## Gate: test:all + acceptance + tag + deploy

- [ ] **Step 1: Full aggregate**

Run: `cd D:\fighting && npm run test:all`
Expected ALL green: shared (+alias contract) + backend 44 + frontend-unit 8 + frontend-e2e 8. Then `git checkout -- config/schemas/` ONLY for files an e2e mutated by PATCH at runtime — BUT the `attackTicket.json` alias seed is a committed intentional change, so after `git checkout -- config/schemas/` confirm `git status` shows config clean (the seed is committed, restore brings back the committed seed, not pristine-pre-seed). If any suite red → STOP, report BLOCKED with root cause; do not weaken tests.

- [ ] **Step 2: Verify PRD §17.6 acceptance** — map each box to a green test:
  - `FieldSchema.aliases` contract + no break → Task 1 shared test + full suite green
  - import divergent column via alias → canonical field → `aliases.e2e` test 1
  - `PATCH setAliases` persist+reload, unknown id 400+rollback, then import uses new alias → `aliases.e2e` tests 2 & 3
  - EntityTable 别名 button persists on /attack (and /contributions via same component) → `aliases.spec.ts` FE-A1 + the button rendering unconditionally per field
  - test:all green → Step 1
  State explicitly: all covered & green (yes/no).

- [ ] **Step 3: Tag**

```
cd D:\fighting
git checkout -- config/schemas/ 2>/dev/null || true
git commit --allow-empty -m "chore: increment-2 (field aliases) acceptance verified — test:all green (PRD §17.6)"
git tag increment-2-aliases
```

- [ ] **Step 4: Deploy**

Run: `cd D:\fighting/scripts/deploy && node deploy.mjs deploy`
Confirm runner ends `DEPLOY_DONE` with health `backend=200 frontend=200`. Report the open URL (`http://www.catown.cloud:5173/`). (Standing deploy principle; creds from gitignored `.env.deploy`.)

- [ ] **Step 5: Report** — increment complete; test:all counts; deploy health.

---

## Self-Review

**1. Spec coverage (PRD §17):**
- 17.1 `FieldSchema.aliases?: string[]` additive → Task 1 ✓
- 17.2 mapColumns matches name|label|aliases (trim); `setAliases` FieldOp handled by applyFieldOp reusing persist/reload/rollback; PATCH route auto-supports → Task 2 ✓
- 17.3 EntityTable column-header 别名 button + Modal (`aliases-${id}`, `aliases-input`, okText 确定, split on \n/comma, calls api.patchSchema setAliases) → Task 3 ✓
- 17.4 seed attackTicket only (当前处理人 + 标题, req.md names); reset-db restore set already includes attackTicket.json → Task 2 (note in Gate Step 1) ✓
- 17.5 decisions reflected (field-level, exact trim match, whole-array replace, seed scope, fuzzy deferred) ✓
- 17.6 acceptance → Gate Step 2 maps each ✓
- Deferred (fuzzy recommend + human-approval gate; cross-view query unification) correctly NOT built ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". All code shown in full incl. exact mapColumns body, exact applyFieldOp branch insertion (with surrounding context), exact EntityTable state/button/Modal. `find(op.id)` reuse for unknown-id→throw→400→rollback is the existing mechanism (verified against §14.2B applyFieldOp). reset-db.cjs unchanged is justified (attackTicket.json already in its restore list from prior increments).

**3. Type consistency:** `FieldSchema.aliases?: string[]` (Task 1) consumed identically in import.ts `f.aliases ?? []` (Task 2), registry.ts `find(op.id).aliases = op.aliases` (Task 2), EntityTable `(f.aliases ?? []).join` (Task 3). `FieldOp` `{op:"setAliases";id;aliases:string[]}` (Task 1) used identically in aliases.e2e PATCH body (Task 2), applyFieldOp branch (Task 2), EntityTable `patch({op:"setAliases",id,aliases})` (Task 3), Playwright (Task 3). `api.patchSchema(nodeType, FieldOp)` already exists (Increment-1) and accepts the widened union via Task 1. Endpoint `PATCH /api/schema/:nodeType` unchanged — it forwards `req.body` as the FieldOp.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-field-aliases.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, parallel Wave-1 worktrees (Task 2 ‖ Task 3).
**2. Inline Execution** — executing-plans with checkpoints.

Which approach?
