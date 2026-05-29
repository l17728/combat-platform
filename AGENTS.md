# AGENTS.md

Guidance for agentic coding agents working in this repository.

## Core Development Principles

### 1. Parallelize Development
**Any task that CAN run in parallel MUST run in parallel.** Identify independent tasks (disjoint files, no shared state, no sequential dependency) and dispatch them concurrently. Only serialize across a true data/sequence dependency.

### 2. Recursive Convergence (举一反三递归收敛)
**When a problem is found, fix the entire CLASS of problems, then check if the fix introduced new problems, and keep recursing until the error count converges to zero.** This is not "fix one, move on" — it's:
1. **Identify** the root cause pattern (not the symptom)
2. **Search** the entire codebase for ALL instances of the same pattern
3. **Fix** every instance (not just the one that failed)
4. **Check** if the fix created new issues (e.g., new selector conflicts, new race conditions)
5. **Recurse**: if new issues found, go back to step 1 with the new pattern
6. **Converge**: stop only when zero failures remain

Example: A test fails because `row.locator('a').filter({ hasText: '编辑' })` matches both the name cell link AND the edit button. The fix is NOT to change just that one test — it's to:
- Search all 20+ test files for the same `row.locator('a')` anti-pattern
- Replace ALL instances with `opsCell(row).locator('a')` (scoped to last `<td>`)
- Re-run ALL tests to check the fix didn't break anything
- Check if `opsCell()` itself has edge cases (e.g., tables without fixed columns)

### 3. Fast MVP, TDD, Full E2E Coverage
**Ship the leanest usable vertical slice fast, then iterate on real feedback.** Trim scope, not rigor — cut features to reach a usable end-to-end product quickly; defer non-essential work to later iterations. **All work is TDD** (failing test → minimal code → green → commit). **Design e2e test cases covering all functionality, both frontend and backend**; every feature must be covered.

### 4. Run to Completion (Autonomous Execution)
**Do not stop until all functional e2e tests (frontend + backend) pass and the product is manually usable.** Keep running through implementation, failures, and fixes autonomously. When a decision is required mid-execution, choose the most-recommended option and proceed — do not block on the user for routine decisions.

### 5. Generalize Fixes (举一反三)
**When a problem is found, fix the entire class of problems, not just the single instance.** Trace every divergent/leaf-node issue, and keep resolving until the problem space converges.

### 6. CLI for Every Backend API
**Every backend HTTP API MUST have a corresponding CLI command.** The CLI is how agents drive the system programmatically. **When implementing ANY new backend API, synchronously implement its CLI command** — this is part of the backend definition-of-done, never deferred. CLI registry: `apps/backend/src/cli-core.ts`.

### 7. Claude-as-Agent (邀请 Claude 参与任务分发)
开发任务可以拆分为多个 agent 并行执行。**每次分发任务时，必须邀请 Claude 作为一个独立 agent 参与。** 邀请方式是通过 `claude` CLI 的 headless 无头模式分配任务（review、代码撰写、测试等），Claude 会自动读取 `CLAUDE.md` 获取独立指导原则。

**调用方式**（通过 Bash 工具执行）：
```bash
# 无头模式：分配任务给 Claude，等待返回结果
echo "任务描述（如：review apps/backend/src/routes.ts 的安全性）" | claude --dangerously-skip-permissions -p

# 指定工作目录
claude --dangerously-skip-permissions -p "实现 XXX 功能，遵循 TDD 流程" --cwd D:\fighting

# 常见任务类型
claude --dangerously-skip-permissions -p "review 最近的 git diff，检查举一反三问题"    # Review
claude --dangerously-skip-permissions -p "为 XXX 编写 e2e 测试"                      # 测试撰写
claude --dangerically-skip-permissions -p "实现 XXX 后端 API + CLI 命令"              # 代码撰写
```

**原则**：
- Claude 的指导文件是 `CLAUDE.md`（包含并行化、举一反三、TDD、CLI 同步、部署后验证等原则）
- `AGENTS.md` = opencode agent 指导，`CLAUDE.md` = Claude Code agent 指导，两者原则一致但表述不同
- 并行化指令优先级最高——"能并行的任务一定要并行处理，使用多个agent"
- Claude CLI 执行的任务可以和 opencode 的 Task subagent 并行运行，互不阻塞

### 8. Local-First Development & Testing (本机先行，现网后行)
**所有开发和测试必须先在本机完成，确认无误后再部署到现网。** 绝不能跳过本机验证直接部署到生产环境。

**标准流程（严格顺序）**：
1. **本机开发** — 编写代码 + 对应测试
2. **本机后端测试** — `npm run test:backend` 全部通过
3. **本机 E2E 测试** — `npx playwright test --config=apps/frontend-v2/playwright.config.ts --reporter=line` 全部通过
4. **本机冒烟验证** — `npm run dev:backend` + `npm run dev:frontend-v2`，Playwright 脚本模拟真实用户操作（登录→浏览→创建→编辑→删除），确认功能正常
5. **git commit** — 所有改动必须先提交
6. **部署到现网** — `cd scripts/deploy-v2 && node deploy-direct.mjs 124.156.193.122 root <password>`
7. **现网验证** — Playwright 跑现网 `http://124.156.193.122:3001/`，确认部署后功能正常
8. **关闭 issue** — 更新问题反馈状态为"已关闭"

**本机冒烟验证脚本示例**：
```javascript
// 用 Playwright 在本机 localhost:5174 跑冒烟测试
const { chromium } = require('playwright');
// 登录 → 仪表盘 → 攻关列表 → 人员列表 → 导出 → 关闭
```

**原则**：
- 本机是第一道防线，现网是最终确认
- 现网验证不要删除原有数据，测试数据测试后清理
- 部署后如果发现问题，先在本机复现，修复后再重新走流程
- 现网问题反馈读取后，在本机环境复现和修复，不要直接在现网调试

