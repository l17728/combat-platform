# 作战管理工具 — 技术设计文档

> 本文档面向二次开发者。读者应能在不阅读源码的情况下理解整个系统的设计决策、数据模型和接口规范。文档中的「代码位置」标注格式为 `文件路径:大致行号`，方便开发者顺藤摸瓜定位代码。

---

## 1. 产品概述与核心价值

**作战管理工具**是华为云 ModelArts 运营团队的日常运维协作平台，核心解决以下问题：

1. **跨视图关联**：同一事件（攻关单、变更单、告警）散落在多张 Excel 表里，人工查找费力；
2. **进展追踪**：攻关单状态变更需要可追溯的时间线，不能只存最新状态；
3. **智能问答**：通过自然语言问 "谁最忙"、"PB-12345 涉及哪些单"，秒出结果；
4. **贡献积累**：荣誉殿堂模块记录每个人的核心/关键/普通贡献，支持排行榜。

**一个数据模型，多张业务表即多个视图**——这是本系统的根本设计思路。不是给每张表各写一套 CRUD，而是维护统一的 `nodes / edges` 图模型，每张表只是这个模型的一个投影/过滤查询。

---

## 2. 整体架构

### 2.1 Monorepo 结构

```
D:\fighting\
├── packages/shared/            # 共享 TypeScript 类型（跨 backend / frontend）
│   └── src/types.ts            # GraphNode, NodeSchema, HermesAnswer, UiSpec 等所有核心类型
├── apps/backend/               # Express + SQLite 后端（Node.js + TypeScript）
│   ├── src/                    # 所有源码
│   │   ├── server.ts           # 入口，启动 HTTP 服务，注册 setInterval 定时任务
│   │   ├── app.ts              # createApp()：组装所有 Router，依赖注入 repo + registry
│   │   ├── db.ts               # openDb()：SQLite DDL，建表 + 索引
│   │   ├── repository.ts       # Repository 接口实现：nodes/edges/progress/audit CRUD
│   │   ├── registry.ts         # FileSchemaRegistry：从 config/schemas/*.json 加载 schema
│   │   ├── cli-core.ts         # CLI 声明式命令表（COMMANDS[]）+ runCli()
│   │   ├── cli.ts              # CLI 入口脚本，通过 fetch 调用后端 HTTP API
│   │   ├── routes.ts           # 节点 CRUD + schema 操作 + 状态流转路由
│   │   ├── hermes.ts           # Hermes 规则引擎问答（8 个意图）
│   │   ├── honor.ts            # 荣誉殿堂：排行榜 + 个人档案
│   │   ├── responsibility.ts   # 责任矩阵 Mermaid 图
│   │   ├── import.ts           # Excel 导入（multer + xlsx）
│   │   ├── export.ts           # Excel 导出
│   │   ├── email.ts            # SMTP 配置 + 邮件发送
│   │   ├── escalation.ts       # SLA 上升扫描
│   │   ├── conflicts.ts        # 冲突/重叠边派生
│   │   ├── kg-rebuild.ts       # 全量重建派生 KG
│   │   ├── graph.ts            # BFS 图快照（可视化用）
│   │   ├── related.ts          # 关联全景路由
│   │   ├── related-core.ts     # buildRelated() / buildExpanded() 核心逻辑
│   │   ├── proposals.ts        # 关系提议队列
│   │   ├── merge.ts            # 人员合并（不可逆）
│   │   ├── merge-route.ts      # 合并路由
│   │   ├── reminders.ts        # 跟催提醒
│   │   ├── rules.ts            # 跟催规则（scanReminders）
│   │   ├── jobs.ts             # 手动触发聚合定时任务
│   │   ├── oncall.ts           # 当前值班人
│   │   ├── daily-report.ts     # 攻关日报
│   │   ├── recommend.ts        # 找帮手推荐
│   │   ├── query.ts            # 全文检索 + 上下文查询
│   │   ├── schema-api.ts       # Schema Wizard API（创建/删除表）
│   │   ├── ui-cache.ts         # UI 固定（pinned UI）
│   │   ├── custom-commands.ts  # 自定义命令（NL 参数化模板）
│   │   ├── dashboard.ts        # 作战大盘
│   │   ├── relations.ts        # 手工关联线（RELATES_TO 边）
│   │   ├── refs.ts             # syncRefEdges()：ref 字段 → REF 边
│   │   ├── anchors.ts          # syncAnchorEdges()：anchor 字段 → ANCHORED_TO 边
│   │   ├── audit.ts            # 审计日志路由
│   │   ├── proposer.ts         # HeuristicRelationProposer（候选提议生成）
│   │   ├── mailer.ts           # NodemailerSender / MailSender 接口
│   │   ├── channel.ts          # StubChannelAdapter（提醒渠道 stub）
│   │   ├── logger.ts           # 结构化日志（log.info/warn/error）
│   │   ├── validation.ts       # validateNode()：根据 NodeSchema 校验属性
│   │   └── date-util.ts        # localToday() / localDateOf()（Asia/Shanghai）
│   └── test/                   # Vitest + supertest e2e 测试（每用例独立 in-memory DB）
├── apps/frontend/              # React 18 + Vite + Ant Design 前端
│   ├── src/
│   │   ├── App.tsx             # BrowserRouter + 所有路由定义（27 个 Route）
│   │   ├── pages/             # 页面组件（每个路由对应一个文件）
│   │   ├── components/        # 可复用组件（UiWidget、AttackForm 等）
│   │   └── api.ts             # HTTP API 客户端（封装 fetch）
│   └── e2e/                    # Playwright 端到端测试
└── config/schemas/             # NodeSchema JSON 配置文件（每个业务实体一个文件，共 15 个）
```

### 2.2 技术栈

