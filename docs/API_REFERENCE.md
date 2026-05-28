# API 参考

> Base：`http://localhost:3001`（开发）/ `http://124.156.193.122:3001`（部署服）。所有响应 `application/json`。错误：`{ error: string }` + 适当 HTTP 码。

## 认证（Auth）

### `POST /api/auth/login`
登录。body = `{username, password}`。成功返回 `{token, user}`。失败 400/401。

### `POST /api/auth/register`
注册。body = `{username, password, displayName?, role?}`。role ∈ `{admin, leader, normal}`（默认 normal）。返回 201 `{token, user}`。用户名已存在 → 409。

### `GET /api/auth/me`
获取当前用户信息。需 `Authorization: Bearer <token>`。`COMBAT_NO_AUTH=1` 时无 token 返回默认 admin。返回 `{user}`。401 if token 无效/过期。

### `PUT /api/auth/change-password`
修改密码。body = `{oldPassword, newPassword}`。需 auth。200/401。

## 用户管理（Users，仅 admin）

### `GET /api/users`
列出所有用户。需 admin 角色。返回 `AuthUser[]`。

### `POST /api/users`
创建用户。body = `{username, password, displayName?, role?}`。需 admin。201/400/409。

### `PATCH /api/users/:id`
更新用户。body = `{role?, displayName?, password?}`。需 admin。200/400/404。

### `DELETE /api/users/:id`
删除用户（不能删自己）。需 admin。200/400/404。

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

### `POST /api/nodes/:id/transition`
原子状态流转（仅 attackTicket）。body = `{toStatus, note?}`。更新 `状态` + 追加含 statusSnapshot 的 progress。200/400/404。

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

### `POST /api/schema/scan`
从磁盘重载所有 schema 配置文件（热加载）。返回 200。

### `GET /api/schema/list`
返回所有 NodeSchema[] 定义。200。

### `GET /api/schema/suggest?q=<keyword>`
按 name/label/alias/concept 搜索 schema 字段。200。

### `POST /api/schema/nodeType`
创建全新 nodeType schema。body = `{nodeType, label, fields[], identityKeys?}`。201/400/409。

### `DELETE /api/schema/nodeType/:nodeType`
删除 schema（若该类型已有节点则拒绝）。200/400/404/409。

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

### `POST /api/hermes/ask`
自然语言问答。body = `{question}`。返回 `{answer, citations?, uiSpec?}`。200/400。

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

### `POST /api/daily-report/publish?date=<YYYY-MM-DD>`
发布指定日期的日报（对当日有进展的 ticket 增加发布计数）。200。

### `GET /api/nodes/:id/daily-reports`
列出某 ticket 的日报条目。200。

### `POST /api/nodes/:id/daily-reports`
创建日报条目（状态=草稿）。body = `{type?, currentProgress, nextSteps?, createdBy?}`。201/400。

### `POST /api/nodes/:id/daily-reports/:eid/publish`
发布（定稿）指定日报条目。200/404。

### `DELETE /api/nodes/:id/daily-reports/:eid`
删除日报条目。204/404。

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

## 审计日志

### `GET /api/audit?action=<action>&entityType=<type>&entityId=<id>&limit=<n>`
查询审计日志。可选按 action/entityType/entityId 过滤。返回 `{total, rows}`。只读。

## 人员合并

### `GET /api/merge/preview?fromId=<id>&toId=<id>`
预览合并结果（属性合并+边迁移预览）。200/400。

### `POST /api/merge/person`
执行合并（不可逆）。body = `{fromId, toId}`。from → to，边全部迁移。200/400。

## 状态升级（Escalation）

### `GET /api/escalation/config`
读取升级 SLA 规则。返回 `{rules: [{事件级别, slaHours, 上升角色}]}`。200。

### `PUT /api/escalation/config`
更新升级规则。body = `{rules: [{事件级别, slaHours, 上升角色}]}`。200/400。

### `POST /api/escalation/scan`
扫描活跃 ticket 的 SLA 违规并自动升级超时单。返回 `{escalated}`。200。

## 手动关联（Relations）

### `POST /api/relations/manual`
创建手动 RELATES_TO 关系。body = `{sourceId, targetId, reason?, sourceField?}`。201/400/404。

