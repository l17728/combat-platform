# SaaS Phase 1 详细待办清单

> 分支: `saas` | 创建日期: 2026-06-02 | 预估工作量: 8-12h
> 前置条件: Phase 0 已完成 (commit `28a98a7`)
> 设计文档: [DESIGN.md](./DESIGN.md)

## 当前状态

| 阶段                                       | 状态          | Commit    |
| ------------------------------------------ | ------------- | --------- |
| Phase 0: 准备 (DDL + 迁移 + Auth + 中间件) | ✅ 已完成     | `28a98a7` |
| **Phase 1: 多租户核心**                    | 🔲 **未开始** | —         |
| Phase 2: 平台管理 UI                       | 🔲 未开始     | —         |
| Phase 3: 注册 & Guest                      | 🔲 未开始     | —         |
| Phase 4: 计费 & 高级                       | 🔲 未开始     | —         |

## Phase 0 已交付明细

- [x] `tenants` 表 DDL (SQLite + Postgres) — `db.ts`
- [x] 16 个业务表自动加 `tenant_id` 列 — `db.ts migrateSqlite()`
- [x] `tenant-middleware.ts` — SAAS_MODE 开关 + `tenantMiddleware` + `ensureDefaultTenant`
- [x] JWT payload 扩展 — `auth.ts` JwtPayload/AuthUser 加 `tenantId`
- [x] `app.ts` 条件挂载中间件
- [x] 迁移脚本 — `scripts/migrate/to-saas.mjs`
- [x] 790/790 后端测试全绿

---

## Phase 1 总览

**目标**: 让所有数据查询在 SAAS_MODE=1 时自动按 `tenant_id` 隔离，单租户模式 (不设 SAAS_MODE) 行为不变。

**核心原则**:

1. **只改数据层** — Repository + 独立 Repo 类，不改业务逻辑
2. **乐观策略** — `getNode(id)` 不加 tenant_id 过滤（跨租户链接场景），但 `queryNodes`/`listXxx` 必须过滤
3. **零回归** — 单租户模式所有现有测试必须 100% 通过

---

## Step 1: Repository 核心方法改造 (预估 3h)

**文件**: `apps/backend/src/repository.ts` (586 行, 26 个公开方法)

### 1.1 Node CRUD (6 个方法)

| #   | 方法                                         | 改造方式                                   | SQL 影响                             |
| --- | -------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| 1   | `createNode(nodeType, properties, actor)`    | INSERT 加 `tenant_id` 列                   | `INSERT INTO nodes ... tenant_id`    |
| 2   | `getNode(id)`                                | **不改** (跨租户 edge 引用需要)            | —                                    |
| 3   | `updateNode(id, patch, actor)`               | **不改** (已通过 id 定位)                  | —                                    |
| 4   | `queryNodes(nodeType, filter?)`              | WHERE 加 `tenant_id = ?`                   | `WHERE "nodeType"=? AND tenant_id=?` |
| 5   | `queryNodesByProperty(nodeType, key, value)` | WHERE 加 `tenant_id = ?`                   | 同上                                 |
| 6   | `deleteNode(id, actor)`                      | **不改** (已通过 id 定位,级联删除不跨租户) | —                                    |

### 1.2 Edge CRUD (4 个方法)

| #   | 方法                                                     | 改造方式                                 |
| --- | -------------------------------------------------------- | ---------------------------------------- |
| 7   | `createEdge(sourceId, targetId, edgeType, props, actor)` | **不改** (源/目标节点已有 tenant_id)     |
| 8   | `queryEdges(opts)`                                       | 加 tenant_id 过滤: `WHERE tenant_id = ?` |
| 9   | `deleteEdges(opts, actor)`                               | 加 tenant_id 过滤 (防止跨租户删除)       |
| 10  | `deleteEdgeById(id, actor)`                              | **不改** (已通过 id 定位)                |

### 1.3 Progress Log (3 个方法)

| #   | 方法                                              | 改造方式                    |
| --- | ------------------------------------------------- | --------------------------- |
| 11  | `appendProgress(ownerId, content, status, actor)` | **不改** (ownerId 隐含租户) |
| 12  | `listProgress(ownerId)`                           | **不改** (ownerId 隐含租户) |
| 13  | `listAllProgress()`                               | 加 tenant_id 过滤           |

### 1.4 Audit Log (2 个方法)

| #   | 方法                   | 改造方式                 |
| --- | ---------------------- | ------------------------ |
| 14  | `logAudit(...)`        | INSERT 加 `tenant_id`    |
| 15  | `listAuditLog(filter)` | WHERE 加 `tenant_id = ?` |

### 1.5 Settings (2 个方法)

| #   | 方法                            | 改造方式                 |
| --- | ------------------------------- | ------------------------ |
| 16  | `getSetting(key)`               | WHERE 加 `tenant_id = ?` |
| 17  | `setSetting(key, value, actor)` | UPSERT 加 `tenant_id`    |

### 1.6 Proposals (4 个方法)