| 层次 | 技术 | 用途 |
|---|---|---|
| 后端运行时 | Node.js + TypeScript + tsx | HTTP 服务 |
| 后端框架 | Express 4 | 路由 / 中间件 |
| 数据库 | SQLite (better-sqlite3) | 开发环境持久化 |
| ORM | 无，直接 SQL | `apps/backend/src/repository.ts` |
| Schema 系统 | JSON 文件 + FileSchemaRegistry | `config/schemas/*.json` + `apps/backend/src/registry.ts` |
| Excel | xlsx (SheetJS) | 导入 / 导出 |
| 前端框架 | React 18 + Vite | SPA |
| UI 库 | Ant Design 5 | 表格 / 表单 / 布局 |
| 图可视化 | mermaid.js / 自定义 vis-network | 责任矩阵 / KG 快照 |
| 测试（后端） | Vitest + supertest | in-memory SQLite e2e |
| 测试（前端） | Playwright | 浏览器 e2e |
| 文件上传 | multer（内存存储） | Excel 导入 |
| 邮件 | nodemailer | SMTP 发送 |

### 2.3 数据流（ASCII 图）

```
  ┌──────────┐    Excel/CSV     ┌─────────────────────────────────────────────┐
  │  用户/   │ ─────────────→  │            Express Backend                   │
  │  Agent  │ ←─── HTTP ─────  │                                              │
  └──────────┘   JSON          │  Routes → Repository → SQLite               │
                               │                 ↓                            │
  ┌──────────┐    HTTP API     │  refs.ts / anchors.ts → REF/ANCHORED_TO边    │
  │  CLI    │ ────────────→   │                 ↓                            │
  │ (Linux) │ ←─── JSON ──── │  conflicts.ts / escalation.ts → 派生边        │
  └──────────┘                │                 ↓                            │
                               │  hermes.ts → 规则引擎问答                    │
  ┌──────────┐    Vite Proxy   │                                              │
  │ 浏览器  │ ──────────────→ │                                              │
  │ React   │ ←─── JSON ────  │                                              │
  └──────────┘                 └─────────────────────────────────────────────┘
```

---

## 3. 核心设计原则

### 3.1 混合数据模型：结构化为主，KG 为辅

- **结构化数据**（SQLite `nodes` / `edges` 表）是唯一写入来源（Source of Truth）；
- **KG（知识图谱）** 是从结构化数据**派生**出来的（REF 边、ANCHORED_TO 边、CONFLICTS_WITH 边等），完全可重建：
  ```
  POST /api/kg/rebuild  →  apps/backend/src/kg-rebuild.ts:rebuildKG()
  ```
- KG 不接受直接写入；所有写操作通过 REST API → Repository → SQLite。

### 3.2 配置驱动 Schema（零 DDL）

所有业务字段定义在 `config/schemas/*.json` 中，**增删改字段 = 改配置文件，无需数据库迁移**。

- Schema 加载：`FileSchemaRegistry.reload()` — `apps/backend/src/registry.ts:11`
- 字段操作 API：`PATCH /api/schema/:nodeType` → `FileSchemaRegistry.applyFieldOp()` — `apps/backend/src/registry.ts:43`
- 支持操作：`addField` / `renameLabel` / `editEnum` / `retire` / `unretire` / `setAliases` / `setConcept` / `setAnchor`
- 动态新增表类型：`POST /api/schema/nodeType`（写 JSON 文件 + reload）— `apps/backend/src/schema-api.ts:72`

### 3.3 引用类型字段（零数据重复，自动建边）

当 `FieldSchema.type === "ref"` 时，写入该字段会自动创建 `REF` 边，数据只存一份：

- 代码：`apps/backend/src/refs.ts:syncRefEdges()`
- 示例：`attackTicket.当前处理人 = "张三"` → 自动创建 `REF` 边：`attackTicket → person`
- `ASSIGNED_TO`、`ESCALATED_TO` 等语义边也基于 REF 边派生

### 3.4 锚点字段（跨颗粒度共享）

当 `FieldSchema.anchor` 有值时，写入该字段会自动创建/复用一个锚节点，并建 `ANCHORED_TO` 边：

- 代码：`apps/backend/src/anchors.ts:syncAnchorEdges()`
- 示例：`attackTicket.问题单号 = "PB-12345"` → 创建/复用 `问题单号` 类型的锚节点 `PB-12345`，建 `ANCHORED_TO` 边
- 同一问题单号下所有攻关单都通过锚节点关联，支持"找帮手"跨单推荐

### 3.5 审计日志（全量不可变）

所有写操作（create/update/delete/merge/transition/schema变更）自动记录：

- 代码：`apps/backend/src/repository.ts:logAudit()`
- 查询：`GET /api/audit?action=A&entityType=T&entityId=ID&limit=N`
- 表结构：`audit_log(id, action, entityType, entityId, changes JSON, performedBy, performedAt)`

### 3.6 状态机约束（攻关单）

攻关单状态流转通过专用 API，同时追加 ProgressLog 确保可追溯：

- API：`POST /api/nodes/:id/transition` body: `{toStatus, note}`
- 合法状态集：`待响应 | 处理中 | 进行中 | 已解决 | 已关闭`（`packages/shared/src/types.ts:92`）
- 代码：`apps/backend/src/routes.ts:111`

### 3.7 进展追加（Append-Only Time Series）

- 进展记录只追加，不修改/删除
- `POST /api/nodes/:id/progress` body: `{content, statusSnapshot?, actor?}`
- 每条进展有 seqNo 序号，支持按时间顺序复盘
- 表：`progress_log(id, ownerId, seqNo, content, statusSnapshot, updatedBy, updatedAt)`

### 3.8 定时任务（手动触发，无 Auto-Scheduler）

后台所有定时任务（冲突检测、SLA 上升、跟催扫描、提议生成）均通过手动 POST 触发：

```
POST /api/jobs/tick  →  apps/backend/src/jobs.ts:tickScheduledJobs()
```

生产环境的 `apps/backend/src/server.ts` 在 createApp 外包了一个 `setInterval`，但测试和 CLI 可随时手动触发，保持无副作用。

---

## 4. 数据模型详解

### 4.1 数据库表结构

所有表在 `apps/backend/src/db.ts` 的 `openDb()` 函数中通过 `CREATE TABLE IF NOT EXISTS` 创建。

#### nodes 表（核心业务数据）

```sql
nodes (
  id         TEXT PRIMARY KEY,           -- UUID
  nodeType   TEXT NOT NULL,              -- 对应 config/schemas/*.json 的 nodeType
  properties TEXT NOT NULL,             -- JSON: 所有业务字段（schema 驱动）
  search_text TEXT,                     -- 全文检索缓存字段
  created_at TEXT,                      -- ISO 8601
  updated_at TEXT                       -- ISO 8601
)
```