### 8.1 Deploy After Green
**After every milestone reaches all-green (`npm run test:all` fully passing), deploy to the test server** so the user can manually verify. Deploy credentials are in `.env.deploy` (gitignored) — **never hardcode server passwords in any committed file**.

### 9. Domain Language: Chinese Only
Domain enum values are **Chinese string literals and are canonical** — preserve verbatim in code, schemas, tests; never translate or normalize to English. **Interact with the user in Chinese.**
```ts
enumValues: ["待响应", "处理中", "已解决", "已关闭"]
toStatus === "已解决"
```

### 10. Config-Driven, No DDL Migrations
Adding/removing a field is a **config change** (JSON file), never a DB migration. Business data lives in `properties` JSON columns. Never hardcode business field names in any layer. UI renders from schema config at runtime.

### 11. One Data Model, Many Views
**Do not build per-table CRUD silos.** Build one unified model; each "combat table" is a projection/view over it. The core problem is cross-view association — the same person/task appears across many tables and must be linked.

### 12. Structured Is Authoritative, KG Is Derived
All writes go through the config-driven structured model (single source of truth). The Knowledge Graph is **derived** from structured data (auto-synced, fully rebuildable) and used only for cross-view association, search, and Q&A. The KG never accepts direct writes.

### 13. Post-Implementation Sync Checklist (特性完工例行检查)
**Every feature implementation MUST complete the following checklist before marking done.** No exceptions, no deferrals:

| # | Check | What to Do |
|---|-------|-----------|
| 1 | **E2E tests** | Write/update Playwright e2e tests covering the new feature. Run full suite (`npx playwright test --config=apps/frontend-v2/playwright.config.ts`). Fix any failures. |
| 2 | **Backend tests** | If backend changed, run `npm run test:backend`. Fix any failures. |
| 3 | **AGENTS.md test status** | Update "当前测试状态" section with date + count. |
| 4 | **CLI commands** | New backend API → new CLI command in `apps/backend/src/cli-core.ts`. Verify with `npm run cli -- help`. |
| 5 | **Mock/seed scripts** | If feature adds new nodeTypes or data shapes, update `scripts/mock-data/seed.mjs`. If feature adds new config items, update `scripts/settings-seed.mjs`. Verify both run correctly. |
| 6 | **Migration scripts** | If feature changes data model, verify `scripts/migrate/export.mjs` and `scripts/migrate/import.mjs` still work with the new schema. Update NODE_TYPES list if new types added. |
| 7 | **API docs** | If `docs/API_REFERENCE.md` exists, add new endpoints with request/response examples. |
| 8 | **Constants** | If new UI enum values added, update `apps/frontend-v2/src/constants.ts` color/label maps. |
| 9 | **Deploy** | After all tests green: `git add -A && git commit` → `cd scripts/deploy-v2 && node deploy.mjs deploy`. |
| 10 | **AGENTS.md updates** | Document any new discoveries (Ant Design quirks, backend gotchas), update architecture descriptions if changed. |

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
- Config-driven CRUD for 16+ nodeTypes (attackTicket, person, contribution, teamContribution, infoCard, etc.) — new nodeTypes need only a `config/schemas/<type>.json`; the generic `/api/nodes/:nodeType` API serves them with no new endpoint/CLI
- Cross-view relations (REF edges, ANCHORED_TO anchors, concept grouping)
- Hermes Q&A, search, recommendation, proposals approval
- Import/export Excel, daily reports, reminders, conflict detection
- KG graph visualization, audit logs, person merge, status transitions
- Email sending, custom commands, escalation management

## New Frontend Directory

The new frontend lives in `apps/frontend-v2/` — completely separate from the reference frontend.
Do NOT create or modify any files under `apps/frontend/`.

## Deployment

### Production Server (生产环境 — 唯一部署目标)
- **服务器**: `124.156.193.122`（直连 SSH，用户 `root`，密码见 `.env.deploy`）
- **部署路径**: `/opt/combat-v2/`
- **访问地址**: `http://124.156.193.122:3001`（**唯一端口**，后端 Express 同时服务 API + 前端静态文件）
- **systemd 服务**: `combat-v2.service`（自动重启，开机自启）
- **部署脚本**: `scripts/deploy-v2/deploy-direct.mjs`
- **默认登录**: `admin` / `admin123`

> **注意**: 旧跳板机部署 (`60.204.199.234` via `47.103.99.229`) 已废弃，不再使用。

#### 部署命令（从 repo 根目录执行）
```bash
# 前提：所有改动必须先 git commit（deploy 打包 git HEAD）
git add -A && git commit -m "your message"

# 安装部署脚本依赖（仅首次）
cd scripts/deploy-v2 && npm install && cd ../..

# 一键部署（直连 SSH → 目标机）
cd scripts/deploy-v2 && node deploy-direct.mjs 124.156.193.122 root <password>

# 查看日志
ssh root@124.156.193.122 'tail -f /opt/combat-v2/backend.log'
```

#### 部署架构（2026-05-28 更新）
- **单端口 :3001**：后端 Express 服务 API (`/api/*`) + 前端静态文件（`apps/frontend-v2/dist/`）
- **systemd 管理**：`combat-v2.service`，`Restart=always`，开机自启
- **直连部署**：`deploy-direct.mjs` 直连 SSH 到 124.156.193.122，无需跳板机

#### 日志体系与文件路径

**三层日志架构**，所有操作均有迹可查：

| 层级 | 存储 | 覆盖范围 | 查看方式 |
|------|------|----------|----------|
| 结构化日志 | 文件 | 所有后端操作（94个日志点）+ 每个HTTP请求 | `tail -f /opt/combat-v2/backend.log` |
| 审计日志 | SQLite `audit_log` 表 | 所有数据变更（CREATE/UPDATE/DELETE/PROGRESS/ESCALATE/MERGE 等，21个审计点） | 前端"审计日志"页面 |
| 操作日志 | SQLite `op_logs` 表 | 前端API调用、路由导航、全局错误 | 前端"操作日志"页面 |

