# 架构评审 — by 系统架构师

日期: 2026-05-30 | 评审分支: master @ commit `6783b0f`
评审范围: 主干 `D:\fighting` 只读独立 review；不涉及 `fighting-postgres` / `fighting-welink` 实验分支。
评审人立场: 20 年系统架构经验，Google L7+ / 前 AWS 首席架构师风格。本评审追求实证、可落地，避免赞美套话。

---

## 总评分: **8.0 / 10**

一句话定调：**这是一个被一根真正想清楚的"轴"穿起来的系统** —— "Node + properties JSON + Schema 注册表"作为单一数据模型，把传统 CRUD 系统会写成 16 张表 16 套 router 16 个 form 的"表格丛林"压成一套泛型管线；少数耦合点（前端单页巨石、SQLite 全表扫描的查询路径）压低了上限，但骨架值得 8 分。

---

## 维度评分

| 维度 | 分 | 评语 |
|------|---|------|
| 整体架构清晰度 | 8 / 10 | 三层 Monorepo（shared / backend / frontend-v2）依赖单向、职责清楚；`createApp({ repo, registry, db, mailSender })` 注入式装配；路由统一为 `makeXxxRouter` 工厂；唯一污点是 `app.ts` 一口气挂载 34 个 router，单文件扛起所有装配，但还在可读阈内。 |
| 领域模型 | 9 / 10 | 真正的"亮活"。`nodes(id, nodeType, properties JSON, search_text)` + `edges(edgeType, sourceId, targetId, properties)` + `progress_log` 是一套**用最少表抽象表达开放域**的方案；`identityKeys` 做幂等导入身份；`concept` / `anchor` / `aliases` 三种语义在 schema 一处声明，REF / ANCHORED_TO / CONFLICTS_WITH / OVERLAPS_WITH 四种派生边由 `refs.ts` / `anchors.ts` / `conflicts.ts` 自动同步并由 `kg-rebuild.ts` 全量重建。"结构化是权威、KG 是派生" 这条原则在代码里被严格执行。 |
| 可演进性 | 8 / 10 | 加一个 nodeType = 在 `config/schemas/` 丢一个 JSON 文件，不需要碰任何 router、迁移脚本、表结构。已有 18 个 schema 文件（attackTicket / person / contribution / teamContribution / infoCard / domain / oncall / weightFile / releasePackage / p3Incident / issue5xx / issue400 / changeIssue / experience / dailyTask / incidentTracking / emailGroup / alarmGovernance）证明这条路是通的。但加新业务能力（如"团队贡献"专属的 leader/members 形态）仍要在 routes.ts 内做特殊判断（CONTRIBUTED_TO 写法、`gradeGate` 等），泛型管线在"少数特殊业务规则"处会破口子。 |
| 解耦 | 7 / 10 | 后端解耦优秀：`Repository` 接口与 `SqliteRepository` 实现分离，shared 包裸定义接口，所有 router 只依赖接口；`MailSender` 也可注入。但**前端是另一个故事**：`AttackDetail.tsx` 已经 1065 行（包含状态流转 / 编辑 / 关系图 / 求助网络 / 日报 / 动态 Tab 等八九个并存的子能力），单组件耦合度过高；`api.ts` 仍是一个 singleton 包揽所有 50+ 端点。后端 7.5、前端 5.5，平均 7。 |
| 巧妙性 | 9 / 10 | 有真正"漂亮"的设计选择，详见亮点章节。Hermes 双跑道（规则引擎+opencode agent，规则优先、agent 走 a2 引用回查防幻觉）、ANCHORED_TO 透明锚节点（占位、自动 GC）、动态 Tab（攻关单可由用户加链接/笔记，不动 schema）、`signServiceToken` 让 agent 走与人类相同的鉴权链路而非旁路 —— 都是经验型的好设计。 |

---

## 三大亮点（实证）

### 亮点 1 — 单一数据模型 + 派生 KG，真正实现了"一份模型多个视图"

证据链：