索引：`idx_nodes_type ON nodes(nodeType)`

#### edges 表（关系图）

```sql
edges (
  id         TEXT PRIMARY KEY,
  edgeType   TEXT NOT NULL,             -- REF | ANCHORED_TO | CONFLICTS_WITH | OVERLAPS_WITH |
                                        --   ASSIGNED_TO | ESCALATED_TO | CONTRIBUTED_TO |
                                        --   SAME_AS | RELATES_TO 等
  sourceId   TEXT NOT NULL,
  targetId   TEXT NOT NULL,
  properties TEXT NOT NULL,            -- JSON: reason, field, role 等边属性
  created_at TEXT,
  updated_at TEXT
)
```

索引：`idx_edges_source`, `idx_edges_target`, `idx_edges_type`

#### progress_log 表（进展时间线）

```sql
progress_log (
  id             TEXT PRIMARY KEY,
  ownerId        TEXT NOT NULL,         -- 关联节点 id（通常是 attackTicket）
  seqNo          INTEGER NOT NULL,      -- 追加序号，单节点内单调递增
  content        TEXT NOT NULL,
  statusSnapshot TEXT,                  -- 写入时刻的状态快照
  updatedBy      TEXT,                  -- 操作者（api / import / cli / 用户名）
  updatedAt      TEXT
)
```

索引：`idx_progress_owner ON progress_log(ownerId, seqNo)`

#### audit_log 表（审计轨迹，不可变）

```sql
audit_log (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,            -- CREATE | UPDATE | DELETE | MERGE | ESCALATE |
                                        --   SCHEMA_addField | DAILY_REPORT_PUBLISH 等
  entityType  TEXT,                     -- node | schema | setting
  entityId    TEXT,                     -- 对应节点/设置 id
  changes     TEXT,                     -- JSON: 变更内容快照
  performedBy TEXT,
  performedAt TEXT
)
```

#### proposals 表（关系提议队列）

```sql
proposals (
  id              TEXT PRIMARY KEY,
  source_node_id  TEXT NOT NULL,
  target_node_id  TEXT NOT NULL,
  relation_type   TEXT NOT NULL,        -- SAME_AS 等
  confidence      REAL,
  proposer_source TEXT,
  rationale       TEXT,
  status          TEXT NOT NULL,        -- 待审批 | 已通过 | 已拒绝
  decided_by      TEXT,
  decided_at      TEXT,
  created_at      TEXT
)
```

#### notifications 表（提醒通知）

```sql
notifications (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,      -- 问题单跟催 | FE Deadline 提醒 | CCB 提醒
  ticket_id         TEXT NOT NULL,
  recipient_person_id TEXT,
  recipient_name    TEXT,
  subject           TEXT,
  body              TEXT,
  status            TEXT NOT NULL,      -- 待发送 | 已发送 | 已忽略
  decided_by        TEXT,
  decided_at        TEXT,
  created_at        TEXT
)
```

#### app_settings 表（KV 配置存储）

```sql
app_settings (
  key   TEXT PRIMARY KEY,               -- smtp | escalation | ui_pinned | customCommands
  value TEXT                            -- JSON 序列化
)
```

### 4.2 NodeSchema 配置格式（完整注释）

文件路径：`config/schemas/<nodeType>.json`

```json
{
  "nodeType": "attackTicket",      // 英文 camelCase，必须与文件名一致
  "label": "攻关单",               // 中文显示名
  "identityKeys": ["攻关单号"],     // 导入去重键（多个字段依序试匹配）
  "derivedToKG": true,             // 是否参与 KG 派生（ref/anchor 字段生效条件）
  "fields": [
    {
      "id": "标题",                 // 字段 id（存入 properties 的键名）
      "name": "标题",               // 字段名（代码/配置层标识，通常与 id 相同）
      "type": "string",            // string | number | date | datetime | enum | ref | sequence
      "label": "标题",              // UI 显示列标题
      "required": true,            // 可选，默认 false
      "aliases": ["title", "问题标题"],  // 导入时的 Excel 列名别名列表
      "enumValues": [],            // type=enum 时必填，合法值列表（中文字符串）
      "refType": "person",         // type=ref 时必填，目标 nodeType
      "concept": "负责人",          // 语义概念（用于跨表关联查询和推荐）
      "anchor": "问题单号",         // 非空时启用锚点机制（值为锚节点的 nodeType）
      "retired": false             // true 时字段隐藏（导出不含，UI 不展示）
    }
  ]
}
```

### 4.3 所有边类型（EdgeType）

| EdgeType | 方向 | 语义 | 触发方式 | 代码位置 |
|---|---|---|---|---|
| REF | source → person/node | ref 类型字段引用 | 写节点时自动创建 | `refs.ts:syncRefEdges()` |
| ANCHORED_TO | ticket → anchor节点 | 跨粒度共享锚点 | 写节点时自动创建 | `anchors.ts:syncAnchorEdges()` |
| ASSIGNED_TO | ticket → person | 攻关单分配 | 导入时按申请人字段创建 | `import.ts:115` |
| ESCALATED_TO | ticket → person | SLA 超期上升 | escalation 扫描创建 | `escalation.ts:scanEscalation()` |
| CONFLICTS_WITH | ticket ↔ ticket | 同处理人并发冲突（双向） | conflicts 扫描派生 | `conflicts.ts:syncConflicts()` |
| OVERLAPS_WITH | ticket ↔ ticket | 同问题单号重叠（双向） | conflicts 扫描派生 | `conflicts.ts:syncConflicts()` |
| CONTRIBUTED_TO | contribution → ticket | 贡献关联攻关单 | 创建 contribution 时按字段值 | `routes.ts:68` |
| SAME_AS | node ↔ node | 实体去重提议（审批后合并） | proposals 扫描 | `proposals.ts:runProposalScan()` |
| RELATES_TO | source → target | 手工标注关联线（带备注） | UI/CLI 手动创建 | `relations.ts:makeRelationsRouter()` |

### 4.4 所有 NodeType（15 个）

