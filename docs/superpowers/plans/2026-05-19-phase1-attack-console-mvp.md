# Phase 1 — Attack Console MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the leanest usable P0-① 攻关作战台 (attack console): import attack tickets from Excel, view/filter them, view detail, and append a traceable daily-progress sequence — all on a config-driven, no-DDL data foundation.

**Architecture:** Monorepo (npm workspaces). Backend = Express + better-sqlite3 with one generic `nodes`/`edges`/`progress_log`/`audit_log` store; business fields live in a `properties` JSON column (adding a field is a config change, never a migration). A file-based Schema Registry loads JSON `EntitySchema` configs and drives validation + the frontend's dynamic columns. Frontend = Vite + React + Ant Design rendering tables/detail from schema. Structured store is the only write path (PRD §0.3); KG/automation/multi-form are out of Phase 1 scope.

**Tech Stack (locked for this plan — raise objections at execution handoff):** Node 20 + TypeScript, npm workspaces, Express, better-sqlite3, Vite + React + Ant Design, xlsx (SheetJS); tests = Vitest (unit/integration) + supertest (backend API e2e) + Playwright (frontend e2e).

---

## Scope (Fast MVP — trim features, not rigor)

**In:** scaffold; generic config-driven SQLite store (no DDL); Schema Registry + validation; `attackTicket`/`person` baseline configs; REST API (list/filter/get/create node, append/list progress, get schema, scan config); minimal Excel→AttackTicket import with Person entity resolution; attack console (list+filter+detail+progress timeline) with schema-driven columns; full backend+frontend e2e.

**Deferred to later phases (PRD §10):** derived KG & graph views, 荣誉殿堂, automation/SLA/escalation, multi-form switching, edges UI, incremental import, RBAC, other entity types beyond what import needs.

---

## Parallel Execution Map

The user directive (CLAUDE.md core principle) is maximum parallelism. Tasks are grouped into waves; within a wave, tracks are independent and SHOULD run as concurrent agents in separate git worktrees, converging at gates.

```
Wave 0 (SERIAL gate — one agent, blocks everything):
  Task 1  Scaffold + shared contracts + test harness
            └─ defines @combat/shared interfaces (Repository, SchemaRegistry, types)
               that let Wave 1 tracks code against contracts, not each other.

Wave 1 (PARALLEL — 3 worktrees/agents, depend only on Task 1):
  Track A → Task 2  SQLite storage (Repository impl)
  Track B → Task 3  Schema Registry + baseline configs + validation
  Track C → Task 4  Frontend attack-console shell vs mock API

Gate 1 (SERIAL — one agent; needs Task 2 + Task 3):
  Task 5  Backend API wiring (storage + registry → REST) + API e2e

Wave 2 (PARALLEL — 2 worktrees/agents, depend on Task 5):
  Track D → Task 6  Minimal Excel import + entity resolution
  Track C → Task 7  Wire console to real API (list/filter/detail/progress)

Gate 2 (SERIAL — one agent; needs all):
  Task 8  Full e2e suite green + Phase 1 acceptance check
```

**Worktree guidance:** before Wave 1, create one worktree per track via the `superpowers:using-git-worktrees` skill, all branched off the commit that completes Task 1. Each track commits independently; gates merge tracks back to the integration branch before proceeding. A track must NOT import another track's internal files — only `@combat/shared`.

---

## E2E Test Catalog (covers all Phase 1 features, front + back)

These are implemented inside the tasks below (referenced by ID). Gate 2 requires all green.

**Backend API e2e** (supertest, fresh temp SQLite DB + real Schema Registry per test):
- `BE-1` POST `/api/nodes/attackTicket` with valid props → 201, returns node with `id`; GET confirms persisted.
- `BE-2` POST missing required `标题` → 400, body `{errors:[...]}` (config-driven required).
- `BE-3` POST `状态:"不存在"` → 400 (config-driven enum; Chinese literals canonical).
- `BE-4` GET `/api/nodes/attackTicket` → all; `?状态=进行中` filters correctly.
- `BE-5` GET `/api/nodes/:id` → detail; unknown id → 404.
- `BE-6` POST `/api/nodes/:id/progress` ×3 → `seqNo` 1,2,3; GET returns ordered; earlier entries retained (append-only/traceable); an `audit_log` row exists per append.
- `BE-7` No-DDL proof: append field `根因服务` to `attackTicket` config → POST `/api/schema/scan` → POST node with `根因服务` → 200, value round-trips in `properties` (no migration, no schema error).
- `BE-8` POST `/api/import` with a 2-row xlsx where both rows share one `攻关申请人` (same employeeId) → 2 AttackTicket nodes + exactly 1 Person node (entity resolution).

**Frontend e2e** (Playwright, backend+frontend running, DB seeded via API):
- `FE-1` Visit `/attack` → table renders seeded rows; column headers = schema field labels.
- `FE-2` Type in the 状态 filter → row count narrows to matching.
- `FE-3` Click a row → `/attack/:id`; detail shows the ticket's field values.
- `FE-4` Submit progress form → Timeline shows new entry at the top of the sequence with seqNo; previously seeded entries still visible (traceable).
- `FE-5` Visit `/import`, upload `fixtures/sample.xlsx` → success toast; `/attack` now lists the imported tickets.

---

## File Structure

```
D:\fighting\
  package.json                         # root: npm workspaces, scripts
  tsconfig.base.json                   # shared TS config
  .gitignore
  config/schemas/
    attackTicket.json                  # AttackTicket EntitySchema (PRD §2.3)
    person.json                        # Person EntitySchema
  packages/shared/
    package.json                       # @combat/shared
    src/index.ts                       # re-exports
    src/types.ts                       # FieldSchema/NodeSchema/EntitySchemaConfig/GraphNode/GraphEdge/ProgressLog
    src/repository.ts                  # Repository, NodeFilter interfaces
    src/registry.ts                    # SchemaRegistry interface
  apps/backend/
    package.json                       # @combat/backend
    src/db.ts                          # better-sqlite3 open + table DDL (storage tables only, NOT business fields)
    src/repository.ts                  # SqliteRepository implements Repository
    src/registry.ts                    # FileSchemaRegistry implements SchemaRegistry
    src/validation.ts                  # validateNode(schema, props)
    src/import.ts                      # parseWorkbook + resolvePerson + importAttackTickets
    src/routes.ts                      # express Router: nodes, progress, schema, import
    src/app.ts                         # createApp(deps) -> express.Express
    src/server.ts                      # bootstrap (real db + config dir)
    test/helpers.ts                    # makeTestApp() -> {app, repo, registry, dbPath}
    test/*.e2e.test.ts                 # BE-1..BE-8
  apps/frontend/
    package.json                       # @combat/frontend
    index.html
    vite.config.ts
    src/main.tsx
    src/App.tsx                        # router
    src/api.ts                         # typed client over fetch
    src/pages/AttackList.tsx
    src/pages/AttackDetail.tsx
    src/pages/ImportPage.tsx
    e2e/fixtures/sample.xlsx           # generated test fixture
    e2e/attack.spec.ts                 # FE-1..FE-5
    playwright.config.ts
```

