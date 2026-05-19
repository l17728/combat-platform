# 增量3c — LLM/Hermes 提议候选关系 + 强制人工审批队列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pluggable relation proposer (deterministic heuristic) generates candidate cross-view relations into an append-only audited store; a mandatory human-approval queue (通过/拒绝/修正) is the only path that produces an authoritative structured effect (person merge); candidates surface as a clearly-separated union in `/api/related` and UI; plus the §18.0-line823 ref-cell direct-jump follow-up.

**Architecture:** Proposals live in a dedicated `proposals` table (NOT the derived graph, NOT authoritative) — §0.3 invariant preserved. `scan` runs proposers (read-only analysis) and persists 待审批; `decide 通过` runs the authoritative structured write (minimal §2.1 person merge: re-point edges + union props + hard-delete dup + audit). Backend and frontend are disjoint file sets → parallel Wave-1 after the shared contract gate.

**Tech Stack:** Node+TS+Express+better-sqlite3 (sync), React+TS+Vite+AntD, vitest+supertest, Playwright. PRD §20 is the development basis.

---

## File Structure

- `packages/shared/src/types.ts` — add `RelationProposalStatus`, `RelationProposal` (T1)
- `packages/shared/src/repository.ts` — add `RelationProposer` interface + 4 Repository proposal methods (T1)
- `packages/shared/src/types.test.ts` — contract tests (T1)
- `apps/backend/src/db.ts` — `proposals` table DDL (T2)
- `apps/backend/src/repository.ts` — implement 4 proposal methods on `SqliteRepository` (T2)
- `apps/backend/src/proposer.ts` — NEW: `levenshtein`, `HeuristicRelationProposer` (T2)
- `apps/backend/src/merge.ts` — NEW: `mergePerson(repo, fromId, toId, actor)` (T2)
- `apps/backend/src/proposals.ts` — NEW: router `/api/proposals/scan|`, list, `/:id/decide` (T2)
- `apps/backend/src/related.ts` — add `?includeCandidates=1` → `candidates[]` (T2)
- `apps/backend/src/app.ts` — wire proposals router (T2)
- `apps/backend/test/proposals.e2e.test.ts` — NEW backend e2e (T2)
- `apps/frontend/src/api.ts` — `listProposals/scanProposals/decideProposal`, `getRelated` opt, `RelatedResult.candidates?` (T3)
- `apps/frontend/src/pages/ProposalsPage.tsx` — NEW approval queue page (T3)
- `apps/frontend/src/App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx` — route+nav+card (T3)
- `apps/frontend/src/pages/RelatedPage.tsx` — separate 候选关系（待审批）group (T3)
- `apps/frontend/src/pages/EntityTable.tsx` — `RefCell` direct-jump + fallback (T3)
- `apps/frontend/e2e/proposals.spec.ts` — NEW FE e2e (T3)

---

## Task 1: Shared contracts (SERIAL GATE — T2/T3 depend on this)

**Files:** Modify `packages/shared/src/types.ts`, `packages/shared/src/repository.ts`, `packages/shared/src/types.test.ts`

- [ ] **Step 1: Write failing contract test** — append to `packages/shared/src/types.test.ts`:

```ts
describe("relation-proposal contracts", () => {
  it("RelationProposal shape + Chinese status literals", () => {
    const p: RelationProposal = {
      id: "p1", sourceNodeId: "a", targetNodeId: "b", relationType: "SAME_AS",
      confidence: 0.8, proposerSource: "heuristic-v1", rationale: "张伟≈张玮 dist=1",
      status: "待审批", createdAt: new Date().toISOString(),
    };
    const decided: RelationProposalStatus[] = ["待审批", "已通过", "已拒绝"];
    expect(decided).toContain(p.status);
    const p2: RelationProposal = { ...p, status: "已通过", decidedBy: "运营", decidedAt: "t" };
    expect(p2.decidedBy).toBe("运营");
  });
  it("RelationProposer.propose returns proposal drafts (no id/status)", () => {
    const proposer: RelationProposer = {
      propose: () => [{ sourceNodeId: "a", targetNodeId: "b", relationType: "SAME_AS",
        confidence: 0.9, proposerSource: "heuristic-v1", rationale: "r" }],
    };
    const out = proposer.propose({} as Repository, {} as SchemaRegistry);
    expect(out[0].relationType).toBe("SAME_AS");
  });
});
```