| nodeType | 中文名 | 关键字段 | 配置文件 |
|---|---|---|---|
| attackTicket | 攻关单 | 攻关单号、标题、状态、当前处理人、问题单号、事件级别 | `config/schemas/attackTicket.json` |
| contribution | 贡献记录 | 贡献人、贡献等级、贡献类型、贡献描述、关联攻关单 | `config/schemas/contribution.json` |
| person | 人员 | name、employeeId、email、团队 | `config/schemas/person.json` |
| incidentTracking | 事件单追踪 | 事件标题、状态 | `config/schemas/incidentTracking.json` |
| changeIssue | 变更问题 | 事项描述、状态 | `config/schemas/changeIssue.json` |
| alarmGovernance | 告警治理 | 告警问题、状态 | `config/schemas/alarmGovernance.json` |
| p3Incident | P3 事件 | 问题说明 | `config/schemas/p3Incident.json` |
| dailyTask | 日常任务 | 事项描述、状态 | `config/schemas/dailyTask.json` |
| issue400 | 400 系列问题 | 问题说明 | `config/schemas/issue400.json` |
| issue5xx | 5xx 系列问题 | 问题说明 | `config/schemas/issue5xx.json` |
| experience | 经验沉淀 | 经验 | `config/schemas/experience.json` |
| oncall | 值班记录 | domain、值班人、起、止 | `config/schemas/oncall.json` |
| releasePackage | 发布包 | 版本号 | `config/schemas/releasePackage.json` |
| weightFile | 权重文件 | 名称 | `config/schemas/weightFile.json` |
| emailGroup | 邮件群组 | 组名、成员邮箱 | `config/schemas/emailGroup.json` |

---

## 5. 后端模块详解

所有路由模块以 `make*Router(repo, registry?)` 工厂函数形式导出，统一挂载到 `/api` 前缀下（`apps/backend/src/app.ts`）。

### 5.1 节点 CRUD（`apps/backend/src/routes.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/schema/:nodeType` | 获取 NodeSchema 配置 |
| POST | `/api/schema/scan` | 重新扫描 config/schemas 目录，热加载 |
| PATCH | `/api/schema/:nodeType` | 字段操作（addField/retire/renameLabel 等），写回 JSON 文件 |
| GET | `/api/nodes/:nodeType` | 查询某类型所有节点（可附加查询参数过滤：`?状态=处理中`） |
| GET | `/api/nodes/:id` | 按 ID 取单个节点（`:id` 实际上也作为 nodeType 后备） |
| POST | `/api/nodes/:nodeType` | 创建节点（body = properties，schema 校验，自动建 REF/anchor 边） |
| PUT | `/api/nodes/:id` | 局部合并更新（merge semantics，非 replace），同步更新 REF/anchor 边 |
| DELETE | `/api/nodes/:id` | 删除节点（同时删关联边） |
| GET | `/api/nodes/:id/progress` | 列出进展时间线（按 seqNo 升序） |
| POST | `/api/nodes/:id/progress` | 追加进展 body: `{content, statusSnapshot?, actor?}` |
| POST | `/api/nodes/:id/transition` | 攻关单状态流转 body: `{toStatus, note?}`，原子更新状态+追加进展 |

**权限控制（routes.ts:11）**：`贡献等级` 字段标定仅 Leader/Admin 可操作（HTTP Header `X-Role: leader|admin`），CLI 和导入流程不传 X-Role 则视为系统信任访问，直接放行。

### 5.2 Hermes 问答引擎（`apps/backend/src/hermes.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/hermes/ask` | 问答，body: `{question: string}` → `HermesAnswer` |

**意图分类（顺序敏感，越具体越靠前）**：

| 意图 | 触发关键词/模式 | UiSpec Widget |
|---|---|---|
| find-helpers | 找谁帮忙 / 找帮手 / 谁能帮 | CARD_GRID |
| ticket-by-pb | PB-XXXX 格式（无帮手关键词） | TABLE |
| owner | 谁负责 / 谁在做 / 负责人 | TABLE |
| status | 状态 / 进展 / 怎么样 / 现在 | CARD_GRID |
| contribution-by-person | 贡献 + 人名 | TABLE |
| person-workload | 最忙 / 负载最重 / 活跃单最多 | STATS |
| recent-changes | 今天 / 本周 / 最近 + 谁动 / 谁改 | TABLE |
| fallback-search | 默认（全类型全文检索） | TABLE |

返回结构 `HermesAnswer`（`packages/shared/src/types.ts:169`）：
```ts
{
  question: string;
  intent: HermesIntent;
  answer: string;            // 纯文本中文答案
  citations: HermesCitation[];  // 引用节点列表（最多 5 条）
  uiSpec?: UiSpec;           // 可选动态 UI 规范（可直接渲染为表格/卡片等）
}
```

### 5.3 Schema 管理（`apps/backend/src/schema-api.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/schema/list` | 返回所有 NodeSchema[] |
| GET | `/api/schema/suggest?q=<关键词>` | 搜索现有字段/概念（名称/别名/标签/概念匹配），用于建表时复用字段 |
| POST | `/api/schema/nodeType` | 创建新表：写 JSON 文件 + reload，body: `{nodeType, label, fields[], identityKeys?}` |
| DELETE | `/api/schema/nodeType/:nodeType` | 删除表（前提：该类型下无数据） |

### 5.4 UI 固定缓存（`apps/backend/src/ui-cache.ts`）

将 Hermes 返回的 `UiSpec` 固定在侧边栏，持久化到 `app_settings.ui_pinned`（最多 50 条）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ui-cache/pinned` | 列出所有已固定 UI |
| POST | `/api/ui-cache/pin` | 固定，body: `{label?, question?, intent?, uiSpec}` |
| PATCH | `/api/ui-cache/pinned/:id` | 重命名，body: `{label}` |
| DELETE | `/api/ui-cache/pinned/:id` | 取消固定 |

`UiSpec` 类型（`packages/shared/src/types.ts:160`）：
```ts
{
  widget: "TABLE" | "STATS" | "MERMAID" | "TIMELINE" | "CARD_GRID";
  params: UiTableParams | UiStatsParams | UiMermaidParams | UiTimelineParams | UiCardGridParams;
  cacheKey: string;   // 用于去重/缓存查找
}
```

### 5.5 荣誉殿堂（`apps/backend/src/honor.ts`）

计分权重：普通=1 / 关键=3 / 核心=8（`honor.ts:5`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/honor/leaderboard?period=P&groupBy=team` | 排行榜，可按周期过滤，可按团队聚合 |
| GET | `/api/honor/person/:name` | 个人贡献档案（贡献节点 + 关联攻关单 id） |