- 表结构 `apps/backend/src/db.ts:9-37`：仅 `nodes` / `edges` / `progress_log` / `audit_log` / `proposals` / `notifications` 六张核心表 + 索引。没有 `attack_tickets` / `persons` / `contributions` 等 per-nodeType 表。
- 通用 CRUD `routes.ts:136-220`：`/api/nodes/:nodeType` 一组路由覆盖所有 18 种业务实体。新增 nodeType **零代码改动**。
- 派生边集中描述 `kg-rebuild.ts:8`：`DERIVED_EDGE_TYPES = ["REF", "ANCHORED_TO", "CONFLICTS_WITH", "OVERLAPS_WITH"]`，全量重建只要"擦掉 → 重算 → 完成"，业务原始数据零损失。
- 钩子点 `routes.ts:180-182`：每次 `POST /nodes` 后调用 `syncRefEdges` + `syncAnchorEdges`；`refs.ts:22` 自动按 `f.refType` 解析或创建目标节点并写 REF 边；`anchors.ts:20-24` 把"问题单号" / "事件单号"这类锚透明地建在 nodes 表里然后用 ANCHORED_TO 接住。

为什么巧妙：传统作战工具是"每张表一个页面一组 CRUD"，跨表关联往往退化为字符串硬编码或外键迁移地狱。这里的 anchor / concept / refType 把"同一指代实体"用结构化方式抽离 —— `当前处理人` 是 person ref，`研发责任人` 是 `当前处理人` 的 alias，三个不同表里出现的"PB-FH-001"自动通过 ANCHORED_TO 节点串到一起。**业界很少看到一个内部工具能把"图模型"做到这种刚刚好的颗粒度**：不过度抽象成图数据库，也不被关系范式束缚。

### 亮点 2 — Hermes 双跑道 + a2 引用回查（防幻觉机制）

证据链：

- 入口 `app.ts:80-88`：`HERMES_AGENT=1` 开启 agent，否则规则引擎托底；现网"零风险接入"的部署哲学清晰表达在注释里。
- 规则引擎 `hermes.ts:50-100`：纯函数 + 仓库 read API，每个意图分类（find-helpers / ticket-by-pb / fallback-search …）映射到现有只读 API，输出文本 + 引用 + UI widget spec。**零依赖 LLM 就能跑**。
- Agent 实现 `hermes-agent.ts:28-54`：让 LLM 看数据字典 + a2 规则（"另起一行输出 CITATIONS:<id1>,<id2>"），输出后由 `buildCitations` 逐个 `repo.getNode(id)` 回查，**幻觉 ID 静默丢弃**，引用永远落地真实节点。
- 服务令牌 `auth.ts:32-35`：`signServiceToken()` 给 agent 签一个 365 天的 admin token，让 agent 的只读工具走 `authMiddleware` 同一鉴权链路而非旁路 —— 比"内部端口绕过鉴权"那种偷懒做法干净得多。
- 工程务实 `app.ts:87`：`hermesRunner?.warmup()` 在 boot 时预热 opencode serve，省掉首问冷启动。

为什么巧妙：业界做 LLM agent 接 KG 的常见教训是幻觉 + 接口暴露面失控。这里 (1) 双跑道保证降级；(2) a2 强制让 LLM "先看字典，再说出处"，引用必须可机器验证；(3) 用真 token 鉴权而不是开后门 —— **这是一份能写进 textbook 的 LLM-on-KG 集成范式**。

### 亮点 3 — ANCHORED_TO 锚节点 + 透明 BFS

证据链：

- 写边 `anchors.ts:12-24`：同一锚 kind 多字段时 schema 后定义的字段胜出 → 单条 ANCHORED_TO 边；锚节点不存在时自动创建 `{ key: value }` 节点。
- 全图 GC `kg-rebuild.ts:43-49`：rebuild 后"无入边的锚节点直接 deleteNode"。**自动垃圾回收**，避免锚节点污染查询/dashboard。
- BFS 透明穿越 `related-core.ts:42-56`：扩展遍历时锚节点 *被穿过* 但 *不被 emit* —— "occluded relay node"模式，用户看不到锚节点本身，但能看到通过该锚关联的对端业务节点。

为什么巧妙：这是把 RDF/Triple-Store 那一套"blank node"思想，用关系表 + JSON 重新实现，复杂度只增加一个 nodeType 概念但把"跨视图同指代"的真问题解决了。是一种**针对作战领域裁剪过的 OWL/SKOS 实践**，不需要引入图数据库栈。

---

## 三大风险（实证）

### 风险 1 — `queryNodes` 全表扫 + 内存过滤，规模上限低（最致命）

证据链：