---

## Task 1: Scaffold + shared contracts + test harness  *(Wave 0 — serial gate)*

**Files:**
- Create: `D:\fighting\package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `src/types.ts`, `src/repository.ts`, `src/registry.ts`
- Create: `apps/backend/package.json`, `apps/frontend/package.json` (skeletons)
- Test: `packages/shared/src/types.test.ts`

- [ ] **Step 1: Init git + root workspace**

`D:\fighting\.gitignore`:
```
node_modules/
dist/
*.sqlite
apps/frontend/test-results/
apps/frontend/playwright-report/
```

`D:\fighting\package.json`:
```json
{
  "name": "combat-tool",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test:shared": "npm run test --workspace=@combat/shared",
    "test:backend": "npm run test --workspace=@combat/backend",
    "test:frontend:e2e": "npm run test:e2e --workspace=@combat/frontend",
    "dev:backend": "npm run dev --workspace=@combat/backend",
    "dev:frontend": "npm run dev --workspace=@combat/frontend"
  }
}
```

`D:\fighting\tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

Run:
```
cd D:\fighting
git init
```

- [ ] **Step 2: Write failing test for shared types**

`packages/shared/src/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { EntitySchemaConfig, GraphNode, ProgressLog } from "./index.js";

describe("shared types", () => {
  it("EntitySchemaConfig shape compiles and is usable", () => {
    const cfg: EntitySchemaConfig = {
      version: 1,
      nodeTypes: [{
        nodeType: "attackTicket", label: "攻关单",
        identityKeys: ["攻关单号"], derivedToKG: true,
        fields: [{ name: "标题", type: "string", label: "标题", required: true }],
      }],
      edgeTypes: [{ edgeType: "ASSIGNED_TO", from: "attackTicket", to: "person" }],
    };
    expect(cfg.nodeTypes[0].fields[0].required).toBe(true);
  });
  it("GraphNode and ProgressLog carry JSON properties / sequence", () => {
    const n: GraphNode = { id: "1", nodeType: "attackTicket", properties: { 标题: "x" }, createdAt: "t", updatedAt: "t" };
    const p: ProgressLog = { id: "p1", ownerId: "1", seqNo: 1, content: "c", statusSnapshot: "进行中", updatedBy: "u", updatedAt: "t" };
    expect(n.properties["标题"]).toBe("x");
    expect(p.seqNo).toBe(1);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm i -w @combat/shared -D vitest typescript` then `npm run test:shared`
Expected: FAIL — cannot find `./index.js` / module not built.

- [ ] **Step 4: Implement shared package**

`packages/shared/package.json`:
```json
{
  "name": "@combat/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```

`packages/shared/src/types.ts`:
```ts
export type FieldType = "string" | "number" | "date" | "datetime" | "enum" | "ref" | "sequence";

export interface FieldSchema {
  name: string;
  type: FieldType;
  label: string;
  required?: boolean;
  enumValues?: string[];
  refType?: string;
}
export interface NodeSchema {
  nodeType: string;
  label: string;
  fields: FieldSchema[];
  identityKeys: string[];
  derivedToKG: boolean;
}
export interface EdgeSchema { edgeType: string; from: string; to: string; }
export interface EntitySchemaConfig {
  version: number;
  nodeTypes: NodeSchema[];
  edgeTypes: EdgeSchema[];
}

export interface GraphNode {
  id: string;
  nodeType: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface GraphEdge {
  id: string;
  edgeType: string;
  sourceId: string;
  targetId: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface ProgressLog {
  id: string;
  ownerId: string;
  seqNo: number;
  content: string;
  statusSnapshot: string;
  updatedBy: string;
  updatedAt: string;
}
```

`packages/shared/src/repository.ts`:
```ts
import type { GraphNode, GraphEdge, ProgressLog } from "./types.js";

export type NodeFilter = Record<string, unknown>;

export interface Repository {
  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): GraphNode;
  getNode(id: string): GraphNode | null;
  updateNode(id: string, patch: Record<string, unknown>, actor: string): GraphNode;
  queryNodes(nodeType: string, filter?: NodeFilter): GraphNode[];
  createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): GraphEdge;
  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): GraphEdge[];
  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): ProgressLog;
  listProgress(ownerId: string): ProgressLog[];
}
```

`packages/shared/src/registry.ts`:
```ts
import type { EntitySchemaConfig, NodeSchema } from "./types.js";

export interface ValidationResult { ok: boolean; errors: string[]; }

export interface SchemaRegistry {
  getConfig(): EntitySchemaConfig;
  getNodeSchema(nodeType: string): NodeSchema | undefined;
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult;
  reload(): void;
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./types.js";
export * from "./repository.js";
export * from "./registry.js";
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm run test:shared`
Expected: PASS (2 tests).

- [ ] **Step 6: Backend & frontend package skeletons**

`apps/backend/package.json`:
```json
{
  "name": "@combat/backend",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@combat/shared": "*",
    "express": "^4.19.0",
    "better-sqlite3": "^11.0.0",
    "multer": "^1.4.5-lts.1",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "tsx": "^4.16.0", "vitest": "^2.0.0", "supertest": "^7.0.0",
    "typescript": "^5.5.0", "@types/express": "^4.17.21",
    "@types/better-sqlite3": "^7.6.11", "@types/supertest": "^6.0.2",
    "@types/multer": "^1.4.11"
  }
}
```

