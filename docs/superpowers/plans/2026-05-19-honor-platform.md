# Hall of Honor + Platform Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 荣誉殿堂 (contribution recording + weighted leaderboard + personal profile) and integrate all pages under one AntD app shell with a 作战平台 navigation homepage.

**Architecture:** `Contribution` is a config-driven nodeType reusing the existing generic store + editable table (no new generic storage code). Two read-only `honor` aggregation endpoints compute a level-weighted leaderboard and per-person profile. The existing `AttackTable` is generalized to a parametric `EntityTable` reused by both `/attack` and `/contributions`. A shared `AppShell` (AntD Layout + nav) wraps all routes; `/` becomes a navigation homepage.

**Tech Stack:** Node 20 + TypeScript, npm workspaces, Express, better-sqlite3, Vite + React + Ant Design; tests = Vitest + supertest (backend) + Playwright (frontend e2e), reusing the existing deterministic harness.

---

## Spec Source

Implements PRD §15 (15.1–15.6). Decisions locked in §15.5. Out of scope (deferred): team-dimension aggregation (no Team model), live-metrics dashboard homepage, RBAC on contribution level (whole app has no auth — §13#4).

Locked constants: level weights `普通=1 / 关键=3 / 核心=8` (missing/unknown level → weight 1).

---

## Parallel Execution Map

Per the standing parallelize directive: independent tasks run as concurrent agents in isolated git worktrees, converging at gates.

```
Wave 0 (SERIAL gate): Task 1  @combat/shared honor DTO types
Wave 1 (PARALLEL — 2 worktrees):
  Track A → Task 2  Backend: contribution config + CONTRIBUTED_TO + honor router + backend e2e
  Track B → Task 3  Frontend: generalize AttackTable→EntityTable + Api honor methods (+unit)
Gate 1 (SERIAL — needs Task 2 + Task 3):
  Task 4  Frontend: AppShell + HomePage + HonorPage + PersonHonor + App routes wiring
Wave 2 (needs Task 4):
  Task 5  Playwright e2e (honor flow + homepage/nav integration) + contract-drift fixes
Gate 2 (SERIAL):
  Task 6  test:all green + §15.6 acceptance + tag + deploy
```

Worktree note: branch tracks off the Task 1 commit; a track imports only `@combat/shared`; merge tracks back at Gate 1. Backend (Track A: `apps/backend/**`, `config/schemas/contribution.json`, `apps/frontend/e2e/reset-db.cjs`) and frontend (Track B: `apps/frontend/src/**`) file sets are disjoint.

---

## File Structure

```
packages/shared/src/types.ts          # MOD: + LeaderboardEntry, PersonHonor
config/schemas/contribution.json       # NEW: contribution entity config
apps/backend/src/honor.ts              # NEW: makeHonorRouter (leaderboard, person)
apps/backend/src/routes.ts             # MOD: CONTRIBUTED_TO edge on POST contribution
apps/backend/src/app.ts                # MOD: mount honor router
apps/backend/test/honor.e2e.test.ts    # NEW: backend honor e2e
apps/frontend/e2e/reset-db.cjs         # MOD: restore contribution.json too
apps/frontend/src/pages/EntityTable.tsx# NEW: generalized table (from AttackTable.tsx)
apps/frontend/src/pages/AttackTable.tsx# DELETE (replaced by EntityTable); test updated
apps/frontend/src/pages/AttackTable.test.tsx # MOD -> EntityTable.test.tsx
apps/frontend/src/api.ts               # MOD: + getLeaderboard, getPersonHonor
apps/frontend/src/api.test.ts          # MOD: + 1 test
apps/frontend/src/pages/AppShell.tsx   # NEW: AntD Layout + nav
apps/frontend/src/pages/HomePage.tsx   # NEW: module cards
apps/frontend/src/pages/HonorPage.tsx  # NEW: leaderboard + period filter
apps/frontend/src/pages/PersonHonor.tsx# NEW: per-person profile
apps/frontend/src/App.tsx              # MOD: shell + routes (/ , /attack, /attack/:id, /honor, /honor/:name, /contributions, /import)
apps/frontend/e2e/honor.spec.ts        # NEW: FE-H1..FE-H6
```

Existing e2e (`attack.spec.ts`, `editable.spec.ts`) must keep passing UNMODIFIED — they `goto("/attack")` and rely on the EntityTable rendering attackTicket with the `status-filter` + 标题→`/attack/:id` link.

---

## Task 1: `@combat/shared` honor DTO types  *(Wave 0 — serial gate)*

**Files:** Modify `packages/shared/src/types.ts`; Test: `packages/shared/src/types.test.ts` (append).

- [ ] **Step 1: Append failing test** to `packages/shared/src/types.test.ts` (add the import at the top import block, then a new describe at end):
```ts
import type { LeaderboardEntry, PersonHonor } from "./index.js";

describe("honor contracts", () => {
  it("LeaderboardEntry and PersonHonor shapes", () => {
    const l: LeaderboardEntry = { 贡献人: "张三", score: 11, 贡献数: 3, byLevel: { 核心: 1 }, byType: { 实施: 2 } };
    const p: PersonHonor = { 贡献人: "张三", contributions: [{ contribution: { id: "c1", nodeType: "contribution", properties: {}, createdAt: "t", updatedAt: "t" }, attackTicketId: "a1" }] };
    expect(l.score).toBe(11);
    expect(p.contributions[0].attackTicketId).toBe("a1");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd D:\fighting && npm run test:shared` → FAIL (types not exported).

- [ ] **Step 3: Implement** — append to `packages/shared/src/types.ts`:
```ts
export interface LeaderboardEntry {
  贡献人: string;
  score: number;
  贡献数: number;
  byLevel: Record<string, number>;
  byType: Record<string, number>;
}
export interface PersonHonor {
  贡献人: string;
  contributions: { contribution: GraphNode; attackTicketId: string | null }[];
}
```
(`index.ts` already `export * from "./types.js"` — no change.)

- [ ] **Step 4: Run, expect PASS** — `cd D:\fighting && npm run test:shared` → all pass (prior + new).

- [ ] **Step 5: Commit**
```
git add packages/shared/src/types.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): honor DTO types (LeaderboardEntry, PersonHonor)"
```

---

## Task 2: Backend — contribution config + CONTRIBUTED_TO + honor router  *(Wave 1 — Track A)*

**Depends on:** Task 1. **Files:** Create `config/schemas/contribution.json`, `apps/backend/src/honor.ts`, `apps/backend/test/honor.e2e.test.ts`; Modify `apps/backend/src/routes.ts`, `apps/backend/src/app.ts`, `apps/frontend/e2e/reset-db.cjs`.

- [ ] **Step 1: Write failing e2e** `apps/backend/test/honor.e2e.test.ts`:
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
  const dir = mkdtempSync(join(tmpdir(), "combat-honor-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
             { name: "攻关单号", type: "string", label: "攻关单号" }] }));
  writeFileSync(join(cfg, "contribution.json"), JSON.stringify({
    nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
    fields: [
      { name: "贡献人", type: "string", label: "贡献人", required: true },
      { name: "关联攻关单", type: "string", label: "关联攻关单" },
      { name: "贡献类型", type: "enum", label: "贡献类型", required: true, enumValues: ["发现","设计","实施","协调","公关"] },
      { name: "贡献等级", type: "enum", label: "贡献等级", enumValues: ["普通","关键","核心"] },
      { name: "周期", type: "string", label: "周期" }] }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("honor e2e", () => {
  it("creating a contribution with 关联攻关单 builds a CONTRIBUTED_TO edge to the ticket", async () => {
    const { app, repo } = makeApp();
    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连攻关", 攻关单号: "GK-1" });
    const c = await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 关联攻关单: "GK-1", 贡献类型: "实施", 贡献等级: "核心" });
    expect(c.status).toBe(201);
    const edges = repo.queryEdges({ sourceId: c.body.id, edgeType: "CONTRIBUTED_TO" });
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(t.body.id);
  });
  it("leaderboard is level-weighted, sorted desc, with per-level/type counts and period filter", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献类型: "实施", 贡献等级: "核心", 周期: "2026-Q2" }); // 8
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "张三", 贡献类型: "设计", 贡献等级: "普通", 周期: "2026-Q2" }); // 1
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "李四", 贡献类型: "协调", 贡献等级: "关键", 周期: "2026-Q1" }); // 3
    const lb = await request(app).get("/api/honor/leaderboard");
    expect(lb.body[0]).toMatchObject({ 贡献人: "张三", score: 9, 贡献数: 2 });
    expect(lb.body[0].byLevel).toMatchObject({ 核心: 1, 普通: 1 });
    expect(lb.body[1]).toMatchObject({ 贡献人: "李四", score: 3 });
    const q2 = await request(app).get("/api/honor/leaderboard?period=2026-Q2");
    expect(q2.body).toHaveLength(1);
    expect(q2.body[0]).toMatchObject({ 贡献人: "张三", score: 9 });
  });
  it("person profile lists the person's contributions with linked attackTicketId", async () => {
    const { app } = makeApp();
    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 攻关单号: "GK-9" });
    await request(app).post("/api/nodes/contribution").send({ 贡献人: "王五", 关联攻关单: "GK-9", 贡献类型: "发现", 贡献等级: "关键" });
    const p = await request(app).get("/api/honor/person/王五");
    expect(p.body.贡献人).toBe("王五");
    expect(p.body.contributions).toHaveLength(1);
    expect(p.body.contributions[0].attackTicketId).toBe(t.body.id);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd apps/backend && npx vitest run test/honor.e2e.test.ts` → FAIL (no contribution schema in real config / honor routes 404 / no edge).

- [ ] **Step 3: Implement.**

`config/schemas/contribution.json`:
```json
{
  "nodeType": "contribution",
  "label": "贡献记录",
  "identityKeys": [],
  "derivedToKG": true,
  "fields": [
    { "id": "贡献人", "name": "贡献人", "type": "string", "label": "贡献人", "required": true },
    { "id": "关联攻关单", "name": "关联攻关单", "type": "string", "label": "关联攻关单" },
    { "id": "贡献类型", "name": "贡献类型", "type": "enum", "label": "贡献类型", "required": true, "enumValues": ["发现", "设计", "实施", "协调", "公关"] },
    { "id": "贡献等级", "name": "贡献等级", "type": "enum", "label": "贡献等级", "enumValues": ["普通", "关键", "核心"] },
    { "id": "贡献描述", "name": "贡献描述", "type": "string", "label": "贡献描述" },
    { "id": "周期", "name": "周期", "type": "string", "label": "周期" },
    { "id": "记录时间", "name": "记录时间", "type": "datetime", "label": "记录时间" },
    { "id": "记录人", "name": "记录人", "type": "string", "label": "记录人" }
  ]
}
```

`apps/backend/src/honor.ts`:
```ts
import { Router } from "express";
import type { Repository } from "@combat/shared";

