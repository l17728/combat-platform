# AGENTS.md

Guidance for agentic coding agents working in this repository.

## Core Mission (核心使命)

**Implement a NEW frontend application** that consumes the existing backend API. The existing
frontend (`apps/frontend/`) serves as a **reference only** — it must NOT be modified in any way.
The new frontend will be a separate app within this monorepo.

Rules:
1. **DO NOT modify `apps/frontend/`** — treat it as read-only reference code.
2. **DO NOT modify existing backend code** (`apps/backend/src/*`) unless there is no alternative
   (conflict, missing capability). Prefer adding new backend files/modules.
3. If backend changes are unavoidable, document exactly what was changed and why.
4. New backend capabilities should be added as new files/modules following existing patterns
   (router factory, dependency injection, audit logging).
5. All backend API endpoints are documented in `docs/API_REFERENCE.md` (50+ endpoints).
6. Shared types in `packages/shared/` can be extended (additive only) but not broken.

The new frontend should leverage the full backend API surface:
- Config-driven CRUD for 16+ nodeTypes (attackTicket, person, contribution, etc.)
- Cross-view relations (REF edges, ANCHORED_TO anchors, concept grouping)
- Hermes Q&A, search, recommendation, proposals approval
- Import/export Excel, daily reports, reminders, conflict detection
- KG graph visualization, audit logs, person merge, status transitions
- Email sending, custom commands, escalation management

## New Frontend Directory

The new frontend lives in `apps/frontend-v2/` — completely separate from the reference frontend.
Do NOT create or modify any files under `apps/frontend/`.

## Deployment

### Target Server (新前端部署)
- **目标机**: `60.204.199.234`（Ubuntu 24.04, 30G RAM, 296G disk）
- **跳板机**: `47.103.99.229`（必须通过此机器 SSH 跳转，不能直连目标机）
- **跳板机凭据**: 见 `.env.deploy`（DEPLOY_HOST/USER/PASS）
- **部署路径**: `/opt/combat-v2/`（目标机上，已创建）
- **后端 API**: 目标机上运行后端 `tsx src/server.ts`，端口 :3001（已验证可用）
- **前端**: 待实现 `apps/frontend-v2/` 后部署
- **部署脚本**: `scripts/deploy-v2/` 目录

#### 快速部署命令（从 scripts/deploy-v2/ 目录执行）
```bash
# 先安装依赖（仅首次）
cd scripts/deploy-v2 && npm install

# 检查目标机状态
node deploy.mjs check

# 一键部署（打包→跳板机→目标机→npm install→启动后端）
node deploy.mjs deploy
```

#### 已验证的关键信息
- 目标机系统 Node v24.13.0，但 **better-sqlite3@11 不兼容 Node 24**
- run-backend.sh 自动安装 Node v22.14.0 到 `/opt/node22-v2/`，用该版本运行后端
- 后端启动后监听 `0.0.0.0:3001`，自动扫描定时任务（5分钟间隔）
- 部署脚本经跳板机跳转：本地→47.103.99.229（ssh2）→60.204.199.234（SSH key 免密）
- 跳板机 SSH 密钥 `/root/.ssh/id_ed25519` 已写入目标机 authorized_keys

### Existing Deployment (参考前端，不要修改)
- **服务器**: `47.103.99.229`（Alibaba Cloud Linux）
- **路径**: `/opt/combat/`
- **前端端口**: 5173（vite preview）
- **后端端口**: 3001（tsx server.ts）
- **部署脚本**: `scripts/deploy/deploy.mjs` + `run-deploy.sh`

## Project Overview

Combat management tool (作战管理工具) — a monorepo for tracking attack/escalation tickets,
contributions, and operations data. One data model with many "combat table" views.
Node.js + Express backend, React + Ant Design frontend, shared types package.
Config-driven schemas (JSON files, no DDL migrations).

## Repository Structure

```
packages/shared/    # @combat/shared — types, interfaces (Repository, SchemaRegistry)
apps/backend/       # @combat/backend — Express API server (SQLite via better-sqlite3)
apps/frontend/      # @combat/frontend — Reference frontend (READ ONLY, do not modify)
apps/frontend-v2/   # @combat/frontend-v2 — New professional frontend (Vite, Ant Design 5, React 18)
config/schemas/     # JSON schema definitions for each entity type (16+ files)
scripts/deploy/     # Deployment scripts (reference frontend)
scripts/deploy-v2/  # Deployment scripts (new frontend + backend)
```

