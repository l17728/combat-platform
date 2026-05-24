# API 参考

> Base：`http://localhost:3001`（开发）/ `http://47.103.99.229:3001`（部署服）。所有响应 `application/json`。错误：`{ error: string }` + 适当 HTTP 码。

## 通用节点 CRUD（PRD §14.2 / 增量1）

### `POST /api/nodes/:nodeType`
创建节点。body = properties。validateNode 失败 → 400 `{errors:[...]}`。返回 201 `{id, nodeType, properties, createdAt, updatedAt}`。
副作用：`syncRefEdges`（每个 `type:ref` 字段建 REF 边）+ `syncAnchorEdges`（每个 `anchor:<kind>` 字段建 ANCHORED_TO 边）+ audit。

### `PUT /api/nodes/:id`
更新节点（合并属性）。同样触发 syncRefEdges/syncAnchorEdges 重建。返回 200。

### `DELETE /api/nodes/:id`
硬删。级联删除该节点的边 + ProgressLog；audit。

### `GET /api/nodes/:nodeType`
列出该类型全部节点（无分页 MVP）。可选 `?<propKey>=<value>` 简单等值过滤。

### `GET /api/nodes/:id`
返回单节点。404 if not found。

## Schema 元数据（增量1 / 1.5 / 3a-d）

### `GET /api/schema/:nodeType`
返回该 nodeType 的 NodeSchema（fields/identityKeys/derivedToKG 等）。

### `PATCH /api/schema/:nodeType`
应用 FieldOp，写回 config 文件 + reload。`op ∈`:
- `{op:"addField",field:{name,type,label,required?,enumValues?}}`
- `{op:"renameLabel",id,label}`
- `{op:"editEnum",id,enumValues}`
- `{op:"retire",id}` / `{op:"unretire",id}`
- `{op:"setAliases",id,aliases:string[]}` 别名（必须数组）
- `{op:"setConcept",id,concept:string}` 语义概念
- `{op:"setAnchor",id,anchor:string}` 共享锚点 kind

任意非字符串/非数组类型 → 400 + 配置不变（增量12 §30 已确保 sibling 损坏不会误回滚本次合法变更）。

## 进展（PRD §2.3 / 增量1）

### `POST /api/nodes/:id/progress`
追加一条 ProgressLog。body `{content, statusSnapshot, actor}`。append-only；返回 200 含 `seqNo`。

### `GET /api/nodes/:id/progress`
返回该节点的全部 ProgressLog（按 seqNo asc）。

## 1 跳关联（增量3a 派生 + 3b concept + 3c candidates + 3d coAnchored）

### `GET /api/related/:nodeType/:id?includeCandidates=1`
返回 `{ outgoing, incoming, coAnchored, candidates? }`：
- `outgoing`/`incoming`：REF + ANCHORED_TO 边对端 `{field, concept, node}`，前端按 `concept ‖ nodeType` 分组。
- `coAnchored`：经共享锚点 2-hop 派生的对端节点（同问题单号下的其它 view）`{anchorKind, anchorKey, node}`。**不落边**。
- `candidates`：当 `?includeCandidates=1` 时附加，列出与该节点相关的待审批 RelationProposal。

## 关系审批（增量3c）

### `POST /api/proposals/scan`
跑全部 RelationProposer（当前内置 `HeuristicRelationProposer`：跨 person 节点 Levenshtein≤1 提议 `SAME_AS`）。幂等：同三元组若已存在「待审批」或「已拒绝」记录则跳过。返回 `{ created: number }`。

### `GET /api/proposals?status=<status>`
列出候选关系。`status ∈ {待审批,已通过,已拒绝}`。

### `POST /api/proposals/:id/decide`
body `{ decision: "通过"|"拒绝"|"修正", decidedBy, patch?:{targetNodeId} }`。
- 通过/修正 → 走结构化权威 person 合并（§2.1：边迁移+属性合并+不可逆+MERGE audit）；提议 → 已通过。
- 拒绝 → 提议 → 已拒绝（负样本，后续 scan 抑制）。
- 非待审批 → 409。不存在 → 404。

## Hermes 只读查询（增量4 / §22）

### `GET /api/query/search?q=<term>&type=<nodeType?>&limit=<1-200>`
属性子串大小写不敏感检索全 nodeType（默认）或单 type。空/缺 q → 400。返回 `QueryHit[]`：`{id,nodeType,summary,score}` 按 `score desc, updatedAt desc, id asc` 排序、limit 截断。`summary` 取属性优先序：`标题 ‖ 攻关单号 ‖ 版本号 ‖ 名称 ‖ name ‖ 贡献人 ‖ key ‖ id`。

### `GET /api/query/context/:id`
返回 `{node, related: buildRelated(...), progress}`：节点 + 全部 1 跳派生邻域（REF/ANCHORED_TO/coAnchored）+ 全部 ProgressLog。供 Agent 单次推理上下文用。404 if not found。

**严格只读**：调用前后 `audit_log` 行数不变。

## 找帮手（增量5 / §23）

### `GET /api/recommend/helpers/:attackTicketId?limit=<1-50>`
不存在 → 404；非 attackTicket → 400。返回 `HelperRecommendation[]`：`{person, score, reasons[]}`。算法：
- 共享问题单的另一攻关单当前处理人 → +3
- 共享问题单相关贡献的贡献人 → +level（核心3/关键2/普通1）
- 通用兜底（未被锚点计分的）历史核心/关键贡献 → +1 每次，每人上限 +3
- **排除本单当前处理人**（self）