`apps/frontend/package.json`:
```json
{
  "name": "@combat/frontend",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@combat/shared": "*",
    "react": "^18.3.0", "react-dom": "^18.3.0",
    "react-router-dom": "^6.25.0", "antd": "^5.19.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0", "vite": "^5.3.0",
    "typescript": "^5.5.0", "@playwright/test": "^1.45.0",
    "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0"
  }
}
```

Run: `cd D:\fighting && npm install`
Expected: workspaces linked, no errors.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "chore: scaffold monorepo + @combat/shared contracts + test harness"
```

---

## Task 2: SQLite storage (Repository impl)  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:**
- Create: `apps/backend/src/db.ts`, `apps/backend/src/repository.ts`
- Test: `apps/backend/test/repository.test.ts`

- [ ] **Step 1: Write failing test**

`apps/backend/test/repository.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import type { Repository } from "@combat/shared";

let repo: Repository;
beforeEach(() => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "combat-")), "t.sqlite"));
  repo = new SqliteRepository(db);
});

describe("SqliteRepository", () => {
  it("creates and reads a node with JSON properties (no DDL per field)", () => {
    const n = repo.createNode("attackTicket", { 标题: "断连", 状态: "进行中" }, "tester");
    expect(n.id).toBeTruthy();
    expect(repo.getNode(n.id)?.properties["标题"]).toBe("断连");
  });
  it("queryNodes filters by property equality", () => {
    repo.createNode("attackTicket", { 标题: "a", 状态: "进行中" }, "t");
    repo.createNode("attackTicket", { 标题: "b", 状态: "已解决" }, "t");
    expect(repo.queryNodes("attackTicket", { 状态: "进行中" })).toHaveLength(1);
  });
  it("appendProgress is append-only with monotonic seqNo and is audited", () => {
    const n = repo.createNode("attackTicket", { 标题: "a" }, "t");
    repo.appendProgress(n.id, "day1", "进行中", "alice");
    repo.appendProgress(n.id, "day2", "进行中", "alice");
    const seq = repo.listProgress(n.id);
    expect(seq.map(p => p.seqNo)).toEqual([1, 2]);
    expect(seq[0].content).toBe("day1");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/backend && npx vitest run test/repository.test.ts`
Expected: FAIL — `../src/db.js` not found.

- [ ] **Step 3: Implement db + repository**

`apps/backend/src/db.ts`:
```ts
import Database from "better-sqlite3";

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, nodeType TEXT NOT NULL, properties TEXT NOT NULL,
      search_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY, edgeType TEXT NOT NULL, sourceId TEXT NOT NULL,
      targetId TEXT NOT NULL, properties TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS progress_log (
      id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, seqNo INTEGER NOT NULL,
      content TEXT NOT NULL, statusSnapshot TEXT, updatedBy TEXT, updatedAt TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, entityType TEXT, entityId TEXT,
      changes TEXT, performedBy TEXT, performedAt TEXT);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(sourceId);
    CREATE INDEX IF NOT EXISTS idx_progress_owner ON progress_log(ownerId, seqNo);
  `);
  return db;
}
```

`apps/backend/src/repository.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import type { Repository, NodeFilter, GraphNode, GraphEdge, ProgressLog } from "@combat/shared";

export class SqliteRepository implements Repository {
  constructor(private db: DB) {}

  private audit(action: string, entityType: string, entityId: string, changes: unknown, actor: string) {
    this.db.prepare(
      `INSERT INTO audit_log VALUES (@id,@action,@entityType,@entityId,@changes,@by,@at)`
    ).run({ id: randomUUID(), action, entityType, entityId,
      changes: JSON.stringify(changes), by: actor, at: new Date().toISOString() });
  }

  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): GraphNode {
    const now = new Date().toISOString();
    const node: GraphNode = { id: randomUUID(), nodeType, properties, createdAt: now, updatedAt: now };
    this.db.prepare(
      `INSERT INTO nodes VALUES (@id,@nodeType,@properties,@search,@c,@u)`
    ).run({ id: node.id, nodeType, properties: JSON.stringify(properties),
      search: Object.values(properties).join(" "), c: now, u: now });
    this.audit("CREATE", "node", node.id, properties, actor);
    return node;
  }

  getNode(id: string): GraphNode | null {
    const r = this.db.prepare(`SELECT * FROM nodes WHERE id=?`).get(id) as any;
    if (!r) return null;
    return { id: r.id, nodeType: r.nodeType, properties: JSON.parse(r.properties),
      createdAt: r.created_at, updatedAt: r.updated_at };
  }

  updateNode(id: string, patch: Record<string, unknown>, actor: string): GraphNode {
    const cur = this.getNode(id);
    if (!cur) throw new Error(`node ${id} not found`);
    const properties = { ...cur.properties, ...patch };
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE nodes SET properties=?, search_text=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(properties), Object.values(properties).join(" "), now, id);
    this.audit("UPDATE", "node", id, patch, actor);
    return { ...cur, properties, updatedAt: now };
  }

  queryNodes(nodeType: string, filter?: NodeFilter): GraphNode[] {
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE nodeType=?`).all(nodeType) as any[];
    let out = rows.map(r => ({ id: r.id, nodeType: r.nodeType,
      properties: JSON.parse(r.properties), createdAt: r.created_at, updatedAt: r.updated_at }));
    if (filter) out = out.filter(n => Object.entries(filter).every(([k, v]) => n.properties[k] === v));
    return out;
  }

  createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): GraphEdge {
    const now = new Date().toISOString();
    const e: GraphEdge = { id: randomUUID(), edgeType, sourceId, targetId, properties, createdAt: now, updatedAt: now };
    this.db.prepare(`INSERT INTO edges VALUES (@id,@edgeType,@s,@t,@p,@c,@u)`)
      .run({ id: e.id, edgeType, s: sourceId, t: targetId, p: JSON.stringify(properties), c: now, u: now });
    this.audit("CREATE", "edge", e.id, { edgeType, sourceId, targetId }, actor);
    return e;
  }

  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): GraphEdge[] {
    const rows = this.db.prepare(`SELECT * FROM edges`).all() as any[];
    return rows.map(r => ({ id: r.id, edgeType: r.edgeType, sourceId: r.sourceId,
      targetId: r.targetId, properties: JSON.parse(r.properties), createdAt: r.created_at, updatedAt: r.updated_at }))
      .filter(e => (!opts.sourceId || e.sourceId === opts.sourceId)
        && (!opts.targetId || e.targetId === opts.targetId)
        && (!opts.edgeType || e.edgeType === opts.edgeType));
  }

  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): ProgressLog {
    const max = this.db.prepare(`SELECT MAX(seqNo) m FROM progress_log WHERE ownerId=?`).get(ownerId) as any;
    const p: ProgressLog = { id: randomUUID(), ownerId, seqNo: (max?.m ?? 0) + 1,
      content, statusSnapshot, updatedBy: actor, updatedAt: new Date().toISOString() };
    this.db.prepare(`INSERT INTO progress_log VALUES (@id,@ownerId,@seqNo,@content,@s,@by,@at)`)
      .run({ id: p.id, ownerId, seqNo: p.seqNo, content, s: statusSnapshot, by: actor, at: p.updatedAt });
    this.audit("PROGRESS", "node", ownerId, { seqNo: p.seqNo, content }, actor);
    return p;
  }

  listProgress(ownerId: string): ProgressLog[] {
    return this.db.prepare(`SELECT * FROM progress_log WHERE ownerId=? ORDER BY seqNo`).all(ownerId) as any[];
  }
}
```

`apps/backend/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/backend && npx vitest run test/repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add apps/backend/src/db.ts apps/backend/src/repository.ts apps/backend/test/repository.test.ts apps/backend/tsconfig.json
git commit -m "feat(storage): config-driven SQLite repository with audited append-only progress"
```

---

## Task 3: Schema Registry + baseline configs + validation  *(Wave 1 — Track B)*

**Depends on:** Task 1. **Files:**
- Create: `config/schemas/attackTicket.json`, `config/schemas/person.json`
- Create: `apps/backend/src/validation.ts`, `apps/backend/src/registry.ts`
- Test: `apps/backend/test/registry.test.ts`

- [ ] **Step 1: Write failing test**

`apps/backend/test/registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FileSchemaRegistry } from "../src/registry.js";
import { join } from "node:path";