**生产环境日志文件路径**：
- 生产机 (124.156.193.122): **`/opt/combat-v2/backend.log`**
- 由 systemd `StandardOutput=append:/opt/combat-v2/backend.log` 写入

**日志查看命令**：
```bash
# SSH 直连查看实时日志
ssh root@124.156.193.122 'tail -f /opt/combat-v2/backend.log'

# 按关键词搜索
ssh root@124.156.193.122 'grep "auth.login" /opt/combat-v2/backend.log | tail -20'
ssh root@124.156.193.122 'grep "ERROR" /opt/combat-v2/backend.log | tail -20'

# journalctl 方式（与 backend.log 内容相同）
ssh root@124.156.193.122 'journalctl -u combat-v2 --no-pager -n 50'
```

**后端日志事件速查**（`logger.ts` 中的 event 名称，可用于 grep）：
- 认证: `auth.login`, `auth.register`, `auth.password_changed`, `auth.user_created/updated/deleted`
- 节点CRUD: `node.create`, `node.update`, `node.delete`, `node.transition`
- Schema: `schema.fieldOp`, `schema.create`, `schema.delete`
- 备份: `backup.created`, `backup.deleted`, `backup.restore_pending`, `backup.scheduled`
- 导入: `import.done`, `import.skip`, `import.parse_fail`
- 邮件: `email.test`, `email.send`
- 合并: `merge.start`, `merge.done`
- 升级: `escalation.triggered`, `escalation.scan.done`
- 提醒: `reminders.scan.done`
- 求助: `help_request.create`, `help_request.feedback`, `help_request.email_sent/fail`
- Bug: `bug_report.create`, `bug_report.update`, `bug_report.delete`
- HTTP: `http.request`（所有请求）, `http.error`, `http.unhandled`
- 动态标签: `ticket_tab.created`, `ticket_tab.updated`, `ticket_tab.deleted`, `ticket_tab.reordered`

### Existing Deployment (参考前端，不要修改，已停止更新)
- **服务器**: `47.103.99.229`（Alibaba Cloud Linux）
- **路径**: `/opt/combat/`
- **前端端口**: 5173（vite preview）
- **后端端口**: 3001（tsx server.ts）
- **部署脚本**: `scripts/deploy/deploy.mjs` + `run-deploy.sh`
- **状态**: 已停止部署新版本，仅保留参考

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

## Scripts Inventory

| Script | Path | Usage |
|--------|------|-------|
| Demo seed | `scripts/mock-data/demo-seed.mjs` | `node scripts/mock-data/demo-seed.mjs --api http://HOST:3001` — full-featured demo data seeder (22 people, 30 tickets, 98 progress, 26 contributions, help requests, bug reports, proposals, tabs, edges, etc.) |
| Mock seed | `scripts/mock-data/seed.mjs` | `node scripts/mock-data/seed.mjs [--api URL] [--count N]` — creates N people, attackTickets, contributions |
| Mock wipe | `scripts/mock-data/wipe.mjs` | `node scripts/mock-data/wipe.mjs [--api URL] [--yes]` — deletes ALL nodes (irreversible!) |
| Settings seed | `scripts/settings-seed.mjs` | `node scripts/settings-seed.mjs [--api URL]` — populates config center with default dropdown options |
| Migrate export | `scripts/migrate/export.mjs` | `node scripts/migrate/export.mjs [--api URL] [--out DIR]` — exports all nodeTypes to xlsx files |
| Migrate import | `scripts/migrate/import.mjs` | `node scripts/migrate/import.mjs [--api URL] [--dir DIR] [--dryRun]` — imports xlsx files via upsert |
| Deploy v2 | `scripts/deploy-v2/deploy.mjs` | `cd scripts/deploy-v2 && node deploy.mjs <check\|deploy\|restart\|logs>` — full deploy pipeline (跳板机→目标机) |
| Deploy direct | `scripts/deploy-v2/deploy-direct.mjs` | `cd scripts/deploy-v2 && node deploy-direct.mjs <host> <user> <pass>` — direct SSH deploy (e.g. 124.156.193.122) |
| Deploy v1 | `scripts/deploy/deploy.mjs` | Old deployment for reference frontend only |

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
npm run test:all             # shared + backend + frontend unit + frontend e2e + frontend-v2 e2e (resets schemas between suites)
```

### Run Tests by Package
```bash
npm run test:shared          # packages/shared vitest unit tests
npm run test:backend         # apps/backend vitest e2e tests
npm run test --workspace=@combat/frontend     # frontend vitest unit tests (src/**/*.test.tsx)
npm run test:frontend:e2e    # Playwright browser e2e tests (apps/frontend/e2e/)
npm run test:frontend-v2:e2e # Playwright browser e2e tests (apps/frontend-v2/e2e/)
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

# Frontend-v2 e2e:
npx playwright test --config=apps/frontend-v2/playwright.config.ts e2e/bug-report.spec.ts
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

- **nodeType** — entity kind (attackTicket, person, contribution, teamContribution, infoCard, etc.)
- **teamContribution（团队贡献）** — 团队级贡献记录（`config/schemas/teamContribution.json`）：团队名称(必填)/贡献类型/贡献等级(必填)/描述/组长(ref→person)/组员(姓名数组)/关联攻关单/周期/记录时间。Contributions 页底部表格录入，Honor 页「团队荣誉」tab 展示；走通用 node CRUD。
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
- **Production:** backend Express on port 3001 serves both API and frontend static files (single port)
- **Layout:** collapsible sidebar (200→64px) + fixed top bar with user Dropdown (displayName + role + logout)
- **Pages:** Dashboard, AttackList, AttackDetail, PeopleList, Contributions, Honor, PersonHonor, HelpCenter, HelpFeedback (public), ImportExport, EmailSettings, AuditLog, ConfigCenter, BugReport, DailyReport, LoginPage, MergePage, OperationLog, ProposalsPage, RelatedPage, RemindersPage, SchemaWizard, SearchPage, UserManagement
- **API client:** `src/api.ts` — singleton `api` instance, auto-detects production API base URL
- **Settings system:** `src/hooks/useSettings.ts` — loads config from `/api/settings` on every page mount (no singleton cache); dropdown options come exclusively from config center, no hardcoded fallbacks
- **DynamicField component:** `src/components/DynamicField.tsx` — renders Select when `optionsKey` has values in config center, degrades to Input when config entry is empty/missing
- **Config-OptionsKey binding:** schema fields with `type: "enum"` have an `optionsKey` property pointing to a config center key; binding is managed in SchemaWizard; config center delete shows impact analysis before confirming

