# Postgres 支持路线图

> 状态(2026-05-30 更新): **Phase 1 + Phase 3 CLI 工具 + Phase 3.5 UI 脚手架 完成**;Phase 2 (Repository async 化) 因体量过大尚未完成,仍是关键瓶颈。
>
> | 阶段 | 状态 |
> |------|------|
> | Phase 1 — 驱动工厂 + Drizzle schema + DB_URL 解析 | ✅ 完成 |
> | Phase 2 — Repository async 化 + 所有 router 改造 | ⏳ **未完成** (需专项 sprint,~80 处 callsite + 50+ 测试用例) |
> | Phase 3 — CLI 迁移工具 `scripts/migrate/sqlite-to-postgres.mjs` | ✅ 完成 |
> | Phase 3.5 — 一键迁移 UI (系统管理菜单) | ✅ 前端 + 后端 API 脚手架完成,**实际可用需 Phase 2 落地** |
> | Phase 4 — JSONB 优化 + GIN 索引 | ⏳ 待 Phase 2 后启动 |
>
> SQLite 路径回归测试 353/353 全绿。

## 当前能力 (Phase 1)

| 能力 | 状态 |
|------|------|
| `drizzle-orm` + `pg` + `drizzle-kit` 依赖 | 已装 |
| `apps/backend/src/schema.ts` 双方言 (sqliteSchema + postgresSchema) | 已写 |
| `parseDbUrl()` 协议解析 (sqlite:// / postgres:// / postgresql://) | 已实现 |
| `openDbFromUrl()` 工厂返回 tagged `DbHandle` | 已实现 |
| Postgres 连接池 + 自动 `CREATE TABLE IF NOT EXISTS` | 已实现 |
| Repository 调用 Postgres | **未实现** (Phase 2) |
| 后端测试 (347/347) 在 SQLite 下全绿 | 通过 |

## 当前限制

`Repository` 仍是 `SqliteRepository`,内部用 `better-sqlite3` 的**同步** API。
Postgres 驱动是**异步**的,所以 Phase 1 只让工厂能开 Postgres 连接 +
建表 — 任何业务调用走到 Repository 还是会走 SQLite。

如果你设了 `DB_URL=postgres://...`:

1. server.ts 会识别到 Postgres URL
2. 用 `openDbFromUrl()` 建好 pg.Pool 并执行 schema DDL
3. 但 Repository **依然使用 SQLite 兜底** (`COMBAT_DB_PATH` 或 `./combat.sqlite`)
4. 启动日志会打印 `server.postgres_phase1` 警告

未设环境变量 `COMBAT_POSTGRES_PHASE2=1` 时,`openDbFromUrl()` 会额外
打印 `db.postgres.phase1_stub` 警告,显式提示这是占位实现。

## 配置示例

### SQLite (默认 / 开发 / CI)

```bash
# 不设 DB_URL 即可。默认走 ./combat.sqlite
# 也可以继续用旧的 COMBAT_DB_PATH:
export COMBAT_DB_PATH=/opt/combat-v2/data/combat.sqlite

# 或者显式 sqlite:// URL:
export DB_URL=sqlite:///opt/combat-v2/data/combat.sqlite
export DB_URL=sqlite://./data/combat.db
export DB_URL=sqlite://combat.sqlite
```

### Postgres (Phase 1 仅基建,Phase 2 才真正可用)

```bash
export DB_URL=postgres://combat:secret@localhost:5432/combat
export DB_URL=postgresql://combat:secret@db.internal:5432/combat?sslmode=require

# 显式确认你知道 Phase 1 限制 (抑制 phase1_stub 警告)
export COMBAT_POSTGRES_PHASE2=1
```

## 开发者指引

- **本机开发**: 用 SQLite,不要设 `DB_URL`,行为与改造前完全一致。
- **CI / 测试**: 仅跑 SQLite,Postgres 集成测试留给 Phase 2。
- **生产 (现网)**: Phase 1 阶段继续用 SQLite,等 Phase 2 完成再切换。
- 调用方 (Repository, 路由文件等) **不感知** DB_URL 变化,Phase 1 是非破坏式扩展。

## 路标

### Phase 2 — Repository async 化 (下一步)

让 Postgres 真正可用,核心工作:

| 文件 | 改动 |
|------|------|
| `apps/backend/src/repository.ts` | 拆出 `interface Repository`,实现 `SqliteRepository` (sync 同步包装) 和 `PostgresRepository` (drizzle 异步) |
| `apps/backend/src/db.ts` | `DbHandle` 加 Repository 工厂 |
| `apps/backend/src/server.ts` | 用 `DbHandle.kind` 决定 Repository 实现 |
| 所有路由文件 | `repo.create(...)` 等方法签名改为 `Promise<>`,handler 加 `await` |
| `apps/backend/test/helpers.ts` | `makeTestApp()` 暴露同步 + 异步两套 |
| 所有 `test/*.e2e.test.ts` | 视情况加 `await`,Supertest 调用本来就是 async,影响较小 |

主要 callsite (Phase 2 直接对接的几个文件):

- `apps/backend/src/repository.ts` (核心)
- `apps/backend/src/routes.ts` (主路由,几十个 handler)
- `apps/backend/src/app.ts` (createApp 注入)
- `apps/backend/src/server.ts` (启动入口)
- `apps/backend/src/auth.ts` + 所有 `make*Router(db)` 工厂 (这些直接吃 sqlite DB,需要换成 async query helper)

### Phase 3 — Postgres 集成测试 + CI + 数据迁移工具

- 引入 testcontainers 或 docker compose 跑临时 PG
- 测试套件并行跑 SQLite + Postgres 双驱动
- 部署脚本支持 PG 凭证
- **新增:CLI 工具 `npm run cli -- db:migrate-sqlite-to-postgres --target <pg-url>`**
  - 读 SQLite 现有数据 → 串行批量 INSERT 到 Postgres
  - 全表事务 + 进度打印 + 失败回滚
  - dry-run 模式预检表/列对齐
  - 完成后写一个 \`.migrated\` 标记文件,供 UI 检测

### Phase 3.5 — 一键迁移 UI (系统管理菜单)

用户需求:**SQLite 一直用着,某天想切 Postgres,从 UI 一键完成,不动 CLI**。

- 系统管理菜单新增「**数据库迁移**」子项 (仅 admin 可见,类似 用户管理/操作追踪)
- 页面 \`/db-migration\` 三段:
  1. **现状卡**:当前 \`DB_URL\` / 数据量统计(每张表行数) / 上次迁移记录
  2. **目标连接表单**:Postgres host/port/database/user/password (或直接粘贴完整 URL);点「测试连接」先验证
  3. **执行迁移**:
     - 倒计时停服窗口 (默认 30s,可调,期间禁止业务写入)
     - 进度条按表显示 (nodes 3271/5040 ...)
     - 失败实时报错,**可中断回滚**(回到 SQLite,不改 \`DB_URL\`)
     - 完成后自动:① 更新 \`DB_URL\` env (写持久化的 \`.env\`/systemd drop-in)② 重启 backend ③ 健康检查 ④ 标记 \`.migrated\` ⑤ 提示用户「迁移完成,SQLite 备份在 ./data/combat.db.pre-pg-<timestamp>」
- 后端 HTTP API: \`POST /api/db-migration/check\` / \`POST /api/db-migration/run\` (server-sent events 推进度);本质包装 Phase 3 的 CLI
- **前置条件**:Phase 2 + Phase 3 全绿 (Postgres 真能服务业务),否则迁移完是空壳

### Phase 4 — properties 列升级 JSONB + 索引优化

- `properties` 从 TEXT 改 JSONB,支持 GIN 索引
- 改写依赖 `json_each()` 的 SQLite-only 查询为方言中立
- KG 派生数据迁移

## 相关文件

- `apps/backend/src/db.ts` — 工厂 + DDL
- `apps/backend/src/schema.ts` — Drizzle schema-as-code
- `apps/backend/src/db-adapter.ts` — DbAdapter 异步接口(Phase 2 备料,SQLite 同步包装 + Postgres 真异步)
- `apps/backend/src/db-migration.ts` — Phase 3.5 一键迁移路由(status / test-connection / run)
- `apps/backend/test/db-url.unit.test.ts` — parseDbUrl 单元测试
- `scripts/migrate/sqlite-to-postgres.mjs` — Phase 3 CLI 迁移工具(批量 INSERT + 事务 + 进度 + 标记文件)
- `apps/frontend-v2/src/pages/DbMigration.tsx` — 一键迁移 UI(系统管理 → 数据库迁移,仅 admin)

## CLI 工具用法

```bash
# 试运行,只统计行数不写入
node scripts/migrate/sqlite-to-postgres.mjs \
  --sqlite ./data/combat.sqlite \
  --postgres postgresql://combat:secret@localhost:5432/combat \
  --dry-run

# 正式迁移(目标 PG 端必须已通过 DB_URL=postgres://... 启动过一次 backend 让它建表)
node scripts/migrate/sqlite-to-postgres.mjs \
  --sqlite ./data/combat.sqlite \
  --postgres postgresql://combat:secret@localhost:5432/combat

# 想清空目标表再写(危险):加 --truncate
```

完成后会写 `<sqlitePath>.migrated-to-postgres` 标记文件,UI status 页会显示「上次迁移于 ...」。

## UI 用法

登录 admin → **系统管理 → 数据库迁移** → 看当前驱动 / 总行数 → 填 PG 连接串 → 测试连接 → 试运行 → 正式迁移。

UI 后端调用 `scripts/migrate/sqlite-to-postgres.mjs` 子进程,事务级别一致;前端用普通 POST 阻塞返回(后续可改 SSE 推进度)。