### `GET /api/relations/manual?nodeId=<id>`
列出与某节点相关的所有手动关系（双向）。200/400。

### `DELETE /api/relations/manual/:edgeId`
删除手动关系。200/404。

## 冲突检测（Conflicts）

### `POST /api/conflicts/scan`
重新扫描冲突/重叠边（相同当前处理人或相同问题单号）。返回 `{created}`。200。

### `GET /api/conflicts`
列出所有冲突/重叠行（无向，去重）。200。

## 知识图谱（KG）

### `POST /api/kg/rebuild`
清空所有派生边，从结构化数据全量重建 KG。200/500。

## 图谱可视化（Graph）

### `GET /api/graph/snapshot/:nodeType/:id?depth=<1-3>`
BFS 图谱快照（沿 REF/ANCHORED_TO/CONFLICTS_WITH/OVERLAPS_WITH 边遍历）。默认 depth=1。返回节点+边集合。200/404。

## 定时任务（Jobs）

### `POST /api/jobs/tick`
手动触发一次所有定时扫描（conflicts + escalation + reminders + proposals）。200。

## 值班查询（Oncall）

### `GET /api/oncall/current?domain=<domain>`
查询今日值班人（从 oncall 节点中起止日期包含今天的记录派生）。200。

## 自定义命令（Custom Commands）

### `GET /api/commands`
列出所有自定义命令。200。

### `POST /api/commands`
创建自定义命令。body = `{name, template, description?}`。201/400。

### `DELETE /api/commands/:id`
删除命令。200/404。

### `POST /api/commands/:id/run`
执行命令（替换参数后解析为 API 请求）。body = `{args: {param: value}}`。200/400/404。

## 邮件（Email）

### `GET /api/email/config`
获取 SMTP 配置（密码已脱敏）。200。

### `PUT /api/email/config`
更新 SMTP 配置。body = `{host, port, secure, username, password?, fromEmail, fromName?}`。不传 password 则保留原密码。200。

### `POST /api/email/test`
发送测试邮件。body = `{to}`（邮箱地址）。200/400。

### `POST /api/email/send`
发送邮件。body = `{to?, subject, body, groupNames?, personNames?}`。to/personNames/groupNames 展开为收件人列表。200/400。

## 责任矩阵（Responsibility）

### `GET /api/responsibility/diagram`
生成 Mermaid 流程图（升级规则 + 人员分配 + 冲突关系）。200。

## UI 缓存（Pinned Widgets）

### `GET /api/ui-cache/pinned`
列出所有已钉住的 Hermes UI 组件（上限 50）。200。

### `POST /api/ui-cache/pin`
钉住一个 UI 组件。body = `{label?, question?, intent?, uiSpec: {widget, params, cacheKey}}`。201/400。

### `PATCH /api/ui-cache/pinned/:id`
重命名已钉住的组件。body = `{label}`。200/404。

### `DELETE /api/ui-cache/pinned/:id`
取消钉住。200。

## 求助网络（Support Nodes）

### `GET /api/support-nodes/:ticketId`
列出某 ticket 的求助节点。200。

### `POST /api/support-nodes/:ticketId`
创建求助节点。body = `{parentId?, category, domain, personId?, personName?, status?, note?}`。201/400。

### `PUT /api/support-nodes/node/:nodeId`
更新求助节点。body = `{parentId?, category?, domain?, personId?, personName?, status?, note?, resolvedAt?}`。200/404。

### `DELETE /api/support-nodes/node/:nodeId`
删除求助节点及其所有子节点。200/404。

### `GET /api/support-templates`
列出所有求助模板（按使用次数排序）。200。

### `POST /api/support-templates`
创建求助模板。body = `{name, description?, nodes: [{category, domain, parentIndex?, ...}]}`。201/400。

### `POST /api/support-templates/:templateId/apply/:ticketId`
将模板应用到 ticket（克隆模板节点）。usage_count+1。200/404。

### `DELETE /api/support-templates/:templateId`
删除模板及其蓝图节点。200/404。

## 求助请求（Help Requests）

### `POST /api/help-requests`
创建求助请求 + 发送通知邮件。body = `{ticketId, requesterName, targetName?, targetEmail, category, question, extraNote?}`。201/400。

### `GET /api/help-requests?ticketId=<id>&status=<status>`
列出求助请求（可按 ticketId/status 过滤）。200。