## E2E Test Hard-Won Discoveries (Frontend-v2)

### Ant Design 5 自动在2字符中文按钮文本间插入空格
Ant Design 5 自动在 `<Button>` 文本为恰好2个中文字符时插入空格。Playwright 选择器需用正则匹配如 `/导\s?出/`、`/确\s?定/`、`/删\s?除/`、`/添\s?加/`。4字符按钮如"新建攻关"不受影响。

### Ant Design Select 下拉 — "Element is outside of the viewport"
Ant Design 5 Select 下拉选项渲染在 body 级 portal 中，Playwright 的 `.click()` 会报 "outside viewport" 错误。**修复：使用 `dispatchEvent('click')` 代替 `.click()`**，通过 `.ant-select-dropdown:not(.ant-select-dropdown-hidden)` 定位活动下拉框，在其中找 `.ant-select-item-option`。见 `e2e/helpers.ts` 的 `selectOption()` 函数。

### 页面上多个 Select 的索引规则
- Header 不再有 `.ant-select`（已替换为 Dropdown 用户菜单）
- 页面级筛选 Select 从 index 0 开始
- Drawer 内的 Select 用 `drawer.locator('.ant-select')` 独立索引，从 0 开始
- **HelpCenter drawer 内有 5 个 Select**：ticketId[0], requesterName[1], targetName[2], targetEmail(非Select), category[3], question(非Select)
- **Contributions drawer 内有 5 个 Select**：贡献人[0], 贡献类型[1], 贡献等级[2], 关联攻关单[3], 周期(非Select)

### Backend 审计日志 action 和 entityType 是大写英文
- **action 值为大写**: `CREATE`, `UPDATE`, `DELETE`, `PROGRESS`, `SETTING`, `ESCALATE`, `MERGE`
- **entityType 值是通用类型**: `node`, `edge`, `schema`, `setting`, `proposal`, `reminder`（**不是** `person`、`attackTicket` 等 nodeType 名称）
- 前端 AuditLog 页面的筛选选项必须与这些大写值精确匹配

### 贡献等级(贡献等级) 创建需要 Leader/Admin 角色
后端 `gradeGate()` 函数（`routes.ts:31`）对 `contribution` nodeType 的 `贡献等级` 字段做了角色门控：
- `X-Role` header 缺失 → 信任（允许，如 CLI/测试）
- `X-Role: normal` → **403 Forbidden**
- `X-Role: leader` 或 `admin` → 允许
- **前端默认角色是 `normal`**（从 `localStorage.getItem('combat-role')` 读取）
- **E2E 测试创建带贡献等级的贡献时，必须用 `page.addInitScript(() => localStorage.setItem('combat-role', 'leader'))` 设置角色**

### Playwright 多次 Toast 消息导致严格模式违规
当连续操作产生多条 Ant Design message toast 时（如快速连续状态流转），`getByText('状态流转成功')` 可能匹配到多条。**必须用 `.first()` 或更精确的选择器**。

### Drawer 关闭不会提交数据
测试验证：打开 drawer、填写数据、点击关闭按钮（`.ant-drawer-close`）不会创建任何数据。这是回归防护测试之一。

## Deploy Infrastructure (2026-05-28 更新)

### 直连部署（当前方式）
- **生产服务器**: `124.156.193.122`（直连 SSH，无需跳板机）
- **部署脚本**: `scripts/deploy-v2/deploy-direct.mjs`
- **Node 版本**: v22.22.3（通过 nvm 管理）
- **systemd 服务**: `combat-v2.service`，自动重启，开机自启

> **注意**: 旧跳板机部署 (`60.204.199.234` via `47.103.99.229`) 已废弃，不再使用。

### 部署流程
```bash
cd scripts/deploy-v2 && node deploy-direct.mjs 124.156.193.122 root <password>
```
- 从 git HEAD 打包 → 直连 SFTP 到生产机 → tar 解压 → npm install → build frontend-v2 → systemctl restart combat-v2
- 前端 build 产物在 `apps/frontend-v2/dist/`，由后端 Express 静态服务

## 前端设计规范（Frontend-v2 Design System）

以下规范从攻关管理、人员与荣誉两大特性打磨中提炼，后续所有新页面必须遵循以保持风格一致。

### 1. 页面结构三段式

每个列表/主页面遵循固定布局：

```
┌─ 页头 ─────────────────────────────────────────┐
│  左: <Title level={4} style={{margin:0}}>标题   │
│  右: <Space> 操作按钮组                          │
├─ 筛选栏 ────────────────────────────────────────┤
│  <Space wrap> Select筛选 + Input搜索 + ...      │
├─ 内容区 ────────────────────────────────────────┤
│  loading ? <Skeleton> : <Table> / <Card>        │
└─────────────────────────────────────────────────┘
```

- **页头**：`display:flex; justify-content:space-between; margin-bottom:16`
- **标题**：统一 `Title level={4}`，`margin:0`
- **主按钮**：`type="primary"`，icon + 两字中文（新建/录入/添加）
- **次按钮**：默认样式，icon + 中文（导出/导入）
- **筛选栏**：`<Space wrap>`，Select 宽 120-140px，Search Input 宽 220-260px