### 5.6 责任矩阵（`apps/backend/src/responsibility.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/responsibility/diagram` | 返回 Mermaid flowchart（SLA 升级规则 + 负责边 + 冲突边） |

`ResponsibilityDiagram` 响应：`{mermaid: string, nodeCount: number, edgeCount: number}`

### 5.7 关联全景（`apps/backend/src/related.ts`，核心逻辑在 `related-core.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/related/:nodeType/:id?depth=N&includeCandidates=1` | 返回 outgoing/incoming/coAnchored/expanded/conflicts/manualLinks |

参数说明：
- `depth`：默认 1，最大 5（多跳展开，超过 1 时返回 `expanded` 数组）
- `includeCandidates`：包含待审批的提议候选项

响应包含以下可选字段（有值才出现，无值时省略以保持向后兼容）：
- `outgoing`: REF 边出向关联
- `incoming`: REF 边入向关联
- `coAnchored`: 通过共同锚节点关联
- `expanded`: depth>1 时的多跳展开节点
- `conflicts`: CONFLICTS_WITH/OVERLAPS_WITH 边
- `manualLinks`: 手工 RELATES_TO 边

### 5.8 提议/合并（`apps/backend/src/proposals.ts`，`apps/backend/src/merge.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/proposals/scan` | 扫描生成候选提议（幂等，已有待审批/已拒绝的不重复生成） |
| GET | `/api/proposals?status=待审批` | 查询提议列表 |
| POST | `/api/proposals/:id/decide` | 审批 body: `{decision: 通过/拒绝/修正, decidedBy, patch?}` |
| GET | `/api/merge/preview?fromId=X&toId=Y` | 合并预览（只读） |
| POST | `/api/merge/person` | 执行人员合并（不可逆！）body: `{fromId, toId}` |

合并规则（`merge.ts:mergePerson()`）：
1. 合并 `properties`（union，to 节点字段优先）
2. 将 from 节点的所有 edges 迁移到 to 节点
3. 删除 from 节点
4. 写 audit_log（action=MERGE）

### 5.9 SLA 上升（`apps/backend/src/escalation.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/escalation/config` | 查看 SLA 规则 |
| PUT | `/api/escalation/config` | 设置 SLA 规则 body: `{rules: [{事件级别, slaHours, 上升角色}]}` |
| POST | `/api/escalation/scan` | 扫描超期活跃攻关单并上升（幂等，已上升不重复） |

默认 SLA 规则（`escalation.ts:6`）：
- P1：2h → 运维Leader
- P2：8h → 运维Leader
- P3：24h → 值班接口人
- P4A：4h → 值班接口人

### 5.10 定时任务（`apps/backend/src/jobs.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/jobs/tick` | 手动触发所有后台扫描（conflicts + escalation + reminders + proposals） |

返回：`{conflicts, overlaps, escalated, reminders, proposals}`（各扫描的产出计数）

### 5.11 邮件（`apps/backend/src/email.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/email/config` | 查看 SMTP 配置（password 掩码） |
| PUT | `/api/email/config` | 设置 SMTP，password 为空则保留旧密码 |
| POST | `/api/email/test` | 发送测试邮件 body: `{to: "email@example.com"}` |
| POST | `/api/email/send` | 发送邮件，收件人 = to[] + emailGroup 展开 + person 邮箱 lookup，去重 |

### 5.12 冲突/重叠检测（`apps/backend/src/conflicts.ts`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/conflicts/scan` | 重建 CONFLICTS_WITH/OVERLAPS_WITH 派生边 |
| GET | `/api/conflicts` | 列出所有冲突/重叠对（无向去重） |

检测规则（`conflicts.ts:syncConflicts()`）：
- Rule 1：同 `当前处理人` + 有 ≥2 个活跃攻关单 → CONFLICTS_WITH
- Rule 2：同 `问题单号` + 有 ≥2 个攻关单 → OVERLAPS_WITH

### 5.13 其他路由

| 模块 | 路径前缀 | 主要端点 |
|---|---|---|
| 导入 `import.ts` | `/api/import` | POST（multipart, ?type=nodeType&dryRun=1） |
| 导出 `export.ts` | `/api/export/:nodeType` | GET（返回 xlsx 文件） |
| 大盘 `dashboard.ts` | `/api/dashboard` | GET |
| 日报 `daily-report.ts` | `/api/daily-report` | GET(?date), POST /publish(?date) |
| 全文检索 `query.ts` | `/api/query/search` | GET(?q, ?type, ?limit) |
| 查询上下文 `query.ts` | `/api/query/context/:id` | GET |
| 图快照 `graph.ts` | `/api/graph/snapshot/:nodeType/:id` | GET(?depth) |
| KG 重建 `kg-rebuild.ts` | `/api/kg/rebuild` | POST |
| 审计日志 `audit.ts` | `/api/audit` | GET(?action, ?entityType, ?entityId, ?limit) |
| 找帮手 `recommend.ts` | `/api/recommend/helpers/:id` | GET(?limit) |
| 提醒 `reminders.ts` | `/api/reminders` | POST /scan, GET, POST /:id/send, POST /:id/ignore |
| 值班 `oncall.ts` | `/api/oncall/current` | GET(?domain) |
| 手工关联线 `relations.ts` | `/api/relations/manual` | POST, GET(?nodeId), DELETE /:edgeId |
| 自定义命令 `custom-commands.ts` | `/api/commands` | GET, POST, DELETE /:id, POST /:id/run |
| Schema Wizard `schema-api.ts` | `/api/schema` | GET /list, GET /suggest, POST /nodeType, DELETE /nodeType/:nodeType |
| UI 固定 `ui-cache.ts` | `/api/ui-cache` | GET /pinned, POST /pin, PATCH /pinned/:id, DELETE /pinned/:id |
| 责任矩阵 `responsibility.ts` | `/api/responsibility/diagram` | GET |