const CONFIG_DIR = join(process.cwd(), "..", "..", "config", "schemas");

describe("FileSchemaRegistry", () => {
  const reg = new FileSchemaRegistry(CONFIG_DIR);
  it("loads attackTicket schema from config dir", () => {
    expect(reg.getNodeSchema("attackTicket")?.label).toBe("攻关单");
  });
  it("rejects missing required field", () => {
    const r = reg.validateNode("attackTicket", { 状态: "进行中" });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("标题");
  });
  it("rejects invalid enum value (Chinese literals canonical)", () => {
    const r = reg.validateNode("attackTicket", { 标题: "x", 状态: "不存在" });
    expect(r.ok).toBe(false);
  });
  it("accepts valid node", () => {
    expect(reg.validateNode("attackTicket", { 标题: "x", 状态: "进行中" }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/backend && npx vitest run test/registry.test.ts`
Expected: FAIL — `../src/registry.js` not found.

- [ ] **Step 3: Implement configs + validation + registry**

`config/schemas/attackTicket.json` (fields from PRD §2.3; enum literals canonical):
```json
{
  "nodeType": "attackTicket",
  "label": "攻关单",
  "identityKeys": ["攻关单号"],
  "derivedToKG": true,
  "fields": [
    { "name": "攻关单号", "type": "string", "label": "攻关单号" },
    { "name": "标题", "type": "string", "label": "标题", "required": true },
    { "name": "问题描述", "type": "string", "label": "问题描述" },
    { "name": "事件级别", "type": "string", "label": "事件级别" },
    { "name": "状态", "type": "enum", "label": "状态", "required": true,
      "enumValues": ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
    { "name": "客户名称", "type": "string", "label": "客户名称" },
    { "name": "客户要求解决时间", "type": "datetime", "label": "客户要求解决时间" },
    { "name": "攻关申请人", "type": "string", "label": "攻关申请人" },
    { "name": "攻关申请人工号", "type": "string", "label": "攻关申请人工号" },
    { "name": "当前处理人", "type": "string", "label": "当前处理人" },
    { "name": "攻关组长", "type": "string", "label": "攻关组长" },
    { "name": "是否已解决", "type": "string", "label": "是否已解决" },
    { "name": "攻关有效性", "type": "string", "label": "攻关有效性" }
  ]
}
```

`config/schemas/person.json`:
```json
{
  "nodeType": "person",
  "label": "人员",
  "identityKeys": ["employeeId", "email"],
  "derivedToKG": true,
  "fields": [
    { "name": "name", "type": "string", "label": "姓名", "required": true },
    { "name": "employeeId", "type": "string", "label": "工号" },
    { "name": "email", "type": "string", "label": "邮箱" }
  ]
}
```

`apps/backend/src/validation.ts`:
```ts
import type { NodeSchema, ValidationResult } from "@combat/shared";

export function validateNode(schema: NodeSchema, props: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  for (const f of schema.fields) {
    const v = props[f.name];
    if (f.required && (v === undefined || v === null || v === "")) {
      errors.push(`字段「${f.name}」必填`);
      continue;
    }
    if (v !== undefined && f.type === "enum" && f.enumValues && !f.enumValues.includes(String(v))) {
      errors.push(`字段「${f.name}」取值非法: ${String(v)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
```

`apps/backend/src/registry.ts`:
```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaRegistry, EntitySchemaConfig, NodeSchema, ValidationResult } from "@combat/shared";
import { validateNode } from "./validation.js";

export class FileSchemaRegistry implements SchemaRegistry {
  private config!: EntitySchemaConfig;
  constructor(private dir: string) { this.reload(); }

  reload(): void {
    const nodeTypes: NodeSchema[] = readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as NodeSchema);
    this.config = { version: Date.now(), nodeTypes, edgeTypes: [] };
  }
  getConfig(): EntitySchemaConfig { return this.config; }
  getNodeSchema(nodeType: string): NodeSchema | undefined {
    return this.config.nodeTypes.find(n => n.nodeType === nodeType);
  }
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult {
    const s = this.getNodeSchema(nodeType);
    if (!s) return { ok: false, errors: [`未知节点类型: ${nodeType}`] };
    return validateNode(s, properties);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/backend && npx vitest run test/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```
git add config/schemas apps/backend/src/validation.ts apps/backend/src/registry.ts apps/backend/test/registry.test.ts
git commit -m "feat(schema): file-based Schema Registry + config-driven validation + baseline configs"
```

---

## Task 4: Frontend attack-console shell vs mock API  *(Wave 1 — Track C)*

**Depends on:** Task 1 (only `@combat/shared`). Builds UI against a typed API client whose network calls are mocked, so it parallelizes with Tasks 2–3.

**Files:**
- Create: `apps/frontend/index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/pages/AttackList.tsx`, `src/pages/AttackDetail.tsx`, `src/pages/ImportPage.tsx`
- Test: `apps/frontend/src/api.test.ts`

- [ ] **Step 1: Write failing test for the API client contract**

`apps/frontend/src/api.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { Api } from "./api.js";

describe("Api client", () => {
  it("listNodes hits the right endpoint and returns nodes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "1", nodeType: "attackTicket", properties: { 标题: "a" }, createdAt: "t", updatedAt: "t" }]), { status: 200 }));
    const api = new Api("http://x", fetchMock as any);
    const rows = await api.listNodes("attackTicket", { 状态: "进行中" });
    expect(fetchMock).toHaveBeenCalledWith("http://x/api/nodes/attackTicket?%E7%8A%B6%E6%80%81=%E8%BF%9B%E8%A1%8C%E4%B8%AD", expect.anything());
    expect(rows[0].properties["标题"]).toBe("a");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/frontend && npx vitest run src/api.test.ts`
Expected: FAIL — `./api.js` not found. (Add `"test": "vitest run"`? No — use `npx vitest`; vitest is pulled in transitively. If missing: `npm i -w @combat/frontend -D vitest`.)

- [ ] **Step 3: Implement client + pages + router**

`apps/frontend/src/api.ts`:
```ts
import type { GraphNode, ProgressLog, NodeSchema } from "@combat/shared";

export class Api {
  constructor(private base = "", private f: typeof fetch = fetch) {}
  async listNodes(nodeType: string, filter: Record<string, string> = {}): Promise<GraphNode[]> {
    const qs = new URLSearchParams(filter).toString();
    const r = await this.f(`${this.base}/api/nodes/${nodeType}${qs ? "?" + qs : ""}`, {});
    return r.json();
  }
  async getNode(id: string): Promise<GraphNode> {
    return (await this.f(`${this.base}/api/nodes/${id}`, {})).json();
  }
  async getSchema(nodeType: string): Promise<NodeSchema> {
    return (await this.f(`${this.base}/api/schema/${nodeType}`, {})).json();
  }
  async listProgress(id: string): Promise<ProgressLog[]> {
    return (await this.f(`${this.base}/api/nodes/${id}/progress`, {})).json();
  }
  async appendProgress(id: string, content: string, statusSnapshot: string): Promise<ProgressLog> {
    return (await this.f(`${this.base}/api/nodes/${id}/progress`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, statusSnapshot, actor: "ui" }) })).json();
  }
  async importXlsx(file: File): Promise<{ created: number }> {
    const fd = new FormData(); fd.append("file", file);
    return (await this.f(`${this.base}/api/import`, { method: "POST", body: fd })).json();
  }
}
export const api = new Api("");
```

`apps/frontend/src/pages/AttackList.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Table, Input } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { GraphNode, NodeSchema } from "@combat/shared";

export function AttackList() {
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  useEffect(() => { api.getSchema("attackTicket").then(setSchema); }, []);
  useEffect(() => {
    api.listNodes("attackTicket", statusFilter ? { 状态: statusFilter } : {}).then(setRows);
  }, [statusFilter]);
  const columns = (schema?.fields ?? []).map(f => ({
    title: f.label, dataIndex: f.name,
    render: (_: unknown, r: GraphNode) =>
      f.name === "标题"
        ? <Link to={`/attack/${r.id}`}>{String(r.properties[f.name] ?? "")}</Link>
        : String(r.properties[f.name] ?? ""),
  }));
  return (
    <div style={{ padding: 16 }}>
      <h2>攻关作战台</h2>
      <Input.Search placeholder="按状态过滤" allowClear
        aria-label="status-filter"
        onSearch={setStatusFilter} style={{ width: 240, marginBottom: 12 }} />
      <Table rowKey="id" dataSource={rows} columns={columns} pagination={false} />
    </div>
  );
}
```

`apps/frontend/src/pages/AttackDetail.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Descriptions, Timeline, Input, Button, message } from "antd";
import { api } from "../api.js";
import type { GraphNode, ProgressLog } from "@combat/shared";

export function AttackDetail() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<GraphNode | null>(null);
  const [seq, setSeq] = useState<ProgressLog[]>([]);
  const [text, setText] = useState("");
  const refresh = () => { api.getNode(id).then(setNode); api.listProgress(id).then(setSeq); };
  useEffect(refresh, [id]);
  const add = async () => {
    if (!text) return;
    await api.appendProgress(id, text, String(node?.properties["状态"] ?? ""));
    setText(""); message.success("已追加进展"); refresh();
  };
  return (
    <div style={{ padding: 16 }}>
      <h2>{String(node?.properties["标题"] ?? "")}</h2>
      <Descriptions bordered column={1} size="small">
        {Object.entries(node?.properties ?? {}).map(([k, v]) =>
          <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>)}
      </Descriptions>
      <h3 style={{ marginTop: 24 }}>进展序列</h3>
      <Input.TextArea aria-label="progress-input" value={text}
        onChange={e => setText(e.target.value)} rows={2} />
      <Button type="primary" onClick={add} style={{ margin: "8px 0" }}>追加进展</Button>
      <Timeline items={[...seq].reverse().map(p => ({ children: `#${p.seqNo} [${p.statusSnapshot}] ${p.content}` }))} />
    </div>
  );
}
```

`apps/frontend/src/pages/ImportPage.tsx`:
```tsx
import { useState } from "react";
import { Upload, Button, message } from "antd";
import { api } from "../api.js";

export function ImportPage() {
  const [done, setDone] = useState(false);
  return (
    <div style={{ padding: 16 }}>
      <h2>导入攻关单</h2>
      <Upload beforeUpload={async (file) => {
        const r = await api.importXlsx(file as unknown as File);
        message.success(`导入 ${r.created} 条`); setDone(true); return false;
      }}>
        <Button>选择 Excel 文件</Button>
      </Upload>
      {done && <p role="status">导入完成</p>}
    </div>
  );
}
```

`apps/frontend/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { AttackList } from "./pages/AttackList.js";
import { AttackDetail } from "./pages/AttackDetail.js";
import { ImportPage } from "./pages/ImportPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 12 }}>
        <Link to="/attack">攻关作战台</Link> | <Link to="/import">导入</Link>
      </nav>
      <Routes>
        <Route path="/" element={<AttackList />} />
        <Route path="/attack" element={<AttackList />} />
        <Route path="/attack/:id" element={<AttackDetail />} />
        <Route path="/import" element={<ImportPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

`apps/frontend/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

`apps/frontend/index.html`:
```html
<!doctype html><html><head><meta charset="utf-8"><title>作战管理工具</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`apps/frontend/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
});
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/frontend && npx vitest run src/api.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```
git add apps/frontend
git commit -m "feat(ui): attack console shell (list/detail/import) + typed API client"
```

---

## Task 5: Backend API wiring + API e2e  *(Gate 1 — serial; needs Task 2 + Task 3)*

**Files:**
- Create: `apps/backend/src/routes.ts`, `apps/backend/src/app.ts`, `apps/backend/src/server.ts`, `apps/backend/test/helpers.ts`
- Test: `apps/backend/test/api.e2e.test.ts` (BE-1..BE-7)

- [ ] **Step 1: Write failing e2e test (BE-1..BE-7)**

`apps/backend/test/helpers.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

export function makeTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-"));
  const cfgDir = join(dir, "schemas"); mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "enum", label: "状态", required: true,
        enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
    ],
  }));
  writeFileSync(join(cfgDir, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true },
             { name: "employeeId", type: "string", label: "工号" }],
  }));
  const db = openDb(join(dir, "t.sqlite"));
  const repo = new SqliteRepository(db);
  const registry = new FileSchemaRegistry(cfgDir);
  return { app: createApp({ repo, registry }), repo, registry, cfgDir };
}
```

`apps/backend/test/api.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp } from "./helpers.js";