### 2. Drawer 规范

所有表单抽屉必须遵循：

| 属性 | 值 | 原因 |
|------|-----|------|
| `width` | 创建/编辑: 480, 详情: 560 | 表单紧凑，详情宽松 |
| `destroyOnClose` | `true` | 避免残留状态 |
| `maskClosable` | `false` | 防误触关闭 |
| 提交按钮位置 | `extra={<Button>}` | 固定在顶部，始终可见 |
| 关闭时 | `form.resetFields()` | 清空表单 |

**字段分组**：表单内用 `<Divider orientation="left" orientationMargin={0}>组名</Divider>` 分隔：
- 基础信息 / 人员信息 / 详细信息（AttackList、AttackDetail）
- 贡献详情 / 关联信息（Contributions）
- 组织信息（PeopleList）

**编辑 vs 创建**：复用相同字段，但用独立的 `editOpen`/`drawerOpen` 状态和独立 Form 实例。

### 3. 表格规范

```tsx
<Table
  rowKey="id"
  dataSource={data}
  columns={columns}
  size="middle"                           // 列表用middle，详情内嵌用small
  pagination={{
    pageSize: PAGE_SIZE,                  // 20
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,   // [10, 20, 50, 100]
    showTotal: (t) => `共 ${t} 条`
  }}
/>
```

**Scroll 规则**（2026-05-27 更新）：
- 有固定列（`fixed: 'left'` 或 `fixed: 'right'`）的表格：`scroll={{ x: true }}`
- 无固定列的表格：**不设 scroll prop**，让浏览器原生 `table-layout: auto` 自动分配列宽
- 每个表格有且仅有 1 个"弹性列"（内容最多的列），设 `ellipsis: true`，不设 `width`
- 其他短内容列设合理的固定 `width`

**列定义模式**：
- 名称/标题列：`fixed: 'left'`，可点击跳转用 `<a>`
- 状态列：`<StatusTag>` 组件，宽度 120
- 时间列：`<Tooltip title={完整时间}>{短时间}</Tooltip>`，默认 `defaultSortOrder: 'descend'`
- 操作列：`fixed: 'right'`，宽度 80-150，编辑用 `<a>`，删除用 `<a style={{color:'#ff4d4f'}}>` + Popconfirm
- 长文本列：`ellipsis: true` 或截断渲染

**行点击跳转**：列表级 `onRow` + 列级 `<a>` 配合，点击非链接区域整行跳转。

### 4. 详情页规范

```
┌─ 返回导航 ──────────────────────────────┐
│  <Button type="link" icon={<ArrowLeft/>}>  返回列表
├─ 标题栏 ────────────────────────────────┤
│  左: <Title level={4}>标题 <StatusTag/>  │
│      <Text type="secondary">时间信息</Text>│
│  右: <Space> 操作按钮组                   │
├─ 状态Steps ─────────────────────────────┤
│  <Steps size="small" current={index} /> │
├─ 摘要卡片 ──────────────────────────────┤
│  <Card size="small"> <Descriptions>     │
├─ 主内容 ────────────────────────────────┤
│  <Row gutter={16}>                       │
│    <Col span={18}> <Tabs> </Col>         │
│    <Col span={6}> 侧边栏卡片 </Col>       │
└─────────────────────────────────────────┘
```

- **返回按钮**：`type="link"`，`paddingLeft:0`
- **标题+状态**：同一行 `<Title>` + `<StatusTag>`
- **时间线**：`Text type="secondary"`，用 dayjs fromNow + Tooltip 完整时间
- **操作按钮顺序**：主功能 → 次功能 → 危险操作（删除用 `danger` + Popconfirm）
- **Tabs图标**：每个 tab label 带 icon（`<span><Icon /> 名称</span>`）
- **必填项缺失**：顶部 `<Alert type="warning">` 提示

### 5. 状态可视化规范

**StatusTag 组件**：统一通过 `<StatusTag status={v} type="status|level|contribution" />` 渲染。

**颜色体系**（在 `constants.ts` 中集中管理）：
- `STATUS_COLOR`：待响应=gold, 处理中=blue, 进行中=cyan, 已解决=green, 已关闭=default
- `STATUS_BAR_COLOR`：同上色系的 hex 值（用于图表柱状）
- `LEVEL_COLOR`：高=red, 中=orange, 低=blue
- `CONTRIBUTION_COLOR`：核心=red, 关键=orange, 普通=blue
- `HELP_STATUS_COLOR`：待回复=gold, 已回复=green
- `SUPPORT_STATUS_COLOR`：待确认=default, 支持中=processing, 已完成=success, 已撤销=error
- `ACTION_COLOR`：CREATE=green, UPDATE=blue, DELETE=red, PROGRESS=cyan, SETTING=purple, ESCALATE=orange, MERGE=gold
- `ACTION_LABEL`：CREATE→创建, UPDATE→更新, DELETE→删除, PROGRESS→进展, SETTING→设置, ESCALATE→升级, MERGE→合并
- `ENTITY_TYPE_LABEL`：node→节点, edge→关系, schema→表结构, setting→设置, proposal→提案, reminder→提醒
- `PROPOSAL_STATUS_COLOR`：待审批=gold, 已通过=green, 已拒绝=red
- `REMINDER_STATUS_COLOR`：待发送=gold, 已发送=green, 已忽略=default
- `REMINDER_KIND_LABEL`：问题单跟催/FE Deadline 提醒/CCB 提醒
- `BUG_SEVERITY_COLOR`：严重=red, 较高=orange, 一般=blue, 建议=default
- `BUG_STATUS_COLOR`：待处理=gold, 处理中=blue, 已解决=green, 已关闭=default
- `NODE_TYPE_LABEL`：attackTicket→攻关单, person→人员, contribution→贡献, teamContribution→团队贡献, releasePackage→版本包, weightFile→权重文件, infoCard→信息卡片
- 所有中文枚举值颜色必须定义在 constants.ts，不在组件中硬编码