Add to the test file's import line the names `RelationProposal, RelationProposalStatus, RelationProposer, Repository, SchemaRegistry` (from `@combat/shared` / local `./...` consistent with existing imports in that file).

- [ ] **Step 2: Run — expect FAIL** (`npm run test:shared`) with "RelationProposal is not defined" / TS errors.

- [ ] **Step 3: Add types** — append to `packages/shared/src/types.ts`:

```ts
export type RelationProposalStatus = "待审批" | "已通过" | "已拒绝";
export interface RelationProposal {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  confidence: number;
  proposerSource: string;
  rationale: string;
  status: RelationProposalStatus;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}
```

- [ ] **Step 4: Add proposer interface + Repository methods** — in `packages/shared/src/repository.ts`:

Add to the top import: `import type { GraphNode, GraphEdge, ProgressLog, RelationProposal, RelationProposalStatus } from "./types.js";` and `import type { SchemaRegistry } from "./registry.js";`

Append inside `interface Repository { ... }` (before closing brace):

```ts
  createProposal(p: Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">, actor: string): RelationProposal;
  listProposals(opts?: { status?: RelationProposalStatus }): RelationProposal[];
  getProposal(id: string): RelationProposal | undefined;
  updateProposalStatus(id: string, status: RelationProposalStatus, decidedBy: string, actor: string): RelationProposal;
```

After the interface, add:

```ts
export type ProposalDraft = Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">;
export interface RelationProposer {
  propose(repo: Repository, registry: SchemaRegistry): ProposalDraft[];
}
```

- [ ] **Step 5: Run — expect PASS** (`npm run test:shared` → all green incl. prior; `cd apps/backend && npx tsc -p tsconfig.json --noEmit` may now fail because `SqliteRepository` doesn't implement the new methods — that is expected and is T2's job; shared itself + its test must be green and shared has no tsc step beyond vitest typecheck).

