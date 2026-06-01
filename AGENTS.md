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
claude --dangerously-skip-permissions -p "实现 XXX 功能，遵循 TDD 流程" --cwd /fighting

# 常见任务类型
claude --dangerously-skip-permissions -p "review 最近的 git diff，检查举一反三问题"    # Review
claude --dangerously-skip-permissions -p "为 XXX 编写 e2e 测试"                      # 测试撰写
claude --dangerously-skip-permissions -p "实现 XXX 后端 API + CLI 命令"              # 代码撰写
```

**原则**：

- Claude 的指导文件是 `CLAUDE.md`（包含并行化、举一反三、TDD、CLI 同步、部署后验证等原则）
- `AGENTS.md` = opencode agent 指导，`CLAUDE.md` = Claude Code agent 指导，两者原则一致但表述不同
- 并行化指令优先级最高——"能并行的任务一定要并行处理，使用多个agent"
- Claude CLI 执行的任务可以和 opencode 的 Task subagent 并行运行，互不阻塞

### 8. Remote-First Development & Testing (远程优先，开发测试部署一体化)

**所有开发、测试和部署均在远程服务器 `/fighting` 上完成。** SSH 登录 → opencode/claude 开发 → 测试 → 同机部署。

**标准流程（严格顺序）**：

1. **开发** — 在 `/fighting` 编写代码 + 对应测试
2. **后端测试** — `./dev-test.sh` 或 `npm run test:backend` 全部通过
3. **E2E 测试** — `./dev-e2e.sh` 或 `npx playwright test --config=apps/frontend-v2/playwright.config.ts --reporter=line` 全部通过
4. **冒烟验证** — `./dev-with-snapshot.sh` + `./dev-frontend.sh`，Playwright 脚本模拟真实用户操作（登录→浏览→创建→编辑→删除），确认功能正常
5. **git commit** — 所有改动必须先提交
6. **部署到现网** — `./dev-deploy.sh`（同机 rsync `/fighting` → `/opt/combat-v2` → systemctl restart）
7. **现网验证** — Playwright 跑现网 `http://124.156.193.122:3001/`，确认部署后功能正常
8. **关闭 issue** — 更新问题反馈状态为"已关闭"

**6 个一键脚本**（放在 `/fighting/` 根目录）：

| 脚本                     | 用途                                      | DB 路径                            | 端口 |
| ------------------------ | ----------------------------------------- | ---------------------------------- | ---- |
| `./dev.sh`               | 启 dev backend(空 db)                     | `/fighting/data/dev-combat.sqlite` | 3500 |
| `./dev-with-snapshot.sh` | 拷生产 db 快照后启 dev backend            | 同上(覆盖为生产快照)               | 3500 |
| `./dev-frontend.sh`      | 启 vite dev(proxy `/api` → :3500)         | —                                  | 5174 |
| `./dev-test.sh`          | 跑 vitest backend(in-memory db)           | 临时                               | —    |
| `./dev-e2e.sh`           | 跑 Playwright(自启 webServer)             | 临时                               | —    |
| `./dev-deploy.sh`        | 同机部署到生产(rsync + systemctl restart) | —                                  | —    |

**DB 隔离矩阵（铁律）**：

|          | 生产 db                             | dev 副本                              | 测试 db          |
| -------- | ----------------------------------- | ------------------------------------- | ---------------- |
| 路径     | `/opt/combat-v2/data/combat.sqlite` | `/fighting/data/dev-combat.sqlite`    | tmpdir/in-memory |
| 谁写     | 生产 systemd combat-v2.service      | `./dev.sh` / `./dev-with-snapshot.sh` | vitest           |
| 互相影响 | ❌ 完全独立                         | ❌ 完全独立                           | ❌ 完全独立      |

**端口约定**：

- `:3001` — 生产 backend(`/opt/combat-v2/`,systemd) — **绝不动**
- `:3500` — `/fighting` dev backend
- `:5174` — `/fighting` dev frontend(vite)

### 8.1 Deploy After Green

**After every milestone reaches all-green (`npm run test:all` fully passing), deploy using `./dev-deploy.sh`.** The user does hands-on testing on `http://124.156.193.122:3001` each cycle.

### 9. Domain Language: Chinese Only

Domain enum values are **Chinese string literals and are canonical** — preserve verbatim in code, schemas, tests; never translate or normalize to English. **Interact with the user in Chinese.**

```ts
enumValues: ["待响应", "处理中", "已解决", "已关闭"];
toStatus === "已解决";
```

### 10. Config-Driven, No DDL Migrations

Adding/removing a field is a **config change** (JSON file), never a DB migration. Business data lives in `properties` JSON columns. Never hardcode business field names in any layer. UI renders from schema config at runtime.

### 11. One Data Model, Many Views

**Do not build per-table CRUD silos.** Build one unified model; each "combat table" is a projection/view over it. The core problem is cross-view association — the same person/task appears across many tables and must be linked.

### 12. Structured Is Authoritative, KG Is Derived

All writes go through the config-driven structured model (single source of truth). The Knowledge Graph is **derived** from structured data (auto-synced, fully rebuildable) and used only for cross-view association, search, and Q&A. The KG never accepts direct writes.

### 13. Post-Implementation Sync Checklist (特性完工例行检查)

**Every feature implementation MUST complete the following checklist before marking done.** No exceptions, no deferrals:

| #   | Check                     | What to Do                                                                                                                                                                          |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **E2E tests**             | Write/update Playwright e2e tests covering the new feature. Run full suite (`npx playwright test --config=apps/frontend-v2/playwright.config.ts`). Fix any failures.                |
| 2   | **Backend tests**         | If backend changed, run `npm run test:backend`. Fix any failures.                                                                                                                   |
| 3   | **AGENTS.md test status** | Update "当前测试状态" section with date + count.                                                                                                                                    |
| 4   | **CLI commands**          | New backend API → new CLI command in `apps/backend/src/cli-core.ts`. Verify with `npm run cli -- help`.                                                                             |
| 5   | **Mock/seed scripts**     | If feature adds new nodeTypes or data shapes, update `scripts/mock-data/seed.mjs`. If feature adds new config items, update `scripts/settings-seed.mjs`. Verify both run correctly. |
| 6   | **Migration scripts**     | If feature changes data model, verify `scripts/migrate/export.mjs` and `scripts/migrate/import.mjs` still work with the new schema. Update NODE_TYPES list if new types added.      |
| 7   | **API docs**              | If `docs/API_REFERENCE.md` exists, add new endpoints with request/response examples.                                                                                                |
| 8   | **Constants**             | If new UI enum values added, update `apps/frontend-v2/src/constants.ts` color/label maps.                                                                                           |
| 9   | **Deploy**                | After all tests green: `git add -A && git commit` → `./dev-deploy.sh`.                                                                                                              |
| 10  | **AGENTS.md updates**     | Document any new discoveries (Ant Design quirks, backend gotchas), update architecture descriptions if changed.                                                                     |

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

- **服务器**: `124.156.193.122`（同机开发+部署）
- **开发目录**: `/fighting/`（完整 git 工作树，与生产隔离）
- **部署路径**: `/opt/combat-v2/`
- **访问地址**: `http://124.156.193.122:3001`（**唯一端口**，后端 Express 同时服务 API + 前端静态文件）
- **systemd 服务**: `combat-v2.service`（自动重启，开机自启）
- **部署脚本**: `./dev-deploy.sh`（同机 rsync，无需 SSH/密码）
- **默认登录**: `admin` / `admin123`

#### 部署命令（在 /fighting 目录执行）

```bash
# 全流程：测试 → build → 备份 DB → rsync → systemctl restart → verify
./dev-deploy.sh

# 跳过测试（紧急部署）
./dev-deploy.sh --skip-test

# 仅 rsync + restart（小改动）
./dev-deploy.sh --skip-test --skip-build

# 预览不真执行
./dev-deploy.sh --dry-run

# 查看日志
tail -f /opt/combat-v2/backend.log
```

#### 部署架构（2026-06-01 更新）

- **单端口 :3001**：后端 Express 服务 API (`/api/*`) + 前端静态文件（`apps/frontend-v2/dist/`）
- **systemd 管理**：`combat-v2.service`，`Restart=always`，开机自启
- **同机部署**：`dev-deploy.sh` rsync `/fighting/` → `/opt/combat-v2/`，不需要 SSH