**Steps 生命周期**：详情页顶部用 `<Steps size="small">` 展示状态流转，当前步骤高亮。

**排名徽章**：前3名用奖牌（🥇🥈🥉），其余用序号，统一用 `<Tag color>`。

### 6. 人员选择器规范

所有涉及选人的场景（攻关单处理人、贡献人等）：

```tsx
<Select
  showSearch
  allowClear
  placeholder="从全员名单搜索"
  options={personOptions}    // [{value: '姓名', label: '姓名 (部门)'}]
  filterOption={(input, option) =>
    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
  }
/>
```

- options 格式：`value=姓名, label=姓名 (部门)` — 显示部门便于区分同名
- 必须 `showSearch` + `filterOption` — 中文模糊搜索

### 7. 交互模式

| 场景 | 模式 |
|------|------|
| 创建 | Drawer + Form + extra按钮 |
| 编辑 | 独立 editOpen Drawer，预填 `editForm.setFieldsValue(node.properties)` |
| 详情 | Drawer(width:560) + Descriptions(bordered, column:1) |
| 删除 | `Popconfirm title="确认删除XX？"` + `<a style={{color:'#ff4d4f'}}>` |
| 状态流转 | Drawer + Steps可视化 + Select选目标状态 |
| 导出 | `api.exportNodes()` → Blob → `<a download>` |
| 导入 | Drawer + Upload.Dragger |

### 8. 加载与空状态

- **首次加载**：`initialLoading` 状态，显示 `<Skeleton active paragraph={{rows:6}}>`
- **静默刷新**：更新操作后 `fetchData(true)` 传 silent 参数，不闪 Skeleton
- **空数据**：`<Empty description="暂无XX" image={Empty.PRESENTED_IMAGE_SIMPLE} />`
- **错误状态**：`<Empty description={错误信息}><Button>重试</Button></Empty>`

### 9. 常量管理

所有可复用值集中在 `constants.ts`：
- 颜色映射：`STATUS_COLOR`, `LEVEL_COLOR`, `CONTRIBUTION_COLOR`, `ACTION_COLOR`
- 标签映射：`ACTION_LABEL`, `ENTITY_TYPE_LABEL`
- 分页：`PAGE_SIZE=20`, `PAGE_SIZE_OPTIONS=[10,20,50,100]`
- 时间格式：`DATE_FORMAT`, `DATE_FORMAT_FULL`, `DATE_FORMAT_SHORT`

### 10. 命名约定

| 类型 | 规范 | 示例 |
|------|------|------|
| 页面文件 | PascalCase | `AttackDetail.tsx`, `PeopleList.tsx` |
| 状态变量 | `xxxOpen` | `editOpen`, `drawerOpen`, `transitionOpen` |
| 提交中状态 | `xxxSubmitting` | `editSubmitting`, `transSubmitting` |
| 加载状态 | `loading` / `initialLoading` | 列表用 loading，详情用 initialLoading |
| Fetch函数 | `fetchData` / `fetchXxx` | `fetchDailyReports`, `fetchSupportNodes` |
| 数据过滤 | `filtered` | `filteredNodes`, `filtered` |

### 11. 表格单元格防换行规范

表格列中包含多段信息（键名+说明、名称+副标题）时，**禁止用 `<Space>` 横排**，必须用 `<div>` 纵向堆叠，否则中长文本必然换行导致行高不一致、对齐错乱。

```tsx
// ✗ 错误：横排挤压，label 长了就换行
<Space><Text code>{key}</Text><Text type="secondary">({label})</Text></Space>

// ✓ 正确：纵向堆叠，主次分明
<div>
  <Text strong code>{key}</Text>
  {label && <div><Text type="secondary">{label}</Text></div>}
</div>
```

配置中心表格为例：配置键独占一行，label 灰色小字换行显示在下方，视觉整洁不挤压。此规范适用于所有表格中「主信息 + 辅助说明」的场景。

### 12. 表格列宽拖拽 + 列顺序拖拽 (useFlexTable)

所有列表页面表格支持列宽拖拽调整和列顺序拖拽排序，通过 `useFlexTable` hook 统一集成。

**使用方式**（每个列表页面必须遵循）：
```tsx
import { useFlexTable, FlexHeaderCell } from '../hooks/useFlexTable.js';

// 1. 每列必须有 key 属性
const columns = [
  { key: 'id', title: '编号', width: 90, ... },
  { key: '标题', title: '标题', ... },
  ...
];

// 2. 调用 hook
const { columns: flexCols, FlexWrapper } = useFlexTable('存储键名', columns);
const tableComponents = useMemo(() => ({ header: { cell: FlexHeaderCell } }), []);

// 3. JSX 中包裹和传参
<Table columns={flexCols} components={tableComponents} ... />
```

**技术实现**：
- 列宽拖拽：`react-resizable` — 拖拽列右边框调整宽度，范围 50-600px
- 列顺序拖拽：`@dnd-kit/sortable` — 拖拽列头左右移动调整顺序
- 列偏好持久化：`localStorage`（`combat-col-w-*` 存宽度，`combat-col-o-*` 存顺序）
- 已集成页面：AttackList, PeopleList, Contributions, UserManagement, ConfigCenter, Honor