---

## 6. CLI 命令参考

CLI 是后端 API 的薄封装（`apps/backend/src/cli-core.ts`），所有命令以 `npm run cli -- <command> [args] [--opts]` 形式调用（读取 `COMBAT_API` 环境变量，默认 `http://localhost:3001`）。

查看所有命令：
```bash
npm run cli -- help
npm run cli -- help nodes:create
```

### 完整命令列表

#### 读取类

| 命令 | 说明 | 示例 |
|---|---|---|
| `dashboard` | 作战大盘汇总 | `npm run cli -- dashboard` |
| `nodes:list <nodeType>` | 列出节点（可附加过滤参数） | `npm run cli -- nodes:list attackTicket --状态 处理中` |
| `nodes:get <id>` | 按 ID 取节点 | `npm run cli -- nodes:get abc-123` |
| `progress:list <id>` | 列出进展时间线 | `npm run cli -- progress:list abc-123` |
| `schema:get <nodeType>` | 取 schema 配置 | `npm run cli -- schema:get attackTicket` |
| `schema:list` | 列出所有 nodeType | `npm run cli -- schema:list` |
| `schema:suggest <keyword>` | 搜索现有字段 | `npm run cli -- schema:suggest 负责人` |
| `related <nodeType> <id>` | 关联全景 | `npm run cli -- related attackTicket abc-123 --depth 2` |
| `graph <nodeType> <id>` | KG 图快照 | `npm run cli -- graph attackTicket abc-123 --depth 2` |
| `conflicts:list` | 冲突/重叠对列表 | `npm run cli -- conflicts:list` |
| `audit:list` | 审计日志 | `npm run cli -- audit:list --entityType node --limit 20` |
| `merge:preview` | 合并预览 | `npm run cli -- merge:preview --from id1 --to id2` |
| `daily-report` | 攻关日报 | `npm run cli -- daily-report --date 2026-05-22` |
| `oncall:current` | 当前值班人 | `npm run cli -- oncall:current --domain 运维` |
| `honor:leaderboard` | 荣誉排行榜 | `npm run cli -- honor:leaderboard --period 2026Q2 --groupBy team` |
| `honor:person <name>` | 个人荣誉档案 | `npm run cli -- honor:person 张三` |
| `proposals:list` | 提议队列 | `npm run cli -- proposals:list --status 待审批` |
| `reminders:list` | 提醒队列 | `npm run cli -- reminders:list --status 待发送` |
| `recommend:helpers <id>` | 找帮手推荐 | `npm run cli -- recommend:helpers abc-123 --limit 5` |
| `search <query>` | 全文检索 | `npm run cli -- search 断网故障 --type attackTicket` |
| `context <id>` | 节点查询上下文 | `npm run cli -- context abc-123` |
| `escalation:config-get` | 查看 SLA 配置 | `npm run cli -- escalation:config-get` |
| `email:config-get` | 查看 SMTP 配置 | `npm run cli -- email:config-get` |
| `ui:pinned` | 列出已固定 UI | `npm run cli -- ui:pinned` |
| `commands:list` | 列出自定义命令 | `npm run cli -- commands:list` |
| `relations:list` | 列出手工关联线 | `npm run cli -- relations:list --node abc-123` |
| `responsibility:diagram` | 责任矩阵 Mermaid 图 | `npm run cli -- responsibility:diagram` |

#### 写入类

| 命令 | 说明 | 示例 |
|---|---|---|
| `nodes:create <nodeType>` | 创建节点 | `npm run cli -- nodes:create attackTicket --data '{"标题":"断网","状态":"待响应"}'` |
| `nodes:update <id>` | 局部更新节点 | `npm run cli -- nodes:update abc-123 --data '{"状态":"处理中"}'` |
| `nodes:delete <id>` | 删除节点 | `npm run cli -- nodes:delete abc-123` |
| `nodes:transition <id>` | 状态流转 | `npm run cli -- nodes:transition abc-123 --to 处理中 --note "已分配"` |
| `progress:add <id>` | 追加进展 | `npm run cli -- progress:add abc-123 --content "已定位根因" --status 处理中` |
| `schema:patch <nodeType>` | 字段操作 | `npm run cli -- schema:patch attackTicket --op '{"op":"addField","field":{"name":"备注","type":"string","label":"备注"}}'` |
| `schema:scan` | 重扫描 schema 目录 | `npm run cli -- schema:scan` |
| `schema:create-nodeType` | 创建新表 | `npm run cli -- schema:create-nodeType --data '{"nodeType":"myType","label":"我的表","fields":[...]}'` |
| `schema:delete-nodeType <nodeType>` | 删除空表 | `npm run cli -- schema:delete-nodeType myType` |
| `conflicts:scan` | 重建冲突边 | `npm run cli -- conflicts:scan` |
| `kg:rebuild` | 全量重建 KG | `npm run cli -- kg:rebuild` |
| `daily-report:publish` | 发布日报 | `npm run cli -- daily-report:publish --date 2026-05-22` |
| `jobs:tick` | 手动触发后台任务 | `npm run cli -- jobs:tick` |
| `hermes:ask <question>` | Hermes 问答 | `npm run cli -- hermes:ask PB-12345 涉及哪些攻关单` |
| `merge:person` | 人员合并（不可逆） | `npm run cli -- merge:person --from id1 --to id2` |
| `proposals:scan` | 扫描生成提议 | `npm run cli -- proposals:scan` |
| `proposals:decide <id>` | 审批提议 | `npm run cli -- proposals:decide p1 --decision 通过 --by 张三` |
| `reminders:scan` | 扫描生成提醒 | `npm run cli -- reminders:scan` |
| `reminders:send <id>` | 发送提醒 | `npm run cli -- reminders:send r1 --by 张三` |
| `reminders:ignore <id>` | 忽略提醒 | `npm run cli -- reminders:ignore r1 --by 张三` |
| `escalation:config-set` | 设置 SLA 规则 | `npm run cli -- escalation:config-set --data '{"rules":[...]}'` |
| `escalation:scan` | 扫描超期上升 | `npm run cli -- escalation:scan` |
| `email:config-set` | 设置 SMTP 配置 | `npm run cli -- email:config-set --data '{"host":"smtp.xxx.com","port":465,...}'` |
| `email:test` | 发送测试邮件 | `npm run cli -- email:test --to me@example.com` |
| `email:send` | 发送邮件 | `npm run cli -- email:send --to a@b.com --subject "提醒" --body "内容"` |
| `import <nodeType>` | Excel 导入 | `npm run cli -- import attackTicket --file data.xlsx --dryRun` |
| `export <nodeType>` | Excel 导出 | `npm run cli -- export attackTicket --out output.xlsx` |
| `relations:link` | 手工关联 | `npm run cli -- relations:link --from id1 --to id2 --reason "同一客户"` |
| `relations:unlink <edgeId>` | 删除手工关联 | `npm run cli -- relations:unlink edge-123` |
| `ui:pin` | 固定 UI | `npm run cli -- ui:pin --label "高危单" --question "PB-12345" --intent ticket-by-pb --uiSpec '...'` |
| `ui:rename-pin <id>` | 重命名固定 UI | `npm run cli -- ui:rename-pin pin-123 --label "新标题"` |
| `ui:unpin <id>` | 取消固定 UI | `npm run cli -- ui:unpin pin-123` |
| `commands:create` | 新建自定义命令 | `npm run cli -- commands:create --name "查活跃单" --template 'nodes:list attackTicket --状态 {状态}'` |
| `commands:delete <id>` | 删除自定义命令 | `npm run cli -- commands:delete cmd-123` |
| `commands:run <id>` | 运行自定义命令 | `npm run cli -- commands:run cmd-123 --args '{"状态":"处理中"}'` |

