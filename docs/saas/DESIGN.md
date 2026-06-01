# 作战管理平台 SaaS 多租户架构设计

> 版本: v3.0 Draft | 日期: 2026-06-01
> 基线分支: `dev` (v2.3.10) → 新分支: `saas`

## 1. 目标与背景

当前系统是单租户架构——一个部署实例服务一个组织。需要演进为多租户 SaaS，支持：

- **平台运营方**管理多个租户（团队/组织）
- 每个租户数据**完全隔离**，互不可见
- 一个特殊的 **guest 共享租户**，供临时访客体验
- 现有单租户部署**向后兼容**，通过环境变量切换模式

### 1.1 三类角色

| 层级   | 角色                        | 范围   | 典型操作                                     |
| ------ | --------------------------- | ------ | -------------------------------------------- |
| 平台层 | superadmin                  | 全平台 | 管理租户 CRUD、平台统计、计费、暂停/恢复租户 |
| 租户层 | tenant admin                | 本租户 | 管理用户、配置中心、Schema、邮件、备份       |
| 租户层 | tenant user (leader/normal) | 本租户 | 攻关单 CRUD、人员、贡献、荣誉                |

### 1.2 设计原则

1. **数据隔离优先**——所有查询必须带 `tenant_id`，中间件自动注入
2. **零破坏迁移**——现有数据归入 `default` 租户，单租户模式继续可用
3. **环境变量开关**——`SAAS_MODE=1` 启用多租户，不设则走原逻辑
4. **Postgres 推荐**——多租户下写入更频繁，生产建议用 Postgres

---

## 2. 多租户数据模型

### 2.1 新增 `tenants` 表

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',       -- free / pro / enterprise
  status TEXT NOT NULL DEFAULT 'active',    -- active / suspended
  max_users INTEGER NOT NULL DEFAULT 50,
  settings TEXT DEFAULT '{}',               -- 租户级配置 (JSON)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 2.2 现有表新增 `tenant_id`

以下表需要新增 `tenant_id TEXT NOT NULL DEFAULT 'default'` 列：

| 表名                    | 说明                         |
| ----------------------- | ---------------------------- |
| `users`                 | 用户归属租户                 |
| `nodes`                 | 攻关单、人员、贡献等所有节点 |
| `edges`                 | 关系边                       |
| `progress_log`          | 进展记录                     |
| `audit_log`             | 审计日志                     |
| `wiki_articles`         | 知识库文章                   |
| `bug_reports`           | 问题反馈                     |
| `help_requests`         | 求助记录                     |
| `ticket_tabs`           | 自定义标签页                 |
| `support_node`          | 资源变动追踪                 |
| `webhook_subscriptions` | Webhook 订阅                 |
| `digest_config`         | 邮件摘要配置                 |
| `invitations`           | 邀请码                       |
| `op_logs`               | 操作日志                     |
| `app_settings`          | 配置中心                     |
| `ticket_tab_dynamic`    | 动态标签内容                 |

### 2.3 索引策略

每个业务表新增联合索引（tenant_id 在前）：

```sql
CREATE INDEX idx_nodes_tenant ON nodes(tenant_id, nodeType);
CREATE INDEX idx_edges_tenant ON edges(tenant_id);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
-- ... 其余表同理
```

### 2.4 Guest 租户

- `tenant_id = "guest"`，在 `tenants` 表中预创建
- 所有游客用户自动关联到此租户
- 无身份区分——任何 guest 都能 CRUD guest 租户内的数据
- 系统管理页面**只读**（仅 guest 租户自身数据）
- guest 数据可定期清理（cron job）

### 2.5 正常租户

- 每个注册组织一个 tenant
- 租户 admin 管理本租户用户、配置中心、Schema、邮件
- 数据受保护，只有同租户用户可见
- 租户间完全隔离

---

## 3. 认证与权限改造

### 3.1 JWT Payload 扩展

```typescript
interface JwtPayload {
  userId: string;
  username: string;
  role: string; // superadmin / admin / leader / normal
  tenantId: string; // 新增
}
```

### 3.2 租户隔离中间件

```typescript
function tenantMiddleware(req, res, next) {
  const payload = verifyAuth(req);
  req.tenantId = payload.tenantId;
  req.isSuperAdmin = payload.role === "superadmin";
  next();
}
```

### 3.3 Repository 改造

所有 Repository 方法签名变更——第一个参数变为 `tenantId`：

```typescript
// Before
queryNodes(nodeType: string, filters?: QueryFilter): Node[]
// After
queryNodes(tenantId: string, nodeType: string, filters?: QueryFilter): Node[]
```