## Build / Dev / Test Commands

All commands run from repo root unless noted. This is an npm workspaces monorepo.

### Development
```bash
npm run dev:backend          # Start backend on :3001 (tsx watch)
npm run dev:frontend         # Start frontend on :5173 (vite dev)
npm run dev:frontend-v2      # Start frontend-v2 on :5174 (vite dev)
```

### Run All Tests (full CI gate)
```bash
npm run test:all             # shared + backend + frontend unit + frontend e2e (resets schemas between suites)
```

### Run Tests by Package
```bash
npm run test:shared          # packages/shared vitest unit tests
npm run test:backend         # apps/backend vitest e2e tests
npm run test --workspace=@combat/frontend     # frontend vitest unit tests (src/**/*.test.tsx)
npm run test:frontend:e2e    # Playwright browser e2e tests (apps/frontend/e2e/)
```

### Run a Single Test File
```bash
# Backend (from apps/backend/):
npx vitest run test/import.e2e.test.ts
# Or from root:
npx vitest run --workspace=@combat/backend test/import.e2e.test.ts

# Shared (from packages/shared/):
npx vitest run src/types.test.ts

# Frontend unit (from apps/frontend/):
npx vitest run src/pages/EntityTable.test.tsx

# Frontend e2e (from apps/frontend/):
npx playwright test e2e/attack.spec.ts
```

### Run a Single Test by Name Pattern
```bash
npx vitest run -t "creates and reads"     # matches test name substring
npx playwright test -g "attack detail"     # Playwright grep
```

### CLI (agent-operable)
```bash
npm run cli -- <command> [args] [--opts]   # reads COMBAT_API env (default http://localhost:3001)
npm run cli -- help                        # lists all commands with usage
npm run cli -- help nodes:create           # per-command detail
```

### Schemas Reset (tests mutate schema files)
```bash
npm run reset:schemas        # git checkout -- config/schemas/
```

### Lint / Typecheck
No ESLint or Prettier config exists yet. TypeScript strict mode is enforced:
```bash
npx tsc --noEmit --workspace=@combat/backend
npx tsc --noEmit --workspace=@combat/shared
```

## Code Style Guidelines

### TypeScript Configuration
- **Target:** ES2022, **Module:** NodeNext, **ModuleResolution:** NodeNext
- **Strict mode** enabled (`strict: true` in tsconfig.base.json)
- **ESM throughout** (`"type": "module"` in all package.json files)

### Imports
- **Always use `.js` extensions** on relative/local imports (NodeNext requirement):
  ```ts
  import { openDb } from "./db.js";
  import { makeTestApp } from "./helpers.js";
  ```
- **Node builtins** use `node:` prefix:
  ```ts
  import { randomUUID } from "node:crypto";
  import { join } from "node:path";
  ```
- **Shared package** imported by package name:
  ```ts
  import type { Repository, SchemaRegistry } from "@combat/shared";
  import { PRIVILEGED_ROLES } from "@combat/shared";
  ```
- Use `import type` for type-only imports.

### Formatting
- No auto-formatter configured. Follow existing style:
  - 2-space indentation
  - Single quotes for strings
  - Semicolons required
  - No trailing commas in multi-line
  - Keep lines under ~120 chars

### Comments
- **Do NOT add comments** unless explicitly asked. This is a standing directive.

### Naming Conventions
- **Files:** camelCase (`repository.ts`, `cli-core.ts`, `makeRouter`)
- **React components:** PascalCase exports (`EntityTable`, `AttackDetail`)
- **Backend routers:** `makeXxxRouter()` factory functions
- **Interfaces/types:** PascalCase (`GraphNode`, `FieldSchema`, `ValidationResult`)
- **Variables/functions:** camelCase
- **Constants:** UPPER_SNAKE_CASE (`PRIVILEGED_ROLES`, `AUTO_SCAN_INTERVAL`)
- **CLI commands:** kebab-case or colon-separated (`nodes:list`, `schema:get`)