---

## 7. 前端模块详解

### 7.1 所有路由（`apps/frontend/src/App.tsx`）

| 路由路径 | 组件 | 说明 |
|---|---|---|
| `/` | HomePage | 首页 / 大盘 |
| `/attack` | EntityTable(attackTicket) | 攻关作战台（带状态过滤，标题可跳转详情） |
| `/attack/:id` | AttackDetail | 攻关单详情（进展时间线 + 关联图） |
| `/contributions` | EntityTable(contribution) | 贡献记录列表 |
| `/honor` | HonorPage | 荣誉殿堂排行榜 |
| `/honor/:name` | PersonHonor | 个人荣誉档案 |
| `/related/:nodeType/:id` | RelatedPage | 关联全景视图 |
| `/proposals` | ProposalsPage | 关系提议审批队列 |
| `/search` | SearchPage | 全文检索 |
| `/releases` | EntityTable(releasePackage) | 发布包列表 |
| `/weights` | EntityTable(weightFile) | 权重文件列表 |
| `/daily-report` | DailyReportPage | 攻关日报 |
| `/reminders` | RemindersPage | 跟催提醒队列 |
| `/conflicts` | ConflictsPage | 冲突/重叠对视图 |
| `/hermes` | HermesPage | Hermes 问答助手 |
| `/graph/:nodeType/:id` | GraphPage | KG 图可视化 |
| `/audit` | AuditPage | 审计日志 |
| `/merge` | MergePage | 人员合并操作 |
| `/import` | ImportPage | Excel 导入 |
| `/email` | EmailPage | 邮件配置 + 发送 |
| `/emailgroups` | EntityTable(emailGroup) | 邮件群组管理 |
| `/incidents` | EntityTable(incidentTracking) | 事件单追踪 |
| `/changes` | EntityTable(changeIssue) | 变更问题 |
| `/alarms` | EntityTable(alarmGovernance) | 告警治理 |
| `/p3` | EntityTable(p3Incident) | P3 事件 |
| `/daily` | EntityTable(dailyTask) | 日常任务 |
| `/issue400` | EntityTable(issue400) | 400 系列问题 |
| `/issue5xx` | EntityTable(issue5xx) | 5xx 系列问题 |
| `/escalation` | EscalationPage | SLA 上升管理 |
| `/oncall` | EntityTable(oncall) | 值班记录 |
| `/experience` | EntityTable(experience) | 经验沉淀 |
| `/commands` | CustomCommandsPage | 自定义命令管理 |
| `/responsibility` | ResponsibilityPage | 责任矩阵 Mermaid 图 |
| `/schema-wizard` | SchemaWizardPage | 表结构管理（新建/编辑/删除字段） |

### 7.2 核心组件

**EntityTable**（`apps/frontend/src/pages/EntityTable.tsx`）
- 配置驱动的通用表格/卡片视图，渲染任意 nodeType
- 从 `/api/schema/:nodeType` 获取列定义，从 `/api/nodes/:nodeType` 获取数据
- 支持内联编辑、新增行、字段操作（addField/retire/renameLabel 等）
- Props: `nodeType`, `filterField?`, `linkField?`, `linkTo?`, `extraColumns?`

**UiWidget**（`apps/frontend/src/components/UiWidget.tsx`）
- 渲染任意 `UiSpec`，支持 TABLE / STATS / MERMAID / TIMELINE / CARD_GRID 五种 widget
- Hermes 问答结果和固定 UI 侧边栏都通过此组件渲染

**HermesPage**（`apps/frontend/src/pages/HermesPage.tsx`）
- 问答输入框 + 答案展示 + UiWidget 渲染 + 一键固定按钮
- 已固定 UI 在侧边栏常驻展示

### 7.3 UiSpec 系统

Hermes 返回的 `uiSpec` 字段描述如何在前端渲染数据，无需前端知道具体业务逻辑：

```ts
// packages/shared/src/types.ts:150
type UiWidgetType = "TABLE" | "STATS" | "MERMAID" | "TIMELINE" | "CARD_GRID";

// TABLE: {columns: string[], rows: {[key:string]: string|number|null}[]}
// STATS: {items: {label, value, color?}[]}
// MERMAID: {diagram: string}     // mermaid 图表代码
// TIMELINE: {items: {time, title, content, status?}[]}
// CARD_GRID: {cards: {title, description?, link?, tags?}[]}
```

---

## 8. 开发指南

### 8.1 本地开发环境

```bash
# 安装依赖
npm install

# 启动后端（端口 3001）
npm run dev:backend
# 或: cd apps/backend && npx tsx src/server.ts

# 启动前端（端口 5173）
npm run dev:frontend
# 或: cd apps/frontend && npx vite

# 运行后端测试
npm run test:backend

# 运行前端单元测试
npm run test:frontend

# 运行前端 e2e 测试（需要先启动服务）
cd apps/frontend && npx playwright test
```