- `repository.ts:91-97` —
  ```ts
  queryNodes(nodeType, filter?) {
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE nodeType=? ORDER BY created_at DESC`).all(nodeType);
    let out = rows.map(...);
    if (filter) out = out.filter(n => Object.entries(filter).every(([k, v]) => n.properties[k] === v));
    return out;
  }
  ```
  filter **不下推 SQL**，每次都是"全表读 → JSON 解析 → 内存过滤"。
- 调用方密集：`refs.ts:15` `repo.queryNodes(f.refType)` — 每次保存一条带 ref 的节点，都把整张目标 nodeType 读一遍以找匹配；`anchors.ts:21` `repo.queryNodes(kind).find(...)` — 每次写锚，全表读锚类型。
- `routes.ts:73-83` 私密访问鉴权时为了解析"私密授权组"成员邮箱 → 人员，做了 emailGroup × 邮箱 × person 的**嵌套全表扫**。每次访问私密单都会跑一次。
- conflicts/related/dashboard 都在内存里跑分组聚合。

何时爆：节点总数 ~ 10k 量级前不会感知；攻关单 50 个以上、person 上千、每次写 ticket 触发 syncRefEdges 把 person 全表读一遍 → P99 可能从 200ms 涨到秒级；rebuild KG 是 O(N×字段数) 全部 query，10 万节点会跑几十秒；**真正爆的临界点是当 person 表破万、攻关单破千** —— 这正是工具走出"小团队 PoC"进入"组织级"的那一步。

为什么是风险：架构上没有任何下推到 SQL 的接口（Repository 没有 `queryNodesBy(propertyPath, value)`），所以问题不能靠加个索引修，必须改 Repository 协议。配合迁移到 Postgres / 引入 JSONB GIN 索引的演进，这是个必修课。

**建议**（详见短期建议）：(1) `nodes.properties` JSON 关键路径（姓名、攻关单号、问题单号、邮箱）做 generated columns + 索引；(2) Repository 接口增加 `queryNodesByProperty(nodeType, key, value)`；(3) ref / anchor / private-access 三个高频路径优先改写。

### 风险 2 — 前端 `AttackDetail.tsx` 已成 1065 行巨石组件

证据链：

- `apps/frontend-v2/src/pages/AttackDetail.tsx` 1065 行 —— 同一组件管理 8 个抽屉 form、6 个 useState 抽屉开关、攻关单详情 / 状态流转 / 进展 / 编辑 / 求助网络树 / 日报 / 动态 Tab / 关系图侧栏。
- import 列表 `AttackDetail.tsx:1-30`：22 个 antd 组件 + 12 个 icon + 8 个本地 utils + 4 个 hooks + 5 个 types —— 单文件依赖密度 ~70。
- `HARDCODED_EDIT_FIELDS` 集合 `AttackDetail.tsx:40`：硬编码了 17 个字段名 —— Schema 驱动的口号在这里破口（其他自定义字段走"其它字段"分组，但核心 17 个硬编码渲染）。这是"业务上必要的特殊化" vs "配置驱动通用化"的真实张力点。
- 多个抽屉的 form 状态：editOpen / editForm / editSubmitting / transitionOpen / transForm / transSubmitting / progressOpen / progForm / progSubmitting / drModalOpen / drForm / drSubmitting / supportModalOpen / supportForm / supportSubmitting / addTabOpen / visibleCards … 加起来 20+ 个 useState 同居。

为什么是风险：(1) 测试昂贵 —— Playwright e2e 难以覆盖所有交互排列；(2) 维护昂贵 —— 任何"加一个抽屉"都要碰这个文件，回归面积大；(3) 性能 —— 任一 state 变化整组件 re-render；(4) 与"AGENTS.md 12 条原则"中的"举一反三"冲突 —— 修一个 bug 必须扫描整个文件确认没破其他抽屉。

### 风险 3 — 钩子链失败 = 静默丢失派生数据

证据链：

- `routes.ts:21-25` `triggerPostSaveJobs` 用 `setImmediate` fire-and-forget，捕获并 `log.warn` 后继续；调用方拿到 201 / 200 已经无可挽回。
- `routes.ts:180-182` 保存节点后立即 `syncRefEdges` / `syncAnchorEdges` —— 这两个**同步**调用如果中途抛出，节点写已经在 SqliteRepository 的 transaction 里 commit 了，REF/ANCHORED_TO 边却没建。
- `merge.ts:62` 合并后 `syncConflicts` 是单独调用，没有放在外层事务里。
- `repository.ts:58-66`：`createNode` 自己有 transaction，但只包"INSERT nodes + audit"；后续的 REF / ANCHORED_TO 建边是**事务外**。
- 没有重放机制 —— 一次失败就要靠运维跑 `/api/kg/rebuild` 全量补救，开销大且 rebuild 期间数据不一致。

何时爆：磁盘满 / 进程被信号杀死 / Schema 表损坏（registry.reload 异常） / SQLite busy。本地单机风险低，但一旦上多副本或部署在不稳定基础设施，数据漂移会无声累积。

**建议**：(1) `createNode + syncRefEdges + syncAnchorEdges` 包到同一个 better-sqlite3 transaction（同进程同步调用可以做到）；(2) 失败要 surface 给调用方而不是"201 + warn 日志"；(3) post-save jobs 改为持久化队列（dedup + 重试）而非内存 `setImmediate`。

---

## 短期建议（2 周内）

| # | 建议 | 影响面 | 投入 |
|---|------|--------|------|
| 1 | **Repository 增加 `queryNodesByProperty(nodeType, key, value)`** 接口，在 SqliteRepository 用 `json_extract(properties, '$.<key>') = ?` 实现，并对热点字段（姓名/攻关单号/问题单号/邮箱）建 generated column + 索引 | 后端，约 5 个调用点 | 1 天 |
| 2 | **把 createNode/updateNode 与 syncRefEdges/syncAnchorEdges 包同一事务**，失败时回滚节点写并把 4xx/5xx 给客户端 | 后端 routes.ts + repository.ts | 1 天 |
| 3 | **AttackDetail.tsx 拆分**：抽出 `EditDrawer` / `TransitionDrawer` / `ProgressDrawer` / `SupportNetworkPanel` / `DailyReportPanel` / `DynamicTabsContainer` 6 个子组件，每个独立持有自己的 form/state；主文件降到 ~300 行 | 前端单文件重构 | 2-3 天 |
| 4 | **派生数据可观测性**：rebuild KG 增加 dry-run 模式输出 diff（哪些边将被增/删），现网升级前可预览；同时给 dashboard 加 `kg.last_rebuild_at` 字段 | 后端 + 1 个 dashboard 卡片 | 0.5 天 |
| 5 | **`app.ts` 装配拆分**：34 个 router 按域分组（auth / core-crud / kg / hermes / ops / admin），各组拆到 `app/sections/*.ts`，主 app 降到 ~30 行 | 后端纯重构 | 0.5 天 |
| 6 | **抽出 `useDrawer<T>()` 自定义 hook**（open + form + submitting + reset 标准化）；当前前端到处复制这套样板 | 前端约 12 个抽屉调用点 | 1 天 |
| 7 | **gradeGate 等业务门控提升为声明式**：在 schema field 上加 `permission: "leader+"` 标记，由通用 middleware 统一处理，避免每个新的"特权字段"都改 routes.ts | 后端中等改动 | 1-2 天 |

---

## 长期愿景（3-6 个月）

### 1. Repository 多方言化（Postgres / JSONB / GIN 索引）

短期靠 generated column 续命，长期要把 `SqliteRepository` 抽成 `Repository` 的一个实现，新增 `PostgresRepository`：
- 数据列 `properties` 用 JSONB，按"经常被 filter / order"的 properties 路径建 GIN 索引
- audit_log / progress_log 走 Postgres 分区表（按月）
- 全文检索从 `search_text` 字段升级为 PG `tsvector` + GIN
- 部署目标：SQLite 留作"单机/演示/便携"模式，Postgres 走"组织级"模式 —— 这与提示词里提到的 `fighting-postgres` 实验线一致

接口需要新增 / 改造：`queryNodesByProperty(...)`、`searchNodes(query, filter)`、流式 `streamNodes(nodeType, batchSize)`（导出/迁移用）。

### 2. KG 派生引擎从同步管线 → 异步可重放管线

短期"保存后同步 sync 派生边"够用，长期演进到：
- 节点写 → 推 outbox 事件（同一事务）
- 后台 worker 消费 outbox → 计算派生边 + 更新冲突边 + 触发提醒
- 派生计算可幂等重放（已实现 rebuildKG），但加上**增量重放**（按事件 ID 范围）
- 每个派生器（refs / anchors / conflicts）实现成独立 worker，可水平扩展

这一步让 KG 升级到"事件源"姿态，为多副本部署和实时分析（日报、提醒）打基础。

### 3. 前端"Schema-as-UI"再下沉一层

目前前端是"Schema 驱动列表 + 硬编码细节页"。下一步：
- 把详情页字段渲染也 schema 化（`fieldLayout: { sections: [{ name: '基础', fieldIds: [...] }] }` 进入 schema JSON）
- 抽屉表单复用 `<DynamicForm schema={schema} />`，把 17 个硬编码字段从 AttackDetail 移走
- 留 5%-10% 的"特殊字段"用 escape hatch（自定义渲染器注册表），覆盖团队成员管理、动态 Tab 这类无法完全配置化的能力

这一步做完，新增 nodeType 真的可以**从零到有可用 UI 不写一行前端代码**。

### 4. Hermes 升级为"工具化 agent + 任务记忆"

当前 agent 是单次问答。下一步：
- 让 agent 工具集从只读扩展到"提案级"动作（提交 RelationProposal、起草 DailyReport、起草 reminder） —— 走人审通道，agent 永不直接落库
- 引入对话 session + 引用历史（用户可对引用追问"为什么推荐他"）
- a2 引用回查升级为"可点击溯源链"，前端展开任何 citation 都能看到背后的 SQL 等价查询，符合"可解释 AI"诉求

### 5. 多团队 / 租户隔离

当前是单租户全局可见 + 私密访问字段。组织扩张后需要：
- `nodes` 加 `tenant_id` 列 + 索引
- audit / settings / schema 全部按 tenant 隔离
- schema 文件改为"全局基底 + tenant override"两层
- WeLink / OA 集成（提示词里有线索）走标准 OAuth2 + JIT 用户开通

---

## 与业界对标

| 工具 | 我们对标位置 | 差距与优势 |
|------|-------------|-----------|
| **Linear** | Linear 是"专注的 issue tracker + 漂亮 UX"。我们的攻关单核心模型更接近 Linear issue + workflow，**领域贴合度比 Linear 强**（攻关单状态机、责任人、问题单号锚都是 Linear 没有的本土化能力）；**UX 美感和性能差 1-2 个档**（Linear 是 RSC + 自研状态机，我们是 antd + REST，刷新感更重）。 |
| **Notion** | Notion 是"任意数据库 + property + view"。我们的 Node/Edge/Schema 模型**思想上同源**，但 Notion 的多 view（看板/日历/Gallery）我们只有 Table；Notion 的 inline relation 我们用 REF + 锚做了等价但 UI 弱。**领域专注度比 Notion 强**，**广度差 Notion 一个数量级**（Notion 是通用，我们是垂类）。 |
| **Airtable** | Airtable 是"在线 Excel + Linked Records + Automation"。我们的导入/导出 Excel + 字段别名 + 弹性新列（detectNewColumns）是 Airtable-like 的关键能力，**自动化（jobs / reminders / escalation）跟 Airtable Automations 思路一致**。差距：Airtable 有 API + Marketplace，我们没有生态，但**这不是我们目标**。 |
| **GitLab / Jira** | GitLab Issues / Jira 是巨型工单系统。我们在 *config-driven* / *no-DDL migration* 这条线**比 GitLab 更激进**（GitLab issue 字段仍要走 DB migration）；**审计 + 知识图谱**这条线 Jira 完全没有。但 GitLab/Jira 有的**插件体系 / SAML SSO / 工作流可视化编辑**我们目前没有。 |
| **Internal-tool 同行（Retool / AppSmith）** | Retool 是"配置化 CRUD 表单平台"。我们的 SchemaWizard / DynamicForm 是"小号 Retool"。Retool 长在 **任意后端 + 拖拽 UI**，我们长在 **领域内一切预设、零拖拽** —— 这是路线选择不是优劣。 |

**总评**：在"内部作战工具"这个垂直赛道，主干代码处于**第一梯队偏头部**（前 10%）的位置。比绝大多数从 PRD 直接生成 CRUD 的工具高一个档（因为有真正的领域模型抽象），比业界顶级 SaaS 低一个档（因为前端 polish、性能、生态、UX 设计语言尚未到位）。

**最大的护城河**是 *Node+Edge+Schema 通用容器 + KG 派生* 这一手 —— 让加新业务能力的边际成本远低于传统做法。**最大的风险**是这套抽象的"性能上限"被 SQLite + 全表扫的 Repository 实现压住了 —— 当用户数从 50 涨到 500，会先撞到这堵墙。**两周内修这堵墙** + **3-6 个月完成 Postgres 迁移**，是把这个系统从"L7 级 PoC"推进到"L7 级产品"的关键路径。

---

> 评审完成。本文档为只读 review，未修改任何源码。