### `GET /api/help/feedback/:token`
公开接口：通过反馈令牌获取求助信息（无需认证）。200/404。

### `POST /api/help/feedback/:token`
公开接口：提交反馈（自动追加到关联合同单进展）。body = `{feedback, name?}`。200/400/404。

## 问题反馈（Bug Reports）

### `POST /api/bug-reports`
创建问题反馈（公开，无需认证）。body = `{title, description?, severity?, pageUrl?, reporter?, screenshot?, consoleLogs?, userAgent?}`。severity ∈ `{严重, 较高, 一般, 建议}`。返回 201 `{ id, title, severity, status, ... }`。

### `GET /api/bug-reports?status=<status>&severity=<severity>`
列出问题反馈。可选按状态/严重度过滤。

### `GET /api/bug-reports/:id`
获取单条问题反馈详情。200/404。

### `PATCH /api/bug-reports/:id`
更新问题反馈（含状态流转）。body = `{status?, resolution?, resolvedBy?}`。200/404。

### `DELETE /api/bug-reports/:id`
删除问题反馈。返回 200 `{ deleted: id }`。

## 操作追踪（op-log）

### `POST /api/op-logs`
批量写入操作日志。body = `[{session_id, user_name?, category, detail?, timestamp?}]`。每批上限 200 条。关闭状态下静默返回 `{inserted:0, disabled:true}`。返回 `{inserted, ids}`。

### `GET /api/op-logs?sessionId=&userName=&category=&from=&to=&limit=&offset=`
查询操作日志。category ∈ `{api, navigate, error, action}`。默认 limit=200，上限 1000。返回 `{total, rows}`。

### `DELETE /api/op-logs?before=<ISO>&sessionId=<id>`
清理旧记录。必须指定 `before`（ISO 时间戳）或 `sessionId` 至少一个。返回 `{deleted}`。

### `GET /api/op-logs/settings`
查看操作追踪开关状态。返回 `{enabled}`。默认 true。

### `PUT /api/op-logs/settings`
切换开关。body = `{enabled: boolean}`。返回 `{enabled}`。

## 动态标签（Ticket Tabs）

### `GET /api/tickets/:id/tabs`
列出某攻关单的所有动态标签。按 `tab_order` 升序、`created_at` 排序。返回 `TicketTab[]`。

### `POST /api/tickets/:id/tabs`
创建动态标签。body = `{tabType: "link"|"custom", title: string, config?: object, content?: string}`。tabType 和 title 必填。自动递增 tab_order。返回 201 `TicketTab`。

### `PATCH /api/tickets/:id/tabs/:tabId`
更新标签。body = `{title?, config?, content?}`。至少一个字段。404 若标签不存在。返回 `TicketTab`。

### `DELETE /api/tickets/:id/tabs/:tabId`
删除标签。404 若不存在。返回 `{deleted: tabId}`。

### `PUT /api/tickets/:id/tabs/order`
重排标签顺序。body = `{order: [id1, id2, ...]}`（ID 数组，按新顺序）。返回 `{ok: true}`。

**TicketTab 结构**：`{id, ticketId, tabType, title, tabOrder, config, content, createdBy, createdAt, updatedAt}`。

## 错误码约定

- 400：客户端错误（参数缺失、validateNode 失败、enum 不合法、字符串类型守卫）。
- 401：未登录或 token 过期。
- 403：权限不足（如 normal 角色操作 admin-only 接口）。
- 404：实体不存在。
- 409：状态冲突（再次审批已决策的项、用户名重复）。
- 500：兜底错误中间件 `{error: err.message}`。

## 审计

任何写经 `repo.logAudit({action, entityType, entityId, changes, actor})`。审计表 schema 见 `apps/backend/src/db.ts`。读路径**永远不写 audit**——只读 e2e 都断言 `audit_log` 行数不变。

## 配置驱动元注

`POST /api/nodes/:type` 接收**任意** properties，不在 schema 的属性也存（schema 是渲染/校验/派生用，不是存储用）。前端 EntityTable 按 schema 渲染列。新加 nodeType = `config/schemas/<type>.json` + 一个 `<Route element={<EntityTable nodeType="..." />}>` 即可（增量7 案例：releasePackage/weightFile 零后端代码）。