### 当前测试状态（2026-05-29 最后验证）
- **319/319 backend vitest tests passing** (52 test files，含新增 teamContribution 4 项)
- **团队贡献特性 e2e（honor-contributions 15/15）+ column-drag 2/2 隔离运行通过**
- ⚠️ 全量回归存在 **预存 flaky 用例**（auth-flow 等约 6 个登录/登出态切换用例 + 级联）：已用 `git stash` 在未含本特性的基线(2e523d0)上复现同样失败，证明与团队贡献特性无关，属机器负载/时序敏感的历史问题，待单独处理。
- **315/315 backend vitest tests passing**（特性前基线）
- 修复：addField 拒绝重复 name（name 是属性/表单键，必须唯一）；attackTicket.json 清理 22 个 E2E 污染重复字段
- 修复：去除攻关单创建/编辑抽屉内联「+字段」，字段新增统一到 SchemaWizard 选中表的「添加新字段」；"自定义字段" 分组改名「其它字段」并按 name 去重
- 修复：useFlexTable 列拖拽彻底失效（onHeaderCell 未传 id → reorder 死；onResize 仅改 ref 无 setState → resize 死），现 resize/reorder 均生效并持久化
- 修复：作战态势发布信息抽屉 重要程度/信息分类 改为上下排列
- 新增：配置中心统一方案（optionsKey 绑定、DynamicField 组件、删除影响分析弹窗）
- 新增：信息广场功能（infoCard nodeType，Dashboard Tabs，卡片网格 + Markdown 渲染 + 配置中心分类）
- 新增：列设置功能（Popover + Checkbox.Group，6个E2E测试）
- 新增：表格列宽拖拽 + 列顺序拖拽（useFlexTable hook，6个列表页面集成）
- 修复：Ant Design scroll.x 导致 `getByText` 严格模式违规，改用 `page.locator('tbody').first().getByText()` 限定表格范围

## 工作流程规范

### 测试状态标记机制
**当所有测试通过时，必须在 AGENTS.md 的"当前测试状态"部分记录通过时间和数量。** 下次会话开始时先检查此标记：
- 如果标记日期是今天且数量一致 → **跳过测试**，直接进入开发或部署
- 如果代码有改动 → 运行测试后更新标记
- 如果标记过期（>1天）→ 建议重新运行测试确认

格式：
```
### 当前测试状态（YYYY-MM-DD 最后验证）
- **NN/NN e2e tests passing**
```

### 修改代码后必须做的事
1. 修改前端源码 → 运行 `npx playwright test --config=apps/frontend-v2/playwright.config.ts --reporter=line`
2. 修改后端源码 → 运行 `npm run test:backend`
3. 全部通过后 → 更新 AGENTS.md 的"当前测试状态"标记
4. 全部通过后 → **先 git commit** → 再执行 `cd scripts/deploy-v2 && node deploy.mjs deploy`

### 部署前必须 git commit
`git archive HEAD` 只打包已提交的文件。**未 commit 的改动不会出现在部署包中**，这是多次"部署后页面没变化"的根因。

## Auth System (认证系统)

### Backend
- **File**: `apps/backend/src/auth.ts` — auth router + user admin router + JWT middleware + bcrypt hashing
- **DB**: `users` table (id, username, password_hash, role, display_name, created_at, updated_at)
- **Default admin**: auto-created on first boot (`admin` / `admin123`)
- **JWT**: 7-day expiry, secret from `JWT_SECRET` env or default
- **Auth middleware**: `authMiddleware` gates all `/api/*` routes EXCEPT public paths
- **Public paths**: `/api/auth/login`, `/api/auth/register`, `/api/help/feedback/*`, `POST /api/bug-reports`
- **COMBAT_NO_AUTH=1**: bypasses auth entirely (for E2E tests); `/api/auth/me` returns default admin without token

### Frontend
- **AuthProvider**: `src/hooks/useAuth.tsx` — context provider with login/logout/isAdmin/isLeader
- **LoginPage**: `src/pages/LoginPage.tsx` — username/password form
- **UserManagement**: `src/pages/UserManagement.tsx` — admin-only user CRUD (Modal-based)
- **AppLayout header**: user Dropdown (displayName + role + logout) replaces old role Select
- **AuthGuard**: redirects unauthenticated users to `/login`
- **Token storage**: `localStorage('combat-token')` + `localStorage('combat-user')`
- **Role from auth**: role is derived from logged-in user, NOT from manual Select dropdown

### E2E Test Bypass
- `COMBAT_NO_AUTH=1` set in `playwright.config.ts` webServer env
- Backend returns admin user for unauthenticated `/api/auth/me` requests
- Frontend `AuthProvider` calls `api.getMe()` on startup → gets admin user → logged in automatically
- All page-level `.ant-select` indices shifted from N to N-1 (no more header Select at index 0)

### CLI Commands
- `auth:login`, `auth:register`, `auth:me`, `auth:change-password`
- `users:list`, `users:create`, `users:update`, `users:delete`

## Op-Log System (操作追踪系统)

### Backend
- **File**: `apps/backend/src/op-log.ts` — op-log router（独立 SQLite 表，不经过通用 CRUD）
- **DB**: `op_logs` table (id, session_id, user_name, category, detail, timestamp, created_at)
- **Settings**: 开关存在 `app_settings` 表，key=`op_log_enabled`，默认 true
- **APIs**:
  - `POST /api/op-logs` — 批量写入（上限 200 条/批，关闭时静默返回 `{inserted:0}`)
  - `GET /api/op-logs?sessionId&userName&category&from&to&limit&offset` — 查询（5 维过滤）
  - `DELETE /api/op-logs?before&sessionId` — 清理（必须指定条件）
  - `GET /api/op-logs/settings` — 查看开关
  - `PUT /api/op-logs/settings` — 切换开关（`{enabled: boolean}`）

### Frontend
- **自动捕获**: `src/utils/op-logger.ts` — 拦截 API 调用、路由导航、全局错误
- **页面**: `src/pages/OperationLog.tsx` — 管理员可见，带开关、过滤、清理
- **API hook**: `src/api.ts` 的 `req()` 方法自动调用 `logApiCall()`
- **路由追踪**: `App.tsx` 的 AppInner 通过 `useEffect` 监听 `location.pathname` 变化
- **Self-filtering**: op-logger 跳过记录自身 API 调用（`POST /api/op-logs`, `GET /api/op-logs/settings`）

### CLI Commands
- `op-logs:list`, `op-logs:settings`, `op-logs:enable`, `op-logs:disable`, `op-logs:cleanup`