describe("API e2e", () => {
  it("BE-1 creates and reads an attack ticket", async () => {
    const { app } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连", 状态: "进行中" });
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/nodes/${c.body.id}`);
    expect(g.body.properties["标题"]).toBe("断连");
  });
  it("BE-2 rejects missing required", async () => {
    const { app } = makeTestApp();
    const r = await request(app).post("/api/nodes/attackTicket").send({ 状态: "进行中" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.errors)).toContain("标题");
  });
  it("BE-3 rejects invalid enum", async () => {
    const { app } = makeTestApp();
    const r = await request(app).post("/api/nodes/attackTicket").send({ 标题: "x", 状态: "不存在" });
    expect(r.status).toBe(400);
  });
  it("BE-4 lists and filters by 状态", async () => {
    const { app } = makeTestApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "a", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "b", 状态: "已解决" });
    const all = await request(app).get("/api/nodes/attackTicket");
    expect(all.body).toHaveLength(2);
    const f = await request(app).get("/api/nodes/attackTicket?状态=进行中");
    expect(f.body).toHaveLength(1);
  });
  it("BE-5 404 unknown id", async () => {
    const { app } = makeTestApp();
    expect((await request(app).get("/api/nodes/nope")).status).toBe(404);
  });
  it("BE-6 progress is append-only, ordered, audited", async () => {
    const { app, repo } = makeTestApp();
    const c = await request(app).post("/api/nodes/attackTicket").send({ 标题: "a", 状态: "进行中" });
    for (const t of ["d1", "d2", "d3"])
      await request(app).post(`/api/nodes/${c.body.id}/progress`).send({ content: t, statusSnapshot: "进行中", actor: "u" });
    const seq = await request(app).get(`/api/nodes/${c.body.id}/progress`);
    expect(seq.body.map((p: any) => p.seqNo)).toEqual([1, 2, 3]);
    expect(seq.body[0].content).toBe("d1");
  });
  it("BE-7 add field via config + scan, no DDL", async () => {
    const { app, cfgDir } = makeTestApp();
    writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
      nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        { name: "状态", type: "enum", label: "状态", required: true,
          enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
        { name: "根因服务", type: "string", label: "根因服务" },
      ],
    }));
    await request(app).post("/api/schema/scan");
    const c = await request(app).post("/api/nodes/attackTicket")
      .send({ 标题: "x", 状态: "进行中", 根因服务: "ModelArts" });
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/nodes/${c.body.id}`);
    expect(g.body.properties["根因服务"]).toBe("ModelArts");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/backend && npx vitest run test/api.e2e.test.ts`
Expected: FAIL — `../src/app.js` not found.

- [ ] **Step 3: Implement routes + app + server**

`apps/backend/src/routes.ts`:
```ts
import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";

export function makeRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();

  r.get("/schema/:nodeType", (req, res) => {
    const s = registry.getNodeSchema(req.params.nodeType);
    return s ? res.json(s) : res.status(404).json({ error: "unknown nodeType" });
  });
  r.post("/schema/scan", (_req, res) => { registry.reload(); res.json({ ok: true }); });

  r.get("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    if (registry.getNodeSchema(nodeType)) {
      const filter = { ...req.query } as Record<string, unknown>;
      return res.json(repo.queryNodes(nodeType, Object.keys(filter).length ? filter : undefined));
    }
    const single = repo.getNode(nodeType);   // /nodes/:id fallthrough
    return single ? res.json(single) : res.status(404).json({ error: "not found" });
  });

  r.post("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    const v = registry.validateNode(nodeType, req.body);
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    res.status(201).json(repo.createNode(nodeType, req.body, "api"));
  });

  r.get("/nodes/:id/progress", (req, res) => res.json(repo.listProgress(req.params.id)));
  r.post("/nodes/:id/progress", (req, res) => {
    const { content, statusSnapshot, actor } = req.body;
    res.status(201).json(repo.appendProgress(req.params.id, content, statusSnapshot, actor ?? "api"));
  });

  return r;
}
```

> Note: `GET /api/nodes/:nodeType` doubles as `GET /api/nodes/:id` — if the path segment is a known nodeType it lists, otherwise it is treated as a node id. This keeps the MVP route surface minimal and matches `Api.getNode`.

`apps/backend/src/app.ts`:
```ts
import express from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import { makeRouter } from "./routes.js";
import { makeImportRouter } from "./import.js";