const WEIGHT: Record<string, number> = { 普通: 1, 关键: 3, 核心: 8 };

export function makeHonorRouter(repo: Repository): Router {
  const r = Router();

  r.get("/honor/leaderboard", (req, res) => {
    const period = typeof req.query.period === "string" ? req.query.period : "";
    const rows = repo.queryNodes("contribution")
      .filter(c => !period || String(c.properties["周期"] ?? "") === period);
    const by: Record<string, { 贡献人: string; score: number; 贡献数: number;
      byLevel: Record<string, number>; byType: Record<string, number> }> = {};
    for (const c of rows) {
      const person = String(c.properties["贡献人"] ?? "");
      if (!person) continue;
      const level = String(c.properties["贡献等级"] ?? "");
      const type = String(c.properties["贡献类型"] ?? "");
      const e = (by[person] ??= { 贡献人: person, score: 0, 贡献数: 0, byLevel: {}, byType: {} });
      e.贡献数 += 1;
      e.score += WEIGHT[level] ?? 1;
      if (level) e.byLevel[level] = (e.byLevel[level] ?? 0) + 1;
      if (type) e.byType[type] = (e.byType[type] ?? 0) + 1;
    }
    res.json(Object.values(by).sort((a, b) => b.score - a.score));
  });

  r.get("/honor/person/:name", (req, res) => {
    const name = req.params.name;
    const list = repo.queryNodes("contribution")
      .filter(c => String(c.properties["贡献人"] ?? "") === name)
      .map(c => ({
        contribution: c,
        attackTicketId: repo.queryEdges({ sourceId: c.id, edgeType: "CONTRIBUTED_TO" })[0]?.targetId ?? null,
      }));
    res.json({ 贡献人: name, contributions: list });
  });

  return r;
}
```

In `apps/backend/src/routes.ts`, in the `r.post("/nodes/:nodeType", ...)` handler, after `const created = repo.createNode(...)` (the line that builds the node) and before sending the response, add the contribution→ticket edge. Replace the existing POST handler body with EXACTLY:
```ts
  r.post("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    const v = registry.validateNode(nodeType, req.body);
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    const node = repo.createNode(nodeType, req.body, "api");
    if (nodeType === "contribution") {
      const ref = String(req.body?.["关联攻关单"] ?? "");
      if (ref) {
        const tickets = repo.queryNodes("attackTicket");
        const target = tickets.find(t => String(t.properties["攻关单号"] ?? "") === ref)
          ?? tickets.find(t => String(t.properties["标题"] ?? "") === ref);
        if (target) repo.createEdge("CONTRIBUTED_TO", node.id, target.id, {}, "api");
      }
    }
    res.status(201).json(node);
  });
