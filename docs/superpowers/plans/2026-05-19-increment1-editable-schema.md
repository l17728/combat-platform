# Increment 1 — Editable Schema-Driven Attack Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the attack console hand-operable: stable field IDs decoupled from display labels, manual record create/edit/delete, and UI field management (add / rename / retire) that writes back to the config — presented as an editable table.

**Architecture:** Builds on the committed Phase-1 monorepo. `@combat/shared` contracts evolve (`FieldSchema.id`/`retired`, `Repository.deleteNode`/`logAudit`, `SchemaRegistry.applyFieldOp`, `FieldOp`). Data and all references key off the immutable `id`; legacy fields get `id = name` (zero data migration since `properties` is already name-keyed). Schema edits persist to `config/schemas/<nodeType>.json` then `reload()` with rollback on failure. No-DDL JSON storage is unchanged. No layout switch (deferred).

**Tech Stack:** Node 20 + TypeScript, npm workspaces, Express, better-sqlite3, Vite + React + Ant Design; tests = Vitest + supertest (backend) + Playwright (frontend e2e), reusing the existing deterministic harness.

---

## Spec Source

Implements PRD §14.2 (A–E). Decisions locked in PRD §14.4. Finalizes open question §13#7: **new-field `id` = the field's `name`; on collision append `#2`, `#3`, …** (ids may be Chinese; they only need to be unique & stable, mirroring legacy `id = name`).

Out of scope (PRD §14.3, deferred): alias/synonym mapping, ref→entity/concept, cross-granularity anchors, table↔layout switch.

---

## Parallel Execution Map

Sequential per subagent-driven-development; waves indicate independence for any parallel session.

```
Wave 0 (SERIAL gate): Task 1  @combat/shared contract evolution
  └─ FieldSchema.id/retired, Repository.deleteNode/logAudit, SchemaRegistry.applyFieldOp, FieldOp

Wave 1 (parallel after Task 1):
  Track A → Task 2  Backend: id-based validation + legacy id normalization
  Track A → Task 3  Backend: SqliteRepository.deleteNode + logAudit
  Track B → Task 5  Frontend: Api client methods (codes against contract)

Gate 1 (needs Tasks 2,3): Task 4  Backend: PUT/DELETE node + PATCH schema routes + applyFieldOp + API e2e

Wave 2 (needs Task 4 + Task 5):
  Track B → Task 6  Frontend: editable table UI
  Track B → Task 7  Frontend: Playwright e2e (needs live API + Task 6)

Gate 2: Task 8  Full test:all green + Increment-1 acceptance + tag
```

Worktree note: if parallelizing, branch tracks off the Task 1 commit; converge at gates. A track imports only `@combat/shared`.

---

## File Structure

```
packages/shared/src/
  types.ts        # MOD: FieldSchema += id, retired
  repository.ts   # MOD: Repository += deleteNode, logAudit
  registry.ts     # MOD: SchemaRegistry += applyFieldOp; + FieldOp union
config/schemas/
  attackTicket.json  # MOD: every field gets "id" = its name
  person.json        # MOD: every field gets "id" = its name
apps/backend/src/
  validation.ts   # MOD: iterate by id, read props[f.id], skip retired
  registry.ts     # MOD: normalize missing id→name on load; implement applyFieldOp (persist+reload+rollback)
  repository.ts   # MOD: deleteNode (+ cascade progress/edges), public logAudit
  routes.ts       # MOD: PUT /nodes/:id, DELETE /nodes/:id, PATCH /schema/:nodeType
  import.ts       # MOD: mapColumns writes out[f.id]
apps/backend/test/
  validation-id.test.ts   # NEW
  repository.test.ts      # MOD: + deleteNode tests
  schema-patch.e2e.test.ts# NEW: PATCH ops + rollback
  api.e2e.test.ts         # MOD: + PUT/DELETE node tests
apps/frontend/src/
  api.ts                  # MOD: + createNode/updateNode/deleteNode/patchSchema
  api.test.ts             # MOD: + one method test
  pages/AttackTable.tsx   # NEW: editable table (replaces AttackList usage)
  App.tsx                 # MOD: route /attack -> AttackTable
apps/frontend/e2e/
  editable.spec.ts        # NEW: FE-6..FE-12
```

Note on UX choice: editing is **row-level** (per-row 编辑→inputs→保存, 删除; a 新增行 draft row; column-header 改名/退休; a +字段 panel). Row-level edit is far less e2e-flaky than inline single-cell editing and satisfies "Excel-式表格" — chosen deliberately for the reliably-green-e2e directive.

---

## Task 1: `@combat/shared` contract evolution  *(Wave 0 — serial gate)*

**Files:**
- Modify: `packages/shared/src/types.ts`, `packages/shared/src/repository.ts`, `packages/shared/src/registry.ts`
- Test: `packages/shared/src/types.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to existing file)**

Append to `packages/shared/src/types.test.ts` inside the file (new `describe`):
```ts
import type { FieldSchema, Repository, SchemaRegistry, FieldOp } from "./index.js";