Verify only: `npm run test:shared` green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/repository.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): RelationProposal + RelationProposer + Repository proposal contracts (3c-T1)"
```

---

## Task 2: Backend — proposer + store + approval + related candidates (PARALLEL, after T1)

**Files:** Modify `apps/backend/src/db.ts`, `apps/backend/src/repository.ts`, `apps/backend/src/related.ts`, `apps/backend/src/app.ts`; Create `apps/backend/src/proposer.ts`, `apps/backend/src/merge.ts`, `apps/backend/src/proposals.ts`, `apps/backend/test/proposals.e2e.test.ts`

- [ ] **Step 1: proposals table** — in `apps/backend/src/db.ts` add inside the `db.exec(\`...\`)` block (after `audit_log` table, before the `CREATE INDEX` lines):

```sql
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL, target_node_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, confidence REAL, proposer_source TEXT,
      rationale TEXT, status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
```

- [ ] **Step 2: Write failing backend e2e** — create `apps/backend/test/proposals.e2e.test.ts`:

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
  const dir = mkdtempSync(join(tmpdir(), "combat-prop-"));
  const cfg = join(dir, "schemas"); mkdirSync(cfg);
  writeFileSync(join(cfg, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [{ name: "标题", type: "string", label: "标题", required: true },
      { name: "当前处理人", type: "ref", label: "当前处理人", refType: "person", concept: "负责人" }],
  }));
  writeFileSync(join(cfg, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true }],
  }));
  const repo = new SqliteRepository(openDb(join(dir, "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("relation proposals e2e", () => {
  it("scan proposes SAME_AS for near (non-exact) persons; exact not proposed; idempotent", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "张伟" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "张玮" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T3", 当前处理人: "李雷" });
    const s1 = await request(app).post("/api/proposals/scan").send({});
    expect(s1.status).toBe(200);
    expect(s1.body.created).toBe(1);
    const s2 = await request(app).post("/api/proposals/scan").send({});
    expect(s2.body.created).toBe(0); // idempotent: pending triple not re-created
    const list = await request(app).get("/api/proposals?status=待审批");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].relationType).toBe("SAME_AS");
    expect(list.body[0].status).toBe("待审批");
  });

  it("decide 通过 merges persons authoritatively (+audit); re-decide → 409", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "王芳" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "王芳 " }); // trailing space → near, not exact after norm? exact-after-trim handled by 3a; use distinct:
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T3", 当前处理人: "王萍" });
    await request(app).post("/api/proposals/scan").send({});
    const list = (await request(app).get("/api/proposals?status=待审批")).body;
    const pid = list[0].id;
    const before = repo.queryNodes("person").length;
    const d = await request(app).post(`/api/proposals/${pid}/decide`).send({ decision: "通过", decidedBy: "运营" });
    expect(d.status).toBe(200);
    expect(repo.queryNodes("person").length).toBe(before - 1); // dup merged away
    const got = (await request(app).get("/api/proposals?status=已通过")).body;
    expect(got.find((x: any) => x.id === pid)?.decidedBy).toBe("运营");
    const again = await request(app).post(`/api/proposals/${pid}/decide`).send({ decision: "通过", decidedBy: "运营" });
    expect(again.status).toBe(409);
  });

  it("decide 拒绝 → 已拒绝 + subsequent scan suppresses that triple", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "陈晨" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "陈辰" });
    await request(app).post("/api/proposals/scan").send({});
    const pid = (await request(app).get("/api/proposals?status=待审批")).body[0].id;
    const r = await request(app).post(`/api/proposals/${pid}/decide`).send({ decision: "拒绝", decidedBy: "运营" });
    expect(r.status).toBe(200);
    const s = await request(app).post("/api/proposals/scan").send({});
    expect(s.body.created).toBe(0); // rejected triple suppressed
    expect((await request(app).get("/api/proposals?status=待审批")).body).toHaveLength(0);
  });

  it("/api/related?includeCandidates=1 adds candidates; authoritative lists never contain them; no-param == 3b", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "刘洋" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "刘阳" });
    await request(app).post("/api/proposals/scan").send({});
    const persons = repo.queryNodes("person");
    const pid = persons[0].id;
    const plain = await request(app).get(`/api/related/person/${pid}`);
    expect(plain.body.candidates).toBeUndefined();
    expect(Array.isArray(plain.body.incoming)).toBe(true);
    const withC = await request(app).get(`/api/related/person/${pid}?includeCandidates=1`);
    expect(Array.isArray(withC.body.candidates)).toBe(true);
    expect(withC.body.candidates.length).toBeGreaterThanOrEqual(1);
    // authoritative lists must not contain proposal nodes
    const allAuth = [...withC.body.outgoing, ...withC.body.incoming];
    expect(allAuth.every((x: any) => x.proposalId === undefined)).toBe(true);
  });

  it("HeuristicRelationProposer is deterministic (same input → same output)", async () => {
    const { app } = makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "赵敏" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "赵明" });
    const a = await request(app).post("/api/proposals/scan").send({});
    expect(a.body.created).toBe(1);
    const list1 = (await request(app).get("/api/proposals")).body.map((x: any) => x.rationale).sort();
    // second app, same data → same rationale set
    const { app: app2 } = makeApp();
    await request(app2).post("/api/nodes/attackTicket").send({ 标题: "T1", 当前处理人: "赵敏" });
    await request(app2).post("/api/nodes/attackTicket").send({ 标题: "T2", 当前处理人: "赵明" });
    await request(app2).post("/api/proposals/scan").send({});
    const list2 = (await request(app2).get("/api/proposals")).body.map((x: any) => x.rationale).sort();
    expect(list2).toEqual(list1);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`cd apps/backend && npx vitest run proposals.e2e` → 404s / missing routes).

- [ ] **Step 4: Implement Repository proposal methods** — in `apps/backend/src/repository.ts` add `import type { ..., RelationProposal, RelationProposalStatus } from "@combat/shared";` and add methods to `SqliteRepository`:

```ts
  createProposal(p: Omit<RelationProposal,"id"|"status"|"decidedBy"|"decidedAt"|"createdAt">, actor: string): RelationProposal {
    const now = new Date().toISOString();
    const row: RelationProposal = { ...p, id: randomUUID(), status: "待审批", createdAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO proposals VALUES (@id,@s,@t,@rt,@c,@ps,@r,@st,@db,@da,@ca)`)
        .run({ id: row.id, s: row.sourceNodeId, t: row.targetNodeId, rt: row.relationType,
          c: row.confidence, ps: row.proposerSource, r: row.rationale, st: row.status,
          db: null, da: null, ca: now });
      this.audit("CREATE", "proposal", row.id, { relationType: row.relationType }, actor);
    })();
    return row;
  }
  private mapProposal(r: any): RelationProposal {
    return { id: r.id, sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id,
      relationType: r.relation_type, confidence: r.confidence, proposerSource: r.proposer_source,
      rationale: r.rationale, status: r.status, decidedBy: r.decided_by ?? undefined,
      decidedAt: r.decided_at ?? undefined, createdAt: r.created_at };
  }
  listProposals(opts: { status?: RelationProposalStatus } = {}): RelationProposal[] {
    const rows = this.db.prepare(`SELECT * FROM proposals`).all() as any[];
    return rows.map(r => this.mapProposal(r))
      .filter(p => !opts.status || p.status === opts.status);
  }
  getProposal(id: string): RelationProposal | undefined {
    const r = this.db.prepare(`SELECT * FROM proposals WHERE id=?`).get(id) as any;
    return r ? this.mapProposal(r) : undefined;
  }
  updateProposalStatus(id: string, status: RelationProposalStatus, decidedBy: string, actor: string): RelationProposal {
    const cur = this.getProposal(id);
    if (!cur) throw new Error(`proposal ${id} not found`);
    const at = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE proposals SET status=?, decided_by=?, decided_at=? WHERE id=?`)
        .run(status, decidedBy, at, id);
      this.audit("UPDATE", "proposal", id, { status, decidedBy }, actor);
    })();
    return { ...cur, status, decidedBy, decidedAt: at };
  }
```

- [ ] **Step 5: Implement proposer** — create `apps/backend/src/proposer.ts`:

```ts
import type { Repository, SchemaRegistry, ProposalDraft, RelationProposer } from "@combat/shared";

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1,
        d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export class HeuristicRelationProposer implements RelationProposer {
  constructor(private threshold = 2, private source = "heuristic-v1") {}
  propose(repo: Repository, registry: SchemaRegistry): ProposalDraft[] {
    const cfg = registry.getConfig();
    const refTypes = new Set<string>();
    for (const ns of cfg.nodeTypes)
      for (const f of ns.fields) if (f.type === "ref" && f.refType) refTypes.add(f.refType);
    const out: ProposalDraft[] = [];
    for (const rt of [...refTypes].sort()) {
      const nodes = repo.queryNodes(rt)
        .map(n => ({ id: n.id, key: norm(String(n.properties["name"] ?? n.id)) }))
        .sort((a, b) => a.id < b.id ? -1 : 1); // deterministic order
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const A = nodes[i], B = nodes[j];
          if (!A.key || !B.key || A.key === B.key) continue; // exact handled by 3a
          const dist = levenshtein(A.key, B.key);
          const maxLen = Math.max(A.key.length, B.key.length);
          if (dist > this.threshold) continue;
          out.push({ sourceNodeId: A.id, targetNodeId: B.id, relationType: "SAME_AS",
            confidence: Math.round((1 - dist / maxLen) * 100) / 100,
            proposerSource: this.source,
            rationale: `${A.key}≈${B.key} dist=${dist}` });
        }
    }
    return out;
  }
}
```

- [ ] **Step 6: Implement person merge** — create `apps/backend/src/merge.ts`:

```ts
import type { Repository } from "@combat/shared";

/** Minimal §2.1 person merge: union missing props into canonical (toId),
 * re-point every edge off the duplicate (fromId), hard-delete duplicate.
 * Irreversible; every step audited via repo primitives. */
export function mergePerson(repo: Repository, fromId: string, toId: string, actor: string): void {
  if (fromId === toId) return;
  const dup = repo.getNode(fromId), canon = repo.getNode(toId);
  if (!dup || !canon) throw new Error("merge: node not found");
  const unioned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dup.properties))
    if (canon.properties[k] === undefined || canon.properties[k] === "") unioned[k] = v;
  if (Object.keys(unioned).length) repo.updateNode(toId, unioned, actor);
  for (const e of repo.queryEdges({ sourceId: fromId }))
    repo.createEdge(e.edgeType, toId, e.targetId, e.properties, actor);
  for (const e of repo.queryEdges({ targetId: fromId }))
    repo.createEdge(e.edgeType, e.sourceId, toId, e.properties, actor);
  repo.deleteNode(fromId, actor); // deleteNode also drops the dup's now-superseded edges
}
```

- [ ] **Step 7: Implement proposals router** — create `apps/backend/src/proposals.ts`:

```ts
import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import { HeuristicRelationProposer } from "./proposer.js";
import { mergePerson } from "./merge.js";

export function makeProposalsRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  const proposers = [new HeuristicRelationProposer()];

  r.post("/proposals/scan", (_req, res) => {
    const existing = repo.listProposals();
    const seen = new Set(existing
      .filter(p => p.status === "待审批" || p.status === "已拒绝")
      .map(p => `${p.sourceNodeId}|${p.targetNodeId}|${p.relationType}`));
    let created = 0;
    for (const pr of proposers)
      for (const d of pr.propose(repo, registry)) {
        const k = `${d.sourceNodeId}|${d.targetNodeId}|${d.relationType}`;
        if (seen.has(k)) continue;
        seen.add(k);
        repo.createProposal(d, "scan");
        created++;
      }
    res.json({ created });
  });

  r.get("/proposals", (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(repo.listProposals(status ? { status: status as any } : {}));
  });

  r.post("/proposals/:id/decide", (req, res) => {
    const p = repo.getProposal(req.params.id);
    if (!p) return res.status(404).json({ error: "proposal not found" });
    if (p.status !== "待审批") return res.status(409).json({ error: `已决策(${p.status})不可重复` });
    const { decision, decidedBy, patch } = req.body ?? {};
    if (!decidedBy || typeof decidedBy !== "string")
      return res.status(400).json({ error: "decidedBy 必填" });
    if (decision === "拒绝") {
      const u = repo.updateProposalStatus(p.id, "已拒绝", decidedBy, decidedBy);
      return res.json(u);
    }
    if (decision === "通过" || decision === "修正") {
      const target = decision === "修正" && patch?.targetNodeId ? patch.targetNodeId : p.targetNodeId;
      if (p.relationType === "SAME_AS") mergePerson(repo, p.sourceNodeId, target, decidedBy);
      const u = repo.updateProposalStatus(p.id, "已通过", decidedBy, decidedBy);
      return res.json(u);
    }
    return res.status(400).json({ error: "decision ∈ {通过,拒绝,修正}" });
  });

  return r;
}
```

- [ ] **Step 8: includeCandidates in related** — in `apps/backend/src/related.ts`, replace the `res.json({ outgoing: out, incoming: inc });` line with:

```ts
    if (req.query.includeCandidates) {
      const cand = repo.listProposals({ status: "待审批" })
        .filter(p => p.sourceNodeId === id || p.targetNodeId === id)
        .map(p => {
          const otherId = p.sourceNodeId === id ? p.targetNodeId : p.sourceNodeId;
          return { proposalId: p.id, relationType: p.relationType,
            confidence: p.confidence, rationale: p.rationale, node: repo.getNode(otherId) };
        }).filter(x => x.node);
      return res.json({ outgoing: out, incoming: inc, candidates: cand });
    }
    res.json({ outgoing: out, incoming: inc });
```

- [ ] **Step 9: Wire router** — in `apps/backend/src/app.ts` add `import { makeProposalsRouter } from "./proposals.js";` and `app.use("/api", makeProposalsRouter(deps.repo, deps.registry));` (after `makeRelatedRouter`, before the error middleware).

- [ ] **Step 10: Run — expect PASS** (`cd apps/backend && npx vitest run` → all green incl. proposals.e2e 5/5; then `npx tsc -p tsconfig.json --noEmit` clean).

- [ ] **Step 11: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/backend/src/db.ts apps/backend/src/repository.ts apps/backend/src/proposer.ts apps/backend/src/merge.ts apps/backend/src/proposals.ts apps/backend/src/related.ts apps/backend/src/app.ts apps/backend/test/proposals.e2e.test.ts
git commit -m "feat(backend): heuristic relation proposer + approval queue + person merge + related candidates (3c-T2)"
```

---

## Task 3: Frontend — approval queue + union view + ref direct-jump (PARALLEL, after T1)

**Files:** Modify `apps/frontend/src/api.ts`, `App.tsx`, `pages/AppShell.tsx`, `pages/HomePage.tsx`, `pages/RelatedPage.tsx`, `pages/EntityTable.tsx`; Create `pages/ProposalsPage.tsx`, `e2e/proposals.spec.ts`

- [ ] **Step 1: Extend api.ts** — in `apps/frontend/src/api.ts`:

Add to imports: `RelationProposal` from `@combat/shared`. Extend `RelatedResult`:

```ts
export interface RelatedResult {
  outgoing: { field: string; concept: string; node: GraphNode }[];
  incoming: { field: string; concept: string; node: GraphNode }[];
  candidates?: { proposalId: string; relationType: string; confidence: number; rationale: string; node: GraphNode }[];
}
```

Replace `getRelated` and add three methods:

```ts
  getRelated(nodeType: string, id: string, opts: { includeCandidates?: boolean } = {}): Promise<RelatedResult> {
    const qs = opts.includeCandidates ? "?includeCandidates=1" : "";
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}${qs}`, {});
  }
  listProposals(status?: string): Promise<RelationProposal[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.req<RelationProposal[]>(`/api/proposals${qs}`, {});
  }
  scanProposals(): Promise<{ created: number }> {
    return this.req<{ created: number }>(`/api/proposals/scan`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  }
  decideProposal(id: string, decision: string, decidedBy: string, patch?: { targetNodeId?: string }): Promise<RelationProposal> {
    return this.req<RelationProposal>(`/api/proposals/${id}/decide`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, decidedBy, patch }) });
  }
```

- [ ] **Step 2: ProposalsPage** — create `apps/frontend/src/pages/ProposalsPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from "react";
import { Table, Button, Space, message, Typography } from "antd";
import { api } from "../api.js";
import type { RelationProposal } from "@combat/shared";

export function ProposalsPage() {
  const [rows, setRows] = useState<RelationProposal[]>([]);
  const refresh = useCallback(async () => {
    setRows(await api.listProposals("待审批"));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const scan = async () => {
    try { const r = await api.scanProposals(); message.success(`扫描完成，新增 ${r.created} 条候选`); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const decide = async (id: string, decision: string) => {
    try { await api.decideProposal(id, decision, "运营"); message.success(`已${decision}`); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };

  const columns = [
    { title: "来源实体", dataIndex: "sourceNodeId" },
    { title: "目标实体", dataIndex: "targetNodeId" },
    { title: "关系", dataIndex: "relationType" },
    { title: "置信度", dataIndex: "confidence" },
    { title: "理由", dataIndex: "rationale" },
    { title: "创建时间", dataIndex: "createdAt" },
    { title: "操作", dataIndex: "__act",
      render: (_: unknown, p: RelationProposal) => (
        <Space>
          <Button aria-label={`approve-${p.id}`} type="primary" onClick={() => decide(p.id, "通过")}>通过</Button>
          <Button aria-label={`reject-${p.id}`} danger onClick={() => decide(p.id, "拒绝")}>拒绝</Button>
        </Space>
      ) },
  ];
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>关系审批队列</Typography.Title>
      <Button aria-label="scan-proposals" type="primary" onClick={scan} style={{ marginBottom: 12 }}>扫描候选</Button>
      {rows.length === 0 && <p role="status">暂无待审批候选</p>}
      <Table rowKey="id" columns={columns} pagination={false} dataSource={rows} />
    </div>
  );
}
```

- [ ] **Step 3: Route + nav + home card** —
  - `App.tsx`: add `import { ProposalsPage } from "./pages/ProposalsPage.js";` and `<Route path="/proposals" element={<ProposalsPage />} />` (after the `/related` route).
  - `AppShell.tsx`: add to `ITEMS` (after import): `{ key: "/proposals", label: <Link to="/proposals">关系审批</Link> },`
  - `HomePage.tsx`: add to `MODULES`: `{ to: "/proposals", title: "关系审批", desc: "候选关系扫描与人工审批" },`

- [ ] **Step 4: RelatedPage candidates group** — in `apps/frontend/src/pages/RelatedPage.tsx`:
  - Change the effect call to `api.getRelated(nodeType, id, { includeCandidates: true }).then(setData).catch(() => setData({ outgoing: [], incoming: [] }));`
  - After the authoritative groups `.map(...)` block (after its closing `))}`), before the outer `</div>`, add:

```tsx
      {(data?.candidates?.length ?? 0) > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #d46b08", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#d46b08" }}>候选关系（待审批）</Typography.Title>
          <List size="small" dataSource={data!.candidates}
            rowKey={(c) => c.proposalId}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#d46b08" }}>
                  [{c.relationType} {Math.round(c.confidence * 100)}%] {c.rationale}
                </span>
              </List.Item>
            )} />
        </div>
      )}
```

- [ ] **Step 5: RefCell direct-jump** — in `apps/frontend/src/pages/EntityTable.tsx`:

Add a component above `export function EntityTable`:

```tsx
function RefCell({ nodeType, rowId, fieldId, value }: { nodeType: string; rowId: string; fieldId: string; value: string }) {
  const [to, setTo] = useState(`/related/${nodeType}/${rowId}`);
  useEffect(() => {
    api.getRelated(nodeType, rowId).then(d => {
      const hit = d.outgoing.find(o => o.field === fieldId);
      if (hit) setTo(hit.node.nodeType === "attackTicket"
        ? `/attack/${hit.node.id}` : `/related/${hit.node.nodeType}/${hit.node.id}`);
    }).catch(() => {});
  }, [nodeType, rowId, fieldId]);
  return <Link aria-label={`ref-${fieldId}`} to={to}>{value}</Link>;
}
```

Replace the ref-cell line `if (f.type === "ref") return <Link aria-label={...} to={...}>{val}</Link>;` with:

```tsx
        if (f.type === "ref") return <RefCell nodeType={nodeType} rowId={r.id} fieldId={f.id} value={val} />;
```

(Imports already include `useEffect, useState`, `Link`, `api`.)

- [ ] **Step 6: Run frontend unit + build — expect PASS** (`cd apps/frontend && npx vitest run` → 11/11 still; `npx vite build` green).

- [ ] **Step 7: Write FE e2e** — create `apps/frontend/e2e/proposals.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-P1 proposals queue: nav, scan, approve; RelatedPage candidate group", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "P1单", 状态: "进行中", 当前处理人: "孙悟空" } });
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "P2单", 状态: "进行中", 当前处理人: "孙悟饭" } });

  await page.goto("/");
  await page.getByRole("link", { name: "关系审批", exact: true }).first().click();
  await expect(page).toHaveURL(/\/proposals$/);
  await page.getByLabel("scan-proposals").click();
  const row = page.getByRole("row").filter({ hasText: "SAME_AS" }).first();
  await expect(row).toBeVisible();

  // RelatedPage shows separate 候选关系（待审批） group
  const persons = await (await page.request.get(`${API}/api/nodes/person`)).json();
  await page.goto(`/related/person/${persons[0].id}`);
  await expect(page.getByRole("heading", { name: "候选关系（待审批）" })).toBeVisible();

  // approve → row disappears from queue
  await page.goto("/proposals");
  await page.getByLabel(/^approve-/).first().click();
  await expect(page.getByRole("row").filter({ hasText: "SAME_AS" })).toHaveCount(0);
});

test("FE-P2 ref cell jumps directly to the referenced person's relations page", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "直跳单", 状态: "进行中", 当前处理人: "唐僧" } })).json();
  await page.goto("/attack");
  await page.getByRole("cell", { name: "唐僧" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/related\/person\//);
  await expect(page.getByText("关联全景", { exact: false })).toBeVisible();
});
```

- [ ] **Step 8: Commit**

```bash
git checkout -- config/schemas/ 2>/dev/null || true
git add apps/frontend/src/api.ts apps/frontend/src/App.tsx apps/frontend/src/pages/AppShell.tsx apps/frontend/src/pages/HomePage.tsx apps/frontend/src/pages/ProposalsPage.tsx apps/frontend/src/pages/RelatedPage.tsx apps/frontend/src/pages/EntityTable.tsx apps/frontend/e2e/proposals.spec.ts
git commit -m "feat(ui): relation-approval queue + candidate union group + ref-cell direct-jump (3c-T3)"
```

---

## Task 4: Gate

- [ ] Merge T2 then T3 to master (controller, `--no-ff`); verify integrated: backend `npx vitest run` (expect 58: 54 + 4 was 5? proposals.e2e has 5 → expect 58), backend `tsc --noEmit` clean, frontend `npx vitest run` (11), `npm run test:shared` (11), frontend `npx vite build` green.
- [ ] Spec-compliance review (T2, T3) concurrently vs PRD §20; then code-quality review (T2, T3); implementer fixes loop until both ✅.
- [ ] Comprehensive Playwright e2e coverage-audit (§18 standard): every 3c user-visible feature × spec; fill gaps (esp. decide-拒绝 path in UI, no-candidates empty state, ref-cell fallback when unresolved).
- [ ] Pre-clear stale :3001/:5173 (PowerShell `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen | Stop-Process -Force`), `git checkout -- config/schemas/`, then `npm run test:all` GREEN twice consecutively (ports cleared before each).
- [ ] Map PRD §20.6 (9 items) → evidence; flip `- [ ]`→`- [x]` with evidence; acceptance commit.
- [ ] `git tag -a increment-3c-proposals -m "increment-3c …"`.
- [ ] Deploy: `cd scripts/deploy && node deploy.mjs deploy`; verify http://www.catown.cloud:5173/ returns 200 + deploy.log backend=200 frontend=200.
- [ ] Final code-reviewer over the whole 3c branch; then finishing-a-development-branch.

---

## Self-Review

1. **Spec coverage (§20.6):** ① shared contracts → T1. ② scan near/exact/idempotent → T2 e2e #1. ③ list 待审批 → T2 #1. ④ 通过 merge+audit / 拒绝 suppress / 409 → T2 #2,#3. ⑤ includeCandidates union purity / no-param==3b → T2 #4. ⑥ /proposals page scan+通过/拒绝 + nav/home → T3 FE-P1 + Step 3. ⑦ RelatedPage separate candidate group → T3 Step 4 + FE-P1. ⑧ ref-cell direct-jump + fallback → T3 Step 5 + FE-P2. ⑨ coverage-audit + test:all twice + deploy → Task 4. All covered.
2. **Placeholder scan:** none — every code step has full code; `decidedBy:"运营"` is a documented MVP decision (§20.5).
3. **Type consistency:** `ProposalDraft`/`RelationProposal`/`RelationProposalStatus` defined in T1, used identically in T2 (`createProposal` Omit matches) and T3 (`RelationProposal` import). `RelatedResult.candidates?` shape matches backend Step 8 emit. `mergePerson(repo,from,to,actor)` signature consistent with router call.
4. **Determinism note:** proposer sorts by node id and refType; e2e #5 asserts cross-instance equality. Schema-mutation safety: 3c adds NO schema PATCH, so the shared-backend Playwright run is unaffected; proposals.spec.ts uses unique person names.

**Resolved during planning:** §20 says "走既有 §2.1 person 合并" but no merge exists yet — this plan provides the first minimal §2.1-conformant realization (`merge.ts`: union props + re-point edges + hard-delete dup + audited), satisfying §20.6 item ④ ("结构化权威合并：边迁移/字段并/审计"). No PRD edit needed.