排序 `score desc, 姓名 asc, id asc`。只读。

## 数据大盘（增量6 / §24）

### `GET /api/dashboard`
返回 `DashboardSummary`：
- `tickets`：`{total, byStatus:{[状态]:n}, open, resolved}`（待响应/处理中/进行中 = open；已解决/已关闭 = resolved；非规范状态不计入 open/resolved 但计入 total，**§31 已跳过空 `状态` 入 byStatus 避免 "" 噪声键**）。
- `contributions`：`{total, topContributors:[{贡献人,count}]}`（按贡献条数，count desc / 贡献人 asc / top 5）。
- `proposalsPending`：待审批候选关系数。

只读。

## 资源归档（增量7 / §25）

复用通用 CRUD：`POST /api/nodes/releasePackage` / `POST /api/nodes/weightFile` 等。详见 `config/schemas/releasePackage.json` / `weightFile.json` 字段。共享锚点 `问题单号` 自动并入 coAnchored。

## 增量导入（增量8 / §26）

### `POST /api/import?type=<nodeType>`
multipart form-data `file=<xlsx>`。`type` 缺省 attackTicket；未知 → 400。
按 `nodeType.identityKeys` upsert（任一 key 非空且命中既有节点 → updateNode 合并；否则 createNode）。
返回 `{ created, updated }`。validateNode 失败行跳过。attackTicket 的 `ASSIGNED_TO 攻关申请人` 边幂等（先删后建）。

## 攻关日报（增量9 / §27）

### `GET /api/daily-report?date=<YYYY-MM-DD>`
缺/无效 date → 今日 UTC（不 400）。返回 `DailyReport`：
- `sections`：当日有进展的 ticket，按 seqNo asc 列 entries，`latestStatus` = 当日最后条 statusSnapshot。
- `summary`：`{ticketsTouched, entriesTotal, openByStatus}`（openByStatus 全局）。

只读。

## 跟催/提醒（增量10 / 11 / §28 / §29）

### `POST /api/reminders/scan`
跑规则引擎（问题单跟催 / FE Deadline 提醒 / CCB 提醒）。每三元组 `(kind, ticketId, recipientPersonId)` 7 天窗口内若已存在记录则跳过。返回 `{ created }`。

### `GET /api/reminders?status=<status>`
列出。`createdAt DESC`。`status ∈ {待发送,已发送,已忽略}`。

### `POST /api/reminders/:id/send` / `POST /api/reminders/:id/ignore`
body `{ decidedBy }`。非待发送 → 409；不存在 → 404。
`send` 走 `ChannelAdapter`（默认 `StubChannelAdapter` 仅记录 `sentAt`，不真发；§13#2/§13#3 落实后注入真实 adapter）→ 状态置已发送+audit。

## 导入/导出（增量1.5）

### `GET /api/export/:nodeType`
返回该 nodeType 的全量 xlsx 下载（`Content-Disposition: attachment; filename=<nodeType>-<timestamp>.xlsx`）。包含全部非退休字段当前值。

## 荣誉殿堂（增量 honor）

### `GET /api/honor/leaderboard?period=<period?>`
返回 `LeaderboardEntry[]`：`{贡献人, score, 贡献数, byLevel:{[等级]:n}, byType:{[类型]:n}}`。score = sum(等级权重)。可按 `period` 过滤（匹配 contribution 的 `周期` 字段值）。

### `GET /api/honor/person/:name`
返回 `PersonHonor`：`{贡献人, contributions: [{contribution, attackTicketId?}]}`，attackTicketId 来自 `CONTRIBUTED_TO` 边（contribution 经 `关联攻关单` 写入时自动建立）。

## 配置中心

### `GET /api/settings`
列出所有配置项。返回 `Record<string, { values: string[]; label?: string }>`。

### `GET /api/settings/:key`
获取单个配置项。返回 `{ values: string[], label?: string }`。404 if not found。

### `GET /api/settings/:key/resolve?scope=<scope>`
解析配置项（支持页面级覆盖回退）。先查 `scope.key`（如 `attackTicket.事件级别`），未命中则回退 `key`。返回同上。

### `PUT /api/settings/:key`
创建或更新配置项。body = `{ values: string[], label?: string }`。返回 `{ key, values, label }`。

### `DELETE /api/settings/:key`
删除配置项。返回 `{ deleted: key }`。404 if not found。

## 错误码约定

- 400：客户端错误（参数缺失、validateNode 失败、enum 不合法、字符串类型守卫）。
- 404：实体不存在。
- 409：状态冲突（再次审批已决策的项）。
- 500：兜底错误中间件 `{error: err.message}`。

## 审计

任何写经 `repo.logAudit({action, entityType, entityId, changes, actor})`。审计表 schema 见 `apps/backend/src/db.ts`。读路径**永远不写 audit**——只读 e2e 都断言 `audit_log` 行数不变。

## 配置驱动元注

`POST /api/nodes/:type` 接收**任意** properties，不在 schema 的属性也存（schema 是渲染/校验/派生用，不是存储用）。前端 EntityTable 按 schema 渲染列。新加 nodeType = `config/schemas/<type>.json` + 一个 `<Route element={<EntityTable nodeType="..." />}>` 即可（增量7 案例：releasePackage/weightFile 零后端代码）。