### 8.2 添加新业务实体（配置驱动，无需写代码）

1. 在 `config/schemas/` 下新建 `myType.json`，遵循 NodeSchema 格式
2. 或通过 API：`POST /api/schema/nodeType` body: `{nodeType, label, fields[], identityKeys?}`
3. 在 `apps/frontend/src/App.tsx` 中添加路由：`<Route path="/my-type" element={<EntityTable nodeType="myType" />} />`
4. 在 `apps/frontend/src/pages/AppShell.tsx` 菜单中添加入口
5. 重启后端（或调用 `POST /api/schema/scan`）使 schema 生效

### 8.3 添加新 Hermes 意图

在 `apps/backend/src/hermes.ts:answerQuestion()` 中按意图优先级顺序（具体→模糊）添加：

```ts
// 1. 检测关键词/模式
if (/新关键词/.test(question)) {
  // 2. 查询 repo 数据
  const results = repo.queryNodes("attackTicket").filter(...);
  // 3. 构造 uiSpec
  const uiSpec = tableSpec("标题", ["col1", "col2"], results, n => ({...}));
  // 4. 返回 HermesAnswer
  return { question, intent: "my-new-intent", answer: "...", citations: [...], uiSpec };
}
```

**注意**：新意图类型需要同步添加到 `packages/shared/src/types.ts` 的 `HermesIntent` 联合类型中。

### 8.4 添加新 API + CLI 命令（同步实现原则）

每新增一个 HTTP endpoint，**必须**在同一提交中添加对应的 CLI 命令（定义在 `apps/backend/src/cli-core.ts` 的 `COMMANDS` 数组中）。CLI 命令的定义结构：

```ts
{
  name: "module:action",       // 命令名，格式 "模块:动作"
  summary: "中文说明 — 提及 HTTP METHOD /path",
  usage: "module:action <必选参数> [--选项 值]",
  build: (pos, opts) => ({
    method: "POST",
    path: `/api/module/${encodeURIComponent(pos[0])}`,
    body: { field: str(opts.field) },
    // uploadFile?: 本地文件路径（multipart 上传）
    // saveTo?: 本地保存路径（下载文件）
  }),
}
```

### 8.5 部署

```bash
# 一键部署到测试服务器（读取 .env.deploy 中的服务器信息）
node scripts/deploy/deploy.mjs deploy

# 前端在本地构建（避免服务器 OOM），上传到服务器
# 详见: scripts/deploy/run-deploy.sh
```

服务器路径：`/opt/combat/`（前端静态文件）、`/opt/combat/backend/`（后端代码）

---

## 9. 日志与观测

### 9.1 日志格式

```
[2026-05-22T15:00:00.000Z] INFO event key=value key2=value2
```

代码：`apps/backend/src/logger.ts`

每个 HTTP 请求自动记录：`method`, `path`, `status`, `ms`（响应时间），可选 `role`（X-Role header）。

### 9.2 关键业务日志事件

| 事件名 | 文件 | 触发时机 | 关键字段 |
|---|---|---|---|
| `http.request` | logger.ts | 每个 HTTP 请求完成 | method, path, status, ms |
| `http.error` | app.ts | 未捕获异常 | path, error |
| `hermes.ask.start` | hermes.ts | 收到问答请求 | question |
| `hermes.ask.done` | hermes.ts | 问答完成 | intent, citationCount |
| `kg.rebuild.start/done` | kg-rebuild.ts | KG 重建 | refEdges, anchorEdges, conflicts, durationMs |
| `import.done` | import.ts | 导入完成 | nodeType, created, updated, skipped |
| `import.skip` | import.ts | 导入行跳过 | nodeType, rowIndex, reason |
| `email.send/test` | email.ts | 邮件发送 | recipients, ok, messageId |
| `reconcile.scan` | proposals.ts | 提议扫描有新结果 | created |
| `daily_report.publish` | daily-report.ts | 日报发布 | date, ticketsTouched |
| `jobs.tick` | jobs.ts | 定时任务执行 | conflicts, overlaps, escalated, reminders, proposals, ms |
| `responsibility.diagram` | responsibility.ts | 图生成 | nodeCount, edgeCount |
| `schema.create/delete` | schema-api.ts | 表创建/删除 | nodeType, fieldCount |
| `ui.pin/unpin` | ui-cache.ts | UI 固定/取消 | id, label |

### 9.3 日志位置（部署环境）

- `/opt/combat/backend.log`：后端服务日志
- `/opt/combat/frontend.log`：Vite 前端日志（开发模式）
- `/opt/combat/deploy.log`：部署脚本日志

---

## 10. 测试策略

### 10.1 后端 e2e 测试

使用 Vitest + supertest，每个测试用例使用独立的 in-memory SQLite 实例（`:memory:`），测试之间完全隔离，无需清理数据库。

测试文件：`apps/backend/test/`

每个功能模块（routes、honor、import、hermes、escalation 等）有独立的 `*.test.ts` 文件。

### 10.2 前端 e2e 测试

使用 Playwright，通过 route mocking 模拟后端响应（无需真实后端运行）。

测试文件：`apps/frontend/e2e/`

---

## 11. 已知限制

1. **定时任务需手动触发**：`POST /api/jobs/tick` 是手动触发，生产服务器通过 `setInterval` 自动调用，但无 cron-based 调度器
2. **通知渠道仅邮件**：eSpace、weLink 等内部 IM 渠道为 stub 实现（`channel.ts:StubChannelAdapter`）
3. **权限模型简单**：仅通过 `X-Role` HTTP Header 做简单门控（贡献等级标定），无服务端 RBAC
4. **Hermes 为规则引擎**：非 LLM 驱动，基于关键词正则匹配 8 个固定意图，自然语言理解能力有限
5. **SQLite 单进程限制**：当前使用 better-sqlite3（同步），不支持多进程/水平扩展；生产切换 PostgreSQL 需改 repository.ts
6. **合并不可逆**：人员合并（`POST /api/merge/person`）无撤销，执行前必须预览确认