#### 日志体系与文件路径

**三层日志架构**，所有操作均有迹可查：

| 层级       | 存储                  | 覆盖范围                                                                    | 查看方式                             |
| ---------- | --------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| 结构化日志 | 文件                  | 所有后端操作（94个日志点）+ 每个HTTP请求                                    | `tail -f /opt/combat-v2/backend.log` |
| 审计日志   | SQLite `audit_log` 表 | 所有数据变更（CREATE/UPDATE/DELETE/PROGRESS/ESCALATE/MERGE 等，21个审计点） | 前端"审计日志"页面                   |
| 操作日志   | SQLite `op_logs` 表   | 前端API调用、路由导航、全局错误                                             | 前端"操作日志"页面                   |

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

### 系统升级机制 (v2.3 一键升级 UI)

详细见 `docs/UPGRADE.md`。要点:

- **三层分层**:代码 baseline(随包替换) / 用户态 overlay (`data/schemas-overlay/`,跨升级保留) / 业务数据(SQLite/uploads,整盘备份)
- **入口**:系统管理 → 系统升级(仅 admin)
- **流程**:上传 .tar.gz → 自动 analyze diff → 双重确认("UPGRADE")→ detached worker 跑 backup/extract/schema-merge/secrets/code-swap/restart/health,失败自动回滚
- **环境变量**(systemd 设置):`COMBAT_INSTALL_ROOT=/opt/combat-v2`、`COMBAT_SCHEMA_OVERLAY_DIR=/opt/combat-v2/apps/backend/data/schemas-overlay`、`COMBAT_UPGRADE_DATA_DIR=/opt/combat-v2/apps/backend/data`
- **sudoers**:升级阶段 worker 需 `sudo systemctl restart combat-v2`(NOPASSWD),首次部署需配 `/etc/sudoers.d/combat-v2`
- **本机/e2e**:设 `COMBAT_UPGRADE_MOCK_SYSTEMD=1` 跳过 systemctl + health 探活

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

| Script         | Path                                  | Usage                                                                                                                                                                                                           |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo seed      | `scripts/mock-data/demo-seed.mjs`     | `node scripts/mock-data/demo-seed.mjs --api http://HOST:3001` — full-featured demo data seeder (22 people, 30 tickets, 98 progress, 26 contributions, help requests, bug reports, proposals, tabs, edges, etc.) |
| Mock seed      | `scripts/mock-data/seed.mjs`          | `node scripts/mock-data/seed.mjs [--api URL] [--count N]` — creates N people, attackTickets, contributions                                                                                                      |
| Mock wipe      | `scripts/mock-data/wipe.mjs`          | `node scripts/mock-data/wipe.mjs [--api URL] [--yes]` — deletes ALL nodes (irreversible!)                                                                                                                       |
| Settings seed  | `scripts/settings-seed.mjs`           | `node scripts/settings-seed.mjs [--api URL]` — populates config center with default dropdown options                                                                                                            |
| Migrate export | `scripts/migrate/export.mjs`          | `node scripts/migrate/export.mjs [--api URL] [--out DIR]` — exports all nodeTypes to xlsx files                                                                                                                 |
| Migrate import | `scripts/migrate/import.mjs`          | `node scripts/migrate/import.mjs [--api URL] [--dir DIR] [--dryRun]` — imports xlsx files via upsert                                                                                                            |
| Deploy v2      | `scripts/deploy-v2/deploy.mjs`        | `cd scripts/deploy-v2 && node deploy.mjs <check\|deploy\|restart\|logs>` — full deploy pipeline (跳板机→目标机)                                                                                                 |
| Deploy direct  | `scripts/deploy-v2/deploy-direct.mjs` | `cd scripts/deploy-v2 && node deploy-direct.mjs <host> <user> <pass>` — direct SSH deploy (e.g. 124.156.193.122)                                                                                                |
| Dev backend    | `dev.sh`                              | `./dev.sh` — 启 dev backend(空 db) :3500                                                                                                                                                                        |
| Dev snapshot   | `dev-with-snapshot.sh`                | `./dev-with-snapshot.sh` — 拷生产 db 快照后启 dev backend :3500                                                                                                                                                 |
| Dev frontend   | `dev-frontend.sh`                     | `./dev-frontend.sh` — 启 vite dev :5174(proxy /api → :3500)                                                                                                                                                     |
| Dev test       | `dev-test.sh`                         | `./dev-test.sh` — 跑 vitest backend(in-memory db)                                                                                                                                                               |
| Dev e2e        | `dev-e2e.sh`                          | `./dev-e2e.sh` — 跑 Playwright(自启 webServer)                                                                                                                                                                  |
| Dev deploy     | `dev-deploy.sh`                       | `./dev-deploy.sh` — 同机部署 /fighting → /opt/combat-v2(rsync + systemctl restart)                                                                                                                              |
| Deploy v1      | `scripts/deploy/deploy.mjs`           | Old deployment for reference frontend only                                                                                                                                                                      |

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
  enumValues: ["待响应", "处理中", "已解决", "已关闭"];
  toStatus === "已解决";
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
- **Frontend unit tests** use vitest (src/**/\*.test.tsx); **e2e tests** use Playwright (e2e/**/\*.spec.ts).
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
- **Settings system:** `src/hooks/useSettings.ts` — loads config from `/api/settings` on mount; exposes `getValues(key, fallback)` / `getOptions(key, fallback)`; **fallback 必填** — 配置中心被清空或网络失败时 UI 仍可用(硬底线,见下方"UI 配置化原则")
- **DynamicField component:** `src/components/DynamicField.tsx` — renders Select when `optionsKey` has values in config center, degrades to Input when config entry is empty/missing
- **Config-OptionsKey binding:** schema fields with `type: "enum"` have an `optionsKey` property pointing to a config center key; binding is managed in SchemaWizard; config center delete shows impact analysis before confirming

### UI 配置化原则(强制)

**所有"业务枚举"下拉/筛选/单选必须走配置中心,严禁源码硬编码** — Bug 严重程度、攻关单状态、贡献等级、团队角色这类业务可变枚举,统一从 `useSettings().getValues(key, fallback)` 读。

```ts
// ❌ 禁止
const SEVERITY_OPTIONS = ['严重', '较高', '一般', '建议'].map(v => ({value: v, label: v}));

// ✓ 必须
const { getValues } = useSettings();
const severities = getValues('Bug 严重程度', ['严重', '较高', '一般', '建议']);
<Select options={severities.map(v => ({value: v, label: v}))} />
```

铁律:

1. **fallback 必填**(string[]),且保留原硬编码默认值 — 离线 / 未 seed 也能渲染。
2. 新增 settings key → `scripts/settings-seed.mjs` 同步加 `await put(...)`,部署时跑一次。
3. 配置项一览见 `docs/UI_CONFIG_AUDIT.md` 和 `help-content.ts` 的 `configCenter` 条目。
4. **排除项**(允许硬编码):角色码 admin/leader/normal、分页 `[10,20,50,100]`、`constants.ts` enum→颜色映射、文件类型、技术参数(KG 布局/Radio link-custom 等)、nodeType 代码。

### UX 改进(2026-05-31 引入,见 `docs/REVIEWS/REVIEW_ux.md`)

针对 review 7.0/10 总评 五项 quick wins,合并后均挂在全站 `AppLayout`:

1. **AI 助手全站浮窗** — `<HermesChat title="AI 问答" bottom={156} />` 挂到 `AppLayout`,所有页面右下机器人可拖拽问答,不再局限知识图谱页。FloatingFeedback(bottom:24)→HermesChat(bottom:156)间距 132px,避免碰撞。
2. **Dashboard 三卡** — `Dashboard.tsx` 在 4 个 Statistic 之后加 size=small 卡片:**分配给我** / **我的关注** / **SLA 风险**(进行中 + 超 3 天)。复用 AttackList 的 favorites localStorage 隔离。
3. **AttackList 批量操作** — Table 加 `rowSelection`,选中 ≥1 行后蓝色工具条暴露「批量删除(仅创建人)」「批量加关注 ★」「取消选择」;深链 `?new=1` 自动打开新建抽屉(供 CommandPalette 调用)。
4. **Cmd+K 命令面板** — `components/CommandPalette.tsx`,Modal 形态,触发 `Ctrl/Cmd + K`,12 个导航命令 + 1 个"新建攻关单" + 输入非空时的"搜索"命令。↑↓ Enter Esc 键盘流。挂在 `AppLayout`。
5. **菜单瘦身** — 一级菜单从 10 项 → 6 项。文档中心/全局搜索/知识图谱/问题反馈/帮助中心 5 个零散工具收纳到新建二级组「工具」(ToolOutlined)。系统管理图标改 SettingOutlined。

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

