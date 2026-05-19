# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Principle: Parallelize Development

**Any task that CAN run in parallel MUST run in parallel, using multiple concurrent agents.** This is mandatory, not a preference. For every plan, identify the independent tasks (disjoint files, no shared state, no sequential dependency) and dispatch them as **multiple agents working concurrently, each in its own isolated git worktree** — launched in a single message. Do NOT fall back to sequential execution for convenience even when a process skill (e.g. subagent-driven-development) defaults to sequential; the user's parallelize directive overrides that default. Only serialize across a true data/sequence dependency (a dependency gate). Read-only work (reviews) may also run concurrently. This is a standing, emphatic directive from the user ("能并行的任务一定要并行处理，使用多个agent").

## Core Principle: Fast MVP, TDD, Full E2E Coverage

**Ship the leanest usable vertical slice fast, then iterate on real feedback.** Trim scope, not rigor — cut features to reach a usable end-to-end product quickly; defer non-essential work to later iterations. **All work is TDD** (failing test → minimal code → green → commit). **Design e2e test cases covering all functionality, both frontend and backend** (backend API e2e + frontend browser e2e); every feature must be covered. This is a standing directive from the user.

## Core Principle: Run to Completion (Autonomous Execution)

**Do not stop until all functional e2e tests (frontend + backend) pass and the product is manually usable.** Keep running through implementation, failures, and fixes autonomously. When a decision is required mid-execution, **choose the most-recommended option and proceed** — do not block on the user for routine decisions. This is a standing directive from the user.

## Core Principle: Generalize Fixes (举一反三)

**When a problem is found, fix the entire class of problems, not just the single instance.** Reason from one failure to all similar latent failures (举一反三), trace every divergent/leaf-node issue, and keep resolving until the problem space converges (no remaining related failures). This is a standing directive from the user.

## Repository State

**Greenfield / pre-implementation.** Only documents exist — no code, scaffolding, or git history:

- `PRD.md` — **the single authoritative development basis.** Source of truth for product scope, data model, architecture, priorities, and phasing.
- `req.md` — **reference only** (post-dates the original PRD; its requirements have been integrated into PRD.md). Do not develop against `req.md`; use it only as historical context. It contains the team's real Excel table schemas and the originating email/IM thread.

First implementation task is **Phase 1.1: project scaffolding** (monorepo: backend / frontend / shared types + schema config dir). No build/lint/test commands exist yet — establish them with the scaffold and update this file when they do.

## What This Product Is

A **作战管理工具** (operations/combat management tool). The essence (PRD §0): **one data model + many "combat tables" as views**. Each Excel table is just one projection of the same model.

- Do **not** build per-table CRUD silos. Build one model; each table is a view (projection) over it.
- **The core problem to solve is cross-view association**: the same person/task/attack-ticket appears across many tables and must be linked.

## Core Architectural Principles (decisions locked — PRD §0, §12)

**Hybrid data model — structured is authoritative, KG is derived.** All writes go through the config-driven *structured model* (single source of truth). The *knowledge graph* is **derived** from structured data (auto-synced, fully rebuildable) and used only for cross-view association, drill up/down, exploratory analysis, document search, and Hermes Q&A. The KG never accepts direct writes.

**Config-driven schema, no DDL.** A config file + versioned Schema Registry defines entities/fields/views/rules. Business fields live in a `properties` JSON column on unified `nodes`/`edges` tables — **adding/removing a field is a config change, never a DB migration**. UI can add/remove fields at runtime and the change is **written back to the config file** (takes effect on startup or manual scan). Never hardcode business field names in any layer.

**UI is config-driven and dynamic.** Tables/forms render from ViewSchema + EntitySchema. Supports switching between **traditional table ↔ layout/card** forms; same data, consistent.

**Entity resolution** (premise of cross-view linking): merge same entity across sources by descending confidence — exact ID → alias → fuzzy (+ human confirm) → manual. Person merges union fields and migrate edges; **irreversible**, audit-logged. Tasks/attack-tickets do not auto-merge.

**Progress is an append-only time series.** Task/AttackTicket progress is a `ProgressLog` sequence (append-only, with status snapshots) so it is traceable. **Everything mutating is audit-logged** (`audit_log`): create/update/delete/merge/escalate.

## Domain Language Constraint

Domain is Chinese (Huawei Cloud operations — ModelArts, oncall/攻关, escalation). Data-model enum values are **Chinese string literals and are canonical** — e.g. `status ∈ {待响应, 处理中, 已解决, 已关闭}`, `type ∈ {问题解决, 攻坚, 重构, 公关应对, 预防, 运维}`. Preserve verbatim in code, schemas, tests; never translate or "normalize" to English. PRD §2.3 is the canonical entity/enum definition. **Interact with the user in Chinese.**

## Planned Tech Stack (PRD §8.3 — confirm before deviating)

| Layer | Choice |
|---|---|
| Backend | Node.js + TypeScript + Express |
| DB | SQLite (dev) / PostgreSQL (prod, JSONB + GIN) |
| Graph traversal | self-implemented BFS/DFS on SQL + derived in-memory graph |
| Frontend | React + TypeScript + Vite |
| Graph viz | D3.js (force/hierarchy) + vis-network (interactive) |
| UI | Ant Design (+ ProForm for config-driven dynamic forms/tables) |
| Excel | xlsx (SheetJS) |
| Rules | json-rules-engine |
| Agent | Hermes Agent (read-only data interface) |

Structure: monorepo — `backend` / `frontend` / `shared` types + schema config.

## Implementation Phasing & Priorities (PRD §1, §10)

Priorities are driven by `req.md` (what the user cares about most), recorded in PRD §1:

- **P0-① 问题攻关 (attack/escalation)** — track attack tickets (owner + participants + progress sync) + search related info in docs/history.
- **P0-② 荣誉殿堂 (Hall of Honor)** — standalone contribution-recording module.
- Other reqs (李嘉's 6 points, auto daily report, find-helper recommendation, etc.) are recorded in PRD §1.4 and scheduled later — **do not drop them**.

Phasing: **P1** data foundation + config-driven schema + attack console skeleton → **P2** Hall of Honor + cross-view linking + derived KG → **P3** Hermes + automation + remaining req.md items. Acceptance criteria in PRD §11 are the definition of done. Open questions in PRD §13 — resolve with the user, do not assume.

## Working With the Spec

Read the relevant PRD section before implementing — it specifies data shapes, view configs, automation triggers precisely. **PRD.md is the only development basis;** `req.md` is reference context only. Do not invent import formats — the import engine must handle the real Excel schemas catalogued in PRD §3.2 / `req.md`.