export function createApp(deps: { repo: Repository; registry: SchemaRegistry }) {
  const app = express();
  app.use(express.json());
  app.use("/api", makeRouter(deps.repo, deps.registry));
  app.use("/api", makeImportRouter(deps.repo, deps.registry));
  return app;
}
```

> `makeImportRouter` is delivered in Task 6. To compile Task 5 before Task 6 lands, add this temporary stub `apps/backend/src/import.ts` and replace it in Task 6:
```ts
import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
export function makeImportRouter(_r: Repository, _s: SchemaRegistry): Router {
  return Router(); // replaced in Task 6
}
```

`apps/backend/src/server.ts`:
```ts
import { join } from "node:path";
import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { FileSchemaRegistry } from "./registry.js";
import { createApp } from "./app.js";

const repo = new SqliteRepository(openDb(join(process.cwd(), "combat.sqlite")));
const registry = new FileSchemaRegistry(join(process.cwd(), "..", "..", "config", "schemas"));
createApp({ repo, registry }).listen(3001, () => console.log("backend on :3001"));
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/backend && npx vitest run test/api.e2e.test.ts`
Expected: PASS (BE-1..BE-7, 7 tests).

- [ ] **Step 5: Commit**

```
git add apps/backend/src/routes.ts apps/backend/src/app.ts apps/backend/src/server.ts apps/backend/src/import.ts apps/backend/test/helpers.ts apps/backend/test/api.e2e.test.ts
git commit -m "feat(api): REST wiring for nodes/progress/schema + API e2e BE-1..BE-7"
```

---

## Task 6: Minimal Excel import + entity resolution  *(Wave 2 — Track D; needs Task 5)*

**Files:**
- Modify (replace stub): `apps/backend/src/import.ts`
- Test: `apps/backend/test/import.e2e.test.ts` (BE-8)

- [ ] **Step 1: Write failing e2e test (BE-8)**

`apps/backend/test/import.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { makeTestApp } from "./helpers.js";