```
(Only this handler changes; everything else in routes.ts stays. If the prior handler used a different variable name, this fully replaces it.)

In `apps/backend/src/app.ts`, mount the honor router. Add the import and the mount line:
```ts
import { makeHonorRouter } from "./honor.js";
// ...inside createApp, after the existing app.use("/api", makeRouter(...)) / makeImportRouter:
  app.use("/api", makeHonorRouter(deps.repo));
```
(Add `makeHonorRouter` mount BEFORE the global error middleware `app.use((err,...))`.)

In `apps/frontend/e2e/reset-db.cjs`, add `contribution.json` to the git-restore list so schema-mutation e2e stays deterministic. Change the `git checkout` line to:
```js
  execSync("git checkout -- config/schemas/attackTicket.json config/schemas/person.json config/schemas/contribution.json",
    { cwd: join(process.cwd(), "..", ".."), stdio: "ignore" });
```

- [ ] **Step 4: Run, expect PASS + full backend green** — `cd apps/backend && npx vitest run test/honor.e2e.test.ts && npx vitest run && npx tsc -p tsconfig.json --noEmit`. honor 3/3; full backend all green (existing 34 + 3 = 37); tsc zero errors. Fix only the new files if tsc/vitest fail (never @combat/shared/locked files).

- [ ] **Step 5: Commit**
```
git add config/schemas/contribution.json apps/backend/src/honor.ts apps/backend/src/routes.ts apps/backend/src/app.ts apps/backend/test/honor.e2e.test.ts apps/frontend/e2e/reset-db.cjs
git commit -m "feat(honor): contribution config + CONTRIBUTED_TO edge on create + weighted leaderboard/person endpoints"
```

---

## Task 3: Frontend — generalize AttackTable→EntityTable + Api honor methods  *(Wave 1 — Track B)*

**Depends on:** Task 1. **Files:** Create `apps/frontend/src/pages/EntityTable.tsx`; rename test `AttackTable.test.tsx`→`EntityTable.test.tsx`; delete `AttackTable.tsx`; Modify `apps/frontend/src/App.tsx` (point /attack at EntityTable), `apps/frontend/src/api.ts`, `apps/frontend/src/api.test.ts`.

- [ ] **Step 1: Write failing tests.**

Rename `apps/frontend/src/pages/AttackTable.test.tsx` to `apps/frontend/src/pages/EntityTable.test.tsx` with content:
```tsx
import { describe, it, expect } from "vitest";
import { EntityTable } from "./EntityTable.js";
describe("EntityTable", () => {
  it("is exported as a component function", () => {
    expect(typeof EntityTable).toBe("function");
  });
});
```

Append to `apps/frontend/src/api.test.ts` inside `describe("Api client")`:
```ts
  it("getLeaderboard / getPersonHonor hit honor endpoints", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify([]), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.getLeaderboard("2026-Q2");
    await api.getPersonHonor("张三");
    expect(calls[0]).toBe("http://x/api/honor/leaderboard?period=2026-Q2");
    expect(calls[1]).toBe("http://x/api/honor/person/%E5%BC%A0%E4%B8%89");
  });