中间件从 `req.tenantId` 取值，传入 Repository 调用。所有 SQL 查询自动追加 `WHERE tenant_id = ?`。

### 3.4 SuperAdmin 权限

- SuperAdmin 请求**不加** tenant_id 过滤，可查看全平台数据
- SuperAdmin 仅在 `/api/platform/*` 路由下生效
- 业务路由（`/api/nodes/*` 等）仍需 tenant_id

---

## 4. API 改造

### 4.1 现有 API 自动隔离

所有 `/api/*` 路由经过 `tenantMiddleware`：

```
GET  /api/nodes/:nodeType     → WHERE tenant_id = req.tenantId
POST /api/nodes/:nodeType     → INSERT with tenant_id = req.tenantId
GET  /api/audit               → WHERE tenant_id = req.tenantId
POST /api/wiki                → INSERT with tenant_id = req.tenantId
```

### 4.2 新增平台管理 API

| 端点                                | 方法 | 说明                               |
| ----------------------------------- | ---- | ---------------------------------- |
| `/api/platform/tenants`             | GET  | 列出所有租户                       |
| `/api/platform/tenants`             | POST | 创建租户                           |
| `/api/platform/tenants/:id`         | GET  | 租户详情                           |
| `/api/platform/tenants/:id`         | PUT  | 更新租户（名称/配额/状态）         |
| `/api/platform/tenants/:id/suspend` | PUT  | 暂停租户                           |
| `/api/platform/tenants/:id/restore` | PUT  | 恢复租户                           |
| `/api/platform/stats`               | GET  | 平台级统计（租户数/用户数/资源量） |

全部需要 `superadminMiddleware` 守卫。

### 4.3 注册流程改造

```typescript
// 新租户注册
POST /api/auth/register
{
  username: "admin",
  password: "xxx",
  displayName: "张三",
  tenantName: "XX团队",        // 新增
  tenantSlug: "xx-team"        // 新增
}
// → 创建 tenant + 创建 admin 用户 + 关联

// 加入已有租户（通过邀请链接）
POST /api/auth/register
{
  username: "user1",
  password: "xxx",
  inviteCode: "ABC123"          // 邀请码自动关联租户
}
```

---

## 5. 前端改造

### 5.1 路由调整

```
/platform              → PlatformAdmin 页面（superadmin only）
/platform/tenants      → 租户列表
/platform/tenants/:id  → 租户详情
/platform/stats        → 平台统计
其余路由不变，API 自动带租户上下文
```

### 5.2 登录页改造

- 新增**租户选择**（下拉或子域名识别）
- 或: 通过邀请/注册链接自动关联租户
- SuperAdmin 有独立的平台管理入口

### 5.3 注册流程

两种模式：

1. **创建新租户** — 注册时填写团队名，自动创建租户 + admin 用户
2. **加入已有租户** — 通过邀请链接注册，自动关联到对应租户

### 5.4 侧边栏

- SuperAdmin 额外看到「平台管理」菜单组
- 普通用户无感知，一切照旧

---

## 6. 数据库迁移方案

### 6.1 迁移脚本

```bash
node scripts/migrate/to-saas.mjs --db /path/to/combat.sqlite
```

步骤：

1. 创建 `tenants` 表
2. 插入默认租户: `INSERT INTO tenants (id, name, slug) VALUES ('default', '默认租户', 'default')`
3. 所有业务表 `ALTER TABLE ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`
4. 创建索引
5. 现有用户 `UPDATE users SET tenant_id = 'default'`

### 6.2 回滚方案

迁移前自动备份 DB。回滚脚本删除 `tenant_id` 列和 `tenants` 表。

### 6.3 双模式兼容

```typescript
// 环境变量控制
const SAAS_MODE = process.env.SAAS_MODE === "1";

// Repository 查询自动适配
if (SAAS_MODE) {
  sql += " AND tenant_id = ?";
  params.push(tenantId);
}
// 单租户模式不加 tenant_id 过滤，行为不变
```

---

## 7. 实施阶段

| 阶段                      | 周期 | 交付物                                                       | 依赖    |
| ------------------------- | ---- | ------------------------------------------------------------ | ------- |
| **Phase 0: 准备**         | 1 周 | DDL + 迁移脚本 + `SAAS_MODE` 开关 + 双模式 Repository        | 无      |
| **Phase 1: 多租户核心**   | 2 周 | tenants 表 + 租户隔离中间件 + Repository 全量改造 + 后端测试 | Phase 0 |
| **Phase 2: 平台管理**     | 1 周 | `/platform` UI + 租户 CRUD + 平台统计 + SuperAdmin 守卫      | Phase 1 |
| **Phase 3: 注册 & Guest** | 1 周 | 新租户注册 + 邀请注册 + Guest 租户 + 公开体验入口            | Phase 2 |
| **Phase 4: 计费 & 高级**  | 1 周 | 计划配额 + 用量统计 + 自动清理 Guest 数据                    | Phase 3 |