function xlsxBuffer(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("import e2e", () => {
  it("BE-8 imports tickets and resolves same Person once", async () => {
    const { app, repo } = makeTestApp();
    const buf = xlsxBuffer([
      { 标题: "断连A", 状态: "进行中", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
      { 标题: "断连B", 状态: "进行中", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
    ]);
    const r = await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(2);
    expect(repo.queryNodes("attackTicket")).toHaveLength(2);
    expect(repo.queryNodes("person")).toHaveLength(1); // entity resolution
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/backend && npx vitest run test/import.e2e.test.ts`
Expected: FAIL — import route returns 404 (stub router).

- [ ] **Step 3: Implement import**

`apps/backend/src/import.ts` (replace the Task 5 stub entirely):
```ts
import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import type { Repository, SchemaRegistry, NodeSchema } from "@combat/shared";

const upload = multer({ storage: multer.memoryStorage() });

function mapColumns(row: Record<string, unknown>, schema: NodeSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    const hit = Object.keys(row).find(k => k.trim() === f.name || k.trim() === f.label);
    if (hit !== undefined) out[f.name] = row[hit];
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

export function makeImportRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/import", upload.single("file"), (req, res) => {
    const schema = registry.getNodeSchema("attackTicket");
    if (!schema) return res.status(500).json({ error: "no attackTicket schema" });
    const wb = XLSX.read(req.file!.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    let created = 0;
    for (const raw of rows) {
      const props = mapColumns(raw, schema);
      const v = registry.validateNode("attackTicket", props);
      if (!v.ok) continue;
      const node = repo.createNode("attackTicket", props, "import");
      created++;
      const personId = resolvePerson(repo,
        raw["攻关申请人"] as string, raw["攻关申请人工号"] as string);
      if (personId) repo.createEdge("ASSIGNED_TO", node.id, personId, { role: "攻关申请人" }, "import");
    }
    res.json({ created });
  });
  return r;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/backend && npx vitest run test/import.e2e.test.ts`
Expected: PASS (BE-8). Also rerun full backend suite: `npx vitest run` → all green.

- [ ] **Step 5: Commit**

```
git add apps/backend/src/import.ts apps/backend/test/import.e2e.test.ts
git commit -m "feat(import): minimal xlsx->attackTicket import with Person entity resolution (BE-8)"
```

---

## Task 7: Wire console to real API + frontend e2e  *(Wave 2 — Track C cont.; needs Task 5)*

The pages from Task 4 already call the real endpoints via `Api`. This task adds Playwright e2e (FE-1..FE-5) and fixes any contract drift found.

**Files:**
- Create: `apps/frontend/playwright.config.ts`, `apps/frontend/e2e/attack.spec.ts`, `apps/frontend/e2e/fixtures/make-fixture.ts`
- Modify (only if e2e reveals drift): `apps/frontend/src/api.ts` / pages

- [ ] **Step 1: Write failing e2e (FE-1..FE-5)**

`apps/frontend/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  webServer: [
    { command: "npm run dev --workspace=@combat/backend", port: 3001, reuseExistingServer: true, cwd: "../.." },
    { command: "npm run dev --workspace=@combat/frontend", port: 5173, reuseExistingServer: true, cwd: "../.." },
  ],
  use: { baseURL: "http://localhost:5173" },
});
```

`apps/frontend/e2e/fixtures/make-fixture.ts`:
```ts
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const rows = [
  { 标题: "导入断连A", 状态: "进行中", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
  { 标题: "导入断连B", 状态: "已解决", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
];
const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "S");
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "sample.xlsx"),
  XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
```
Run once: `cd apps/frontend && npx tsx e2e/fixtures/make-fixture.ts`

`apps/frontend/e2e/attack.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("FE-1..FE-4 list, filter, detail, append progress", async ({ page, request }) => {
  const base = "http://localhost:3001";
  const t1 = await (await request.post(`${base}/api/nodes/attackTicket`,
    { data: { 标题: "E2E进行中单", 状态: "进行中" } })).json();
  await request.post(`${base}/api/nodes/attackTicket`, { data: { 标题: "E2E已解决单", 状态: "已解决" } });
  await request.post(`${base}/api/nodes/${t1.id}/progress`,
    { data: { content: "首次进展", statusSnapshot: "进行中", actor: "seed" } });

  await page.goto("/attack");                                  // FE-1
  await expect(page.getByText("E2E进行中单")).toBeVisible();
  await expect(page.getByText("E2E已解决单")).toBeVisible();

  await page.getByLabel("status-filter").fill("进行中");          // FE-2
  await page.getByLabel("status-filter").press("Enter");
  await expect(page.getByText("E2E已解决单")).toHaveCount(0);

  await page.getByRole("link", { name: "E2E进行中单" }).click(); // FE-3
  await expect(page.getByText("首次进展", { exact: false })).toBeVisible();

  await page.getByLabel("progress-input").fill("第二次进展");     // FE-4
  await page.getByRole("button", { name: "追加进展" }).click();
  await expect(page.getByText("#2", { exact: false })).toBeVisible();
  await expect(page.getByText("首次进展", { exact: false })).toBeVisible(); // traceable
});

test("FE-5 import xlsx then see rows", async ({ page }) => {
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", "e2e/fixtures/sample.xlsx");
  await expect(page.getByText("导入完成")).toBeVisible();
  await page.goto("/attack");
  await expect(page.getByText("导入断连A")).toBeVisible();
});
```

- [ ] **Step 2: Run e2e, verify it fails (or surfaces drift)**

Run: `cd apps/frontend && npx playwright install --with-deps chromium && npx playwright test`
Expected: FAIL initially (fixture not generated / servers contract). Generate fixture (Step 1 command), then re-run.

- [ ] **Step 3: Fix any contract drift**

Only if e2e fails on a real mismatch (e.g., AntD `Input.Search` clear button, Timeline text). Apply the minimal change to `src/pages/*` or `src/api.ts` to make assertions pass. Do NOT loosen test intent.

- [ ] **Step 4: Run e2e, verify it passes**

Run: `cd apps/frontend && npx playwright test`
Expected: PASS (FE-1..FE-5).

- [ ] **Step 5: Commit**

```
git add apps/frontend/playwright.config.ts apps/frontend/e2e
git commit -m "test(ui): Playwright e2e FE-1..FE-5 against real backend"
```

---

## Task 8: Full e2e suite green + Phase 1 acceptance  *(Gate 2 — serial)*

**Files:** Modify: `D:\fighting\package.json` (add aggregate script). No new features.

- [ ] **Step 1: Add aggregate test script**

Add to root `package.json` scripts:
```json
"test:all": "npm run test:shared && npm run test:backend && npm run test:frontend:e2e"
```

- [ ] **Step 2: Run the whole suite**

Run: `cd D:\fighting && npm run test:all`
Expected: shared (2) + backend (repository 3, registry 4, api BE-1..7, import BE-8) + frontend Playwright (FE-1..5) ALL PASS.

- [ ] **Step 3: Manual usability smoke (fast-feedback gate)**

Run `npm run dev:backend` and `npm run dev:frontend`; in a browser: import `apps/frontend/e2e/fixtures/sample.xlsx`, filter by 状态, open a ticket, append two progress entries, reload — confirm sequence persists and is ordered. This is the "fast usage, fast feedback" checkpoint before iterating.

- [ ] **Step 4: Verify against PRD §11 Phase 1 acceptance**

Confirm each box, citing the covering test:
- 改配置增字段、扫描后无需改库、生效 → `BE-7`
- 多 Excel 导入、同一人跨行合并为一个 Person → `BE-8`
- 攻关作战台展示/筛选、字段覆盖 req.md → `FE-1/FE-2` + `config/schemas/attackTicket.json`
- 每日追加进展、时间线按序、历史可回溯 → `BE-6` + `FE-4`
- 所有写操作 audit_log 留痕 → `BE-6` (audit assertion) + repository test

- [ ] **Step 5: Commit + tag**

```
git add D:\fighting\package.json
git commit -m "chore: aggregate test:all + Phase 1 acceptance verified"
git tag phase-1-mvp
```

---

## Self-Review

**1. Spec coverage (PRD §10 Phase 1 + §11):**
- 1.1 scaffold → Task 1 ✓ · 1.2 Schema Registry + config-driven/scan → Task 3 + Task 5 (`/api/schema/scan`) ✓ · 1.3 structured store no-DDL + audit → Task 2 ✓ · 1.4 EntitySchema baseline → Task 3 (attackTicket/person; other entity types deferred per Scope, recorded in PRD §1.4 — acceptable for MVP) ✓ · 1.5 Excel import + entity resolution → Task 6 ✓ · 1.6 attack console list/detail/filter → Tasks 4 + 7 ✓ · 1.7 progress time-series + timeline → Task 2 (`appendProgress`) + Task 4 (Timeline) + Task 7 (FE-4) ✓
- User directives: fast MVP (scope trimmed, deferrals explicit) ✓ · TDD every task ✓ · e2e all features front+back (BE-1..8, FE-1..5) ✓ · parallel decomposition (Wave map + worktree guidance) ✓
- Deferred items are tracked in PRD §1.4/§10, not dropped.

**2. Placeholder scan:** No "TBD/handle errors/similar to". The one cross-task dependency (import router) is handled with an explicit compilable stub in Task 5, fully replaced in Task 6 — code shown for both. ✓

**3. Type consistency:** `Repository`, `SchemaRegistry`, `ValidationResult`, `GraphNode`, `ProgressLog`, `NodeSchema` defined once in `@combat/shared` (Task 1) and imported unchanged in Tasks 2,3,5,6 and frontend `api.ts`. Method names (`createNode`/`queryNodes`/`appendProgress`/`listProgress`/`reload`/`getNodeSchema`/`validateNode`) are identical across interface, impl, routes, and tests. API client methods match route paths in Task 5. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-phase1-attack-console-mvp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Maps cleanly onto the Wave map: Task 1 solo; then 3 parallel subagents for Wave 1 (Tasks 2/3/4); Task 5 solo; 2 parallel for Wave 2 (Tasks 6/7); Task 8 solo.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