describe("increment-1 contracts", () => {
  it("FieldSchema has immutable id and optional retired", () => {
    const f: FieldSchema = { id: "标题", name: "标题", type: "string", label: "标题", required: true };
    const r: FieldSchema = { id: "x", name: "x", type: "string", label: "X", retired: true };
    expect(f.id).toBe("标题");
    expect(r.retired).toBe(true);
  });
  it("Repository requires deleteNode and logAudit", () => {
    const keys: (keyof Repository)[] = ["deleteNode", "logAudit", "createNode", "updateNode"];
    expect(keys).toContain("deleteNode");
  });
  it("FieldOp union and SchemaRegistry.applyFieldOp typecheck", () => {
    const ops: FieldOp[] = [
      { op: "addField", field: { name: "根因服务", type: "string", label: "根因服务" } },
      { op: "renameLabel", id: "标题", label: "问题标题" },
      { op: "editEnum", id: "状态", enumValues: ["待响应", "已关闭"] },
      { op: "retire", id: "事件级别" },
      { op: "unretire", id: "事件级别" },
    ];
    const applyKey: keyof SchemaRegistry = "applyFieldOp";
    expect(ops).toHaveLength(5);
    expect(applyKey).toBe("applyFieldOp");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting && npm run test:shared`
Expected: FAIL — `FieldSchema.id` missing / `FieldOp` not exported / `applyFieldOp` not on `SchemaRegistry` (type errors surfaced by vitest on the new `describe`).

- [ ] **Step 3: Implement contract changes**

In `packages/shared/src/types.ts`, replace the `FieldSchema` interface with:
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
}
```

In `packages/shared/src/repository.ts`, add to the `Repository` interface (after `listProgress`):
```ts
  deleteNode(id: string, actor: string): void;
  logAudit(action: string, entityType: string, entityId: string, changes: unknown, actor: string): void;
```

In `packages/shared/src/registry.ts`, add the `FieldOp` union and the `applyFieldOp` method. Final file content:
```ts
import type { EntitySchemaConfig, NodeSchema, FieldType } from "./types.js";

export interface ValidationResult { ok: boolean; errors: string[]; }

export type FieldOp =
  | { op: "addField"; field: { name: string; type: FieldType; label: string; required?: boolean; enumValues?: string[] } }
  | { op: "renameLabel"; id: string; label: string }
  | { op: "editEnum"; id: string; enumValues: string[] }
  | { op: "retire"; id: string }
  | { op: "unretire"; id: string };

export interface SchemaRegistry {
  getConfig(): EntitySchemaConfig;
  getNodeSchema(nodeType: string): NodeSchema | undefined;
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult;
  reload(): void;
  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema;
}
```

`packages/shared/src/index.ts` already does `export * from "./registry.js"` so `FieldOp` is exported automatically — verify no change needed.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd D:\fighting && npm run test:shared`
Expected: PASS (original 2 + new 3 = 5 tests).

- [ ] **Step 5: Commit**

```
git add packages/shared/src/types.ts packages/shared/src/repository.ts packages/shared/src/registry.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): contract evolution for editable schema (FieldSchema.id/retired, deleteNode/logAudit, FieldOp/applyFieldOp)"
```

---

## Task 2: Backend id-based validation + legacy id normalization  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:**
- Modify: `config/schemas/attackTicket.json`, `config/schemas/person.json`, `apps/backend/src/validation.ts`, `apps/backend/src/registry.ts`, `apps/backend/src/import.ts`
- Test: `apps/backend/test/validation-id.test.ts` (new)

- [ ] **Step 1: Write the failing test**

`apps/backend/test/validation-id.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FileSchemaRegistry } from "../src/registry.js";
import { validateNode } from "../src/validation.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function regWith(schema: object) {
  const dir = mkdtempSync(join(tmpdir(), "combat-vid-"));
  writeFileSync(join(dir, "t.json"), JSON.stringify(schema));
  return new FileSchemaRegistry(dir);
}

describe("id-based validation + legacy normalization", () => {
  it("legacy config without field.id gets id defaulted to name on load", () => {
    const reg = regWith({ nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ name: "标题", type: "string", label: "标题", required: true }] });
    expect(reg.getNodeSchema("t")!.fields[0].id).toBe("标题");
  });
  it("validateNode reads values by field.id and rejects missing required", () => {
    const reg = regWith({ nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ id: "标题", name: "标题", type: "string", label: "标题", required: true }] });
    expect(reg.validateNode("t", {}).ok).toBe(false);
    expect(reg.validateNode("t", { "标题": "x" }).ok).toBe(true);
  });
  it("validateNode skips retired fields entirely", () => {
    const reg = regWith({ nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ id: "f1", name: "f1", type: "enum", label: "F1", required: true,
                 enumValues: ["a"], retired: true }] });
    // retired required+enum field must NOT cause errors even when absent/invalid
    expect(reg.validateNode("t", {}).ok).toBe(true);
    expect(reg.validateNode("t", { f1: "不在枚举" }).ok).toBe(true);
  });
  it("validateNode unit: value read by id not name", () => {
    const schema = { nodeType: "t", label: "T", identityKeys: [], derivedToKG: false,
      fields: [{ id: "real-id", name: "displayName", type: "string", label: "L", required: true }] } as any;
    expect(validateNode(schema, { "displayName": "x" }).ok).toBe(false); // keyed by name -> missing
    expect(validateNode(schema, { "real-id": "x" }).ok).toBe(true);      // keyed by id -> present
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting/apps/backend && npx vitest run test/validation-id.test.ts`
Expected: FAIL — registry does not default `id`; `validateNode` still keys by `name`; retired not skipped.

- [ ] **Step 3: Implement**

Replace `apps/backend/src/validation.ts` with:
```ts
import type { NodeSchema, ValidationResult } from "@combat/shared";

export function validateNode(schema: NodeSchema, props: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  for (const f of schema.fields) {
    if (f.retired) continue;
    const v = props[f.id];
    if (f.required && (v === undefined || v === null || v === "")) {
      errors.push(`字段「${f.label}」必填`);
      continue;
    }
    if (v !== undefined && f.type === "enum" && f.enumValues && !f.enumValues.includes(String(v))) {
      errors.push(`字段「${f.label}」取值非法: ${String(v)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
```

In `apps/backend/src/registry.ts`, in `reload()`, after the shape guard and before pushing each parsed schema, normalize field ids. Replace the `.map(f => { ... })` body's `return raw as NodeSchema;` region so each field without `id` gets `id = name`:
```ts
  reload(): void {
    const nodeTypes: NodeSchema[] = readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(join(this.dir, f), "utf8"));
        } catch (e) {
          throw new Error(`Schema 配置文件 ${f} 不是合法 JSON: ${(e as Error).message}`);
        }
        const r = raw as { nodeType?: unknown; fields?: unknown };
        if (typeof r.nodeType !== "string" || !Array.isArray(r.fields)) {
          throw new Error(`Schema 配置文件 ${f} 缺少必需的 nodeType 或 fields`);
        }
        const ns = raw as NodeSchema;
        ns.fields = ns.fields.map(fd => ({ ...fd, id: fd.id ?? fd.name }));
        return ns;
      });
    this.config = { version: Date.now(), nodeTypes, edgeTypes: [] };
  }
```
(Keep the rest of `registry.ts` unchanged in this task — `applyFieldOp` is added in Task 4.)

In `apps/backend/src/import.ts`, in `mapColumns`, change the stored key from name to id:
```ts
    if (hit !== undefined) out[f.id] = row[hit];
```
(Only that one line changes; matching still uses `f.name`/`f.label`.)

Add `"id"` to every field in `config/schemas/attackTicket.json` and `config/schemas/person.json`, equal to that field's `name`. Example for the first attackTicket field: `{ "id": "攻关单号", "name": "攻关单号", "type": "string", "label": "攻关单号" }`. Do this for all 13 attackTicket fields and all 3 person fields. (The registry normalization also defaults this, but persisting it makes the config canonical for Task 4's PATCH ops.)

- [ ] **Step 4: Run tests, verify pass + no regression**

Run: `cd D:\fighting/apps/backend && npx vitest run test/validation-id.test.ts && npx vitest run`
Expected: validation-id 4/4 PASS; full backend suite still green (registry/repository/api.e2e/import) — `id == name` keeps existing data/tests valid. If `api.e2e`/`import` regress, the cause is a real id/name mismatch — fix `validation.ts`/`registry.ts`/config, not the tests.

- [ ] **Step 5: Commit**

```
git add apps/backend/src/validation.ts apps/backend/src/registry.ts apps/backend/src/import.ts config/schemas apps/backend/test/validation-id.test.ts
git commit -m "feat(backend): id-based validation, legacy id=name normalization, retired-field skip"
```

---

## Task 3: SqliteRepository.deleteNode + public logAudit  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:**
- Modify: `apps/backend/src/repository.ts`
- Test: `apps/backend/test/repository.test.ts` (append)

- [ ] **Step 1: Write the failing test (append inside the existing `describe("SqliteRepository")`)**

Append these tests:
```ts
  it("deleteNode removes node, its progress and edges, and audits", () => {
    const n = repo.createNode("attackTicket", { 标题: "a" }, "t");
    const other = repo.createNode("person", { name: "p" }, "t");
    repo.appendProgress(n.id, "d1", "进行中", "t");
    repo.createEdge("ASSIGNED_TO", n.id, other.id, {}, "t");
    repo.deleteNode(n.id, "killer");
    expect(repo.getNode(n.id)).toBeNull();
    expect(repo.listProgress(n.id)).toHaveLength(0);
    expect(repo.queryEdges({ sourceId: n.id })).toHaveLength(0);
    const a = db.prepare("SELECT * FROM audit_log WHERE action='DELETE' AND entityId=?").all(n.id) as any[];
    expect(a).toHaveLength(1);
    expect(a[0].performedBy).toBe("killer");
  });
  it("logAudit writes an arbitrary audit row", () => {
    repo.logAudit("SCHEMA_addField", "schema", "attackTicket", { x: 1 }, "alice");
    const a = db.prepare("SELECT * FROM audit_log WHERE action='SCHEMA_addField'").all() as any[];
    expect(a).toHaveLength(1);
    expect(a[0].performedBy).toBe("alice");
    expect(JSON.parse(a[0].changes)).toEqual({ x: 1 });
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting/apps/backend && npx vitest run test/repository.test.ts`
Expected: FAIL — `repo.deleteNode`/`repo.logAudit` are not functions.

- [ ] **Step 3: Implement**

In `apps/backend/src/repository.ts`, change the private `audit` into a public `logAudit` and keep an internal alias. Replace the existing `private audit(...) { ... }` method with:
```ts
  logAudit(action: string, entityType: string, entityId: string, changes: unknown, actor: string): void {
    this.db.prepare(
      `INSERT INTO audit_log VALUES (@id,@action,@entityType,@entityId,@changes,@by,@at)`
    ).run({ id: randomUUID(), action, entityType, entityId,
      changes: JSON.stringify(changes), by: actor, at: new Date().toISOString() });
  }
  private audit(action: string, entityType: string, entityId: string, changes: unknown, actor: string) {
    this.logAudit(action, entityType, entityId, changes, actor);
  }
```
(All existing internal `this.audit(...)` calls keep working.)

Add the `deleteNode` method (place after `appendProgress`/`listProgress`):
```ts
  deleteNode(id: string, actor: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM progress_log WHERE ownerId=?`).run(id);
      this.db.prepare(`DELETE FROM edges WHERE sourceId=? OR targetId=?`).run(id, id);
      this.db.prepare(`DELETE FROM nodes WHERE id=?`).run(id);
      this.audit("DELETE", "node", id, { id }, actor);
    })();
  }
```

- [ ] **Step 4: Run tests, verify pass + no regression**

Run: `cd D:\fighting/apps/backend && npx vitest run test/repository.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: repository tests all PASS (existing 3 + 2 new = 5); tsc zero errors (the class now structurally satisfies the extended `Repository`).

- [ ] **Step 5: Commit**

```
git add apps/backend/src/repository.ts apps/backend/test/repository.test.ts
git commit -m "feat(storage): deleteNode (cascade progress/edges, audited) + public logAudit"
```

---

## Task 4: PUT/DELETE node + PATCH schema routes + applyFieldOp + API e2e  *(Gate 1 — needs Tasks 2 & 3)*

**Files:**
- Modify: `apps/backend/src/registry.ts` (implement `applyFieldOp`), `apps/backend/src/routes.ts`
- Test: `apps/backend/test/schema-patch.e2e.test.ts` (new), `apps/backend/test/api.e2e.test.ts` (append)

- [ ] **Step 1: Write failing tests**

`apps/backend/test/schema-patch.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp } from "./helpers.js";

describe("PATCH /api/schema e2e", () => {
  it("addField: new id writable/readable, no DDL", async () => {
    const { app } = makeTestApp();
    const p = await request(app).patch("/api/schema/attackTicket")
      .send({ op: "addField", field: { name: "根因服务", type: "string", label: "根因服务" } });
    expect(p.status).toBe(200);
    expect(p.body.fields.some((f: any) => f.id === "根因服务")).toBe(true);
    const c = await request(app).post("/api/nodes/attackTicket")
      .send({ 标题: "x", 状态: "进行中", 根因服务: "ModelArts" });
    expect(c.status).toBe(201);
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["根因服务"]).toBe("ModelArts");
  });
  it("renameLabel: label changes, data still read by id", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "保留我", 状态: "进行中" });
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "renameLabel", id: "标题", label: "问题标题" });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "标题").label).toBe("问题标题");
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["标题"]).toBe("保留我");
  });
  it("retire: data retained, not validated; unretire restores", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "t", 状态: "进行中" });
    expect((await request(app).patch("/api/schema/attackTicket").send({ op: "retire", id: "状态" })).status).toBe(200);
    // 状态 now retired -> creating without it must pass (skipped in validation)
    expect((await request(app).post("/api/nodes/attackTicket").send({ 标题: "no-status" })).status).toBe(201);
    // old node still has its 状态 data
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["状态"]).toBe("进行中");
    const u = await request(app).patch("/api/schema/attackTicket").send({ op: "unretire", id: "状态" });
    expect(u.body.fields.find((f: any) => f.id === "状态").retired).toBe(false);
  });
  it("invalid op rolls back: bad addField leaves schema usable", async () => {
    const { app, cfgDir } = makeTestApp();
    const before = readFileSync(join(cfgDir, "attackTicket.json"), "utf8");
    const r = await request(app).patch("/api/schema/attackTicket").send({ op: "addField", field: { name: "", type: "string", label: "" } });
    expect(r.status).toBe(400);
    expect(readFileSync(join(cfgDir, "attackTicket.json"), "utf8")).toBe(before); // unchanged
    expect((await request(app).post("/api/nodes/attackTicket").send({ 标题: "still ok", 状态: "进行中" })).status).toBe(201);
  });
  it("addField duplicate name gets #2 suffixed id", async () => {
    const { app } = makeTestApp();
    const p = await request(app).patch("/api/schema/attackTicket").send({ op: "addField", field: { name: "标题", type: "string", label: "另一个标题" } });
    expect(p.status).toBe(200);
    expect(p.body.fields.some((f: any) => f.id === "标题#2")).toBe(true);
  });
});
```

Append to `apps/backend/test/api.e2e.test.ts` inside `describe("API e2e", ...)`:
```ts
  it("PUT /api/nodes/:id updates a record (validated)", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "old", 状态: "进行中" });
    const u = await request(app).put(`/api/nodes/${c.body.id}`).send({ 标题: "new" });
    expect(u.status).toBe(200);
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).body.properties["标题"]).toBe("new");
    const bad = await request(app).put(`/api/nodes/${c.body.id}`).send({ 状态: "不存在" });
    expect(bad.status).toBe(400);
  });
  it("DELETE /api/nodes/:id removes the record", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "del", 状态: "进行中" });
    expect((await request(app).delete(`/api/nodes/${c.body.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/nodes/${c.body.id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/nodes/does-not-exist`)).status).toBe(404);
  });
```

Note: `makeTestApp()` (locked `test/helpers.ts`) writes its own 2-field attackTicket config. `schema-patch` tests that reference `状态` use values in that helper's enum (`进行中`). The retire/addField/rename ops operate on that helper schema. `helpers.ts` must NOT be modified — its config already has `标题`(required) + `状态`(enum required), sufficient for these tests; field `id` is defaulted by the Task-2 registry normalization.

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd D:\fighting/apps/backend && npx vitest run test/schema-patch.e2e.test.ts test/api.e2e.test.ts`
Expected: FAIL — `applyFieldOp` not implemented; `PATCH/PUT/DELETE` routes 404.

- [ ] **Step 3: Implement applyFieldOp + routes**

In `apps/backend/src/registry.ts`: add imports and the `applyFieldOp` method to `FileSchemaRegistry`. Add `writeFileSync` to the `node:fs` import (currently `import { readdirSync, readFileSync } from "node:fs";` → add `writeFileSync`). Add `FieldOp` to the `@combat/shared` import. Implement:
```ts
  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema {
    const file = join(this.dir, `${nodeType}.json`);
    const prev = readFileSync(file, "utf8");
    const schema = JSON.parse(prev) as NodeSchema;
    schema.fields = schema.fields.map(f => ({ ...f, id: f.id ?? f.name }));

    const find = (id: string) => {
      const f = schema.fields.find(x => x.id === id);
      if (!f) throw new Error(`字段 id 不存在: ${id}`);
      return f;
    };
    if (op.op === "addField") {
      const { name, type, label } = op.field;
      if (!name || !type || !label) throw new Error("addField 需要 name/type/label");
      const ids = new Set(schema.fields.map(f => f.id));
      let id = name, n = 2;
      while (ids.has(id)) id = `${name}#${n++}`;
      schema.fields.push({ id, name, type, label,
        required: op.field.required, enumValues: op.field.enumValues });
    } else if (op.op === "renameLabel") {
      if (!op.label) throw new Error("renameLabel 需要非空 label");
      find(op.id).label = op.label;
    } else if (op.op === "editEnum") {
      find(op.id).enumValues = op.enumValues;
    } else if (op.op === "retire") {
      find(op.id).retired = true;
    } else if (op.op === "unretire") {
      find(op.id).retired = false;
    } else {
      throw new Error(`未知操作: ${(op as { op: string }).op}`);
    }

    writeFileSync(file, JSON.stringify(schema, null, 2));
    try {
      this.reload();
    } catch (e) {
      writeFileSync(file, prev);     // rollback file
      this.reload();                 // restore in-memory
      throw new Error(`Schema 变更后重载失败，已回滚: ${(e as Error).message}`);
    }
    return this.getNodeSchema(nodeType)!;
  }
```

In `apps/backend/src/routes.ts`, add three routes (place node PUT/DELETE near the other `/nodes` routes, PATCH near `/schema`). Insert:
```ts
  r.patch("/schema/:nodeType", (req, res) => {
    try {
      const s = registry.applyFieldOp(req.params.nodeType, req.body);
      repo.logAudit(`SCHEMA_${req.body?.op}`, "schema", req.params.nodeType, req.body, "api");
      res.json(s);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.put("/nodes/:id", (req, res) => {
    const cur = repo.getNode(req.params.id);
    if (!cur) return res.status(404).json({ error: "not found" });
    const v = registry.validateNode(cur.nodeType, { ...cur.properties, ...req.body });
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    res.json(repo.updateNode(req.params.id, req.body, "api"));
  });

  r.delete("/nodes/:id", (req, res) => {
    if (!repo.getNode(req.params.id)) return res.status(404).json({ error: "not found" });
    repo.deleteNode(req.params.id, "api");
    res.json({ ok: true });
  });
```
Routing note: `PUT`/`DELETE` on `/nodes/:id` do not collide with the existing dual `GET /nodes/:nodeType` (different HTTP methods). `PATCH /schema/:nodeType` is distinct from `POST /schema/scan`.

- [ ] **Step 4: Run tests, verify pass + full suite**

Run: `cd D:\fighting/apps/backend && npx vitest run test/schema-patch.e2e.test.ts test/api.e2e.test.ts && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: schema-patch 5/5 PASS; api.e2e PASS (prior 9 + 2 new = 11); full backend suite all green; tsc zero errors.

- [ ] **Step 5: Commit**

```
git add apps/backend/src/registry.ts apps/backend/src/routes.ts apps/backend/test/schema-patch.e2e.test.ts apps/backend/test/api.e2e.test.ts
git commit -m "feat(api): PUT/DELETE node + PATCH schema (applyFieldOp persist+reload+rollback) + e2e"
```

---

## Task 5: Frontend Api client methods  *(Wave 1 — Track B; depends on Task 1 only)*

**Files:**
- Modify: `apps/frontend/src/api.ts`, `apps/frontend/src/api.test.ts` (append)

- [ ] **Step 1: Write the failing test (append inside existing `describe("Api client")`)**

```ts
  it("createNode POSTs to the nodeType collection", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ id: "1", nodeType: "attackTicket", properties: {}, createdAt: "t", updatedAt: "t" }), { status: 201 }); });
    const api = new Api("http://x", fm as any);
    await api.createNode("attackTicket", { 标题: "a" });
    expect(calls[0][0]).toBe("http://x/api/nodes/attackTicket");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(calls[0][1].body)).toEqual({ 标题: "a" });
  });
  it("patchSchema PATCHes the schema endpoint with the op", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ nodeType: "attackTicket", label: "攻关单", fields: [], identityKeys: [], derivedToKG: true }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.patchSchema("attackTicket", { op: "retire", id: "状态" });
    expect(calls[0][0]).toBe("http://x/api/schema/attackTicket");
    expect(calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(calls[0][1].body)).toEqual({ op: "retire", id: "状态" });
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting/apps/frontend && npx vitest run src/api.test.ts`
Expected: FAIL — `api.createNode`/`api.patchSchema` are not functions.

- [ ] **Step 3: Implement (add methods to the `Api` class, before `importXlsx`)**

Add these methods to `apps/frontend/src/api.ts` (the class has `private req<T>`; reuse it). Add the `FieldOp` type import to the existing `import type { ... } from "@combat/shared"` line (append `, FieldOp`):
```ts
  createNode(nodeType: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${nodeType}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(props) });
  }
  updateNode(id: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(props) });
  }
  deleteNode(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/nodes/${id}`, { method: "DELETE" });
  }
  patchSchema(nodeType: string, op: FieldOp): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(op) });
  }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd D:\fighting/apps/frontend && npx vitest run src/api.test.ts`
Expected: PASS (prior + 2 new).

- [ ] **Step 5: Commit**

```
git add apps/frontend/src/api.ts apps/frontend/src/api.test.ts
git commit -m "feat(ui): Api client createNode/updateNode/deleteNode/patchSchema"
```

---

## Task 6: Editable table UI  *(Wave 2 — Track B; needs Task 4 + Task 5)*

**Files:**
- Create: `apps/frontend/src/pages/AttackTable.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Write a placeholder render test first (TDD for the component contract)**

Create `apps/frontend/src/pages/AttackTable.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { AttackTable } from "./AttackTable.js";

describe("AttackTable", () => {
  it("is exported as a component function", () => {
    expect(typeof AttackTable).toBe("function");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd D:\fighting/apps/frontend && npx vitest run src/pages/AttackTable.test.tsx`
Expected: FAIL — `./AttackTable.js` not found.

- [ ] **Step 3: Implement the editable table**

`apps/frontend/src/pages/AttackTable.tsx`:
```tsx
import { useEffect, useState, useCallback } from "react";
import { Table, Input, Button, Space, Popconfirm, message, Modal, Select } from "antd";
import { api } from "../api.js";
import type { GraphNode, NodeSchema, FieldSchema } from "@combat/shared";

const NODE = "attackTicket";

export function AttackTable() {
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [editing, setEditing] = useState<Record<string, Record<string, string>>>({});
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState({ name: "", label: "", type: "string" });

  const activeFields = (s: NodeSchema | null): FieldSchema[] =>
    (s?.fields ?? []).filter(f => !f.retired);

  const refresh = useCallback(async () => {
    const s = await api.getSchema(NODE); setSchema(s);
    setRows(await api.listNodes(NODE));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const saveRow = async (r: GraphNode) => {
    const patch = editing[r.id];
    try { await api.updateNode(r.id, patch); message.success("已保存");
      setEditing(e => { const n = { ...e }; delete n[r.id]; return n; }); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const delRow = async (id: string) => { await api.deleteNode(id); message.success("已删除"); await refresh(); };
  const createDraft = async () => {
    try { await api.createNode(NODE, draft ?? {}); message.success("已新增"); setDraft(null); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const patch = async (op: Parameters<typeof api.patchSchema>[1]) => {
    try { await api.patchSchema(NODE, op); message.success("字段已更新"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };

  const fields = activeFields(schema);
  const columns = [
    ...fields.map(f => ({
      title: (
        <Space size={4}>
          <span>{f.label}</span>
          <Button aria-label={`rename-${f.id}`} size="small" type="link" onClick={() => {
            const v = window.prompt(`重命名「${f.label}」`, f.label);
            if (v) patch({ op: "renameLabel", id: f.id, label: v });
          }}>改名</Button>
          <Popconfirm title={`退休字段「${f.label}」？数据保留`} onConfirm={() => patch({ op: "retire", id: f.id })}>
            <Button aria-label={`retire-${f.id}`} size="small" type="link" danger>退休</Button>
          </Popconfirm>
        </Space>
      ),
      dataIndex: f.id,
      render: (_: unknown, r: GraphNode) => {
        const e = editing[r.id];
        if (e) return <Input aria-label={`edit-${f.id}`} value={e[f.id] ?? String(r.properties[f.id] ?? "")}
          onChange={ev => setEditing(s => ({ ...s, [r.id]: { ...s[r.id], [f.id]: ev.target.value } }))} />;
        return String(r.properties[f.id] ?? "");
      },
    })),
    {
      title: <Button aria-label="add-field" onClick={() => setAddOpen(true)}>+字段</Button>,
      dataIndex: "__act",
      render: (_: unknown, r: GraphNode) => editing[r.id]
        ? <Space><Button aria-label={`save-${r.id}`} type="primary" onClick={() => saveRow(r)}>保存</Button></Space>
        : <Space>
            <Button aria-label={`edit-row-${r.id}`} onClick={() => setEditing(s => ({ ...s, [r.id]: {} }))}>编辑</Button>
            <Popconfirm title="删除该记录？" onConfirm={() => delRow(r.id)}>
              <Button aria-label={`del-row-${r.id}`} danger>删除</Button>
            </Popconfirm>
          </Space>,
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <h2>攻关作战台（可编辑）</h2>
      <Space style={{ marginBottom: 12 }}>
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
      <Table rowKey="id" dataSource={rows} columns={columns} pagination={false} />
      <Modal title="新增字段" open={addOpen} okText="添加"
        onCancel={() => setAddOpen(false)}
        onOk={async () => { await patch({ op: "addField", field: { name: nf.name, label: nf.label || nf.name, type: nf.type as FieldSchema["type"] } }); setAddOpen(false); setNf({ name: "", label: "", type: "string" }); }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input aria-label="nf-name" placeholder="字段名(name)" value={nf.name} onChange={e => setNf(s => ({ ...s, name: e.target.value }))} />
          <Input aria-label="nf-label" placeholder="显示名(label)" value={nf.label} onChange={e => setNf(s => ({ ...s, label: e.target.value }))} />
          <Select aria-label="nf-type" value={nf.type} style={{ width: 160 }}
            onChange={v => setNf(s => ({ ...s, type: v }))}
            options={["string", "number", "date", "datetime", "enum"].map(t => ({ value: t, label: t }))} />
        </Space>
      </Modal>
    </div>
  );
}
```

In `apps/frontend/src/App.tsx`, replace the `AttackList` import and the `/` + `/attack` routes to use `AttackTable`. Change:
```tsx
import { AttackList } from "./pages/AttackList.js";
```
to
```tsx
import { AttackTable } from "./pages/AttackTable.js";
```
and the two routes `element={<AttackList />}` → `element={<AttackTable />}` (the `/` and `/attack` routes). Leave `/attack/:id` (AttackDetail) and `/import` unchanged. (`AttackList.tsx` stays in the tree, just no longer routed — acceptable; do not delete it in this task.)

- [ ] **Step 4: Run test + build**

Run: `cd D:\fighting/apps/frontend && npx vitest run src/pages/AttackTable.test.tsx && npx vite build`
Expected: render test PASS; `vite build` succeeds (antd chunk-size warning OK).

- [ ] **Step 5: Commit**

```
git add apps/frontend/src/pages/AttackTable.tsx apps/frontend/src/pages/AttackTable.test.tsx apps/frontend/src/App.tsx
git commit -m "feat(ui): editable attack table (row CRUD + field add/rename/retire)"
```

---

## Task 7: Frontend Playwright e2e  *(Wave 2 — Track B; needs Task 4 live API + Task 6)*

**Files:**
- Create: `apps/frontend/e2e/editable.spec.ts`

- [ ] **Step 1: Write the failing e2e spec**

`apps/frontend/e2e/editable.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-6..FE-9 create / edit / delete record", async ({ page, request }) => {
  await page.goto("/attack");
  await page.getByLabel("new-row").click();                       // FE-6 create
  await page.getByLabel("draft-标题").fill("手工新建单");
  await page.getByLabel("draft-状态").fill("进行中");
  await page.getByLabel("create-row").click();
  await expect(page.getByText("手工新建单")).toBeVisible();

  await page.getByLabel(/edit-row-/).first().click();             // FE-7 edit
  await page.getByLabel("edit-标题").first().fill("改过的标题");
  await page.getByLabel(/save-/).first().click();
  await expect(page.getByText("改过的标题")).toBeVisible();
  await page.reload();                                            // FE-8 persists
  await expect(page.getByText("改过的标题")).toBeVisible();

  await page.getByLabel(/del-row-/).first().click();              // FE-9 delete
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("改过的标题")).toHaveCount(0);
});

test("FE-10..FE-12 add / rename / retire field", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "字段测试单", 状态: "进行中" } });
  await page.goto("/attack");

  await page.getByLabel("add-field").click();                     // FE-10 add field
  await page.getByLabel("nf-name").fill("根因服务");
  await page.getByLabel("nf-label").fill("根因服务");
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByText("根因服务")).toBeVisible();

  await page.getByLabel(/^rename-标题$/).click();                 // FE-11 rename (window.prompt)
  page.on("dialog", d => d.accept("问题标题"));
  await page.goto("/attack");
  await expect(page.getByText("问题标题")).toBeVisible();
  await expect(page.getByText("字段测试单")).toBeVisible();        // data kept by id

  await page.getByLabel(/^retire-状态$/).click();                 // FE-12 retire
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByLabel(/^retire-状态$/)).toHaveCount(0);   // column gone
  await expect(page.getByText("字段测试单")).toBeVisible();        // data retained
});
```

- [ ] **Step 2: Run e2e, verify it fails / surfaces drift**

Run: `cd D:\fighting/apps/frontend && npx playwright test editable.spec.ts`
Expected: FAIL initially (selectors / `window.prompt` dialog timing). Diagnose each.

- [ ] **Step 3: Fix contract drift (minimal, app side preferred)**

Likely real fixes (apply the smallest correct change to `AttackTable.tsx`, not the test, unless the test is wrong):
- `window.prompt` rename: Playwright must register `page.on("dialog", ...)` BEFORE the click. If flaky, change rename UX to an AntD `Modal` with an `aria-label="rename-input"` instead of `window.prompt` (more deterministic — recommended if the dialog races). Update the test accordingly only if you change the app UX; keep the assertion intent (label changes, data kept).
- AntD `Popconfirm` confirm button text is `OK` by default; if locale renders differently, set `okText="OK"` on the `Popconfirm`s.
- `getByText("根因服务")` could match both the new column header and the add-field modal remnants — scope with a column-header role or `.first()` if a strict-mode violation occurs (do not weaken intent).

- [ ] **Step 4: Run e2e until green twice consecutively**

Run: `cd D:\fighting/apps/frontend && npx playwright test` (runs attack.spec.ts + editable.spec.ts)
Expected: ALL pass. Run again immediately — must pass again (deterministic global-setup wipes DB).

- [ ] **Step 5: Commit**

```
git add apps/frontend/e2e/editable.spec.ts apps/frontend/src/pages/AttackTable.tsx
git commit -m "test(ui): Playwright e2e FE-6..FE-12 (record CRUD + field add/rename/retire)"
```

---

## Task 8: Full suite green + Increment-1 acceptance + tag  *(Gate 2)*

**Files:** none (verification + tag only).

- [ ] **Step 1: Run the whole aggregate suite**

Run: `cd D:\fighting && npm run test:all`
Expected ALL green: shared 5 · backend (repository 5, registry 6, validation-id 4, api.e2e 11, import 1, schema-patch 5) · frontend-unit (api 3 + AttackTable 1) · frontend-e2e (attack 2 + editable 2). If anything fails, STOP and report BLOCKED with root cause — do not weaken tests.

- [ ] **Step 2: Verify PRD §14.2 E acceptance — map each to a green test**

Confirm and cite:
- 记录 建/改/删 + 审计 → `api.e2e` PUT/DELETE + `repository.test` deleteNode-audit + `FE-6..FE-9`
- PATCH 加字段 → 新 id 可写读，零 DDL → `schema-patch` addField + `FE-10`
- 改 label → 老数据按 id 仍取到 → `schema-patch` renameLabel + `FE-11`
- 退休字段 → 数据保留、不再校验、可恢复 → `schema-patch` retire/unretire + `validation-id` retired-skip + `FE-12`
- 非法 schema 写入 → 回滚且旧 schema 可用 → `schema-patch` rollback test
- DELETE 不存在 id → 合理响应 → `api.e2e` DELETE 404

State explicitly: all covered & green (yes/no).

- [ ] **Step 3: Commit marker + tag**

```
cd D:\fighting
git commit --allow-empty -m "chore: increment-1 (editable schema) acceptance verified"
git tag increment-1-editable-schema
git tag --list increment-1-editable-schema
```

---

## Self-Review

**1. Spec coverage (PRD §14.2 A–E):**
- A stable id/label decoupling → Task 1 (FieldSchema.id) + Task 2 (validate by id, legacy id=name, config ids) ✓
- B field mgmt PATCH + write-back + rollback + non-destructive retire + audit → Task 4 (applyFieldOp persist/reload/rollback; PATCH route; `repo.logAudit` schema audit) + Task 1/3 (logAudit) ✓
- C record CRUD + editable table → Task 3 (deleteNode) + Task 4 (PUT/DELETE routes) + Task 5 (Api) + Task 6 (UI) ✓
- D no layout switch → not built (Task 6 is table-only) ✓
- E TDD + front/back e2e → every task TDD; backend e2e (validation-id, schema-patch, api.e2e additions, repository); Playwright FE-6..FE-12; Task 8 aggregate ✓
- §14.3 correctly NOT implemented (deferred) ✓

**2. Placeholder scan:** No TBD/“handle errors”/“similar to”. The Task-7 Step-3 “likely fixes” are contingency guidance with concrete code directions, not a placeholder implementation (the e2e is real and must pass in Step 4). Open question §13#7 finalized inline (id=name, `#n` collision). No undefined types: `FieldOp`/`FieldSchema.id`/`Repository.deleteNode`/`logAudit`/`applyFieldOp` all defined in Task 1 and used consistently thereafter.

**3. Type consistency:** `FieldOp` shape (addField.field{name,type,label,required?,enumValues?}; renameLabel{id,label}; editEnum{id,enumValues}; retire/unretire{id}) is identical across Task 1 (def), Task 4 (applyFieldOp impl + tests), Task 5 (Api.patchSchema + test), Task 6 (UI calls), Task 7 (e2e). `repo.logAudit(action,entityType,entityId,changes,actor)` identical in Task 1 (iface), Task 3 (impl/test), Task 4 (schema audit call). `deleteNode(id,actor)` identical Task 1/3/4. Frontend reads/writes `properties[f.id]`, columns `dataIndex:f.id`/`title:f.label` consistently (Task 6) matching backend id-keyed storage (Task 2). `makeTestApp()`/`helpers.ts` left unmodified; new backend tests rely only on its existing 标题/状态 fields whose ids are normalized to their names by Task 2.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-increment1-editable-schema.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec then quality) between tasks, fast iteration. Maps onto the wave map (Task 1 solo gate; 2/3/5 parallelizable; Task 4 gate; 6→7; Task 8 gate).

**2. Inline Execution** — execute in this session via executing-plans with checkpoints.

Which approach?