### Type Patterns
- Entity properties live in `Record<string, unknown>` — never hardcode field names.
- Domain enum values are **Chinese string literals** and are canonical. Never translate them.
  ```ts
  // Correct — preserve Chinese verbatim
  enumValues: ["待响应", "处理中", "已解决", "已关闭"]
  toStatus === "已解决"
  ```
- Use `interface` for data shapes, `type` for unions and utility types.
- Shared types go in `packages/shared/src/types.ts`; re-export from `index.ts`.

### Error Handling
- Express routes: validate input, return `{ error: string }` with appropriate HTTP status.
- Backend errors use structured logger: `log.warn/error(event, { fields })`.
- Async Express handlers wrapped with `asyncHandler()` from `logger.ts`.
- Frontend API client: throws `Error` with HTTP status and detail message.
- User-facing error messages in Chinese where domain-appropriate.

### Backend Patterns
- **Router factory pattern:** each feature file exports `makeXxxRouter(repo, registry)` → Express Router.
- **Dependency injection:** `createApp({ repo, registry })` — no globals, testable.
- **Audit logging:** every mutating action calls `repo.logAudit(...)` or `repo.audit(...)`.
- **Test helper:** `makeTestApp()` in `test/helpers.ts` creates a fresh in-memory app with temp schemas.
- **Tests use supertest:** `request(app).post("/api/...").send(body)`.
- **Never import `server.ts` in tests** — it starts listening. Use `createApp()` from `app.ts`.

### Frontend Patterns
- **API client:** `Api` class in `src/api.ts`, singleton `api` exported. All backend calls go through it.
- **Pages:** functional components using hooks (`useState`, `useEffect`, `useCallback`).
- **UI library:** Ant Design (`Table`, `Form`, `Modal`, `message`, etc.).
- **Routing:** react-router-dom v6 with `BrowserRouter` in `App.tsx`.
- **Config-driven tables:** `EntityTable` component renders columns from `NodeSchema.fields`.
- **Frontend unit tests** use vitest (src/**/*.test.tsx); **e2e tests** use Playwright (e2e/**/*.spec.ts).
- **Playwright config:** `fullyParallel: false, workers: 1` — sequential execution, single worker.

### Config-Driven Schema Rules
- Entity schemas are JSON files in `config/schemas/` (e.g., `attackTicket.json`, `person.json`).
- **Adding/removing a field is a config change, never a DB migration.**
- Business data lives in a `properties` JSON column on `nodes`/`edges` tables.
- Schema changes at runtime via API (`PATCH /api/schema/:nodeType`) write back to the config file.
- Tests mutate schema files; always run `npm run reset:schemas` between test suites.
  `test:all` does this automatically; when running individual suites, do it manually.

## Key Domain Concepts

- **nodeType** — entity kind (attackTicket, person, contribution, etc.)
- **Nodes** — universal data container with `nodeType` and `properties` JSON
- **Edges** — typed relationships between nodes (ASSIGNED_TO, CONTRIBUTED_TO, etc.)
- **ProgressLog** — append-only time series on attack tickets
- **Knowledge Graph** — derived from structured data, never directly written to
- **Entity resolution** — merge same person across sources (irreversible, audit-logged)

## New Backend Module: Help Request System

- **File:** `apps/backend/src/help-request.ts`
- **Table:** `help_requests` (auto-created on first use)
- **APIs:**
  - `POST /api/help-requests` — create help request + send email
  - `GET /api/help-requests?ticketId=&status=` — list with filters
  - `GET /api/help/feedback/:token` — public: get help info (no auth)
  - `POST /api/help/feedback/:token` — public: submit feedback (no auth)
- **Integration:** auto-appends feedback as progress on the associated ticket
- **Dependency:** requires SMTP config (`/api/email/config`) for email sending

## Frontend-v2 Architecture

- **Stack:** React 18 + Vite 6 + Ant Design 5 + react-router-dom 6 + TypeScript 5 strict
- **Dev port:** 5174, API proxied to localhost:3001
- **Production:** static files served by `serve` on port 80, API calls go to same-host:3001
- **Layout:** collapsible sidebar (200→64px) + fixed top bar with role switcher
- **Pages:** Dashboard, AttackList, AttackDetail, PeopleList, Contributions, Honor, PersonHonor, HelpCenter, HelpFeedback (public), ImportExport, EmailSettings, AuditLog
- **API client:** `src/api.ts` — singleton `api` instance, auto-detects production API base URL