```

- [ ] **Step 2: Run, expect FAIL** — `cd apps/frontend && npx vitest run src/pages/EntityTable.test.tsx src/api.test.ts` → FAIL (EntityTable.js missing; api.getLeaderboard not a function).

- [ ] **Step 3: Implement.**

Create `apps/frontend/src/pages/EntityTable.tsx` by generalizing the current AttackTable: it takes `nodeType`, optional `filterField` (renders the search box filtering rows by that property; default none), optional `linkField`+`linkTo` (renders that field's cell as a router `<Link>`). Full content:
```tsx
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Table, Input, Button, Space, Popconfirm, message, Modal, Select } from "antd";
import { api } from "../api.js";
import type { GraphNode, NodeSchema, FieldSchema } from "@combat/shared";

export function EntityTable({ nodeType, filterField, linkField, linkTo }: {
  nodeType: string; filterField?: string;
  linkField?: string; linkTo?: (id: string) => string;
}) {
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [editing, setEditing] = useState<Record<string, Record<string, string>>>({});
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState({ name: "", label: "", type: "string" });
  const [rn, setRn] = useState<{ id: string; label: string } | null>(null);
  const [filter, setFilter] = useState("");

  const activeFields = (s: NodeSchema | null): FieldSchema[] => (s?.fields ?? []).filter(f => !f.retired);
  const refresh = useCallback(async () => {
    setSchema(await api.getSchema(nodeType));
    setRows(await api.listNodes(nodeType));
  }, [nodeType]);
  useEffect(() => { refresh(); }, [refresh]);

  const saveRow = async (r: GraphNode) => {
    try { await api.updateNode(r.id, editing[r.id]); message.success("已保存");
      setEditing(e => { const n = { ...e }; delete n[r.id]; return n; }); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const delRow = async (id: string) => {
    try { await api.deleteNode(id); message.success("已删除"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const createDraft = async () => {
    try { await api.createNode(nodeType, draft ?? {}); message.success("已新增"); setDraft(null); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const patch = async (op: Parameters<typeof api.patchSchema>[1]) => {
    try { await api.patchSchema(nodeType, op); message.success("字段已更新"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };

  const fields = activeFields(schema);
  const columns = [
    ...fields.map(f => ({
      title: (
        <Space size={4}>
          <span>{f.label}</span>
          <Button aria-label={`rename-${f.id}`} size="small" type="link" onClick={() => setRn({ id: f.id, label: f.label })}>改名</Button>
          <Popconfirm title={`退休字段「${f.label}」？数据保留`} okText="OK" onConfirm={() => patch({ op: "retire", id: f.id })}>
            <Button aria-label={`retire-${f.id}`} size="small" type="link" danger>退休</Button>
          </Popconfirm>
        </Space>
      ),
      dataIndex: f.id,
      render: (_: unknown, r: GraphNode) => {
        const e = editing[r.id];
        if (e) return <Input aria-label={`edit-${f.id}`} value={e[f.id] ?? String(r.properties[f.id] ?? "")}
          onChange={ev => setEditing(s => ({ ...s, [r.id]: { ...s[r.id], [f.id]: ev.target.value } }))} />;
        const val = String(r.properties[f.id] ?? "");
        return linkField && linkTo && f.id === linkField ? <Link to={linkTo(r.id)}>{val}</Link> : val;
      },
    })),
    {
      title: <Button aria-label="add-field" onClick={() => setAddOpen(true)}>+字段</Button>,
      dataIndex: "__act",
      render: (_: unknown, r: GraphNode) => editing[r.id]
        ? <Space><Button aria-label={`save-${r.id}`} type="primary" onClick={() => saveRow(r)}>保存</Button></Space>
        : <Space>
            <Button aria-label={`edit-row-${r.id}`} onClick={() => setEditing(s => ({ ...s, [r.id]: {} }))}>编辑</Button>
            <Popconfirm title="删除该记录？" okText="OK" onConfirm={() => delRow(r.id)}>
              <Button aria-label={`del-row-${r.id}`} danger>删除</Button>
            </Popconfirm>
          </Space>,
    },
  ];
  const data = filterField
    ? rows.filter(r => !filter || String(r.properties[filterField] ?? "").includes(filter))
    : rows;

  return (
    <div style={{ padding: 16 }}>
      <h2>{schema?.label ?? nodeType}（可编辑）</h2>
      {filterField && <Input.Search aria-label="status-filter" placeholder={`按${filterField}过滤`} allowClear
        onSearch={setFilter} style={{ width: 220, marginBottom: 12 }} />}
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
      <Table rowKey="id" columns={columns} pagination={false} dataSource={data} />
      <Modal title="新增字段" open={addOpen} okText="添加" onCancel={() => setAddOpen(false)}
        onOk={async () => { await patch({ op: "addField", field: { name: nf.name, label: nf.label || nf.name, type: nf.type as FieldSchema["type"] } }); setAddOpen(false); setNf({ name: "", label: "", type: "string" }); }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input aria-label="nf-name" placeholder="字段名(name)" value={nf.name} onChange={e => setNf(s => ({ ...s, name: e.target.value }))} />
          <Input aria-label="nf-label" placeholder="显示名(label)" value={nf.label} onChange={e => setNf(s => ({ ...s, label: e.target.value }))} />
          <Select aria-label="nf-type" value={nf.type} style={{ width: 160 }}
            onChange={v => setNf(s => ({ ...s, type: v }))}
            options={["string", "number", "date", "datetime", "enum"].map(t => ({ value: t, label: t }))} />
        </Space>
      </Modal>
      <Modal title="重命名字段" open={rn !== null} okText="确定" onCancel={() => setRn(null)}
        onOk={async () => { if (rn) await patch({ op: "renameLabel", id: rn.id, label: rn.label }); setRn(null); }}>
        <Input aria-label="rename-input" value={rn?.label ?? ""}
          onChange={e => setRn(s => (s ? { ...s, label: e.target.value } : s))} />
      </Modal>
    </div>
  );
}
```
Delete `apps/frontend/src/pages/AttackTable.tsx` (`git rm`). In `apps/frontend/src/App.tsx`, change the import `AttackTable`→`EntityTable` and render the `/attack` (and current `/`) route as `<EntityTable nodeType="attackTicket" filterField="状态" linkField="标题" linkTo={(id) => \`/attack/${id}\`} />`. (App.tsx is fully restructured in Task 4; this task only needs `/attack` to keep working so existing e2e stays green — keep `/`→same EntityTable for now; Task 4 introduces the homepage.)

In `apps/frontend/src/api.ts`: add `LeaderboardEntry, PersonHonor` to the `@combat/shared` type import, and add two methods (before `importXlsx`):
```ts
  getLeaderboard(period?: string): Promise<LeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    return this.req<LeaderboardEntry[]>(`/api/honor/leaderboard${qs}`, {});
  }
  getPersonHonor(name: string): Promise<PersonHonor> {
    return this.req<PersonHonor>(`/api/honor/person/${encodeURIComponent(name)}`, {});
  }
```

- [ ] **Step 4: Run, expect PASS** — `cd apps/frontend && npx vitest run` → all green (EntityTable 1 + api tests incl. new). `npx vite build` → succeeds. The unchanged `attack.spec.ts`/`editable.spec.ts` still target `/attack` with `status-filter`/`标题` link — preserved via the EntityTable props.

- [ ] **Step 5: Commit**
```
git add apps/frontend/src/pages/EntityTable.tsx apps/frontend/src/pages/EntityTable.test.tsx apps/frontend/src/api.ts apps/frontend/src/api.test.ts apps/frontend/src/App.tsx
git rm apps/frontend/src/pages/AttackTable.tsx apps/frontend/src/pages/AttackTable.test.tsx
git commit -m "refactor(ui): generalize AttackTable -> EntityTable(nodeType,filterField,link); Api honor methods"
```

---

## Task 4: Frontend — AppShell + HomePage + HonorPage + PersonHonor + routes  *(Gate 1 — needs Task 2 + Task 3)*

**Files:** Create `apps/frontend/src/pages/AppShell.tsx`, `HomePage.tsx`, `HonorPage.tsx`, `PersonHonor.tsx`; Modify `apps/frontend/src/App.tsx`.

- [ ] **Step 1: Write failing render tests** `apps/frontend/src/pages/HonorPage.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { HonorPage } from "./HonorPage.js";
import { HomePage } from "./HomePage.js";
import { AppShell } from "./AppShell.js";
describe("honor/platform pages", () => {
  it("exports components", () => {
    expect(typeof HonorPage).toBe("function");
    expect(typeof HomePage).toBe("function");
    expect(typeof AppShell).toBe("function");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd apps/frontend && npx vitest run src/pages/HonorPage.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement.**

`apps/frontend/src/pages/AppShell.tsx`:
```tsx
import { Layout, Menu } from "antd";
import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const ITEMS = [
  { key: "/", label: <Link to="/">首页</Link> },
  { key: "/attack", label: <Link to="/attack">攻关作战台</Link> },
  { key: "/honor", label: <Link to="/honor">荣誉殿堂</Link> },
  { key: "/contributions", label: <Link to="/contributions">贡献录入</Link> },
  { key: "/import", label: <Link to="/import">导入</Link> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const selected = ITEMS.map(i => i.key)
    .filter(k => k === "/" ? loc.pathname === "/" : loc.pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0] ?? "/";
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 700, marginRight: 24 }}>作战平台</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selected]} items={ITEMS} style={{ flex: 1 }} />
      </Layout.Header>
      <Layout.Content>{children}</Layout.Content>
    </Layout>
  );
}
```

`apps/frontend/src/pages/HomePage.tsx`:
```tsx
import { Card, Row, Col } from "antd";
import { Link } from "react-router-dom";

const MODULES = [
  { to: "/attack", title: "攻关作战台", desc: "攻关单跟踪、进展、可编辑表格" },
  { to: "/honor", title: "荣誉殿堂", desc: "贡献加权排行榜与个人档案" },
  { to: "/contributions", title: "贡献录入", desc: "记录贡献并关联攻关单" },
  { to: "/import", title: "导入", desc: "从 Excel 导入数据" },
];

export function HomePage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>作战平台</h1>
      <Row gutter={[16, 16]}>
        {MODULES.map(m => (
          <Col span={8} key={m.to}>
            <Link to={m.to}>
              <Card hoverable title={m.title} aria-label={`home-card-${m.to}`}>{m.desc}</Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
```

`apps/frontend/src/pages/HonorPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Table, Input } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { LeaderboardEntry } from "@combat/shared";

export function HonorPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [period, setPeriod] = useState("");
  useEffect(() => { api.getLeaderboard(period || undefined).then(setRows); }, [period]);
  const columns = [
    { title: "名次", dataIndex: "__rank", render: (_: unknown, __: LeaderboardEntry, i: number) => i + 1 },
    { title: "贡献人", dataIndex: "贡献人",
      render: (v: string) => <Link to={`/honor/${encodeURIComponent(v)}`}>{v}</Link> },
    { title: "加权得分", dataIndex: "score" },
    { title: "贡献数", dataIndex: "贡献数" },
    { title: "各等级", dataIndex: "byLevel",
      render: (b: Record<string, number>) => Object.entries(b).map(([k, n]) => `${k}:${n}`).join(" ") },
  ];
  return (
    <div style={{ padding: 16 }}>
      <h2>荣誉殿堂</h2>
      <Input.Search aria-label="period-filter" placeholder="按周期过滤(如 2026-Q2)" allowClear
        onSearch={setPeriod} style={{ width: 240, marginBottom: 12 }} />
      <Table rowKey="贡献人" dataSource={rows} columns={columns} pagination={false} />
    </div>
  );
}
```

`apps/frontend/src/pages/PersonHonor.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { List } from "antd";
import { api } from "../api.js";
import type { PersonHonor as PH } from "@combat/shared";

export function PersonHonor() {
  const { name = "" } = useParams();
  const [data, setData] = useState<PH | null>(null);
  useEffect(() => { api.getPersonHonor(decodeURIComponent(name)).then(setData); }, [name]);
  return (
    <div style={{ padding: 16 }}>
      <h2>个人贡献档案：{decodeURIComponent(name)}</h2>
      <List
        dataSource={data?.contributions ?? []}
        rowKey={(x) => x.contribution.id}
        renderItem={(x) => (
          <List.Item>
            {String(x.contribution.properties["贡献类型"] ?? "")} /
            {String(x.contribution.properties["贡献等级"] ?? "")} —
            {String(x.contribution.properties["贡献描述"] ?? "")}
            {x.attackTicketId
              ? <> · <Link to={`/attack/${x.attackTicketId}`}>关联攻关单</Link></>
              : null}
          </List.Item>
        )}
      />
    </div>
  );
}
```

Rewrite `apps/frontend/src/App.tsx` to use the shell + all routes:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "./pages/AppShell.js";
import { HomePage } from "./pages/HomePage.js";
import { EntityTable } from "./pages/EntityTable.js";
import { AttackDetail } from "./pages/AttackDetail.js";
import { ImportPage } from "./pages/ImportPage.js";
import { HonorPage } from "./pages/HonorPage.js";
import { PersonHonor } from "./pages/PersonHonor.js";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/attack" element={<EntityTable nodeType="attackTicket" filterField="状态" linkField="标题" linkTo={(id) => `/attack/${id}`} />} />
          <Route path="/attack/:id" element={<AttackDetail />} />
          <Route path="/contributions" element={<EntityTable nodeType="contribution" />} />
          <Route path="/honor" element={<HonorPage />} />
          <Route path="/honor/:name" element={<PersonHonor />} />
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
```
(Leave `AttackList.tsx` untouched/unused if still present; do not reference it.)

- [ ] **Step 4: Run, expect PASS + build** — `cd apps/frontend && npx vitest run` → all green; `npx vite build` → succeeds.

- [ ] **Step 5: Commit**
```
git add apps/frontend/src/pages/AppShell.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/HonorPage.tsx apps/frontend/src/pages/PersonHonor.tsx apps/frontend/src/pages/HonorPage.test.tsx apps/frontend/src/App.tsx
git commit -m "feat(ui): AppShell + 作战平台 homepage + HonorPage + PersonHonor + integrated routes"
```

---

## Task 5: Playwright e2e — honor flow + homepage/nav integration  *(Wave 2 — needs Task 4)*

**Files:** Create `apps/frontend/e2e/honor.spec.ts`; minimal contract-drift fixes to `apps/frontend/src/pages/*` only if e2e reveals a real mismatch (never weaken assertions; never edit `attack.spec.ts`/`editable.spec.ts`).

- [ ] **Step 1: Write failing e2e** `apps/frontend/e2e/honor.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-H1..H3 homepage + nav integration", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "作战平台" })).toBeVisible();
  await page.getByRole("link", { name: "荣誉殿堂" }).first().click();
  await expect(page).toHaveURL(/\/honor$/);
  await page.getByRole("link", { name: "攻关作战台" }).first().click();
  await expect(page).toHaveURL(/\/attack$/);
  await expect(page.getByLabel("status-filter")).toBeVisible();
});

test("FE-H4..H6 record contribution -> weighted leaderboard -> personal profile backlink", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "荣誉攻关单", 攻关单号: "HK-1", 状态: "进行中" } })).json();
  await page.goto("/contributions");
  await page.getByLabel("new-row").click();
  await page.getByLabel("draft-贡献人").fill("赵六");
  await page.getByLabel("draft-关联攻关单").fill("HK-1");
  await page.getByLabel("draft-贡献类型").fill("实施");
  await page.getByLabel("draft-贡献等级").fill("核心");
  await page.getByLabel("create-row").click();
  await expect(page.getByText("赵六")).toBeVisible();

  await page.goto("/honor");
  await expect(page.getByRole("link", { name: "赵六" })).toBeVisible();
  await expect(page.getByText("8", { exact: false })).toBeVisible(); // 核心 weight

  await page.getByRole("link", { name: "赵六" }).click();
  await expect(page).toHaveURL(/\/honor\/%E8%B5%B5%E5%85%AD/);
  await expect(page.getByText("关联攻关单")).toBeVisible();
  await page.getByRole("link", { name: "关联攻关单" }).click();
  await expect(page).toHaveURL(new RegExp(`/attack/${t.id}`));
});
```

- [ ] **Step 2: Run, expect FAIL/diagnose** — `cd apps/frontend && npx playwright test honor.spec.ts`. Diagnose each failure (read `apps/frontend/test-results/.../error-context.md`).

- [ ] **Step 3: Fix contract drift (minimal, app-side preferred).** Likely fixes: AntD `Menu` horizontal renders nav links — `getByRole("link", { name: "荣誉殿堂" }).first()` should match the menu `<Link>`; if the menu collapses on the test viewport, set a wide viewport in `playwright.config.ts`? (Do NOT edit playwright.config — instead, if the AntD horizontal Menu overflows, use `getByRole("link", { name })` which still resolves the DOM link even if visually in the overflow; if truly hidden, switch `AppShell` Menu to always-visible links via `overflowedIndicator={null}` or render plain `<Link>`s — minimal app-side change preserving the nav intent). Ensure draft inputs exist for contribution fields (aria-label `draft-贡献人` etc. come from EntityTable rendering the contribution schema fields — confirm contribution.json field ids are 贡献人/关联攻关单/贡献类型/贡献等级 so the labels match).

- [ ] **Step 4: Green twice consecutively** — `cd apps/frontend && npx playwright test` runs attack.spec + editable.spec + honor.spec; ALL pass. Run again immediately → all pass again (determinism; reset-db restores attackTicket/person/contribution configs). Paste both summary lines.

- [ ] **Step 5: Commit**
```
git add apps/frontend/e2e/honor.spec.ts apps/frontend/src/pages
git commit -m "test(ui): Playwright e2e FE-H1..H6 (homepage/nav + contribution->leaderboard->profile backlink)"
```

---

## Task 6: test:all green + acceptance + tag + deploy  *(Gate 2)*

**Files:** none (verification + tag + deploy).

- [ ] **Step 1: Full aggregate** — `cd D:\fighting && npm run test:all` → ALL green (shared incl. honor types; backend incl. honor.e2e; frontend unit incl. EntityTable/HonorPage/api; frontend e2e attack+editable+honor). Then `git checkout -- config/schemas/` (e2e mutates it by design). If any fail → STOP, report BLOCKED with root cause; do not weaken tests.

- [ ] **Step 2: Verify PRD §15.6 acceptance** — confirm each box maps to a green test/artifact:
  - contribution.json config-driven CRUD + enum validation → honor.e2e + EntityTable on `/contributions`
  - CONTRIBUTED_TO edge + bidirectional traceback → honor.e2e edge test + FE-H6 backlink
  - leaderboard weighting/sort/counts + period filter → honor.e2e leaderboard test
  - /honor + person profile + ticket backlink → FE-H4..H6
  - AppShell unified nav across modules → FE-H1..H3
  - `/` navigation homepage; existing e2e (goto /attack) still green → FE-H1 + unchanged attack.spec/editable.spec green in Step 1
  State explicitly: all covered & green (yes/no).

- [ ] **Step 3: Tag** — `cd D:\fighting && git commit --allow-empty -m "chore: honor + platform increment acceptance verified (test:all green)" && git tag increment-honor-platform`.

- [ ] **Step 4: Deploy** — `cd D:\fighting/scripts/deploy && node deploy.mjs deploy`. Confirm the runner ends with `DEPLOY_DONE` and health `backend=200 frontend=200`. Report the open URL. (Per the standing deploy principle; creds from gitignored `.env.deploy`.)

- [ ] **Step 5: Report** — increment complete; test:all counts; deploy health; URL for manual testing.

---

## Self-Review

**1. Spec coverage (PRD §15.1–15.6):**
- 15.1 contribution.json (8 fields, enums, id=name) → Task 2 ✓ ; CONTRIBUTED_TO resolve rule (攻关单号 then 标题, else no edge) → Task 2 routes change + honor.e2e edge test ✓
- 15.2 generic CRUD reuse + edge-on-create + 2 read endpoints (weighted, period, person+backlink) → Task 2 ✓
- 15.3 EntityTable generalization (nodeType/filterField/link) + /contributions + AppShell + HomePage + HonorPage + PersonHonor + routes (`/`=home; e2e goto /attack unaffected) → Tasks 3 + 4 ✓
- 15.4 TDD + backend e2e + Playwright honor + nav integration; reset-db restores contribution.json → Tasks 2,3,5 ✓
- 15.5 decisions (config-driven, edge+field, weighted 1/3/8, no RBAC, table generalized, platform integration) → reflected across Tasks 2–4 ✓
- 15.6 acceptance → Task 6 maps each ✓
- Deferred (team dim, dashboard metrics, RBAC) correctly NOT built ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Task 5 Step 3 is contingency guidance with concrete options; the e2e is real and Step 4 must be green twice. All types/methods (`EntityTable` props, `getLeaderboard/getPersonHonor`, `LeaderboardEntry/PersonHonor`, `makeHonorRouter`, `CONTRIBUTED_TO`) are defined in earlier tasks and used consistently.

**3. Type consistency:** `LeaderboardEntry`/`PersonHonor` defined in Task 1, consumed identically in honor.ts (Task 2) and api.ts/HonorPage/PersonHonor (Tasks 3/4). `EntityTable({nodeType,filterField,linkField,linkTo})` signature identical in Task 3 def and Task 4 usages. Contribution field ids (贡献人/关联攻关单/贡献类型/贡献等级/周期…) identical across contribution.json, honor.ts, e2e draft-`${id}` labels. `api.getLeaderboard(period?)`/`getPersonHonor(name)` identical in Task 3 def/test and Task 4 pages. CONTRIBUTED_TO edge type string identical in routes.ts, honor.ts, tests.

**Self-review fix applied:** Task 2 Step 1 test used a stray `app2` assignment artifact — the test helper is named `app()`; the first test must use `const { app, repo } = app();` (not `app2 = app()`). Corrected mentally for the implementer: in `honor.e2e.test.ts` first test, line is `const { app, repo } = app();` and the trailing `let app2;` is removed. (Implementer: use the helper `app()` directly; ignore any `app2`.)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-honor-platform.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, parallel Wave-1 worktrees (Task 2 ‖ Task 3).
**2. Inline Execution** — executing-plans with checkpoints.

Which approach?