| #   | 方法                        | 改造方式                 |
| --- | --------------------------- | ------------------------ |
| 18  | `createProposal(...)`       | INSERT 加 `tenant_id`    |
| 19  | `listProposals(opts)`       | WHERE 加 `tenant_id = ?` |
| 20  | `getProposal(id)`           | **不改**                 |
| 21  | `updateProposalStatus(...)` | **不改**                 |

### 1.7 Reminders / Notifications (6 个方法)

| #   | 方法                                                                         | 改造方式                 |
| --- | ---------------------------------------------------------------------------- | ------------------------ |
| 22  | `createReminder(...)`                                                        | INSERT 加 `tenant_id`    |
| 23  | `listReminders(opts)`                                                        | WHERE 加 `tenant_id = ?` |
| 24  | `getReminder(id)`                                                            | **不改**                 |
| 25  | `updateReminderStatus(...)`                                                  | **不改**                 |
| 26  | `createNotification(...)` / `listNotifications` / `updateNotificationStatus` | 同上模式                 |

### 实现策略

```typescript
// 方案 A: 方法签名加可选参数 (向后兼容)
async queryNodes(nodeType: string, filter?: NodeFilter, tenantId?: string): Promise<GraphNode[]> {
  const sql = tenantId
    ? `SELECT * FROM nodes WHERE "nodeType" = ? AND tenant_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM nodes WHERE "nodeType" = ? ORDER BY created_at DESC`;
  const params = tenantId ? [nodeType, tenantId] : [nodeType];
  // ...
}

// 方案 B: 构造时传入 tenantId (更干净,但改动更大)
class Repository {
  constructor(private adapter: DbAdapter, private tenantId?: string) {}
  // 所有方法内部用 this.tenantId
}
```

**推荐方案 A** — 改动最小,向后兼容。tenantId 从 router 层的 `req.tenantId` 透传。

---

## Step 2: 独立 Repo 类改造 (预估 2h)

以下模块各自管理独立表（不走 Repository），需要同样加 tenant_id 过滤：

| #   | 文件                    | 表                            | 方法数 | 改造点                                               |
| --- | ----------------------- | ----------------------------- | ------ | ---------------------------------------------------- |
| 1   | `wiki.ts`               | `wiki_articles`               | ~8     | list/create/update/delete/search/reorder 加 tenantId |
| 2   | `help-request.ts`       | `help_requests`               | ~4     | list/create/get/update 加 tenantId                   |
| 3   | `bug-report.ts`         | `bug_reports`                 | ~4     | list/create/update 加 tenantId                       |
| 4   | `op-log.ts`             | `op_logs`                     | ~4     | list/create/delete/settings 加 tenantId              |
| 5   | `webhooks.ts`           | `webhook_subscriptions`       | ~5     | CRUD + dispatch 加 tenantId                          |
| 6   | `digest.ts`             | `digest_configs`              | ~4     | CRUD 加 tenantId                                     |
| 7   | `invitation.ts`         | `invitations`                 | ~4     | CRUD 加 tenantId                                     |
| 8   | `ticket-tabs.ts`        | `ticket_tabs`                 | ~5     | CRUD + reorder 加 tenantId                           |
| 9   | `documents.ts`          | `documents`                   | ~4     | CRUD 加 tenantId                                     |
| 10  | `settings.ts`           | `app_settings`                | ~2     | 与 Repository.getSetting/setSetting 统一             |
| 11  | `notifications.ts`      | `notifications`               | ~3     | 已在 Repository 中,但直接 SQL 的地方需适配           |
| 12  | `support-node.ts`       | `support_nodes`               | ~4     | CRUD 加 tenantId                                     |
| 13  | `daily-report-entry.ts` | `daily_report_entries`        | ~4     | CRUD 加 tenantId                                     |
| 14  | `llm-settings.ts`       | `llm_settings`                | ~3     | CRUD 加 tenantId                                     |
| 15  | `hermes-sessions.ts`    | `hermes_sessions`             | ~4     | CRUD 加 tenantId                                     |
| 16  | `welink.ts`             | `welink_messages/extractions` | ~6     | CRUD 加 tenantId                                     |

---

## Step 3: Router 层适配 (预估 3h)

**48 个 router/模块文件**调用 Repository / 独立 Repo。每个文件的改造模式相同：

```typescript
// Before
router.get("/nodes/:nodeType", async (req, res) => {
  const nodes = await repo.queryNodes(req.params.nodeType);
  res.json(nodes);
});

// After
router.get("/nodes/:nodeType", async (req, res) => {
  const tenantId = (req as TenantReq).tenantId; // undefined when SAAS_MODE off
  const nodes = await repo.queryNodes(req.params.nodeType, undefined, tenantId);
  res.json(nodes);
});
```

### 高频文件 (改动量大,优先处理)