### Test Coverage
- **15 backend unit tests**: `apps/backend/test/op-log.test.ts`（需 `COMBAT_NO_AUTH=1`）
- **12 E2E tests**: `apps/frontend-v2/e2e/op-log.spec.ts`

## 问题反馈标准修复流程

现网用户通过"问题反馈"页面（`/bug-report`）提交问题，数据存储在 `bug_reports` 表。

### 读取现网问题
```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://124.156.193.122:3001/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# 读取全部问题（含已关闭）
curl -s http://124.156.193.122:3001/api/bug-reports?status= \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

# 仅读取待处理
curl -s "http://124.156.193.122:3001/api/bug-reports?status=%E5%BE%85%E5%A4%84%E7%90%86" \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
```

### 修复流程（标准 6 步）
1. **读取问题** — 从现网 `GET /api/bug-reports?status=` 获取所有待处理问题
2. **分析 & 分类** — bug 立即修，功能需求记录为 feature request
3. **修复代码** — TDD：先写/改测试 → 改代码 → 确认测试通过
4. **测试验证** — `npm run test:all` 或至少 `npx playwright test --config=apps/frontend-v2/playwright.config.ts --reporter line` + `npm run test:backend`
5. **部署** — `git add -A && git commit -m "fix: ..."` → `cd scripts/deploy-v2 && node deploy-direct.mjs 124.156.193.122 root <password>`
6. **关闭问题** — 部署验证后，逐条 PATCH 对应 bug report 状态为"已关闭"：
   ```bash
    curl -s -X PATCH http://124.156.193.122:3001/api/bug-reports/<id> \
      -H "Authorization: Bearer $TOKEN" \
      -H "content-type: application/json" \
      -d '{"status":"已关闭","resolution":"已修复并部署","resolvedBy":"系统管理员"}'
    ```

## 踩坑记录 (Lessons Learned)

**修复 BUG 引入的问题必须做到两点：一是总结根因记入此文档避免再犯，二是补充回归测试用例。**

### L1. auth.ts publicPaths 路径前缀错误 (2026-05-28)
- **现象**：匿名 POST /bug-reports 返回 401，导出 Excel 返回 401
- **根因**：`authMiddleware` 挂载在 `/api` 下，`req.path` 已经去掉了 `/api` 前缀，但 `publicPaths` 写成了 `/api/auth/login`、`/api/bug-reports`（多了 `/api` 前缀）
- **修复**：publicPaths 改为 `/auth/login`、`/bug-reports` 等
- **教训**：Express 子路由中的 `req.path` 是**相对于挂载点**的路径，不是完整 URL 路径
- **回归测试**：`apps/backend/test/auth.test.ts` 已覆盖 publicPaths 验证

### L2. exportNodes/downloadBackup 缺少 auth header (2026-05-28)
- **现象**：前端导出功能返回 401 Unauthorized
- **根因**：`api.ts` 的 `exportNodes()` 和 `downloadBackup()` 使用原始 `this.f()` 发请求，没有带 Authorization header
- **修复**：新增 `authFetch()` 私有方法，自动注入 Bearer token，所有 blob 下载改用 `authFetch()`
- **教训**：任何新增的 API 调用方法都必须经过 `req()` 或 `authFetch()` 统一带 token，禁止直接用 `fetch`/`this.f()`
- **回归测试**：需补充 E2E 测试验证导出功能在 auth 模式下正常

### L3. HelpButton 位置不一致导致布局偏移 (2026-05-28)
- **现象**：HelpButton 在 14 个页面中的 DOM 位置不统一（有的在 Title 上方，有的在 Title 右侧），导致修改时容易引入布局回归
- **根因**：没有统一的 HelpButton 放置规范，各页面自行决定位置
- **修复**：14 个页面统一为 `<div style={{ display:'flex', alignItems:'center', gap:8 }}><Title/><HelpButton/></div>` 模式
- **教训**：跨页面的共享组件必须有统一的放置规范，新增页面也必须遵循
- **回归测试**：AttackDetail 布局回归被 Claude CLI review 发现并修复

### L4. 部署后灰屏 — 浏览器缓存旧 JS bundle (2026-05-28)
- **现象**：用户部署后报告"登录后灰屏"
- **排查**：Playwright 实测生产环境完全正常（Root HTML 23655 chars，仪表盘正常渲染），发现 `/api/auth/me` 有 401 但不影响功能（AuthProvider 竞态）
- **根因**：浏览器缓存了旧版本 JS bundle，新部署后没有强制刷新。Vite build 的文件名带 hash，但 `index.html` 可能被浏览器缓存
- **修复方案**：部署后提醒用户 Ctrl+Shift+R 强制刷新；后续考虑在 `server.ts` 对 `index.html` 添加 `Cache-Control: no-cache` header
- **教训**：SPA 部署后 `index.html` 不能被缓存，否则用户会加载旧的 JS/CSS 文件引用（即使新文件已部署）
- **预防**：部署脚本应自动重启服务 + 前端验证脚本应带 `cache: 'no-cache'`

### L5. demo-seed 生成假 bug report 污染问题反馈 (2026-05-28)
- **现象**：现网问题反馈页面出现 8 条虚假 issue（报告人：李四、王五、赵敏等），与真实用户反馈混在一起
- **根因**：`demo-seed.mjs` 为了"覆盖多状态"在 bug_report 表插入了假 issue，reporter 是虚构人名，与用户真实提交的反馈无法区分
- **修复**：1) 清理现网假 issue（按 reporter 筛选删除）；2) demo-seed 改为只创建 2 条已关闭的"演示数据"并明确标注
- **教训**：seed/mock 脚本绝对不能生成伪造的用户反馈、审计日志、操作日志等业务数据。问题反馈是用户真实输入，填充假数据会误导开发和运维
- **预防**：demo-seed 只生成结构性数据（人员、攻关单、贡献），不生成反馈类数据
