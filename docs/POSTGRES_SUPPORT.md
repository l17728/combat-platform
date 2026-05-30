# Postgres 支持路线图

> 状态: **Phase 1 已完成** — 仅搭基建,SQLite 仍是默认且全部测试通过。
> Postgres 真正能跑起来要等 Phase 2 的 Repository async 化。

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

### Phase 3 — Postgres 集成测试 + CI

- 引入 testcontainers 或 docker compose 跑临时 PG
- 测试套件并行跑 SQLite + Postgres 双驱动
- 部署脚本支持 PG 凭证

### Phase 4 — properties 列升级 JSONB + 索引优化

- `properties` 从 TEXT 改 JSONB,支持 GIN 索引
- 改写依赖 `json_each()` 的 SQLite-only 查询为方言中立
- KG 派生数据迁移

## 相关文件

- `apps/backend/src/db.ts` — 工厂 + DDL
- `apps/backend/src/schema.ts` — Drizzle schema-as-code
- `apps/backend/test/db-url.unit.test.ts` — parseDbUrl 单元测试
