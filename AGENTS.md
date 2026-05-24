# AGENTS.md

Guidance for agentic coding agents working in this repository.

## Core Development Principles

### 1. Parallelize Development
**Any task that CAN run in parallel MUST run in parallel.** Identify independent tasks (disjoint files, no shared state, no sequential dependency) and dispatch them concurrently. Only serialize across a true data/sequence dependency.

### 2. Fast MVP, TDD, Full E2E Coverage
**Ship the leanest usable vertical slice fast, then iterate on real feedback.** Trim scope, not rigor — cut features to reach a usable end-to-end product quickly; defer non-essential work to later iterations. **All work is TDD** (failing test → minimal code → green → commit). **Design e2e test cases covering all functionality, both frontend and backend**; every feature must be covered.

### 3. Run to Completion (Autonomous Execution)
**Do not stop until all functional e2e tests (frontend + backend) pass and the product is manually usable.** Keep running through implementation, failures, and fixes autonomously. When a decision is required mid-execution, choose the most-recommended option and proceed — do not block on the user for routine decisions.

### 4. Generalize Fixes (举一反三)
**When a problem is found, fix the entire class of problems, not just the single instance.** Trace every divergent/leaf-node issue, and keep resolving until the problem space converges.

### 5. CLI for Every Backend API
**Every backend HTTP API MUST have a corresponding CLI command.** The CLI is how agents drive the system programmatically. **When implementing ANY new backend API, synchronously implement its CLI command** — this is part of the backend definition-of-done, never deferred. CLI registry: `apps/backend/src/cli-core.ts`.

### 6. Deploy After Green
**After every milestone reaches all-green (`npm run test:all` fully passing), deploy to the test server** so the user can manually verify. Deploy credentials are in `.env.deploy` (gitignored) — **never hardcode server passwords in any committed file**.

### 7. Domain Language: Chinese Only
Domain enum values are **Chinese string literals and are canonical** — preserve verbatim in code, schemas, tests; never translate or normalize to English. **Interact with the user in Chinese.**
```ts
enumValues: ["待响应", "处理中", "已解决", "已关闭"]
toStatus === "已解决"
```

### 8. Config-Driven, No DDL Migrations
Adding/removing a field is a **config change** (JSON file), never a DB migration. Business data lives in `properties` JSON columns. Never hardcode business field names in any layer. UI renders from schema config at runtime.

### 9. One Data Model, Many Views
**Do not build per-table CRUD silos.** Build one unified model; each "combat table" is a projection/view over it. The core problem is cross-view association — the same person/task appears across many tables and must be linked.

### 10. Structured Is Authoritative, KG Is Derived
All writes go through the config-driven structured model (single source of truth). The Knowledge Graph is **derived** from structured data (auto-synced, fully rebuildable) and used only for cross-view association, search, and Q&A. The KG never accepts direct writes.

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
- **Production:** backend Express on port 3001 serves both API and frontend static files (single port)
- **Layout:** collapsible sidebar (200→64px) + fixed top bar with role switcher
- **Pages:** Dashboard, AttackList, AttackDetail, PeopleList, Contributions, Honor, PersonHonor, HelpCenter, HelpFeedback (public), ImportExport, EmailSettings, AuditLog
- **API client:** `src/api.ts` — singleton `api` instance, auto-detects production API base URL

## E2E Test Hard-Won Discoveries (Frontend-v2)

### Ant Design 5 自动在2字符中文按钮文本间插入空格
Ant Design 5 自动在 `<Button>` 文本为恰好2个中文字符时插入空格。Playwright 选择器需用正则匹配如 `/导\s?出/`、`/确\s?定/`、`/删\s?除/`、`/添\s?加/`。4字符按钮如"新建攻关"不受影响。

### Ant Design Select 下拉 — "Element is outside of the viewport"
Ant Design 5 Select 下拉选项渲染在 body 级 portal 中，Playwright 的 `.click()` 会报 "outside viewport" 错误。**修复：使用 `dispatchEvent('click')` 代替 `.click()`**，通过 `.ant-select-dropdown:not(.ant-select-dropdown-hidden)` 定位活动下拉框，在其中找 `.ant-select-item-option`。见 `e2e/helpers.ts` 的 `selectOption()` 函数。

### 页面上多个 Select 的索引规则
- Header 角色切换器永远是页面上 `.ant-select` 的 index 0
- 页面级筛选 Select 从 index 1 开始
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

## Deploy Infrastructure (2026-05-24 已验证)

### 跳板机 → 目标机 SSH Key 认证
- 跳板机 (47.103.99.229) 上已生成 ed25519 密钥对（2026-05-24 创建）
- 公钥已写入目标机 (60.204.199.234) 的 `~/.ssh/authorized_keys`
- **密码**: 两台机器密码相同，见 `.env.deploy`
- 如果 SSH key 认证失效，需要通过 `sshpass` 重新写入公钥：
  ```
  sshpass -p '<PASSWORD>' ssh root@60.204.199.234 'echo <PUBKEY> > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
  ```
- 跳板机上只有公钥没有私钥会导致认证失败。**必须在跳板机上用 `ssh-keygen` 生成完整的密钥对**

### 部署流程
```bash
cd scripts/deploy-v2 && node deploy.mjs deploy
```
- 从 git HEAD 打包 → SFTP 到跳板机 → SCP 到目标机 → tar 解压 → npm install → build frontend-v2 → 启动后端(:3001) + serve(:80)
- 后端通过 Node v22 (`/opt/node22-v2/`) 运行（better-sqlite3 不兼容 Node 24）
- 前端 build 产物在 `apps/frontend-v2/dist/`，由后端 Express 静态服务

### 当前测试状态（2026-05-24 最后验证）
- **79/79 e2e tests passing** (62 原始 + 4 新导航 + 13 回归防护)
- 测试文件: attack(17), people(8), honor-contributions(14), dashboard(4), system-navigation(23), regression(13)
- 回归防护覆盖：角色权限、表单交互、状态全生命周期、Dashboard 数据一致性、直接 URL 导航、审计日志完整性
- 导航覆盖：子菜单标题点击导航、折叠侧边栏、当前页高亮、所有 12 个页面通过侧边栏可达

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
4. 全部通过后 → 执行 `cd scripts/deploy-v2 && node deploy.mjs deploy`