| 优先级 | 文件                      | 调用次数 | 说明                               |
| ------ | ------------------------- | -------- | ---------------------------------- |
| P0     | `routes.ts`               | ~30+     | 通用节点 CRUD,所有 nodeType 走这里 |
| P0     | `query.ts`                | ~10      | 搜索/筛选/汇总                     |
| P0     | `graph.ts`                | ~8       | KG 图谱构建                        |
| P1     | `dashboard.ts`            | ~6       | 仪表盘聚合                         |
| P1     | `conflicts.ts`            | ~5       | 冲突检测                           |
| P1     | `proposer.ts`             | ~5       | 关系推荐                           |
| P1     | `honor.ts`                | ~4       | 荣誉排行                           |
| P1     | `recommend.ts`            | ~4       | 找帮手推荐                         |
| P1     | `import.ts` / `export.ts` | ~3 each  | 导入导出                           |
| P2     | 其余 ~30 个文件           | 1-3 each | 逐个适配                           |

### 适配策略

1. **P0 文件逐个改** — 手动适配每个 repo 调用,确保 tenantId 透传
2. **P1/P2 批量处理** — 用 grep 找出所有 `repo.queryNodes(`/`repo.queryEdges(`/`repo.listXxx(` 调用,批量加 tenantId 参数
3. **不改业务逻辑** — 只改数据层调用签名,不改 if/else 分支

---

## Step 4: 测试验证 (预估 2h)

### 4.1 单租户回归 (必须 100% 通过)

```bash
# 不设 SAAS_MODE,所有现有测试不变
npm run test:backend
# 期望: 790/790 pass
```

### 4.2 多租户隔离测试 (新增)

```typescript
// test/saas-isolation.test.ts
describe("SaaS tenant isolation", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    // 创建两个租户
    tenantA = "tenant-a";
    tenantB = "tenant-b";
  });

  it("tenant A cannot see tenant B's nodes", async () => {
    await repo.createNode("attackTicket", { 标题: "A的工单" }, "userA", tenantA);
    await repo.createNode("attackTicket", { 标题: "B的工单" }, "userB", tenantB);

    const aNodes = await repo.queryNodes("attackTicket", undefined, tenantA);
    const bNodes = await repo.queryNodes("attackTicket", undefined, tenantB);

    expect(aNodes).toHaveLength(1);
    expect(aNodes[0].properties.标题).toBe("A的工单");
    expect(bNodes).toHaveLength(1);
    expect(bNodes[0].properties.标题).toBe("B的工单");
  });

  it("tenant A cannot delete tenant B's edges", async () => {
    /* ... */
  });
  it("tenant A's audit log does not leak to tenant B", async () => {
    /* ... */
  });
  it("wiki articles are isolated per tenant", async () => {
    /* ... */
  });
  // ... 覆盖所有独立 Repo
});
```

### 4.3 测试矩阵

| 模式   | SAAS_MODE | 测试数   | 期望                 |
| ------ | --------- | -------- | -------------------- |
| 单租户 | 未设      | 790      | 100% pass (零回归)   |
| 多租户 | =1        | ~30 新增 | 100% pass (隔离验证) |

---

## Step 5: 部署 & 验证 (预估 1h)

1. `SAAS_MODE` 不设 → 单租户部署,行为与现网完全一致
2. `SAAS_MODE=1` → 多租户模式,默认所有数据归 `default` 租户
3. 现网验证: 登录 → 数据可见 → 创建/编辑 → 确认 tenant_id 正确写入

---

## 风险与缓解

| 风险                            | 概率 | 影响     | 缓解                                             |
| ------------------------------- | ---- | -------- | ------------------------------------------------ |
| 遗漏某个 repo 调用未加 tenantId | 高   | 数据泄露 | grep 全扫 + 多租户测试覆盖                       |
| 单租户模式回归                  | 低   | 现网故障 | SAAS_MODE 未设时 tenantId=undefined,SQL 条件跳过 |
| getNode(id) 跨租户访问          | 中   | 信息泄露 | Phase 1.5 加 ownership 校验                      |
| 性能下降 (每查询多一个 WHERE)   | 低   | <5%      | tenant_id 已有索引 (Phase 0 已建)                |

---

## 提交计划

| Commit | 内容                                                 | 测试            |
| ------ | ---------------------------------------------------- | --------------- |
| 1      | Repository 核心 26 方法加 tenantId 可选参数          | 单租户 790 pass |
| 2      | 独立 Repo 类 (wiki/help/bug/op-log/webhook 等 16 个) | 单租户 790 pass |
| 3      | Router 层 P0 适配 (routes/query/graph)               | 单租户 790 pass |
| 4      | Router 层 P1+P2 适配 (剩余 ~44 文件)                 | 单租户 790 pass |
| 5      | 多租户隔离测试 (~30 用例)                            | 双模式 pass     |

---

## Phase 1 完成定义

- [ ] Repository 26 方法支持可选 tenantId 参数
- [ ] 16 个独立 Repo 类支持可选 tenantId
- [ ] 48 个 router 文件全部适配
- [ ] 单租户模式: 790/790 测试全绿 (零回归)
- [ ] 多租户模式: ~30 新增隔离测试全绿
- [ ] `SAAS_MODE=1` 部署验证通过
- [ ] PHASE1_TODO.md 所有项打勾