### Phase 0 详细任务

1. `tenants` DDL (SQLite + Postgres)
2. `scripts/migrate/to-saas.mjs` 迁移脚本
3. `SAAS_MODE` 环境变量 + `db.ts` 条件建表
4. Repository `queryNodes` 等方法签名扩展（可选 tenantId 参数）
5. 后端测试确认双模式兼容（790 + 新增多租户用例）

### Phase 1 详细任务

1. `tenantMiddleware` 中间件
2. `app.ts` 条件挂载中间件
3. 全量 Repository 方法改造（~30 个方法加 tenantId 参数）
4. 所有 router 调用点适配
5. 后端测试全量更新

### Phase 2 详细任务

1. `platform-router.ts` — 平台管理 API
2. `PlatformAdmin.tsx` — 租户列表页
3. `TenantDetail.tsx` — 租户详情页
4. 侧边栏增加「平台管理」菜单
5. SuperAdmin 认证 + 权限守卫

### Phase 3 详细任务

1. 注册流程改造（创建租户 / 加入租户）
2. Guest 租户预创建 + 自动关联
3. 公开体验入口（无需注册直接用 Guest）
4. Guest 数据定期清理 cron

---

## 8. 风险与缓解

| 风险                | 影响                   | 缓解措施                                |
| ------------------- | ---------------------- | --------------------------------------- |
| SQLite 并发写入瓶颈 | 多租户写入频繁时锁竞争 | 生产推荐 Postgres；开发用 SQLite        |
| 迁移不可逆          | 数据结构变更           | 自动备份 + 回滚脚本 + 先在 staging 验证 |
| 查询性能下降        | 所有查询加 tenant_id   | 联合索引覆盖；EXPLAIN 验证              |
| 租户间数据泄露      | 严重安全事故           | 中间件强制注入；代码审查 + 渗透测试     |
| 单租户回归          | 破坏现有部署           | 双模式开关；CI 同时跑单租户/多租户测试  |

---

## 9. 文件变更清单（预估）

### 后端新增

| 文件                                    | 说明           |
| --------------------------------------- | -------------- |
| `apps/backend/src/tenant-middleware.ts` | 租户隔离中间件 |
| `apps/backend/src/platform-router.ts`   | 平台管理 API   |
| `scripts/migrate/to-saas.mjs`           | 迁移脚本       |

### 后端修改

| 文件                             | 改动                                       |
| -------------------------------- | ------------------------------------------ |
| `apps/backend/src/db.ts`         | tenants DDL + SAAS_MODE 条件建表           |
| `apps/backend/src/auth.ts`       | JWT payload 扩展 + 注册流程改造            |
| `apps/backend/src/repository.ts` | 所有方法加 tenantId 参数                   |
| `apps/backend/src/routes.ts`     | 调用点适配 tenantId                        |
| `apps/backend/src/app.ts`        | 条件挂载 tenantMiddleware + platformRouter |
| 其他 router 文件 (~10个)         | 调用点适配                                 |

### 前端新增

| 文件                          | 说明       |
| ----------------------------- | ---------- |
| `src/pages/PlatformAdmin.tsx` | 租户管理页 |
| `src/pages/TenantDetail.tsx`  | 租户详情页 |

### 前端修改

| 文件                        | 改动                  |
| --------------------------- | --------------------- |
| `src/api.ts`                | 新增平台管理 API 方法 |
| `src/hooks/useAuth.tsx`     | tenantId 上下文       |
| `src/pages/LoginPage.tsx`   | 租户选择 / 注册流程   |
| `src/layouts/AppLayout.tsx` | 平台管理菜单          |
| `src/App.tsx`               | /platform 路由        |

---

## 10. 测试策略

- **单元测试**：Repository 双模式（单租户/多租户）对比验证
- **集成测试**：多租户隔离——租户 A 的数据对租户 B 不可见
- **E2E 测试**：平台管理 CRUD + 租户注册 + Guest 体验流程
- **迁移测试**：单租户 DB → 多租户迁移 → 数据完整性验证
- **性能测试**：10 租户 × 1000 节点，查询响应 < 50ms