## Deploy Infrastructure (2026-06-01 更新)

### 同机部署（当前方式 — 远程优先）

- **开发+部署同机**: `124.156.193.122`
- **开发目录**: `/fighting/`（完整 git 工作树）
- **部署脚本**: `./dev-deploy.sh`（同机 rsync，无需 SSH/密码）
- **Node 版本**: v22.22.3（通过 nvm 管理）
- **systemd 服务**: `combat-v2.service`，自动重启，开机自启

### 部署流程

```bash
cd /fighting
./dev-deploy.sh                  # 全流程: test → build → backup → rsync → restart
./dev-deploy.sh --skip-test      # 跳过测试
./dev-deploy.sh --dry-run        # 预览
```

- rsync `/fighting/` → `/opt/combat-v2/`（排除 node_modules/.git/dev 脚本等）
- 在 `/opt/combat-v2/` 运行 `npm install` → `systemctl restart combat-v2` → 健康检查
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

| 属性             | 值                        | 原因                 |
| ---------------- | ------------------------- | -------------------- |
| `width`          | 创建/编辑: 480, 详情: 560 | 表单紧凑，详情宽松   |
| `destroyOnClose` | `true`                    | 避免残留状态         |
| `maskClosable`   | `false`                   | 防误触关闭           |
| 提交按钮位置     | `extra={<Button>}`        | 固定在顶部，始终可见 |
| 关闭时           | `form.resetFields()`      | 清空表单             |

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
  size="middle" // 列表用middle，详情内嵌用small
  pagination={{
    pageSize: PAGE_SIZE, // 20
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS, // [10, 20, 50, 100]
    showTotal: (t) => `共 ${t} 条`,
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
  options={personOptions} // [{value: '姓名', label: '姓名 (部门)'}]
  filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
/>
```

- options 格式：`value=姓名, label=姓名 (部门)` — 显示部门便于区分同名
- 必须 `showSearch` + `filterOption` — 中文模糊搜索

### 7. 交互模式

| 场景     | 模式                                                                  |
| -------- | --------------------------------------------------------------------- |
| 创建     | Drawer + Form + extra按钮                                             |
| 编辑     | 独立 editOpen Drawer，预填 `editForm.setFieldsValue(node.properties)` |
| 详情     | Drawer(width:560) + Descriptions(bordered, column:1)                  |
| 删除     | `Popconfirm title="确认删除XX？"` + `<a style={{color:'#ff4d4f'}}>`   |
| 状态流转 | Drawer + Steps可视化 + Select选目标状态                               |
| 导出     | `api.exportNodes()` → Blob → `<a download>`                           |
| 导入     | Drawer + Upload.Dragger                                               |

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

| 类型       | 规范                         | 示例                                       |
| ---------- | ---------------------------- | ------------------------------------------ |
| 页面文件   | PascalCase                   | `AttackDetail.tsx`, `PeopleList.tsx`       |
| 状态变量   | `xxxOpen`                    | `editOpen`, `drawerOpen`, `transitionOpen` |
| 提交中状态 | `xxxSubmitting`              | `editSubmitting`, `transSubmitting`        |
| 加载状态   | `loading` / `initialLoading` | 列表用 loading，详情用 initialLoading      |
| Fetch函数  | `fetchData` / `fetchXxx`     | `fetchDailyReports`, `fetchSupportNodes`   |
| 数据过滤   | `filtered`                   | `filteredNodes`, `filtered`                |

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

### 本会话新增特性（2026-05-29）

#### 1. Hermes agent 问答(opencode serve + SDK)

"Hermes" 是"用 agent 做只读问答"的稳定概念,opencode 为可替换的具体 agent。`/api/hermes/ask` 契约不变(返回 `HermesAnswer`),实现可在规则引擎 ↔ agent 间切换。

- **确定性核心** `apps/backend/src/hermes-agent.ts`:`AgentRunner` 接口 + `buildHermesPrompt`(数据字典) + `parseAgentOutput`(拆答案/引用 id) + `buildCitations`(按 id 回查节点做 **a2 校验**,丢弃编造 id = 防幻觉) + `answerWithAgent`。
- **agent 实现** `apps/backend/src/opencode-runner.ts`:`createOpencodeServer` + `@opencode-ai/sdk`(`session.create`/`prompt`),取 `text` part 拼答案;失败/超时静默**回退规则引擎**。
- **只读工作区** `apps/backend/hermes-workspace/.opencode/`:`tools/hermes.ts`(只读工具 `hermes_lookup` 一步检索 search+context、`hermes_recommendHelpers`,经 Bearer 调本机只读端点)+ `agents/hermes.md`(受限 agent,`bash/edit/write/webfetch: deny`)+ `opencode.json`(禁全局重型 MCP、glm-5 关 thinking)。`.opencode/node_modules` 由 opencode 自动安装、已 gitignore。
- **环境变量**:`HERMES_AGENT=1` 开启 agent(默认关→规则引擎,现网零风险);`HERMES_MODEL`(默认 `huawei_cloud/glm-5`);`HERMES_OPENCODE_URL`(连外部 serve);`HERMES_TIMEOUT_MS`(默认 180000);`HERMES_API`(工具回调地址);token 由 `signServiceToken` 签发。
- **实测**:本机冒烟 agent 端到端通(自主 lookup→组织答案→a2 双引用可点击)。瓶颈是 **GLM-5 单轮 ~50-80s 延迟,总 ~2-3min**(已合并工具/关 thinking/常驻预热;再快需换路由模型)。UI 有 loading,可接受。
- **未完**:切片5 现网部署(需 prod 装 opencode workspace 依赖 + 设 `HERMES_AGENT=1` + prod opencode.json 华为云凭据);默认不开时走规则引擎,可安全先部署。

#### 2. 灵活容错 Excel 导入(未知列自动建字段)

不要求 Excel 列与内置字段完全一致:`detectNewColumns` 识别未匹配 name/label/alias 的列;`/import?createFields=1` 逐列 `applyFieldOp` 建为 string 字段后用更新 schema 重映射导入(失败只记日志不阻断);`dryRun` 预览返回 `newColumns`。前端 ImportExport 预览展示未匹配列 + 勾选「自动创建字段」+ 复用已预览文件(免再弹原生框)。

#### 3. 知识图谱可视化(`/kg` 菜单)

后端 `GET /api/kg/graph?types=&q=&limit=`(`buildGraph` 跨类型筛节点+取其间边);前端 `KGGraph.tsx` 用 **@antv/g6 v5** 力导向图:按 nodeType 着色+图例、顶部多选筛选+关键词搜索、双击跳详情。

- **单击节点折叠/展开切换**:展开取 1 跳邻域(复用 `/graph/snapshot`,含上钻/下钻方向);引用计数(`addedBy`)追踪邻居由谁引入,折叠移除本节点独占且非基图的邻居(级联),刷新=折叠全部。
- **浮动 AI 问答**:可复用组件 `components/HermesChat.tsx`(FloatButton+Drawer)挂在 KG 页,底层即 `/hermes/ask`(与攻关详情 AI 助手**同一能力**);答案 markdown + 可点击溯源引用(跳对应节点)。agent 开启时为 opencode 图谱问答,否则规则引擎。

> **现网 agent 已启用(2026-05-29)**:opencode agent 通过 **systemd drop-in** `/etc/systemd/system/combat-v2.service.d/hermes.conf`(`HERMES_AGENT=1` + `HERMES_MODEL=huawei_cloud/glm-5` 等)持久开启,**跨部署不丢**。
>
> - 为何用 drop-in 而非 `combat-v2-direct.service`:该服务文件的 HERMES env 会被(钩子/lint)反复剥离,故改用 drop-in,既启用 agent 又不与之冲突。
> - 现网验证:问「你好」→ `intent=agent`、~19s(暖服务、无需调工具);数据类问题需 lookup/读笔记,~1-2min。简单问答快、复杂稍慢均可用,失败/超时自动回退规则引擎。
> - 关闭办法:删除该 drop-in + `systemctl daemon-reload && systemctl restart combat-v2`。

> **UUID 语义化(全站不暴露内部 id)**:新增 `utils/nodeLabel`(取标题/姓名/组名/贡献人…,无名回退中文类型名,绝不返回 UUID)。后端 `query.ts` summarize 补「姓名」、回退「(无标题)」。已清理:搜索摘要/卡片标题/关联标签(可点击)、关联全景头部、攻关单下拉(去 id 前缀)、提案节点名、攻关详情关联/找帮手。审计日志「实体ID」为技术追溯列保留。

> **KG 健壮性修复**:g6 `animation:false`(消除 force 布局持续 tick 与增删节点抢占 transform 的 `getTransformInstance` 崩溃);双击导航 `setTimeout(0)` 推迟避免卸载销毁竞态;单击防抖(dblclick 取消);人员节点显示姓名非 id、贡献标签带类型、图例按实际类型生成。

### 当前测试状态(2026-06-01 v2.12.0 — 知识库 + API文档 + Code-split)

**v2.12.0 = v2.11.0 + 三桶(知识库Wiki / API自动文档 / 前端Code-splitting)**

- 后端 vitest **768/768 全绿**（100 文件）
- shared vitest **28/28 全绿**
- 三端 `npx tsc --noEmit` 全 0 错（backend + shared + frontend-v2）
- 新增 `wiki.ts`（WikiRepo CRUD + 文章搜索 + 排序）
- 新增 `wiki-router.ts`（REST API: 列表/详情/创建/更新/删除/搜索/重排序）
- 新增 `openapi-router.ts`（OpenAPI 3.0 spec 生成 + Swagger UI 渲染）
- 新增前端 `WikiPanel.tsx`（知识库面板：文章列表+Markdown编辑+搜索）
- 新增前端 `buildTabItems.tsx` wiki 类型支持（攻关单局部知识库）
- 新增前端 `AddTabModal.tsx` wiki 选项
- `Dashboard.tsx` 新增「知识库」tab（全局知识库，信息广场后面）
- `App.tsx` 全面改为 React.lazy 路由级懒加载（30+ 页面，3.5MB→按需加载）
- `api.ts` 新增 wiki CRUD 方法，TicketTab.tabType 扩展 "wiki"
- `help-content.ts` 追加 v2.3.0 release notes + wiki/apiDocs 帮助页

**关键设计决定**:

1. **知识库双态** — 全局知识库(scope=global)放在态势首页 tab；局部知识库(scope=ticket,scopeId=ticketId)通过自定义 tab 创建
2. **OpenAPI 静态 spec** — 手工维护的 spec 对象，覆盖 50+ 端点、10 个标签分组；Swagger UI CDN 加载，自动携带 JWT token
3. **Code-splitting** — React.lazy + Suspense 包裹整个 Routes，LoginPage/ErrorBoundary 保持 eager load；PageLoader 统一 loading 态

### 当前测试状态(2026-06-01 v2.11.0 — 邮件增强 + 邀请管理 + 运营大屏)

**v2.11.0 = v2.10.0 + 三桶(邮件增强 / 邀请管理 / 运营大屏)**

- 后端 vitest **768/768 全绿**（100 文件）
- shared vitest **28/28 全绿**
- 三端 `npx tsc --noEmit` 全 0 错（backend + shared + frontend-v2）
- `mailer.ts` 扩展支持 `html` + `attachments`（MailMessage 接口）
- `digest.ts` 新增 `buildDigestHtml` HTML 模板生成（渐变头部 + 表格 + 统计卡片）
- `digest.ts` `sendDigest` 支持 `customDays` 自定义时间段参数
- `digest-router.ts` preview 和 send 端点支持 `days` 查询参数
- 新增 `invitation.ts`（InvitationRepo CRUD + 邀请码生成 + 过期/使用标记）
- 新增 `invitation-router.ts`（REST API: 创建邀请 + 邮件发送 + 验证邀请码 + 删除）
- `auth.ts` register 端点支持 `inviteCode` 参数，有邀请码时使用预设角色
- `auth.ts` publicPaths 添加 `/invitations/check/`
- 新增前端 `InvitationPage.tsx`（邀请管理 + 发送邀请 + 复制链接）
- 新增前端 `InviteRegister.tsx`（公开邀请注册页，预设角色自动生效）
- 新增前端 `DashboardScreen.tsx`（深色全屏运营大屏 + KPI 卡片 + 状态分布 + 自动刷新）
- `api.ts` 新增 invitation/dashboard 相关方法，register 改为对象参数支持 inviteCode
- `AppLayout.tsx` 侧边栏增加邀请管理（admin）+ 运营大屏入口
- `help-content.ts` 追加 v2.2.0 release notes + invitation/dashboardScreen 帮助页

**关键设计决定**:

1. **邀请码机制** — 12 位大写随机码，默认 7 天过期，注册时自动标记已使用；邀请邮件同时发送 HTML 和纯文本版本
2. **HTML 邮件模板** — 内联 CSS 样式（不依赖外部样式表），渐变头部 + 表格 + 统计卡片，兼容主流邮件客户端
3. **大屏独立页面** — 不依赖 Ant Design 组件，纯 CSS Grid 布局，深色主题，每 30 秒自动刷新，Fullscreen API 投屏

### 当前测试状态(2026-06-01 v2.10.0 — Webhook + 邮件摘要 + 内联字段)

**v2.10.0 = v2.9.0 + 三桶(Webhook 事件订阅 / 邮件 Digest / 攻关详情内联字段添加)**

- 后端 vitest **768/768 全绿**（100 文件）
- shared vitest **28/28 全绿**
- 三端 `npx tsc --noEmit` 全 0 错（backend + shared + frontend-v2）
- 新增 `webhooks.ts`（WebhookSubscription CRUD + dispatchWebhook 异步推送）
- 新增 `webhook-router.ts`（REST API: CRUD + 测试推送 + 事件列表）
- 新增 `digest.ts`（DigestConfig 配置 + buildDigestSummary 汇总 + sendDigest 发送）
- 新增 `digest-router.ts`（REST API: 配置 CRUD + 预览 + 手动发送）
- 新增 `server.ts` 每小时 digest 定时检查（daily/weekly 自动发送）
- `routes.ts` 增加 webhookAdapter 参数，5 处事件点触发 dispatchWebhook
- `email.ts` readConfig 导出为 public
- `api.ts` 新增 webhook/digest/addSchemaField 公共方法
- 新增前端 `WebhookSettings.tsx`（订阅管理 + 启停 + 测试推送）
- 新增前端 `DigestSettings.tsx`（配置 + 预览 + 手动发送）
- `AttackBasicInfoTab.tsx` 增加「添加字段」按钮 + Modal（字段类型/分组/枚举配置中心绑定）
- `AppLayout.tsx` 侧边栏增加 Webhook 订阅 + 邮件摘要菜单（admin only）
- `help-content.ts` 追加 v2.11.0 release notes + webhookSettings/digestSettings 帮助页

**关键设计决定**:

1. **Webhook 异步不阻塞** — dispatchWebhook 在事件触发后 fire-and-forget，10s 超时，失败只记日志不影响主流程
2. **Digest 定时检查** — 每小时检查 lastSentAt，daily 按天去重、weekly 按 7 天间隔
3. **内联字段与 SchemaWizard 联动** — AttackBasicInfoTab 通过 `api.addSchemaField()` 直接写 schema，`fetchSchema()` 刷新后新字段立即出现

### 当前测试状态(2026-06-01 v2.7.0 — Hermes 体验收尾 + Schema-as-UI 全栈化 + 多视图)

**v2.7.0 = v2.6.0 + 三桶(r-hermes-polish / r-schema-all / r-views)**

- 后端 vitest **~755/755 全绿**(集成阶段汇总;含 hermes-polish 17 + schema-all 25 + golden set 15/15)
- shared vitest **28/28 全绿**
- 前端 tsc 0 错
- 前端 e2e: 多视图 12(kanban 5 + calendar 4 + pivot 3)+ schema-driven 25 + 抽屉/详情回归 47+ 全绿
- **现网 LLM 端到端 golden set 真跑预期 15/15**(Q7 prompt 修复 → 审计类问题自动调 get_audit)
- 现网部署 `124.156.193.122:3001` (待 deploy)
- systemd drop-in 自愈机制就位: deploy-direct.mjs 自动检测多 .conf 设同 env key,新覆盖旧并备份;`--keep-old-drop-ins` 关闭
- 文档:help-content 顶部追加 v2.7.0 release notes、attackList/contributions/llmSettings/peopleList/helpCenter/bugReport/proposals/reminders 8 个 page 章节追加 v2.7 说明;`docs/MULTI_VIEW.md` 新建;`docs/SCHEMA_AS_UI.md` 全栈化章节;`docs/HERMES_TOOLS.md` /models endpoint;`docs/LLM_SETTINGS.md` 动态刷新

**关键设计决定**:

1. **virtual schema** — helpRequest/bugReport/proposal/reminder 这些已有专用表存数据的 nodeType,仍写 schema 描述字段(让 UI 通用渲染),后端 `/api/nodes/<virtual>` 拒收避免双写;UI 视它们与普通 nodeType 一致
2. **多视图 URL 同步** — `?view=table|kanban|calendar|pivot`,可直链分享;切换不重置 filter/搜索/分页
3. **HTML5 native DnD** — Kanban 用浏览器原生拖拽 + 卡片底部 Select 降级,无新依赖
4. **glm-4-flash 默认** — 智谱免费层 + thinking disabled,零成本 + 0.5-3s/题

### 当前测试状态(2026-05-31 v2.6.0 — LLM 端到端 + Inbox + 面包屑 + Schema-as-UI)

**v2.6.0 = v2.5.0 + 四桶(r-llm OpenAI-compat + r-inbox-breadcrumb + r-schema-ui)**

- 后端 vitest **715/715 全绿**(96 文件)
- shared vitest **28/28 全绿**
- 前端 tsc 0 错
- 前端 e2e: LLM settings 4 + breadcrumb 6 + notifications 3 + schema-driven-detail 2 + schema-wizard-group 2 + 回归全绿
- **现网 LLM 端到端 golden set 真跑**: **14/15 通过**(门槛 12/15) — model=`glm-4-flash`(智谱免费层 OpenAI 兼容),"有多少员工" → tool=count_nodes → answer="共有22名员工",平均 1-4s/题
- 现网部署 `124.156.193.122:3001` active running、`977c543` 落地
- systemd drop-in `hermes-llm.conf` 注入: `HERMES_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4`(智谱) + `HERMES_LLM_API_KEY`(zhipu key) + `HERMES_MODEL=glm-4-flash` + `HERMES_THINKING=disabled`;旧 hermes.conf / hermes-mode.conf 已删
- 文档:help-content 顶部追加 v2.6.0 release notes、attackDetail/contributions v2.6 章节追加、`llmSettings` / `notifications` 章节新增;`docs/LLM_SETTINGS.md` / `NOTIFICATIONS.md` / `SCHEMA_AS_UI.md` 新建;`HERMES_TOOLS.md` 架构去 opencode
- Playwright 现网截图 `test-results/v2.6-trace.png` 留档

**关键教训(v2.6 → v2.7)**:

1. systemd Environment drop-in 是**累加**不是覆盖,新版本若 env key 名复用必须同时清掉旧 conf 文件,否则两个 conf 都设同 key 时按"最后一个写入"取值(我们 v2.4 的 hermes.conf 里 `HERMES_MODEL=huawei_cloud/glm-5` 长期覆盖了 v2.6 hermes-llm.conf 的 `HERMES_MODEL=glm-4.5-air`,导致表面看像"模型不存在"实际是发了错 model)
2. **provider key 的资源限额是隐式的** — zhipuai-coding-plan key 在 zhipu OpenAI 兼容 endpoint 上可访问 glm-4.5/4.5-air/4.6/4.7/5/5-turbo/5.1 但都需余额(1113);唯独 `glm-4-flash` / `glm-4-flash-250414` 免费层可用。线上选 model 一定要先用 `GET /api/paas/v4/models` 列表 + 小请求实测,避免上线后 401/1113 才发现
3. UI 配置后端的"测试连接"endpoint 必须支持 env-fallback(如果 admin 没存 DB 就直接走 env 实测);当前 router 仅看 body + DB,部分场景误报"缺 baseUrl"

### 当前测试状态(2026-05-31 v2.4.1 hot-fix — React #310 + AI 抖动)

**v2.4.1 = v2.4.0(三桶 harden + resilience + upgrade-real)+ hot-fix(AttackDetail Hooks 顺序 + HermesChat 抖动)**

- 后端 vitest **575/575 全绿**(86 文件:v2.3 baseline 536 + harden 12 + resilience 17 + upgrade-real 8 + Sentry 2)
- shared vitest **28/28 全绿**
- 前端 vitest **54/54 继承全绿**
- 三端 `npx tsc --noEmit` 0 错
- Playwright 现网 e2e probe `/attack/<id>` 完整渲染、0 console error
- 现网部署 `124.156.193.122:3001` active running、`f4af74f` 落地
- 文档:`help-content.ts` 顶部追加 v2.4.1 release notes + 受影响页面(attackDetail / contributions)末尾追加修复说明;`docs/OBSERVABILITY.md` 已交付(Sentry);`docs/UPGRADE.md` 追加 v2.4+ JWT_SECRET drop-in 修复步骤;`docs/V2.5_DESIGN.md` 已起草(14 工具 / 4 桶 / 15 题评测 golden set)
- 在线 bug 关闭:`de1bf88e` AI 抖动 status=已解决

**v2.4 → v2.4.1 关键教训**:Hooks 规则不可妥协。子 hook(useAttackDetailHandlers)内新增/删除 useState 等价于父组件 hooks 数量变化;**任何 hook 必须固定调用在所有 early return 之前**。重构 hook 抽取时尤其要复核——把 useState 收到子 hook 不意味着可以放到 conditional 分支后。回归防护:Playwright probe `/attack/<id>` 加入 e2e baseline。

### 当前测试状态(2026-05-31 v2.3.0 整合 — v2.2.0 master 合并到 upgrade-ui 分支)

**v2.3.0 = v2.2.0(sec+perf+quality 三桶 P1)+ 一键升级 UI(schema overlay + upgrade router + SystemUpgrade page)**

- 后端 vitest **536/536 全绿**(v2.2 baseline 507 + upgrade-ui 29:schema-overlay 11 + upgrade router 18 + metrics 4 + queryNodesByProperty 5 共 80 个测试文件)
- 前端 vitest **54/54 全绿**(v2.2 quality 7 文件全继承)
- 三端 `npx tsc --noEmit` 全 0 错(backend + shared + frontend-v2)
- 前端 e2e 未跑(端口被占,集成机共用 5174/3001;各桶分支独立验证已绿)
- 文档:`help-content.ts` 顶部追加 v2.3.0 release notes;`docs/UPGRADE.md` / `SECURITY_RUNBOOK.md` / `PERFORMANCE_TUNING.md` 已交付

**合并策略(本次成功路径)**:

- master(c2b1d93 v2.2.0)→ feature/roadmap-integ-v2.3(9daf36e upgrade-ui 4 commits)
- 冲突清单:AGENTS.md / help-content.ts / package-lock.json(全部 union 解决)
- app.ts / api.ts / App.tsx / AppLayout.tsx / registry.ts / shared/types.ts 全部 auto-merge 成功,无需人工
- v2.2 安全(helmet/rate-limit/CSRF/audit actor)+ 性能(queryNodesByProperty/Prometheus)+ 质量(AttackDetail 拆/vitest 起手/ApiError)全继承
- upgrade-ui 新增(schema overlay/upgrade router/SystemUpgrade page/UPGRADE.md)全保留
- upgrade router 受 `/api/upgrade adminMiddleware` 守卫(app.ts 行 142)

---

### 历史测试状态(2026-05-31 v2.2.0 整合 — roadmap P1 三桶合并到 expert-roadmap-v2.2 后)

**v2.2.0 = 7 P1 安全 + 7 P1 性能 + Prometheus + 4 P1 质量(AttackDetail 拆 + frontend vitest 起手 + ApiError + makeTestApp 去重)**

- 后端 vitest **507/507 全绿** (基线 463 → 各桶整合后 +44:sec 23 + perf 14 + quality 7)
- 前端 vitest **54/54 全绿** (全新增 7 文件:auditFilter/handleApiError/nodeLabel/teamMembers/useSettings/StatusTag/apiError)
- 三端 `npx tsc --noEmit` 全 0 错 (backend + shared + frontend-v2)
- 前端 e2e 未跑 (端口被占,集成机共用 5174/3001;各桶分支独立验证 401+ 全绿)
- 文档:`apps/frontend-v2/src/help-content.ts` 顶部追加 v2.2.0 release notes;各桶 `docs/REVIEWS/REVIEW_*.md` 已含"v2.2 P1 已实施"段

**整合策略(本次成功路径):**

- 按依赖顺序合:perf(基础数据通路) → quality(重构 + 测试) → sec(收尾守卫)
- perf / quality 干净合入无冲突
- sec 合时冲突在 routes.ts(4 处) / LoginPage.tsx(2 处) / package-lock.json
  - routes.ts: 保留 perf 桶 `triggerPostSaveJobs(repo, registry, nodeId)` 签名 + sec 桶 `actorOf(req)` actor 来源
  - private-tickets.ts: 用 sec 桶拆分版本(从 routes.ts inline 移出) + perf 桶 `queryNodesByProperty` SQL 下推
  - LoginPage.tsx: union(sec 的 `passwordMustChange` 提示 + quality 的 `handleApiError` helper)
  - package-lock.json: theirs + `npm install` regenerate
- master 当前 8b3f223 与三桶共同祖先一致,master 合是 no-op

---

### 历史测试状态(2026-05-31 feature/roadmap-upgrade-ui — v2.3 旗舰特性 一键升级 UI)

**v2.3 一键升级 UI 分支(基于 v2.1.0 master)**:

- 后端 vitest **492 通过**(基线 463 + schema-overlay 单测 11 + upgrade router e2e 18)
- 双端 `npx tsc --noEmit` 通过
- 前端 e2e `system-upgrade.spec.ts` 4 用例(本机未跑全量,端口被并行 worktree 占,合并 master 后再跑)
- 部署需先 git commit,然后在测试环境真跑一次自我升级验证 systemd detached worker 行为

**核心交付**:

- Schema overlay 系统(`apps/backend/src/schema-overlay.ts` + `FileSchemaRegistry` 扩展)— baseline vs user 分离
- Schema 三方合并 `scripts/upgrade/schema-merger.mjs` — 用户字段名撞新基线 → 冲突报告
- 升级 router `apps/backend/src/upgrade.ts` 8 个端点(admin-only)
- 自我升级 worker `scripts/upgrade/worker.mjs`(detached 进程,phase=backup→extract→schema-merge→secrets→code-swap→restart→health,失败自动回滚)
- 前端 SystemUpgrade 页面(三段式 + 双重确认 + 实时 log tail)
- 详细文档 `docs/UPGRADE.md`

**MVP 限制**(留 v2.4):仅本地上传(不支持 GitHub Release)、无 PGP 签名校验、自我升级需在 staging 测一次再上线。

---

### 历史测试状态(2026-05-31 v2.2 安全 P1 — feature/roadmap-sec-p1 分支)

**v2.2 P1 = 私密单全集过滤 + SMTP 加密 + 强制改默认密 + helmet/rate-limit + CSRF + multer/express 升级 + audit actor 强制:**

- 后端 vitest **493/493 全绿** (基线 463 → 新增 30 个 P1 用例,分布在 7 个 commit)
- 双端 `npx tsc --noEmit` 通过 (backend + shared + frontend-v2)
- 前端 e2e 未跑 (本次仅安全后端 + 强制改密 Modal 接入,业务流无破坏)
- 文档: `docs/REVIEWS/REVIEW_security.md` 已追加 v2.2 P1 实施记录;`docs/SECURITY_RUNBOOK.md` 新增运营手册

**安全 P1 commit 列表 (feature/roadmap-sec-p1):**

1. `2410744` fix(sec/P1): 私密 ticket 全集过滤 list/export/audit/dashboard
2. `0c6f584` feat(sec/P1): SMTP 密码 AES-256-GCM 加密 + 自动迁移
3. `7bfe0ec` feat(sec/P1): 默认密强制首登改密
4. `98188d9` feat(sec/P1): helmet + 全局 rate-limit + 登录 rate-limit 加固
5. `403fddc` feat(sec/P1): CSRF 同源 Referer 校验
6. `4f8d762` fix(deps/sec): 升级 multer 1.x→2.x + express ≥4.21.2 修 CVE
7. (本 commit) fix(sec/P1): audit actor 强制取自 req.user 防伪造

详细安全运营 / 事故响应见 [docs/SECURITY_RUNBOOK.md](./docs/SECURITY_RUNBOOK.md)。

---

### 历史测试状态（2026-05-31 v2.1.0 整合 — roadmap 4 桶合并到 master 后)

**v2.1.0 整合 = quality + performance + security + ux + 已含 master 的 welink + postgres + UI 配置化:**

- 后端 vitest **(SQLite 默认路径) 全绿** — 含 welink 21 / postgres 已 async 化 / 健康检查 2 / RBAC 5 + 全套核心 e2e
- 双端 `npx tsc --noEmit` 通过
- 前端 e2e 全量套件待整合后验证(各桶分支均独立 401+/全绿)
- 待部署到 124.156.193.122,v2.1.0 release notes 已写

**整合策略**:

- 4 桶按 quality → performance → security → ux 顺序合(基础设施先,功能桶后)
- 再合 master(welink + postgres + 配置化):repository.ts 取 master 的 async DbAdapter(quality 的 Row 类型化让位 — postgres 异步路径无法保持)
- app.ts/auth.ts/routes.ts/dashboard.ts/conflicts.ts:合并 master 的 async 与各桶的安全/性能/UX 改进
- AppLayout.tsx:union UX 的 "工具" 分组 + master 的 /db-migration

---

### 历史测试状态(2026-05-30 master 大整合 — welink + postgres 合并后)

**master 合并 feature/welink-integration + feature/postgres-support 后:**

- 后端 vitest **(SQLite 默认路径) 全绿** — 含 welink 21 / postgres 已 async 化 / 全套核心 e2e
- 双端 `npx tsc --noEmit` 通过
- 前端 e2e 在 feature 分支已分别验证(welink 21/21、postgres 407/407);主干 union 合并仅做接口聚合,无新行为
- 已部署到 124.156.193.122,生产 release notes v2.0.0 可见

**合并策略**:

- welink router 暂时只在 SQLite 模式下挂载(deps.db 判断),postgres 模式下不挂(welink async 化作为后续 phase)
- welink 的 4 处 `repo.getNode/queryNodes/updateNode` 已跟随 postgres async 改造加 await
- SQLite DDL + Postgres DDL 都加了 welink_messages / welink_extractions 表

---

### 历史测试状态(2026-05-30 feature/welink-integration 分支)

- **后端 vitest 377/377 全绿**(主干 347 + welink 模块 30+)
- **welink 模块 e2e 21/21 全绿**

### 历史测试状态(feature/postgres-support · 2026-05-30 Phase 4 完成)

**后端 SQLite 路径 353/353 全绿**(60 文件)+ **本地 PG 18 实跑 OK**(CRUD/UPDATE/Audit + JSONB GIN 索引 + 中文 UTF-8 + migrate CLI 端到端验证)。

Postgres 支持全阶段完成:

- Phase 1 基建(drizzle-orm + pg + schema 双方言 + DB_URL 解析工厂)
- Phase 2a/2b/2c:Repository async 化 + 11 router 改用 DbAdapter + PostgresAdapter 全套 + backup.ts pg_dump 分支
- Phase 3 CLI 迁移工具(scripts/migrate/sqlite-to-postgres.mjs,事务/进度/标记 + Phase 4 JSONB 适配)
- Phase 3.5 一键迁移 UI(系统管理 → 数据库迁移,前端 + 后端 3 个 API + AdminGuard 守卫)
- **Phase 4**:PG 端 properties/changes 升级 JSONB + GIN 索引;Repository encode/decode adapter 分支;SQLite 路径完全不动

详见 `docs/POSTGRES_SUPPORT.md` 路线图。

### 历史测试状态（2026-05-30 主干验证）

**前端 e2e 全量套件 401/401 全绿**（~14min，单 worker，`NODE_ENV=test`，干净机器跑）；后端 **349/349**（60 文件，新增 health.e2e.test.ts 2 用例）。

### 性能 P1（2026-05-31 实施，分支 `feature/roadmap-perf-p1`）

依 `docs/REVIEWS/REVIEW_performance.md` (4.0/10) 落地 7 项 P1,主攻**算法/架构热点**:

| #   | 项                                                                                                    | commit    | 关键收益                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Repository.queryNodesByProperty` SQL 下推 + 9 个热点 key 表达式索引                                  | `cc9d915` | 单键等值过滤从 O(N) 全表 + N·JSON.parse 降到 O(log N) 索引 + k·parse。bench 实测 10k 节点 4.9× speedup,EXPLAIN 验证 `SEARCH nodes USING INDEX idx_nodes_prop_status` 走索引 |
| 2   | 5 处 callsite 改用下推:emailGroup.组名/person.邮箱(2)、attackTicket.问题单号、anchor.key、import 主键 | `8b22423` | 私密授权组授权 + 邮件发送 + Hermes find-helpers + anchor 创建 + import 行级查找全部消除应用层 N 次扫表 + filter                                                             |
| 3   | `conflicts.syncConflictsForOne` 增量 O(N²) → O(N) + post-save 防抖累计 ticketId 集                    | `6548942` | 单 ticket 保存的 audit 写从 ~Σk²(全量) 降到 ~k(单 ticket 同组大小);兜底 >50 ticket 累计降级到全量(避免逐个增量也 O(N²))                                                     |
| 4   | `recommend.recommendHelpers` 消除 N+1                                                                 | `b69bbac` | 5k contributions × queryEdges 从 O(N)·SQL roundtrip 降到 1 次 queryEdges + 内存 join                                                                                        |
| 5   | `proposer.HeuristicRelationProposer` levenshtein 长度差预筛                                           | `28bc9a9` | `Δlen > threshold` 直接跳过 O(L²) leven 调用,中文 1k 人样本约 99% 候选对被筛掉;dist=0 路径(完全同名)不受影响                                                                |
| 6   | `appendProgress` 原子 seqNo:INSERT...SELECT COALESCE(MAX+1)                                           | `93fd37a` | 单条 SQL 取号+插入,SQLite/PG 兼容;消除 select-then-insert race(异步驱动下经典问题)                                                                                          |
| 7   | Prometheus metrics `/api/metrics`(无 auth)+ 默认 Node 指标                                            | `d383a89` | combat_http_requests_total/duration_ms/in_flight + combat_db_queries_total + nodejs/process 默认 metrics;支撑 Grafana p99/error-rate 监控                                   |

**EXPLAIN 实测**(`scripts/bench-explain.mjs`):

```
EXPLAIN QUERY PLAN — queryNodesByProperty equivalent:
  {"detail":"SEARCH nodes USING INDEX idx_nodes_prop_status (nodeType=? AND <expr>=?)"}

EXPLAIN QUERY PLAN — queryNodes 全表扫:
  {"detail":"SCAN nodes"}
```

**Benchmark 实测**(`scripts/bench-queryNodes.mjs`,SQLite,本机):

| N      | queryNodes (filter) median | queryNodesByProperty median | speedup |
| ------ | -------------------------- | --------------------------- | ------- |
| 100    | 0.72 ms                    | 0.24 ms                     | 3.0×    |
| 1 000  | 3.53 ms                    | 0.69 ms                     | 5.1×    |
| 5 000  | 19.41 ms                   | 3.43 ms                     | 5.7×    |
| 10 000 | 39.53 ms                   | 7.99 ms                     | 4.9×    |

**实施纪律**:

- 7 个独立 commit + 每个 commit 立刻 push origin。
- baseline 463 backend tests → 477 全绿(+5 queryNodesByProperty +5 conflicts-incremental +4 metrics,无回归)。
- typecheck 双端均通过(backend + shared)。
- 新增 1 个 npm 依赖:`prom-client@15`(零 native binding,纯 JS)。
- 新增文档:`docs/PERFORMANCE_TUNING.md`(何时用哪个 API、metrics 解读)。
- SQLite 同步语义不动(better-sqlite3 单进程串行是 design),仅增加优化兼容。

### 性能 quick wins（2026-05-31 实施，分支 `feature/roadmap-performance`）

依 `docs/REVIEWS/REVIEW_performance.md` (4.0/10) 落地 5 项 P0,代码改动小、不引入新依赖:

| #   | 项                                                                                                  | commit    | 收益(预估)                                                                        |
| --- | --------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| 1   | `useSettings` 真缓存(module-level singleton + 5min TTL + 并发去重)                                  | `a4b40a5` | 13 callsite 重复 fetch → 1 次/5min,首屏少 12 个请求                               |
| 2   | `GET /api/health` 端点(无需鉴权,返回 `{status,uptime,version,db:{kind,connected}}`)                 | `e01c715` | systemd/反代/监控可探活,识别"进程在但 DB 断连"                                    |
| 3   | `conflicts.syncConflicts` 30s debounce(连续保存合并成 1 次扫描)                                     | `f7f6b56` | 10 次连续创建攻关单 audit 写放大 10-100× → 1×                                     |
| 4   | `backend.log` logrotate(daily/50MB/keep 7,copytruncate 不打断 systemd append)                       | `3fe00f3` | 防 append-only 撑爆磁盘,日志上限 ≤ 350MB                                          |
| 5   | Dashboard 5 次扫表 → 1 次内存聚合(`listConflictRows(repo, preloadedTickets)` 复用 + top-5 增量维护) | `1257a86` | 2 次 attackTicket 全表扫 + 2N 次 JSON.parse → 1 次 + N 次,10k 节点级 ~50% IO 削减 |

实施纪律:

- 每项独立 commit + 立刻 push。
- 改动前 baseline 347 tests pass;改动后 349 tests pass(+2 新增 health e2e),无回归。
- typecheck 双端均通过。
- 不动 SQLite Repository 同步 API(那是 Phase 2 大重构,本批不碰)。
- 不引入新 npm 依赖(logrotate 用宿主机系统工具)。

本会话新增/重构：审核管理移入系统管理（仅 admin 可访问 + AdminGuard）、攻关单成员多选 + 成员管理固定 tab（双向同步 攻关组长/攻关成员/成员列表）、自动「信息广场」自定义 tab、详情布局重构（面板默认收起、进展同步 Timeline 合并 progress + 过滤后审计：状态流转 green/升级 orange/合并 gold/成员变更 blue，删历史记录 tab，新增「合规追溯」侧边卡 leader+admin 可见）、AuditLog 支持 `?entityId=` 过滤、基础信息字段隐藏/恢复（按用户名 localStorage 持久化）、AI 助手浮窗可拖拽（DynamicCustomTab + HermesChat 都改造）、攻关单删除权限收紧（创建人本人，admin/leader 也不可见）。

> page-health.spec.ts:17 已豁免 `/api/nodes/{uuid}` 类型的 404（AuditLog 反查已删除节点是 benign，UI 显示「(已删除)」）。

### 历史测试状态（2026-05-29）本会话新增 Hermes agent 问答、灵活 Excel 导入、知识图谱可视化三大特性 + 多项增强(详见下节),并把上一轮残留的 12 个"历史抖动"用例**全部实证定位并清零**（均为真根因，非笼统时序抖动；此前误判为"满负载抖动"）：

> ⚠️ **数据累积抖动注意**:people/honor/help-center 等少数用例在**机器被并发重负载占用时**会因数据累积(DB 仅启动清一次)触发严格模式重复匹配而偶发失败;**干净机器跑全绿**。跑全量 e2e 时勿同时跑其它重任务(后端测试/构建/agent 冒烟)。

| 类           | 用例                                                    | 实证真根因                                                                                                                                                                                                                                                                                                       | 修复                                                                                     |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **配置污染** | 状态流转 ×5（lifecycle 4.2/4.5/6.2/6.3、regression:64） | `config-center.spec.ts:62` 盲点配置表**第一行**「编辑」改成「新值A/B/C」。全量下第一行恰是 `config:状态`（启动 `seedConfigFromSchemas` 从 alarmGovernance/告警治理跟踪 首次 seed）→ attackTicket 状态流转下拉读**共享全局 `config:状态` 键**，丢失"处理中"等。残留 DB `config:状态={新值A,新值B,新值C}` 为铁证。 | 改为精确编辑自建的 `e2eTestConfig` 行（仿 :89 删除用例 + 搜索过滤），不碰第一行          |
| **审计刷屏** | audit-log-extended :10/:86                              | E2E webServer 未设 `NODE_ENV=test` → 每次建/改单触发 `routes.ts` postSave 的 `syncConflicts` 全量重建 O(n²) 冲突边，海量「创建 关系」审计把目标节点 CREATE 挤出「最新 200 条」窗口（同文件带筛选的 :24/:46/:63 不受影响，反向印证）。                                                                            | `playwright.config.ts` 后端 env 加 `NODE_ENV=test`，激活 `routes.ts:20` 的 postSave 跳过 |
| **数据累积** | info-square:11                                          | 断言「暂无信息」空态，但全量下前序用例累积了 infoCard。                                                                                                                                                                                                                                                          | 断言前用 `page.request` GET `/api/nodes/infoCard` + 逐个 DELETE 再 reload                |
| **真实失效** | dynamic-tabs ×4（:82/:95/:227/:255）                    | `DynamicCustomTab` 编辑器默认折叠（`editorOpen=false`，commit 550b82e/accadba 的有意 UX），测试未点「展开编辑」即断言 Markdown 框——**隔离即复现，与负载无关**。                                                                                                                                                  | 4 用例断言/填写 Markdown 框前先点「展开编辑」                                            |

- 辅助加固：`e2e/helpers.ts` `pickOption` 先等下拉内任一 option 渲染再过滤目标 + 超时 4→5s / 重试 3→4 次（吸收 AntD 下拉 portal 渲染竞态）。
- 关键教训：**"隔离过、全量挂"未必是时序抖动**；配置/数据是整段 webServer 生命周期共享（DB 仅启动清一次），跨用例污染共享全局 key（如 `config:状态`）才是常见真因——务必查残留 DB / 失败快照取实证，勿臆测"负载抖动"。
- 上线特性：文档上传(原生 input + 拖拽区)、全局悬浮「截图反馈」(html2canvas 截当前页 + 记录链接)、问题反馈截图(拖拽 + Ctrl+V 粘贴 + 中文框)、console 捕获启动安装(修复「预览已捕获日志」恒空)、文档中心操作列防换行、攻关详情返回保留列表搜索/筛选(筛选入 URL + navigate(-1))。

**硬核发现（环境约束）**：受控/企业浏览器可在策略层禁用「系统文件选择对话框」(如 Chrome `AllowFileSelectionDialogs=Disabled`)，此时**任何**点击式文件上传(含原生 `<input type=file>`)都弹不出对话框、前端无法绕过；**拖拽上传 / Ctrl+V 粘贴 / html2canvas 截图**走的是非对话框通道，是这类环境下唯一可用的上传方式 —— 新增上传入口务必提供拖拽/粘贴兜底。

**（历史）团队贡献特性**

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
5. **部署** — `git add -A && git commit -m "fix: ..."` → `./dev-deploy.sh`
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

## 安全 P0 修复 (2026-05-31)

依据 `docs/REVIEWS/REVIEW_security.md`(OWASP 红蓝队评分 3/10)实施 P0 修复,
合并前总评 D 级,合并后核心鉴权链路达 C+。分支 `feature/roadmap-security`。

| #    | 漏洞                                                                                      | 文件                                                                                                         | commit  |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| P0-1 | 公开自注册任意提权                                                                        | `apps/backend/src/auth.ts:82-110`                                                                            | 9c87975 |
| P0-2 | JWT 默认硬编码 secret                                                                     | `apps/backend/src/auth.ts:8-43`                                                                              | f3915aa |
| P0-3 | X-Role 头由 localStorage 决定                                                             | `apps/backend/src/routes.ts:94-107`, `apps/frontend-v2/src/api.ts:146`                                       | 315828f |
| P0-4 | 敏感路由零守卫(merge/backup/email/op-log/audit/proposals/reminders/ticket-tabs/documents) | `apps/backend/src/auth.ts:270-318`, `apps/backend/src/app.ts:60-79`                                          | cbb2106 |
| P0-5 | rehypeRaw 存储型 XSS                                                                      | `apps/frontend-v2/src/components/DynamicCustomTab.tsx:157`, `apps/frontend-v2/src/pages/ManualCenter.tsx:62` | 4999208 |

### 关键设计点

- **JWT_SECRET 启动校验** (`auth.ts:resolveJwtSecret`):
  - production 未设置/等于默认串 → `process.exit(1)`
  - dev/test 未设置 → console.warn 但允许默认串(测试 bypass)
  - 部署 systemd Unit 必须 `EnvironmentFile=/etc/combat-v2.env` 注入 32+ 字节随机串

- **adminMiddleware/leaderMiddleware** (`auth.ts`):
  - `COMBAT_NO_AUTH=1` → 直放(保留 e2e bypass,348 测试全绿)
  - 无效 token → 401;角色不足 → 403 + audit log

- **挂载策略**:仅当 `deps.db` 存在且非 COMBAT_NO_AUTH 时挂载,
  无 db 的纯 e2e 单元测试(如 audit/reminders/email)继续 bypass

- **gradeGate 改造**:`req.headers["x-role"]` → `verifyAuth(req).role`,
  curl 伪造 `X-Role: admin` 不再奏效;前端 api.ts 同步移除 X-Role 头注入

- **rehypeRaw 移除**:`DynamicCustomTab` + `ManualCenter` 均不再渲染原始 HTML,
  markdown 内 `<script>` 等会作为字面量字符串显示。`highlightMd` 一并简化。

### 回归测试

- backend: 348/348 通过(基线一致)
- TypeScript: backend + frontend-v2 `tsc --noEmit` 均无报错
- 前端 e2e 因端口被占未跑,改在并入 master 前由 deploy 流水线验证

### 部署前必须做

1. 现网 systemd `combat-v2.service` 增加 `Environment=JWT_SECRET=<32+ 字节随机>`
   或 `EnvironmentFile=/etc/combat-v2.env`(600 权限,owner root)
2. 旋转 secret 同时所有现存 token 失效,通知现役账号重新登录
3. 前端 `localStorage.removeItem('combat-role')` (已无用,但避免缓存残留),
   清理后端日志中遗留的 X-Role 痕迹(`grep "x-role" /opt/combat-v2/backend.log`)

## 代码质量 P1 已实施 (v2.2)

`feature/roadmap-quality-p1` 分支完成 4 项质量重构(已 PR 入 master):

1. **AttackDetail.tsx 拆 6 子组件**(1823 → 327 行,目录 `apps/frontend-v2/src/pages/attackDetail/`):
   - 子组件:Header / BasicInfoTab / MembersTab / ProgressTimelineTab / DailyReportTab / SupportNetworkTab / Sidebar / Drawers
   - 自定义 hook:`useAttackDetailData`(数据)、`useAttackDetailHandlers`(交互)
   - builder:`buildTabItems.tsx`(tab 配置)
   - 新增 tab/字段类型应改子组件,不应触碰 page 文件
2. **ApiError 类型化 + 401 自动跳登录**:`api.ts` 抛 `ApiError`,`main.tsx` 注册 `onUnauthorized` 钩子,`utils/handleApiError.ts` 集中处理。新代码推荐 `catch (e) { handleApiError(e, '操作失败') }`。
3. **`makeRealSchemaTestApp` 单源**:merge/rbac/automation 测试不再各自重复 makeApp。
4. **前端 vitest 单测落地**:`apps/frontend-v2/src/__tests__/` 7 文件 54 tests,`test:frontend:unit` script,CI 已挂。

## 前端单测开发模式

- 测试文件位置:`apps/frontend-v2/src/__tests__/{api,components,hooks,utils}/*.test.{ts,tsx}`
- 跑测试:
  ```bash
  npm run test:frontend:unit          # 一次性运行
  cd apps/frontend-v2 && npm run test:watch  # 监听模式
  ```
- 框架:vitest + jsdom + @testing-library/react,jest-dom matcher 已在 `setup.ts` 全局注入
- mock 模块:`vi.mock('../../api.js', () => ({ ... }))` — 注意 vi.mock 会 hoist 到文件顶,如需引用外部变量用 `vi.hoisted({ ... })`
- 涉及 module-level 缓存的 hook(如 useSettings):用 `vi.resetModules()` + 动态 `import()` 在每个 test 拿到干净 module
- 跑前端 vitest 单测不需要后端启动,与 Playwright e2e 完全独立
