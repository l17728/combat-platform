# 作战管理工具 — 产品需求文档 (PRD)

> 最后更新: 2026-05-18
> 状态: 已整合 `req.md` 实际反馈，需求刷新完成，待评审
> **本文档为唯一开发依据。`req.md` 仅作历史参考，不再作为开发依据。**

---

## 0. 核心设计哲学

**本章是最根本的范式，必须贯穿所有设计和实现决策。**

### 0.1 一句话定位

这是一个**作战管理工具**：把团队散落在多个 Excel/系统里的"作战面"（问题攻关、现网问题、变更问题、告警治理、攻关单、日常事项、贡献记录…）收拢为**一个可关联、可探索、可追溯的数据模型**，并用多种形态把它呈现出来。

### 0.2 软件本质：一个数据模型，多个 view

> 软件本质 = **一个大数据模型** + **多张"作战表"作为 view**。每张 Excel 表只是同一模型按某个切面查询出来的不同形式。

- 不要为每张表建独立的 CRUD 孤岛。建**一个模型**，每张表是它的一个 **view（投影）**。
- 同一份数据可在不同 view 间切换，数据一致。
- **要解决的核心问题 = 跨 view 的数据关联**：不同 view 的数据之间是可关联的（同一个人、同一个任务、同一个攻关单在多张表中出现，必须能打通）。

### 0.3 混合数据模型（关键架构决策，已拍板）

采用**混合模型**：

| 层 | 角色 | 用途 |
|---|---|---|
| **结构化模型** | **权威写入源（Source of Truth）** | 所有写入走配置驱动的结构化模型；承载 Excel 表/view 的 CRUD |
| **知识图谱 (KG)** | **派生层（Derived）** | 由结构化数据**自动同步/构建**；专用于跨 view 关联、上钻下钻、探索分析、文档检索、Hermes 问答；可随时重建 |

- 写路径只有一条：结构化模型。KG 不接受直接写入，由结构化数据派生，保证一致性简单、KG 可随时重建。
- 用户的长期理念是"最核心的模型是 schemaless 知识图谱"，本架构以**派生 KG** 满足其探索/分析价值，同时让规则化数据有唯一权威源。

**大设计原则：显式优先 → 模糊兜底 → 并集检索（已拍板）**

- **能明确的一律显式化**：凡能明确表达的，统一由结构化 schema 承载（schema 本身配置驱动、可随时修改 §0.4）。
- **不能明确的走模糊兜底**：无法明确的，经模糊查找/分析做知识图谱匹配；**任何模糊匹配结果必须人工审批后方可固化**（与 §14.3 LLM/Hermes 提议 + 强制人工审批门一致）。
- **检索是并集（hybrid）**：同一次查询**同时命中结构化层与 KG 层**，结果取**并集**呈现——既给出确定的显式结果，也给出待确认的模糊候选（标注来源/置信度，模糊项须人审）。
- 落位：Increment 1 实现"显式/结构化"这一半；模糊匹配 + KG + 并集检索 + 审批门属增量2/3。

### 0.4 配置驱动的 Schema（运行时可增减字段，无 DDL，已拍板）

软件在使用过程中会持续被改，因此 schema 必须**配置驱动**：

- **配置文件**定义实体/字段/view/规则。
- 代码在**启动或手动扫描**时按配置建立/更新数据模型与校验规则。
- **UI 可随时增减字段**，变更**回写配置文件**。
- 字段存储采用**通用 JSON 属性存储，不做 DDL**：`nodes`/`edges` 表 + `properties` JSON 列承载全部业务字段；增减字段=改配置，零数据库迁移风险；类型校验与 UI 全部由配置驱动。
- **UI 采用动态布局**，根据配置自适应字段增减；并支持**传统表格 ↔ 布局/卡片**两种形态切换。

### 0.5 能力清单

| # | 能力 | 说明 |
|---|------|------|
| 1 | 多源导入 + 实体关联 | 从多张 Excel 导入，自动识别同一实体（人/任务/攻关单/领域）并合并 |
| 2 | 跨 view 关联 | 不同 view 数据互通；从任意实体可遍历其全部关联 |
| 3 | 配置驱动 schema | 配置定义模型/字段/view；UI 增减字段回写配置；无 DDL |
| 4 | 多形态渲染 | 同一数据可渲染为：表格、布局/卡片、关系图、时间线、矩阵、看板、统计 |
| 5 | 进展时间序列 | 任务进展按日序列化记录，可追溯 |
| 6 | 派生知识图谱 | 从结构化数据构建 KG，用于探索/分析/文档检索 |
| 7 | Hermes Agent | Agent 直接访问后台数据模型做问答与分析、生成日报 |
| 8 | 贡献荣誉殿堂 | 记录贡献，让"雷锋让人记住" |

---

## 1. 需求优先级与路线（整合 `req.md`）

`req.md` 代表用户最关心的真实需求，用于排序。优先级如下，**未列入首期的需求不得遗忘，全部记录在本 PRD**。

### 1.1 优先级总览

| 优先级 | 模块 | 来源 |
|---|---|---|
| **P0-①** | **问题攻关/公关** | Tony："我主要看到的是第4点" |
| **P0-②** | **荣誉殿堂（贡献记录）** | Tony："攻关完了…记录功劳很容易忘记""雷锋让人记住" |
| P1 | 跨 view 关联 + 实体合并 | 软件核心问题 |
| P1 | 进展时间序列 + 可追溯 | req.md 特殊需求 |
| P2 | 自动日报（信息断裂） | Tony / 李嘉 |
| P2 | 找人推荐（资源断裂） | Tony / 李嘉 |
| P2 | Hermes Agent 问答分析 | req.md |
| P3 | 李嘉 6 条其余（见 1.4） | 李嘉邮件 |

### 1.2 P0-① 问题攻关/公关

核心痛点（`req.md`）：跟踪难、攻关人孤立无援、流程口口相传没固化。

- **攻关单跟踪**：负责人 + 参与人 + 进展刷新与同步；状态、SLA、上升渠道可见。
- **攻关相关信息检索**：能在已沉淀的文档/经验总结/历史攻关单中检索与当前攻关相关的信息（为 Hermes 检索打底）。
- 攻关单数据结构需覆盖 `req.md` 实际字段（见 §2.3 Task/AttackTicket）。

### 1.3 P0-② 荣誉殿堂（贡献记录）

独立模块，让贡献不被遗忘：

- 记录每次攻关/任务中各人的**贡献类型、贡献描述、贡献等级**（Leader 标定）。
- 支持按人/团队/周期聚合，形成"荣誉殿堂"展示（排序/榜单/个人贡献档案）。
- 贡献与攻关单/任务强关联，可从贡献回溯到具体作战。

### 1.4 其余需求清单（记录在案，排期见 §10）

| 来源 | 需求 |
|---|---|
| 李嘉① | 问题单跟催：每人头上的问题单邮件/eSpace 消息自动跟催 |
| 李嘉② | CCB 提醒：需要 CCB 的问题单提醒上会 |
| 李嘉③ | 需求 FE 负责人提醒：待交付 FE 的 Deadline 提醒 |
| 李嘉④ | 关键网上问题 + 版本严重问题跟踪：负责人 + 参与人 + 进展刷新同步（已并入 P0-①） |
| 李嘉⑤ | 版本发布包管理和归档（当前为表格方式） |
| 李嘉⑥ | 权重文件管理和归档（当前为表格方式） |
| Tony | 信息断裂 → 自动日报（welinkcli/Hermes 自动整理攻关群信息） |
| Tony | 资源断裂 → 找人推荐（谁能帮/谁有空/谁必须帮，基于人-知识映射） |

---

## 2. 数据模型

### 2.1 配置驱动的实体定义（EntitySchema）

所有节点/边类型由配置定义，不在代码中硬编码业务字段：

```
EntitySchema (配置文件 / Schema Registry)
  ├── nodeTypes:  { Person, Task, Domain, Team, AttackTicket, Contribution, Document, ... }
  │     每个 nodeType:
  │       ├── fields: [{ id, name, type, enumValues?, required?, label, source?, retired? }]
  │       │     # id: 不可变内部键（创建时定，永不变）；数据与一切引用按 id 取值
  │       │     # label: 可改的展示名；改名只动 label，零数据迁移（详见 §14）
  │       │     # retired: 非破坏退休标记（删字段=置 retired，旧数据保留，可恢复）
  │       ├── identityKeys: [...]      # 实体合并用（如 employeeId/email）
  │       └── derivedToKG: bool        # 是否同步到派生 KG
  ├── edgeTypes:  { ASSIGNED_TO, BELONGS_TO, CONTRIBUTED_TO, ... }
  ├── viewSchemas: [...]               # 见 §3
  ├── flowSchemas: [...]               # 状态机/SLA/上升
  └── ruleSchemas: [...]               # 检测/通知/聚合
版本化管理 + 变更迁移；UI 改字段 → 回写本配置 → 启动或手动扫描生效。
```

字段 `type` 支持：string / number / date / datetime / enum / ref(指向某 nodeType) / sequence(时间序列，见 §2.5)。

### 2.2 结构化存储（通用 JSON 属性，无 DDL）

所有类型统一存两张表，业务字段进 `properties` JSON；增减字段只改配置，不改库结构。

```sql
nodes (
  id          TEXT PRIMARY KEY,
  nodeType    TEXT NOT NULL,        -- Task / Person / Domain / AttackTicket ...
  properties  TEXT NOT NULL,        -- JSON: 全部业务字段（由配置定义/校验）
  search_text TEXT,                 -- 关键字段拼接，全文检索/Hermes 用
  created_at  DATETIME,
  updated_at  DATETIME
)
edges (
  id          TEXT PRIMARY KEY,
  edgeType    TEXT NOT NULL,
  sourceId    TEXT NOT NULL REFERENCES nodes(id),
  targetId    TEXT NOT NULL REFERENCES nodes(id),
  properties  TEXT NOT NULL,        -- JSON: 边属性
  created_at  DATETIME,
  updated_at  DATETIME
)
schema_versions ( id, schemaType, name, version, definition TEXT, created_at )
audit_log ( id, action, entityType, entityId, changes TEXT, performedBy, performedAt )
global_config ( key TEXT PRIMARY KEY, value TEXT, updated_at )

CREATE INDEX idx_nodes_type ON nodes(nodeType);
CREATE INDEX idx_nodes_search ON nodes(search_text);
CREATE INDEX idx_edges_type ON edges(edgeType);
CREATE INDEX idx_edges_source ON edges(sourceId);
CREATE INDEX idx_edges_target ON edges(targetId);
CREATE INDEX idx_edges_source_type ON edges(sourceId, edgeType);
CREATE INDEX idx_edges_target_type ON edges(targetId, edgeType);
```

- 所有变更写 `audit_log`（create/update/delete/merge/escalate），满足"可追溯"。
- DB：SQLite(dev) / PostgreSQL(prod)；PG 下 `properties` 用 JSONB + GIN 索引以加速字段查询。

### 2.3 节点类型

每个节点有全局唯一 ID 和类型标签。字段以配置为准，下列为基线定义。

**Person（人）**：name、employeeId?、email?、imAccount?、role[]（IC/Leader/Director/VP/CTO）、team?、aliases[]（合并用）。

**Task（任务）— 中心节点**
- 基础：title、description?、type[问题解决/攻坚/重构/公关应对/预防/运维]、severity[P0-P3]、classification?[难题/架构债/常规]、status[待响应/处理中/已解决/已关闭]、triggerSource[线上问题/技术债/外部诉求/主动规划/日常运维]、createdAt、createdBy。
- 责任：domain、techOwner、prOwner?、currentOncall。
- 上升：currentEscalationLevel[L1-L3]、currentEscalationContact、slaDeadline?、escalationLogs[]。
- 进展：currentSummary?、**progressSeq**（时间序列，见 §2.5）、nextUpdateDeadline?、subTasks[]。
- 贡献：contributions[]（→ 荣誉殿堂）。
- 技术债（type∈{攻坚,重构} 时激活）：impactAssessment?、workaround?、hasPlan、expectedTimeline?。

**AttackTicket（攻关单）— P0-① 核心，覆盖 `req.md` 实际字段**

```
AttackTicket
  ├── 攻关单号 / OSM问题单号 / 事件单号 / 事件级别(P4A...)
  ├── 标题 / 问题描述 / 影响及现存风险
  ├── 资源ID / 租户ID / 故障局点 / 局点(HC/华为云) / 根因服务(如 ModelArts)
  ├── 客户名称 / 客户要求解决时间 / 客户级别
  ├── 攻关申请人 → Person / 攻关发起说明
  ├── 当前处理人 → Person / 当前处理部门
  ├── 攻关组长 → Person / 攻关成员 → Person[]
  ├── 状态 / 是否已解决 / 攻关有效性
  ├── 攻关响应时长 / 攻关时长 / 创建时间 / 结束攻关时间
  ├── 挂起开始时间 / 总挂起时长 / 解除挂起时间 / 日报发布数量
  ├── progressSeq（进展时间序列，见 §2.5）
  └── contributions[]（→ 荣誉殿堂）
```
AttackTicket 与 Task 共享进展/贡献/上升机制；可视为 Task 的特化 nodeType（由配置定义）。

**Domain（责任田）**：name、description?、area?、owningTeam、oncallSchedules[]、currentOncall（自动推算）。

**Team（团队）**：name、leader、members[]、parentTeam?。

**Contribution（贡献记录）**：task/attackTicket、contributor、type[发现/设计/实施/协调/公关]、description?、level?[普通/关键/核心]（Leader 标定）、recordedAt、recordedBy。

**Document（文档/经验）**：title、content/链接、责任人?、tags[]、relatedTasks[]。承载 `req.md` "经验总结" 表及攻关沉淀，供 P0-① 检索与 Hermes 使用。

**EscalationLog（上升记录）**：task、fromLevel/toLevel[L1-L3]、reason、triggeredAt、receiver→Person、respondedAt?。

**OncallSchedule（排班）**：domain、person→Person、startDate、endDate、rotationType[daily/weekly/biweekly]。

**ProgressLog**：见 §2.5（进展时间序列）。

### 2.4 边类型

边有类型、方向、属性，是跨 view 关联与图遍历的关键。

| 边类型 | 源 | 目标 | 属性 | 语义 |
|---|---|---|---|---|
| `ASSIGNED_TO` | Task/AttackTicket | Person | role:[techOwner,prOwner,oncall,creator,组长,成员] | 分配 |
| `BELONGS_TO` | Task | Domain | — | 归属责任田 |
| `DEPENDS_ON` | Task | Task | type:[blocks,related,duplicate] | 依赖/关联/重复 |
| `HAS_SUBTASK` | Task | Task | — | 父子任务 |
| `ESCALATED_TO` | Task | Person | level,at | 上升 |
| `CONTRIBUTED_TO` | Person | Task/AttackTicket | type,level | 贡献（→荣誉殿堂） |
| `MEMBER_OF` / `LEADS` | Person | Team | — | 团队关系 |
| `ONCALL_FOR` | Person | Domain | schedule | Oncall |
| `RELATES_TO` | 任意 | 任意 | reason | 跨 view 通用关联 |
| `REFERENCES_DOC` | Task/AttackTicket | Document | — | 关联经验/文档 |
| `CONFLICTS_WITH` / `OVERLAPS_WITH` | Task | Task | type/reason | 冲突/重叠（自动检测） |

### 2.5 进展时间序列模型（可追溯）

`req.md` 特殊需求：跟踪进度时进展每天更新，**进展是一个序列**，需可追溯并在 UI 表达序列变化。

```
ProgressLog (序列元素)
  ├── ownerId         # 所属 Task/AttackTicket 节点 id
  ├── seqNo           # 序号（单调递增）
  ├── content         # 当日进展内容
  ├── statusSnapshot  # 当时状态快照（用于回溯状态变迁）
  ├── updatedBy → Person
  └── updatedAt
```

- Task/AttackTicket 的 `progressSeq` = 按 `seqNo` 排序的 ProgressLog 序列；只追加不就地改，修订产生新元素，旧元素保留 → 天然可追溯。
- 与 `audit_log` 配合：进展变迁全程留痕。
- UI 表达见 §3.3（时间线形态 + 表格内"进展"列展开序列）。

### 2.6 派生知识图谱（从结构化数据构建）

- KG 由结构化 `nodes`/`edges` **派生**：结构化写入后，按 `derivedToKG` 配置增量同步到 KG（内存图 / 图索引）。
- 用途：跨 view 关联遍历、上钻下钻、探索分析、文档检索、Hermes 问答。
- KG 不接受直接写；可随时按结构化数据全量重建（容灾/一致性兜底）。
- 规模假设：千级节点先用 SQL 邻接索引上的 BFS/DFS 即可；万级再引入图索引/分页聚类（开放问题 §13）。

### 2.7 全局配置（非图谱节点，系统级，存 `global_config`）

**EscalationMatrix（责任矩阵）**：`cells: Map<(taskType, severity) → EscalationPath>`；`EscalationPath = { L1/L2/L3: { roleOrTeam, slaTimeout } }`。供 §5.1 任务创建时设定上升路径与 SLA。示例：问题解决/P0 → L1:运维Oncall(15min) → L2:运维Leader(1h) → L3:CTO(4h)。在 `/settings`（§9）可视化编辑，版本化。

---

## 3. View 与渲染（Excel 表 = view）

### 3.1 View = 大模型的投影

每张作战表是一个 ViewSchema：定义数据获取（遍历 + 过滤）+ 渲染配置。同一数据多形态、可切换。

```yaml
view:
  name: attackTickets
  label: "未闭环攻关单"
  query:
    nodeType: AttackTicket
    filter: { 状态: [进行中, 待响应, 处理中] }
    traversal: { include: [ASSIGNED_TO, REFERENCES_DOC, CONTRIBUTED_TO] }
  render:
    default: table                  # 默认传统表格
    available: [table, layout, graph, timeline]
  table:
    columns: [攻关单号, 标题, 状态, 当前处理人, 当前进展, 攻关组长]
  layout:                           # 布局/卡片形态
    card: { title: 标题, badges: [状态, 事件级别], body: 当前进展 }
```

### 3.2 内置 view 模板（对应 `req.md` 实际表）

为降低导入与上手成本，内置以下 view/导入模板（字段以 `req.md` 为准，由配置定义）：

| View | 关键字段（节选） |
|---|---|
| 现网问题跟踪 | 问题分类, region, 问题说明, 类别, 影响客户, 发现日期, 当前进展, 风险等级, 状态, 运维责任人, 研发责任人, 关联需求/问题单, 归属模块 |
| 变更相关问题 | region, 严重程度, 问题说明, 发现日期, 归属模块, 当前进展, 状态, 研发责任人, 关联需求/问题单 |
| 告警治理跟踪 | 告警问题, 问题和措施, 进展, 预计闭环时间, 状态, 责任人, 问题单/需求单号 |
| 未闭环P3事件单 | 事件单号, 事件标题, 事件处理人, 客户级别, 当前进展 |
| 未闭环攻关单 | 攻关单号, 标题, 状态, 当前责任人, 当前进展（+ §2.3 全字段） |
| 日常事项跟踪 | 事项描述, 涉及客户, 进展, 计划完成时间, 优先级, 状态, 责任人 |
| 现网400/5xx梳理 | 客户, domain id, 总数, MaaS报错信息, 错误码, model, 说明, 下一步 |
| 经验总结 | 经验, 责任人, 计划完成时间, 链接（→ Document，供检索/Hermes） |
| 荣誉殿堂 | 贡献人, 关联攻关单/任务, 贡献类型, 贡献等级, 贡献描述, 周期 |

### 3.3 渲染形态

| 形态 | 适用 | 技术 |
|---|---|---|
| 传统表格 | 精确筛选、批量操作（默认） | Ant Design Table |
| 布局/卡片 | 概览、移动友好 | 自定义卡片栅格 |
| 关系图 | 跨 view 关联、协作网络 | D3 力导向 / vis-network |
| 层次图 | 上升链路、组织 | D3 tree / dagre |
| 时间线 | **进展序列**、贡献时间线 | Ant Design Timeline |
| 矩阵 | 责任田-人员、任务-人员 | 自定义 grid |
| 看板 | 状态流转 | 拖拽列 |
| 统计 | 负荷/趋势 | ECharts |

进展序列在表格中以"进展"列点开展开为时间线；在详情页以 Timeline 完整呈现并可回溯历史快照。

### 3.4 动态布局与字段配置

- 表格/布局的列与字段**由 ViewSchema + EntitySchema 配置驱动动态渲染**，不硬编码。
- UI 提供字段编辑器：增/删/改字段、改列顺序、切换形态 → 变更**回写配置文件** → 启动或手动扫描生效。
- 表格 ↔ 布局一键切换，数据一致。

---

## 4. 跨 view 关联（核心）

### 4.1 实体解析与合并

跨表同一实体必须识别并合并（"全息"的前提）。优先级：精确 ID（工号/邮箱）→ 别名表 → 模糊匹配（编辑距离+人工确认）→ 人工指定。

- Person 合并：取并集字段，冲突保留最新来源，边自动迁移；**合并不可逆**，记审计日志。
- Task/AttackTicket 通常不自动合并，标题+责任人+时间高度相似 → 标记疑似重复，人工确认。

### 4.2 关联与图遍历

派生 KG 提供遍历 API，是所有关联视图的数据底座。

```typescript
interface TraversalQuery {
  startNodeId: string; startNodeType: NodeType;
  depth?: number;              // 默认2，最大6
  edgeTypes?: EdgeType[];      // 默认全部
  direction?: 'outgoing'|'incoming'|'both';
  nodeTypes?: NodeType[]; filter?: NodeFilter;
}
interface TraversalResult { nodes: GraphNode[]; edges: GraphEdge[]; paths: Path[]; }
```

典型：人的全部任务/攻关单、人+协作网络、攻关单全息（涉及的人及其它任务）、上升链路、领域全景。

### 4.3 冲突/重叠检测（自动）

定时在图上检测并维护 `CONFLICTS_WITH`/`OVERLAPS_WITH` 边：人员负荷过载、SLA 时间密集冲突、同域任务重叠、高优依赖低优未启动。冲突在关系图上红色高亮。

---

## 5. 自动化规则引擎

### 5.1 任务/攻关单创建时

| 触发 | 动作 |
|---|---|
| 创建 | 按 type+severity 查责任矩阵设 L1 接口人，建 ESCALATED_TO |
| 创建 | 按 domain 查排班设 currentOncall，建 ONCALL_FOR |
| 创建 | 对 techOwner/当前处理人做负荷检测，过载告警 |

### 5.2 SLA 超时

| 触发 | 动作 |
|---|---|
| L1 SLA 超时未响应 | 自动升 L2，写 EscalationLog，通知 L2 |
| L2 SLA 超时 | 自动升 L3，通知 L3 |

### 5.3 定时检测与提醒（含 `req.md` 李嘉诉求）

| 检测项 | 频率 | 动作 |
|---|---|---|
| 负荷/时间冲突 | 每小时 | 维护 CONFLICTS_WITH 边 |
| 任务重叠 | 每天 | 同域 Task 对标记 OVERLAPS_WITH |
| 进展催更 | 每天 | nextUpdateDeadline 已过且处理中 → 通知责任人 |
| **问题单跟催**（李嘉①） | 每天 | 每人头上未闭环问题单 → 邮件/eSpace 自动跟催 |
| **CCB 提醒**（李嘉②） | 按需 | 需 CCB 的问题单 → 提醒上会 |
| **FE Deadline 提醒**（李嘉③） | 每天 | 待交付 FE 临近 Deadline → 提醒负责人 |
| 技术债回顾 | 每周 | 长期未更新攻坚/重构 → 提醒回顾 |
| Oncall 轮换 | 每日0点 | 更新 Domain.currentOncall，群通知 |

### 5.4 状态流转

`待响应 →(认领) 处理中 →(解决) 已解决 →(关闭) 已关闭`，可（重开）回 待响应。P0/P1 须在 SLA 内推进否则自动上升；已解决→已关闭须非本人确认。

---

## 6. Hermes Agent 集成

### 6.1 直接访问后台数据模型做问答与分析

- 提供只读数据访问接口（结构化 + 派生 KG），供 Hermes Agent 做自然语言问答、关联分析、上钻下钻探索。
- 边界：Agent 走只读接口（不直接写库）；写操作仍经结构化模型与审计。
- 用于 P0-① "在文档/历史攻关中检索与当前攻关相关信息"。

### 6.2 自动日报（信息断裂 → 见 §10 Phase 3）

- 由 Hermes/welinkcli 自动整理攻关群信息 + 系统内 progressSeq，生成每日攻关日报。
- 日报回写为 ProgressLog 序列元素并计入"日报发布数量"。

### 6.3 找人推荐（资源断裂 → 见 §10 Phase 3）

- 基于 KG 的人-任务-知识关联，推荐"谁能帮/谁有空/谁必须帮"。

---

## 7. Excel 导入 / 导出

### 7.1 导入流程

上传 → 文件类型识别 → 列名智能映射（模糊匹配 + 同义词到 EntitySchema 字段）→ 预览映射 + 样本 → 用户确认/调整 → 逐行解析 → 实体解析与合并（§4.1）→ 预览合并结果 → 写入结构化模型（KG 自动派生）。

### 7.2 智能列映射 + 模板

- 同义词映射：如 "责任人/owner/负责人" → ASSIGNED_TO；"P0/P1" → severity 枚举。
- 预定义模板对应 §3.2 内置 view（含攻关单/经验总结模板）。

### 7.3 增量同步与导出

- 记录每次导入时间戳/行范围，后续按增量提取；策略可选"仅新增"或"新增+覆盖"。
- 任意 view 可导出 Excel（按 ViewSchema 扁平化），双向兼容。

---

## 8. 架构设计

### 8.1 分层架构（配置驱动）

```
UI 层      : 视图渲染引擎（表格↔布局↔图↔时间线，配置驱动动态布局）
           : 字段编辑器（增减字段回写配置）；交互探索（点击/右键聚焦/路径追踪）
业务层     : 结构化写引擎（权威源，配置校验）/ KG 派生同步引擎
           : 遍历·实体解析·冲突检测 / 流程·SLA·上升 / 规则·通知 / 导入导出
           : Hermes 只读访问接口
数据层     : 结构化存储（nodes/edges + properties JSON，无 DDL）
           : 派生 KG（内存图/图索引，可重建）/ 审计日志 / Schema 版本
         ↕ Schema 契约（配置文件 + Schema Registry，版本化）↕
```

所有层通过 Schema 引用字段，**不硬编码业务字段名**。

### 8.2 存储设计

见 §2.2（结构化权威，DDL-free）+ §2.6（派生 KG）。结构化为唯一写路径；KG 由同步引擎从结构化增量构建，可全量重建。

### 8.3 技术选型

| 层 | 技术 |
|---|---|
| 后端 | Node.js + TypeScript + Express |
| DB | SQLite(dev) / PostgreSQL(prod，JSONB+GIN) |
| 图遍历 | 自实现 BFS/DFS（SQL 邻接索引）+ 派生内存图 |
| 前端 | React + TypeScript + Vite |
| 图可视化 | D3.js（力导向/层次）+ vis-network（交互） |
| UI 组件 | Ant Design（+ ProForm，配置驱动动态表单/表格） |
| Excel | xlsx (SheetJS) |
| 规则引擎 | json-rules-engine |
| Agent | Hermes Agent（只读数据接口集成） |

结构：monorepo（backend / frontend / shared types + schema 配置）。

### 8.4 配置驱动运行机制

启动或手动"扫描配置"时：校验配置 → diff 上一版本 → 更新 Schema Registry → 重建校验器/视图渲染元数据 → 触发 KG 重建（如 schema 变化影响派生）。UI 改字段 → 写回配置文件 + 版本+1 → 提示需扫描生效。

---

## 9. 页面 / 功能清单

| 类 | 页面 | 路径 | 说明 |
|---|---|---|---|
| 全局 | 全局图谱 | `/graph` | 跨 view 关联力导向图 |
| 全局 | 冲突仪表盘 | `/conflicts` | 冲突/重叠汇总 |
| 全局 | 配置中心 | `/settings` | EntitySchema/ViewSchema/责任矩阵/扫描生效 |
| 作战 | 攻关作战台 | `/attack` | **P0-①** 攻关单跟踪 + 进展序列 + 上升 + 关联检索 |
| 作战 | 荣誉殿堂 | `/honor` | **P0-②** 贡献记录/榜单/个人贡献档案 |
| 实体 | 任务/攻关单列表 | `/tasks` | 表格↔布局↔图↔时间线 |
| 实体 | 任务/攻关单详情 | `/tasks/:id` | 详情+局部关系图+进展序列+贡献+上升 |
| 实体 | 人员列表/详情 | `/people` `/people/:id` | 负荷+全部任务+协作网络+贡献汇总 |
| 实体 | 责任田 | `/domains` | 责任田-人员-Oncall 矩阵 |
| 切面 | 上升渠道 | `/escalation` | 上升链路图+超时列表 |
| 切面 | 文档/经验 | `/docs` | 经验总结，供检索/Hermes |
| 操作 | 导入 | `/import` | Excel 上传→映射→预览→确认 |

### 9.1 仍记录在案、暂未排期的需求页面

发布包归档（李嘉⑤）、权重文件归档（李嘉⑥）、自动日报中心、找人推荐 —— 见 §10 排期。

---

## 10. 分期实施计划（按新优先级）

### Phase 1 — 数据底座 + 配置驱动 schema + 攻关作战台骨架（P0-①）

| # | 内容 |
|---|---|
| 1.1 | 项目脚手架（monorepo: backend / frontend / shared + schema 配置目录） |
| 1.2 | Schema Registry + 配置驱动机制（配置→模型/校验，启动/手动扫描，版本化） |
| 1.3 | 结构化存储（nodes/edges + properties JSON，CRUD，审计日志，无 DDL） |
| 1.4 | EntitySchema 基线（Person/Task/AttackTicket/Domain/Contribution/Document） |
| 1.5 | Excel 导入引擎（列映射 + 预览 + 实体解析合并 + 写入） |
| 1.6 | 攻关作战台 `/attack`：攻关单列表/详情（表格形态）+ 基础筛选 |
| 1.7 | 进展时间序列模型 + 详情页时间线表达（追加+追溯） |

### Phase 2 — 荣誉殿堂 + 关联 + 派生 KG（P0-② / P1）

| # | 内容 |
|---|---|
| 2.1 | 荣誉殿堂 `/honor`：贡献记录 + 等级标定 + 聚合榜单/个人档案 |
| 2.2 | 派生 KG 同步引擎（结构化→KG 增量 + 全量重建） |
| 2.3 | 跨 view 关联：图遍历 API + 全局图谱页 |
| 2.4 | 实体解析与合并（精确/模糊/人工确认） |
| 2.5 | 责任矩阵 + Oncall 排班 + 任务创建自动化 + SLA 上升 |
| 2.6 | 冲突/重叠检测引擎 + 冲突仪表盘 |
| 2.7 | 多形态渲染：表格↔布局↔图↔时间线切换；动态字段编辑器回写配置 |

### Phase 3 — Hermes + 自动化 + 其余 `req.md` 需求

| # | 内容 |
|---|---|
| 3.1 | Hermes Agent 只读数据接口（问答/分析/攻关信息检索） |
| 3.2 | 自动日报（welinkcli/Hermes 整理攻关群 + progressSeq → 日报） |
| 3.3 | 找人推荐（KG 人-知识映射） |
| 3.4 | 问题单跟催 / CCB 提醒 / FE Deadline 提醒（李嘉①②③） |
| 3.5 | 版本发布包归档 / 权重文件归档（李嘉⑤⑥） |
| 3.6 | 增量导入 + 任意 view 导出 + 数据大盘 |

---

## 11. 验证标准

**Phase 1**
- [ ] 改配置文件增/减一个字段，扫描后无需改库结构、UI 表格/表单同步变化
- [ ] 从多张 Excel 导入，同一人跨表正确合并为一个 Person
- [ ] 攻关作战台可展示/筛选攻关单，字段覆盖 `req.md` 实际字段
- [ ] 攻关单每日追加进展，详情页时间线按序展示且历史可回溯
- [ ] 所有写操作在 audit_log 留痕

**Phase 2**
- [ ] 荣誉殿堂可按人/团队/周期聚合贡献并展示榜单，可从贡献回溯到攻关单
- [ ] 派生 KG 可从结构化数据全量重建，结果与增量同步一致
- [ ] 从 Person 可遍历到其全部任务/攻关单，反向亦可；冲突边红色高亮
- [ ] 同一数据可在表格/布局/图/时间线间切换且一致

**Phase 3**
- [ ] Hermes 可对后台数据模型做只读问答，并检索到相关历史攻关/经验
- [ ] 自动日报生成并计入"日报发布数量"
- [ ] 问题单跟催/CCB/FE Deadline 提醒按规则触发

---

## 12. 关键设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 数据模型主从 | **结构化为权威源，KG 为派生层** | 单一写路径，一致性简单，KG 可随时重建；兼顾探索分析价值 |
| 动态字段存储 | **通用 JSON 属性，无 DDL** | "随时增减字段、回写配置、零迁移风险"；与配置驱动一致 |
| Schema | 配置驱动，全三层 | 软件必持续改，配置驱动确保改得动；UI 改字段回写配置 |
| 软件本质 | 一模型 + 多 view | Excel 表只是同一模型的不同投影；核心是跨 view 关联 |
| 首期优先级 | P0-① 攻关、P0-② 荣誉殿堂 | `req.md` 用户最关心；其余记录在案排后 |
| 进展 | 追加式时间序列 + 审计 | 进展是序列且须可追溯 |
| Hermes | 只读接口集成 | 让 Agent 能问答/分析而不破坏写路径权威性 |
| 文档定位 | PRD 唯一依据，req.md 参考 | 用户明确指示 |

---

## 13. 开放问题

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | Hermes Agent 的具体接入形态（SDK/HTTP/MCP）？ | Phase3 集成 | **部分解决（§22）**：增量4 已交付传输无关 HTTP 只读数据访问契约（任意 SDK/MCP 适配器可包装）；具体传输绑定待 Hermes 侧接口确定 |
| 2 | 通知渠道：邮件 / eSpace / welink？ | Phase2-3 跟催/日报 | 先邮件，后接 eSpace/welink |
| 3 | welinkcli 抓取攻关群消息的可行性与权限？ | Phase3 自动日报/找人 | 需确认 welinkcli 能力与合规 |
| 4 | 权限模型（谁可见/可改/可标定贡献等级）？ | 全局 | Phase1 不做，Phase2 加 RBAC（贡献等级仅 Leader） |
| 5 | 图谱规模上限？ | KG 存储/渲染 | 千级先用 SQL+内存图，万级引入图索引/分页聚类 |
| 6 | 发布包/权重文件归档：仅元数据登记还是文件托管？ | 李嘉⑤⑥ | **已解决（§25）**：增量7 交付**元数据+链接登记**（`releasePackage` / `weightFile` 两 nodeType），文件托管后续按需评估 |
| 7 | 字段 id 生成策略（新字段 slug 派生算法/唯一化/中文）？ | §14 增量1 | 现有字段 id=原名；新字段：名字派生 slug + 冲突加序号；最终化 §14.2 |
| 8 | 跨颗粒度锚点的权威清单（问题单号/OSM/事件单号/domain id/客户）？ | §14 增量3d | **已解决（§21.1）**：锁定 `问题单号`（含 OSM/关联需求·问题单）/`事件单号`/`domain`/`客户`（含 涉及/影响客户），配置可扩展 |
| 9 | `applyFieldOp` 回滚粒度：`reload()` 全目录重解析，无关 sibling 配置损坏会误回滚本次有效变更 | §14.2B 增量1 已交付 | **已解决（§30）**：增量12 把 reload 改为容错（跳过损坏 sibling+warn），applyFieldOp 仅校验被写文件 |

---

## 14. 可编辑 Schema 与跨 View 关联（演进路线）

> 本章细化并作为 §0.4 / §2.1 / §3.4 / §4 在"用户可手工增删改记录与字段、跨 view 动态关联"方向上的权威规格。**§14.2 是下一次实现（增量1）的开发依据。**

### 14.1 背景

Phase-1 MVP 把范围收敛到"导入+只读+进展"，缺少手工建/改记录与 UI 增删字段——对每天要用的工具这是底线 UX 缺失（用户明确反馈）。同时"用户自改字段名 / 不同 view 字段名不一 / 跟踪对象颗粒度不对齐"需要统一的关联机制。解法分层递进，分多个增量交付。

| 增量 | 内容 | 状态 |
|---|---|---|
| **增量1** | 字段稳定 ID 地基 + 记录 CRUD + UI 字段管理(回写配置) + 可编辑表格 | ✅ 完成、tag、已部署（§14.2） |
| **荣誉殿堂 (P0-②) + 平台集成** | 贡献记录(配置驱动)+CONTRIBUTED_TO+等级加权榜单+个人档案 **+ 统一外壳/导航 + 作战平台首页** | **进行中：本次实现（规格见 §15）** |
| 增量1.5 | **服务端全量导出 Excel**（落实 §7.3 到 EntityTable 界面） | ✅ 完成、tag、已部署（§16） |
| 增量2 | 字段 `aliases` 别名映射：导入列归一 + UI 别名管理（精确等值；模糊推荐+人审门留后续） | ✅ 完成、tag、已部署（§17） |
| 增量3（拆解） | ref→实体+concept+跨颗粒度锚点+LLM提议人审+派生KG —— **跨多子系统，拆 3a/3b/3c/3d 各自独立交付** | 拆解见 §18.0 |
| └ 增量3a | `type:ref` 写入解析建实体+建有向边 + 1跳跨view关联只读API/页 | ✅ 完成、tag、已部署（§18）+ 全功能 e2e 覆盖审计门确立 |
| └ 增量3b | 语义 `concept`：字段挂 concept→写 REF 边→/api/related 按 concept 分组（异名同 concept 归并可见） | **进行中：本次实现（规格见 §19）** |
| └ 增量3c | LLM/Hermes 提议候选关系 + **强制人工审批队列**（§0.3/§14.4） | 已定向（需 3a） |
| └ 增量3d | 跨颗粒度锚点：类型化层级/聚合边 + 共享最细锚点 + 桥接节点 | 已定向（需 3a） |

### 14.2 增量1 规格（开发依据）

**A. 字段稳定 ID / 显示名解耦（地基）**
- `FieldSchema` 增不可变 `id`（创建时定、永不变）；`label` 为可改展示名。数据(`properties`)与一切引用（view 列、校验、导入映射）一律按 `id` 取值，按 `label` 显示。
- 零迁移迁法：现有字段 `id` 初始化为其当前中文名（如 `标题` 的 id 即 `"标题"`），与现存 `properties` 键天然对齐；改名只改 `label`，`id` 不动；新字段创建时分配派生 slug（开放问题 §13#7）。
- 属于对已锁 `@combat/shared` 契约的有意演进：`FieldSchema` 加 `id` + 可选 `retired`；`validateNode`、前端列渲染改为按 `id` 取值、按 `label` 显示。

**B. 字段管理（UI → 回写配置）**
- 新增 `PATCH /api/schema/:nodeType`：加字段(分配新 id，零 DDL) / 改 label / 改 enumValues / **退休字段**(置 `retired:true`) / 取消退休。持久化回 `config/schemas/<type>.json`(`version`+1)→ `reload()`；**写文件后 reload 校验失败则回滚到上一版 JSON**（复用 §2.7/Registry 硬化的报错→可回滚）。
- **删字段 = 非破坏退休**（用户已拍板）：从活跃 schema 移除展示/校验，节点 `properties` 旧值保留；重新加回同 `id` 字段即恢复。所有 schema 变更写 `audit_log`。

**C. 记录手工增删改 + 可编辑表格**
- 后端：建（已有 `POST /nodes/:type`）；改 → 暴露已实现的 `updateNode` 为 `PUT /api/nodes/:id`；删 → `Repository` 增 `deleteNode` + `DELETE /api/nodes/:id`（**记录硬删** + 写 `audit_log`；区别于字段的非破坏退休）。
- `@combat/shared` 契约演进：`Repository` 增 `deleteNode(id, actor)`；前端 `Api` 增 `createNode / updateNode / deleteNode / patchSchema`。
- 前端 `/attack` 升级为**可编辑 Excel 式表格**：单元格行内编辑并保存、新增行、删除行；列由 schema 动态生成（按 `id`/`label`）；列头菜单"加字段 / 改名 / 退休字段"。
- **不含**表格↔布局/卡片切换（用户已拍板，留后续增量）。

**D. 测试（TDD + 前后台全 e2e）**
- 后端 e2e：记录 建/改/删（含 audit 断言）；`PATCH` 加字段 → 新 id 可写读（证零 DDL）；改 `label` → 老数据按 `id` 仍取到；退休字段 → 数据保留且不再校验、可恢复；非法 schema 写入 → 回滚且旧 schema 可用；`DELETE` 不存在 id → 合理响应。
- 前端 Playwright e2e：行内改值持久化（刷新仍在）；加行；删行；列头加字段→新列出现可填；改列名→数据不丢；退休列→列消失但重加恢复数据。复用既有确定性 e2e 框架（fresh-DB global setup）。
- 复用既有 TDD→spec 评审→代码质量评审→修复闭环;并行拆分按依赖波次。

### 14.3 跨 View 关联方向（增量2/3 定向，不在增量1）

- **别名/同义词映射（增量2）**：EntitySchema 定义 canonical 字段；ViewSchema/导入声明别名→canonical `id`；人工维护 + 模糊推荐（编辑距离/同义词，延伸 §7.2）。
- **ref→实体 + 语义 concept（增量3）**：关系型字段（责任人/处理人/组长…）本质是 `type:ref` 指向实体，关联=图的边而非字符串匹配；字段挂 `concept`（语义角色），异名同 concept 自动归并。
- **跨颗粒度关联（增量2/3）**：`RELATES_TO`/"相关" 仅作兜底，**不是最优**。标准做法由弱到强：①类型化层级/聚合边（`PART_OF`/`AGGREGATES`/`ROLLS_UP`/`DERIVED_FROM`/`CAUSED_BY`）承载颗粒度关系，上钻下钻=定向遍历；②显式 grain/level（节点层级或按颗粒度分 nodeType）使"不对齐"可查询；③**(最强、首选)经共享最细粒度锚点实体关联**——粗对象不互连，统一连到共享原子，跨 view 关系由"共享锚点"派生（req.md 现成锚点：问题单号/OSM单号、事件单号、domain id、客户）；④关联本身带属性时用**桥接(关联)节点**而非裸边。这与 §0.2/§4 派生 KG 范式一致。
- **LLM/Hermes 提议关系 + 强制人工审批门（增量2/3）**：实体解析与跨 view 关联的候选关系由 LLM/Hermes agent 基于锚点/别名/语义**自动提议**，但**任何关系在落库前必须经人工审批（通过/拒绝/修正）**；审批结果回流为正/负样本持续改进提议质量。延伸 §2.1/§4「模糊匹配→人工确认」与 §6「Hermes 只读」：Agent 只提议、不直接写，写路径仍走结构化权威源 + 审计。

### 14.4 关键设计决策（补充 §12）

| 决策 | 选择 | 理由 |
|---|---|---|
| 字段身份 | **稳定 id 与 label 解耦，数据按 id 存** | 改名/增删字段不破坏数据与引用；零迁移；跨 view 关联前提 |
| 删字段语义 | **非破坏退休（retired），数据保留可恢复** | 避免不可逆数据丢失；与审计/不可逆合并的审慎一致 |
| 删记录语义 | **硬删 + 写 audit** | 记录不需列级可恢复；审计可追溯 |
| 增量1 范围 | 仅可编辑表格，不含布局切换 | 最小可用闭环；YAGNI |
| 跨颗粒度关联 | 锚点优先 + 类型化层级边；"相关"仅兜底 | 语义不丢、可上钻下钻；符合派生 KG 范式 |
| MVP UX 底线 | 任何数据特性首切片须含手工 CRUD | 用户反馈：只读/只导入不可用 |
| 关系建立 | LLM/Hermes 提议 + **强制人工审批门**（增量2/3） | 自动召回 + 人审准确率；Agent 不破坏写权威性，审批样本回流改进 |

---

## 15. 荣誉殿堂（贡献记录）增量规格（开发依据）

> 落实 PRD §1.3 **P0-②** / §2.3 Contribution / §2.4 CONTRIBUTED_TO / §10 Phase 2。复用增量1 的配置驱动通用存储 + 可编辑表格。本节是本增量的实现依据。

### 15.1 数据模型（配置驱动，零新增通用存储代码）

新增 `config/schemas/contribution.json`，`nodeType: contribution`，字段（id=name；枚举沿用 req.md/§1.3 原文）：

| 字段 | 类型 | 说明 |
|---|---|---|
| 贡献人 | string(必填) | 姓名或工号 |
| 关联攻关单 | string | 关联的攻关单（其 `攻关单号` 或 id） |
| 贡献类型 | enum(必填) | 发现 / 设计 / 实施 / 协调 / 公关 |
| 贡献等级 | enum | 普通 / 关键 / 核心 |
| 贡献描述 | string | |
| 周期 | string | 如 `2026-Q2` / `2026-05` |
| 记录时间 | datetime | |
| 记录人 | string | |

创建贡献时（API 层）同时建一条 `CONTRIBUTED_TO` 边 `contribution → attackTicket`，用于回溯。**目标解析规则（明确）**：取一个 attackTicket 节点，其 `攻关单号` 属性等于"关联攻关单"值；若无匹配则退而匹配 `标题` 等于该值；仍无匹配则**只存字段、不建边、不报错**（首匹配；空值同样不建边）。复用现有 `createEdge/queryEdges`。

### 15.2 后端

- Contribution 的 CRUD 完全走**现有通用路由**（`POST/GET/PUT/DELETE /api/nodes/contribution`、`GET /api/schema/contribution`）——零新增通用代码。`POST /api/nodes/contribution` 之后，若 body 含可解析的"关联攻关单"，建 `CONTRIBUTED_TO` 边（在 nodes 路由内对 `contribution` 类型做此一处特化，或独立 honor 路由处理创建）。
- 新增 2 个**只读聚合**路由（独立 `honor` 路由模块）：
  - `GET /api/honor/leaderboard?period=<可选>` → 按贡献人聚合：`score = Σ 等级权重`（**默认 普通=1 / 关键=3 / 核心=8**，常量，注释标注后续可配置化），返回按 score 降序的 `[{ 贡献人, score, 贡献数, byLevel{普通,关键,核心}, byType{...} }]`；`period` 传入则先按 `周期` 过滤。
  - `GET /api/honor/person/:name` → 该贡献人全部 Contribution（含其"关联攻关单"值与（若有）CONTRIBUTED_TO 边目标的 attackTicket id，用于前端回链）。

### 15.3 前端

- 把现有可编辑表格组件**泛化为接收 `nodeType` 参数**（它已完全 schema 驱动；仅 `NODE="attackTicket"` 常量与 `标题→Link` 特化需参数化：链接特化改为"当存在某约定字段时才链接"，contribution 无此字段则不链接）。新增路由 `/contributions` 复用之做贡献增删改。
- 新增页 `/honor`（荣誉殿堂）：排行榜表（名次 / 贡献人 / 加权得分 / 贡献数 / 各等级计数）+ `周期` 筛选输入；点击贡献人 → 个人贡献档案（其贡献列表，每条可链接回关联攻关单详情 `/attack/:id`）。
- **平台集成（本增量内，用户诉求）**：用 AntD `Layout` 建一个**统一应用外壳 `AppShell`**（侧边或顶部导航贯穿所有页：首页 / 攻关作战台 / 荣誉殿堂 / 贡献录入 / 导入），替换 Phase-1 `App.tsx` 里的极简 `<nav>` 文字链接；所有现有+新增页面渲染在该外壳内（统一标题栏/导航高亮）。
- **作战平台首页 `/`**：导航式落地页——若干模块卡片（标题+简述+进入按钮）链接到 攻关作战台/荣誉殿堂/贡献录入/导入。**不含实时指标/仪表盘**（延后）。路由调整：`/`=首页（原 `/`→AttackTable 取消），`/attack`+`/attack/:id` 不变，新增 `/honor`、`/contributions`、`/import` 不变。注：现有 e2e（attack.spec/editable.spec）均显式 `goto("/attack")`，不依赖裸 `/`，故首页改动不影响既有 e2e。

### 15.4 测试（TDD + 前后台全 e2e）

- 后端 e2e：创建 contribution（配置驱动校验）+ CONTRIBUTED_TO 边建立；leaderboard 加权得分与排序、byLevel/byType 计数、period 过滤；person 档案返回该人贡献 + 攻关单回链；非法枚举被拒。
- 前端 Playwright e2e：经 `/contributions` 录入一条贡献（关联某攻关单）→ `/honor` 看到该人按加权得分排名 → 点贡献人进个人档案 → 列表含该贡献并可链接回攻关单。
- 复用确定性 e2e 框架；`reset-db.cjs` 的 per-run 配置恢复集**加入 `contribution.json`**。

### 15.5 关键设计决策（补充 §12/§14.4）

| 决策 | 选择 | 理由 |
|---|---|---|
| 贡献实体 | 配置驱动 nodeType，复用通用 CRUD | 零新增存储代码；与 §0.4 一致 |
| 贡献↔攻关单 | 存字段值 + 建 CONTRIBUTED_TO 边 | 双保险；支持从贡献/攻关单双向回溯 |
| 排名指标 | 等级加权 score（默认 1/3/8，常量可后续配置化） | "雷锋让人记住"需突出关键/核心贡献 |
| 等级标定权限 | **无 RBAC**，谁都可填等级 | 全应用尚无鉴权；RBAC 按 §13#4 延后 |
| 可编辑表格 | 泛化出 nodeType 参数（小重构） | 复用、不重复造轮子；借机改良所接触代码 |
| 首期范围 | 录入 + 加权个人榜单 + 个人档案 + 回链 + `周期` 筛选 | 用户选定。**团队维度不在本期**（尚无 Team 数据模型/Person→Team 关系）——延后 |
| 平台集成 | 本增量内：统一 AntD Layout 外壳 + 导航式首页 `/` | 用户诉求"页面集成、要首页"；导航式（不含实时指标仪表盘——延后），最小集成不返工 |

### 15.6 验收标准

- [ ] `contribution.json` 配置生效，经 `/contributions` 可增删改贡献，枚举校验生效（配置驱动，零 DDL）
- [ ] 创建带"关联攻关单"的贡献后存在 CONTRIBUTED_TO 边，可双向回溯
- [ ] `/api/honor/leaderboard` 加权得分/排序/各等级计数正确，`period` 过滤生效
- [ ] `/honor` 展示排行榜，点人进个人档案，档案条目可链接回攻关单详情
- [ ] 统一外壳 `AppShell` 生效：所有页面在同一 Layout 内，侧/顶导航可在 首页/攻关作战台/荣誉殿堂/贡献录入/导入 间切换
- [ ] `/` 为作战平台导航首页（模块卡片可进入各模块）；既有 e2e（goto `/attack`）不受影响仍全绿
- [ ] `npm run test:all` 全绿（含新增后端 e2e + Playwright：honor 用例 + 首页/导航集成用例）；完成后部署到测试服务器

---

## 16. 服务端全量 Excel 导出（增量1.5 规格，开发依据）

落实 §7.3「任意 view 可导出为 Excel，双向兼容」到 EntityTable 界面。复用既有 `xlsx`(SheetJS，已是后端依赖)。

### 16.1 后端

- 新增 `apps/backend/src/export.ts`：`makeExportRouter(repo, registry): Router` → `GET /api/export/:nodeType`：
  - `registry.getNodeSchema(nodeType)` 未知 → 404 `{ error }`。
  - `repo.queryNodes(nodeType)` 全量（**忽略任何 UI 过滤——全量导出**）；按**活跃字段**（`!retired`）将每行扁平化为 `{ [field.label]: properties[field.id] }`（表头用 `label` 人类可读，值按稳定 `id` 取——与导入 `mapColumns` 的 name/label 匹配对称，实现 §7.3 双向兼容）。
  - `xlsx` `json_to_sheet`→`book_append_sheet`→`write({type:"buffer",bookType:"xlsx"})`；响应头 `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`、`Content-Disposition: attachment; filename="<nodeType>-<ISO时间>.xlsx"`，body 为 buffer。
- `app.ts`：挂载 `makeExportRouter(deps.repo, deps.registry)` 于 `/api`，在全局错误中间件之前。

### 16.2 前端

- `EntityTable` 头部新增「导出 Excel」按钮，`aria-label="export-excel"`，实现为 `<a href={\`/api/export/${nodeType}\`} download>`（浏览器走 attachment 头直接下载，零 blob 处理）。`/attack`、`/contributions` 复用同组件自动具备。

### 16.3 测试（TDD + 前后台 e2e）

- 后端 e2e：建数条记录 → `GET /api/export/attackTicket` 200 + 正确 content-type；`XLSX.read` 回解析，表头=活跃字段 `label`、值按 `id` 正确、退休字段不出现；未知 nodeType→404。
- 前端 Playwright：`/attack` 点「导出 Excel」→ `page.waitForEvent('download')` 触发，`suggestedFilename` 匹配 `attackTicket-*.xlsx`。复用既有确定性 e2e 框架（无需改 reset-db.cjs）。

### 16.4 关键设计决策（补充 §12）

| 决策 | 选择 | 理由 |
|---|---|---|
| 导出位置 | 服务端端点 | 全量、与导入对称、复用后端 xlsx；前端零依赖新增 |
| 导出范围 | 该 nodeType 全部记录（忽略 UI 过滤） | 用户选定"全量导出" |
| 表头/取值 | 表头=活跃字段 label，值按 field.id | 可读 + 与 §7 导入列映射对称（双向兼容） |
| 退休字段 | 排除 | 与 §14 退休=非破坏隐藏一致 |
| 鉴权 | 无 | 与全局一致（§13#4 延后） |
| 范围 | 仅服务端全量；不含客户端过滤导出/样式 | YAGNI |

### 16.5 验收标准

- [ ] `GET /api/export/:nodeType` 返回合法 xlsx（正确 content-type + attachment 文件名）；回解析行=全量、表头=活跃字段 label、值按 id 正确、退休字段不含；未知 nodeType→404
- [ ] `EntityTable`「导出 Excel」按钮在 `/attack` 与 `/contributions` 均可触发浏览器下载
- [ ] `npm run test:all` 全绿（含新增导出后端 e2e + Playwright 下载用例）；完成后部署到测试服务器

---

## 17. 字段别名映射（增量2 规格，开发依据）

落实 §14.3「别名/同义词映射（跨 view/导入名字归一）」第一步与 §0.3「显式优先」。本增量只做**显式别名**（精确等值）；**模糊推荐 + 强制人工审批门**（§0.3/§14.4）留后续增量；跨 view 查询归一留增量3。

### 17.1 契约（@combat/shared）

`FieldSchema` 增可选 `aliases?: string[]`（纯加法，与 `retired?` 同性质，不破坏现有数据/配置/校验）。

### 17.2 后端

- `apps/backend/src/import.ts` `mapColumns`：列→字段匹配从 `k===f.name || k===f.label` 扩展为 `k===f.name || k===f.label || (f.aliases ?? []).includes(k)`（k、name、label、alias 均 `trim()`）。遍历 `schema.fields` 顺序，首个命中某 Excel 列的字段胜出；输出仍按 `f.id` 键。效果：跨表异名列（研发责任人/运维责任人/责任人/owner/当前处理人…）归到同一 canonical 字段。
- `@combat/shared` `FieldOp` 新增变体 `{ op: "setAliases"; id: string; aliases: string[] }`。`apps/backend/src/registry.ts` `applyFieldOp` 处理该 op：`find(id)` 后整体替换 `field.aliases = op.aliases`，复用既有「写回 config JSON → reload → 失败回滚」机制。`PATCH /api/schema/:nodeType` 自动支持（它转发 FieldOp）。

### 17.3 前端

- `apps/frontend/src/pages/EntityTable.tsx` 列头在「改名/退休」旁加「别名」按钮 `aria-label="aliases-${f.id}"`，打开 Modal（`okText="确定"`）含 `<Input.TextArea aria-label="aliases-input">`（换行/逗号分隔，预填当前 `f.aliases` join），确定 → 解析为 `string[]`（去空、trim）→ `api.patchSchema(nodeType, { op: "setAliases", id: f.id, aliases })` → refresh。`/attack`、`/contributions` 复用同组件自动具备。

### 17.4 配置（最小演示性 seed）

仅 `config/schemas/attackTicket.json`，给少数字段按 `req.md` 真实异名列补 `aliases`（如 `当前处理人` ← `["研发责任人","运维责任人","责任人","owner"]`；`标题` ← `["title","问题标题","事件标题"]`）。其余 nodeType 不动。该文件已在 `apps/frontend/e2e/reset-db.cjs` 的 e2e 恢复集，无需改 reset-db。

### 17.5 关键设计决策（补充 §12/§14.4）

| 决策 | 选择 | 理由 |
|---|---|---|
| 别名存放 | EntitySchema 字段级 `aliases[]`（非 ViewSchema） | 首期一份规范别名表够用；view 级覆盖留后续；与 §0.4 配置驱动一致 |
| 匹配方式 | 精确等值（trim 后） | 显式优先（§0.3）；大小写/编辑距离模糊属下一增量+人审门 |
| setAliases 语义 | 整体替换该字段 aliases（非 add/remove） | UI 传完整列表，简单可预测；复用 applyFieldOp 持久化/回滚 |
| seed 范围 | 仅 attackTicket，来源 req.md 真实表列名 | 让"导入跨表异名归一"立即有真实价值；YAGNI |
| 模糊推荐+人审门 | 不在本增量 | §0.3/§14.4 明确属后续；本增量只做显式别名 |

### 17.6 验收标准

- [ ] `FieldSchema.aliases` 契约生效（类型测试），现有数据/配置/校验不破坏
- [ ] 导入含异名列（如「研发责任人」）的 Excel，按 alias 命中 → 值落到 canonical 字段（`properties[f.id]`），跨异名归一
- [ ] `PATCH /api/schema/:nodeType {op:"setAliases",...}` 持久化回 config JSON + reload；非法/未知字段 id 报错并回滚；setAliases 后再导入能用新别名
- [ ] `EntityTable` 列头「别名」按钮在 `/attack`、`/contributions` 可设别名并持久化（经 schema 端点/刷新可见）
- [ ] `npm run test:all` 全绿（含新增 shared 类型测试 + 后端 alias-import/setAliases e2e + Playwright 别名管理用例）；完成后部署到测试服务器

---

## 18. 增量3a：ref→实体边 + 1跳跨view关联（开发依据）

> 兑现 §0.2「从一个人遍历到他在所有 view 的全部工作」与 §4 关联（1跳子集）。承接 §14.3 ②→③ 过渡。

### 18.0 增量3 拆解（多子系统，各自独立 spec→plan→实现→部署）

| 子增量 | 内容 | 依赖 |
|---|---|---|
| **3a（本节）** | `type:ref`+`refType` 字段写入解析/建实体+建有向边；1跳「从实体→跨view全部引用」只读 API + 关联页 | 地基 |
| 3b | 语义 `concept`：字段挂 concept，异名同 concept 归并到同一关系语义 | 需 3a |
| 3c | LLM/Hermes 提议候选关系 + **强制人工审批队列**（§0.3 模糊兜底 + §14.4 审批门；Agent 只提议不直写） | 需 3a |
| 3d | 跨颗粒度：`PART_OF/ROLLS_UP/AGGREGATES…` 类型化层级/聚合边 + 共享最细锚点(问题单号/事件单号/domain id/客户) + 桥接节点 | 需 3a |
| 多跳/冲突/独立KG引擎 | PRD §3 冲突检测、§4 depth-N 遍历、独立可重建 KG 引擎 | 后续 |
| ref单元格直跳目标实体 | EntityTable ref 单元格当前链接到本行节点的关联页(§18.5 既定，FE-R1 已验证可两跳钻取到 person)；直接跳到被引用实体的关联页需客户端把字符串值解析回 person id（或边上存解析后 targetId 并在节点缓存暴露）——增量3b/3c 一并处理 | 后续（3a 评审记录） |

### 18.1 契约（@combat/shared）

`FieldSchema` 已含 `type:"ref"` 与 `refType?:string`（无需改）。`Repository` 新增 `deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): void`（事务+审计，镜像 `deleteNode` 风格）——用于节点更新时先删旧 `REF` 边再按当前字段值重建，保证幂等。

### 18.2 后端 — 写入时解析 ref（新模块 `apps/backend/src/refs.ts`，单一职责）

`syncRefEdges(repo, registry, node, body, actor)`：
- 先 `repo.deleteEdges({ sourceId: node.id, edgeType: "REF" }, actor)`（幂等基础）。
- 对该 nodeType schema 中每个 `f.type === "ref" && f.refType` 字段，若 `body[f.id]` 为非空值 `v`（trim 后非空）：
  - 解析目标：在 `repo.queryNodes(f.refType)` 中找首个节点，其某 `identityKey` 属性 === `v`，否则其 `name` 属性 === `v`（精确匹配；§2.1 精确层；不做模糊——模糊+人审属 3c）。
  - 找不到 → `repo.createNode(f.refType, { name: v }, actor)` 建新目标实体（`name` 为首选标识）。
  - `repo.createEdge("REF", node.id, target.id, { field: f.id, refType: f.refType }, actor)`。
- 单一通用 `REF` 边类型，来源字段记于 `properties.field`（便于统一遍历，不每字段一种边类型）。
- 在通用 `POST /api/nodes/:nodeType`（节点创建后）与 `PUT /api/nodes/:id`（更新后）各加一行调用 `syncRefEdges`。contribution 的 `CONTRIBUTED_TO` 特化逻辑保持不变，二者并存互不冲突。

### 18.3 后端 — 1跳关联只读 API

`GET /api/related/:nodeType/:id`：`repo.getNode(id)` 不存在 → 404 `{error}`；否则取 `REF` 边中 `sourceId===id` 与 `targetId===id` 两类，载入对端节点，返回 `{ outgoing: [{ field, node }], incoming: [{ field, node }] }`（`node` 为完整 GraphNode，含 nodeType 供前端分组/跳转；`field` 为边 `properties.field`）。独立 `related` 路由模块或并入既有路由，挂载于 `/api`、全局错误中间件之前。

### 18.4 配置 seed（让 ref 真实可用）

- `config/schemas/attackTicket.json`：`当前处理人` 字段改为 `"type": "ref", "refType": "person"`（保留 id/name/label/aliases）。
- `config/schemas/contribution.json`：`贡献人` 字段改为 `"type": "ref", "refType": "person"`。
- 现存字符串数据不受影响（解析仅在新写入触发）；`validateNode` 对 `ref` 走非枚举常规校验（required 仍生效，不破坏）。`person.json` 现有 `identityKeys: ["employeeId","email"]` + `name` 字段，解析按 identityKey/name 精确匹配。

### 18.5 前端

- 新页 `/related/:nodeType/:id`（关联全景）：调 `api.getRelated(nodeType, id)`，将 outgoing+incoming 的对端节点**按 nodeType 分组**列出，每条目链接到该实体自己的 `/related/<其nodeType>/<其id>`（可继续钻取）或其详情页（attackTicket→`/attack/:id`）。
- 入口（最小，二者皆"链接到本行节点自身的关联页"，不在前端解析 person id——从关联页可见其 outgoing 指向的 person 并继续钻取）：
  - ① `AttackDetail` 页加「关联全景」链接 → `/related/attackTicket/:id`（:id = 当前攻关单）。
  - ② `EntityTable` 中 `f.type==="ref"` 字段的单元格：值渲染为 `<Link>` → `/related/${nodeType}/${rowId}`（rowId = 该行节点 id；非编辑态时；编辑态仍是 Input）。
- 不做通用力导向图可视化（留后续）。

### 18.6 关键设计决策（补充 §12/§14.4）

| 决策 | 选择 | 理由 |
|---|---|---|
| 边模型 | 单一 `REF` 边 + `properties.field` 标记来源字段 | 统一遍历；避免边类型爆炸；与 honor/import 既有具名边并存 |
| 解析策略 | 精确(identityKey/name)否则建新；无模糊 | §0.3 显式优先；模糊+人审属 3c |
| 更新幂等 | 写前 `deleteEdges(sourceId,REF)` 全删再按现值重建 | 简单可预测；避免悬挂/重复边；复用事务+审计 |
| 遍历面 | 仅 1 跳、只读 | 最小可用闭环兑现 §0.2；depth-N/冲突留后续 |
| seed | 改 attackTicket.当前处理人 / contribution.贡献人 为 ref→person | 让"从人跨view看全部工作"端到端真实可演示 |
| 前端入口 | AttackDetail 链接 + ref 单元格链接到本节点关联页 | 最小；通用图可视化 YAGNI |

### 18.7 验收标准

- [ ] `Repository.deleteEdges` 契约生效（shared 类型/行为测试，事务+审计）
- [ ] 写 attackTicket(当前处理人=张三) → 自动建/复用 person「张三」+ 一条 `REF` 边（field=当前处理人）
- [ ] 同一 person 再建 contribution(贡献人=张三) → `GET /api/related/person/<id>` 跨 view 返回该攻关单 + 该贡献（incoming 分组）
- [ ] 更新 当前处理人=李四 → 旧 REF 边删、新边建，无重复/悬挂；复用已有 person 不重复建；未知 id→404
- [ ] `/related/:nodeType/:id` 关联页按 nodeType 分组展示并可钻取；AttackDetail 与 ref 单元格入口可达
- [ ] `npm run test:all` 全绿（shared deleteEdges + 后端 refs/related e2e + Playwright 关联用例）；完成后部署到测试服务器

---

## 19. 增量3b：语义 concept（异名同 concept 归并）开发依据

> 承接 §14.3 ②→③：在 3a 的 REF 边之上加"语义角色"，使不同 view 的异名关系字段（当前处理人/贡献人/责任人…）按 concept 归并为同一语义。复用增量2（aliases）的形态。本节是本增量的实现依据。

### 19.1 契约（@combat/shared）

`FieldSchema` 增可选 `concept?: string`（纯加法，与 `aliases?`/`retired?` 同性质，不破坏现有数据/配置/校验）。`FieldOp` 增变体 `| { op: "setConcept"; id: string; concept: string }`（追加在 `setAliases` 之后）。

### 19.2 后端

- `apps/backend/src/registry.ts` `applyFieldOp`：在 `setAliases` 分支之后、未知 op `else` 之前，新增：
  ```ts
  } else if (op.op === "setConcept") {
    if (typeof op.concept !== "string") throw new Error("setConcept 需要 concept 字符串");
    find(op.id).concept = op.concept;
  ```
  （沿用增量2 `setAliases` 评审教训的运行时类型守卫；`find(id)` 在写盘前抛错→路由 400→配置不变；复用既有 writeFileSync→reload→回滚尾。）
- `apps/backend/src/refs.ts` `syncRefEdges`：建 REF 边时 properties 增 `concept: f.concept ?? ""`（与既有 `field`、`refType` 并存，单一 `REF` 边类型不变）。
- `apps/backend/src/related.ts`：每个关联项增 `concept`，即 `outgoing`/`incoming` 项形为 `{ field: string; concept: string; node: GraphNode }`（`concept` 取边 `properties.concept` 字符串）。
- seed：`config/schemas/attackTicket.json` 的 `当前处理人` 字段增 `"concept": "负责人"`；`config/schemas/contribution.json` 的 `贡献人` 字段增 `"concept": "负责人"`。仅这两个字段对象改动（追加 `concept` 键），其余 JSON 字节不变，Chinese 完好。

### 19.3 前端

- `apps/frontend/src/api.ts`：`RelatedResult` 的项类型由 `{ field; node }` 改为 `{ field: string; concept: string; node: GraphNode }`（outgoing/incoming 同）。
- `apps/frontend/src/pages/EntityTable.tsx`：列头在「改名/退休/别名」旁加「概念」按钮 `aria-label="concept-${f.id}"`，打开 Modal（`okText="确定"`）含 `<Input aria-label="concept-input">`（预填当前 `f.concept`），确定 → `api.patchSchema(nodeType, { op: "setConcept", id: f.id, concept })` → refresh。镜像现有 `别名` 编辑器（`al`/`setAl` → `cp`/`setCp`，单值字符串而非数组）。纯加法，不改任何既有 aria-label/行为。
- `apps/frontend/src/pages/RelatedPage.tsx`：分组键由 `x.node.nodeType` 改为 **`x.concept || x.node.nodeType`**。组标题即该键；无 concept 的项仍按 nodeType 分组（行为不变）。效果：某 person 的关联页里，来自 attackTicket 的「当前处理人」与来自 contribution 的「贡献人」（皆 concept=负责人）归并到同一「负责人」组——异名同语义归并可见。`label/detailLink` 不变。
- **有意更新既有断言**（分组键变更所致，非弱化——底层关联数据仍断言）：`apps/frontend/e2e/related.spec.ts` FE-R1 与 `apps/frontend/e2e/coverage.spec.ts` 的 RelatedPage 用例中，对 person 关联页"按 nodeType 分组标题(attackTicket/contribution/person)"的断言，更新为新的 concept 分组（如「负责人」组含来自两个异名字段的节点；无 concept 节点仍按 nodeType）。

### 19.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`FieldSchema.concept` + `FieldOp` `setConcept` 类型测试（tsc-clean）。
- 后端 e2e（新 `apps/backend/test/concept.e2e.test.ts`）：写带 ref 字段的节点 → REF 边 `properties.concept` = 字段 concept；`/api/related` 项含正确 concept；同一 person 经两个不同 nodeType 的同-concept ref 字段被引用 → related 两项 concept 均为「负责人」；`PATCH setConcept` 持久化回 config + reload + 再读 schema 生效；`setConcept` 非字符串 body → 400 + 配置不变（镜像 setAliases 测试）。
- 前端 Playwright（新 `apps/frontend/e2e/concept.spec.ts`）：列头「概念」编辑器设置 concept 并经 schema 端点验证持久化；建 attackTicket(当前处理人=某人)+contribution(贡献人=同人)→该 person 关联页两项归并到「负责人」组（断言该组标题可见且含两来源）。
- 既有 FE-R1/coverage RelatedPage 断言按 §19.3 更新；随后跑**全功能 Playwright e2e 覆盖审计门**（§18 确立的标准门：审计所有用户可见功能×现有 spec，补缺）+ `npm run test:all` 连续两次全绿。

### 19.5 关键设计决策（补充 §12/§18.6）

| 决策 | 选择 | 理由 |
|---|---|---|
| concept 存放 | EntitySchema 字段级 `concept?`，写入 REF 边 `properties.concept` | 与 aliases 同形态、配置驱动；边自带语义便于 related 分组与后续遍历 |
| 分组键 | `concept ‖ nodeType` | 异名同 concept 归并可见；无 concept 退回 nodeType 不破坏既有行为 |
| setConcept 语义 | 整体替换 + 非字符串运行时守卫 | 简单可预测；沿用增量2 setAliases 评审教训 |
| seed | 仅 attackTicket.当前处理人 / contribution.贡献人 → concept「负责人」 | 让"异名同语义跨 view 归并"端到端真实可演示；YAGNI |
| 既有断言更新 | 有意更新 FE-R1/coverage RelatedPage 分组断言 | 分组键有意变更；底层数据仍断言；覆盖审计门+两次全绿兜底 |
| 专用 concept 查询 API / concept 词表管理 UI | 不在 3b | 留 3c/后续；本增量只做"字段挂 concept + 边带 concept + related 按 concept 分组" |

### 19.6 验收标准

- [x] `FieldSchema.concept?` + `FieldOp.setConcept` 契约生效（shared 类型测试 9/9，tsc-clean），现有数据/配置/校验不破坏
- [x] 写带 ref 字段节点 → REF 边 `properties.concept` 正确；`/api/related` 项含 `concept`（concept.e2e 用例1）
- [x] 同一 person 经 attackTicket.当前处理人 与 contribution.贡献人（皆 concept=负责人）被引用 → related 两项 concept 均为「负责人」（concept.e2e 用例2，断言 incoming 长度 2）
- [x] `PATCH /api/schema {op:"setConcept"}` 持久化回 config + reload；非字符串(缺键 + `42`) → 400 + 配置不变（concept.e2e 用例4）
- [x] `EntityTable` 列头「概念」编辑器在 `/attack`、`/contributions` 可设 concept 并持久化（FE-C1；编辑器为配置驱动 EntityTable 列头，两路由同组件）
- [x] `RelatedPage` 把两个异名字段（当前处理人/贡献人，concept=负责人）归并到同一「负责人」组显示（FE-C1/FE-R1）；无 concept 节点仍按 nodeType（concept.e2e「ref WITHOUT concept → related concept ''」覆盖回退输入）
- [x] 既有 FE-R1/coverage RelatedPage 断言已按新分组更新；全功能 e2e 覆盖审计门通过（审计发现 nodeType-回退缺口并补齐）；`npm run test:all` 连续两次全绿（shared9/backend54/FEunit11/e2e19）；完成后部署到测试服务器

---

## 20. 增量3c：LLM/Hermes 提议候选关系 + 强制人工审批队列 开发依据

> 承接 §14.3④⑤ + §0.3「模糊兜底 + 并集检索」 + §14.4「强制人工审批门」。依赖 3a（REF 边）/3b（concept）。本节是本增量的实现依据。

### 20.0 范围与定向

交付：①可插拔 `RelationProposer`（本增量内置**确定性启发式**实现；真实 Hermes/LLM 按 §13#9 后续接入）；②提议持久化（append-only + 审计，**非权威、不入派生图**）；③**强制人工审批队列**（通过/拒绝/修正），仅审批「通过」才走结构化权威写路径；④决策回流正/负样本（MVP：持久化 + 启发式据「已拒绝」抑制重复）；⑤**并集呈现**（`/api/related` 可选 `candidates`，UI 独立「候选关系（待审批）」分组，标注来源/置信度，绝不混入权威列表）；⑥并入跟进项 §18.0 line823「ref 单元格直跳被引用实体」。YAGNI：不做在线学习 / 真实 LLM / 力导图。

### 20.1 契约（@combat/shared）

- `RelationProposalStatus = "待审批" | "已通过" | "已拒绝"`（中文字面，规范，不译）。
- `RelationProposal`：`{ id; sourceNodeId; targetNodeId; relationType: string; confidence: number; proposerSource: string; rationale: string; status: RelationProposalStatus; decidedBy?: string; decidedAt?: string; createdAt: string }`。
- `RelationProposer`：`propose(repo: Repository, registry: SchemaRegistry): Omit<RelationProposal,"id"|"status"|"decidedBy"|"decidedAt"|"createdAt">[]`（**只读分析、纯提议、不写**）。
- `Repository` 增（纯加法，镜像既有节点/边事务+审计）：`createProposal(p, actor): RelationProposal`、`listProposals(opts:{status?:RelationProposalStatus}): RelationProposal[]`、`getProposal(id): RelationProposal | undefined`、`updateProposalStatus(id, status, decidedBy, actor): RelationProposal`。不破坏 §0.3「KG 不接受直接写入」——提议是独立 pending 存储，非派生图边、非权威结构化数据。

### 20.2 后端

- 新模块 `apps/backend/src/proposer.ts` `HeuristicRelationProposer implements RelationProposer`（确定性、可测、无外部依赖）：对同一 `refType` 实体类型（如 person）现存节点，按规范化键（trim+小写+去内部空白）两两比较；规范化后**非精确相等**但 Levenshtein 距离 ≤ 阈值（默认 **1**：单字符近重复=疑似录入误差，是最精准的"疑似同实体"信号；阈值 2 会把无关单字名两两误配，已验证收敛为 1）者，提议 `relationType:"SAME_AS"`，`confidence = 1 - dist/maxLen`，`proposerSource:"heuristic-v1"`，`rationale` 含两值与距离。精确相等**不**提议（§0.3 显式优先；3a 已处理）。已被「已拒绝」覆盖的同 `(sourceNodeId,targetNodeId,relationType)` 三元组不再重复提议（负样本回流抑制）。
- 提议存储：`SqliteRepository` 加 `proposals` 表（id,source_node_id,target_node_id,relation_type,confidence,proposer_source,rationale,status,decided_by,decided_at,created_at）+ §20.1 方法，每变更写 `audit_log`。
- API（新 `apps/backend/src/proposals.ts` 路由，挂 `/api`、全局错误中间件前）：
  - `POST /api/proposals/scan`：运行 registry 配置的所有 proposer（本增量即 `HeuristicRelationProposer`）；每个新候选若无同三元组「待审批/已拒绝」记录则 `createProposal(status:"待审批")`；返回 `{created:n}`。**幂等**。
  - `GET /api/proposals?status=待审批`：默认全部，可按 status 过滤。
  - `POST /api/proposals/:id/decide` body `{ decision:"通过"|"拒绝"|"修正", decidedBy:string, patch?:{ targetNodeId?:string } }`：不存在→404；非「待审批」→409。`通过`：走**结构化权威写路径**——`SAME_AS`→调用既有 §2.1 person 合并（并字段、迁边、不可逆、审计）；`updateProposalStatus(已通过,decidedBy)`；全程 audit。`修正`：以 `patch.targetNodeId` 校正后按「通过」处理。`拒绝`：`updateProposalStatus(已拒绝,decidedBy)`（负样本）+ audit。
  - `GET /api/related/:nodeType/:id?includeCandidates=1`：在既有权威 `{outgoing,incoming}` 外**另加** `candidates:[{ proposalId, relationType, confidence, rationale, node }]`（仅 status=待审批 且命中该节点）。**绝不**并入 outgoing/incoming。无 `includeCandidates` 时与 3b 完全一致。
- 无需改 schema seed；proposer 基于现有 person 节点运行。

### 20.3 前端

- `apps/frontend/src/api.ts`：加 `listProposals(status?)`、`scanProposals()`、`decideProposal(id,decision,decidedBy,patch?)`；`getRelated` 加可选 `includeCandidates`，`RelatedResult` 加可选 `candidates?:{ proposalId:string; relationType:string; confidence:number; rationale:string; node:GraphNode }[]`。
- 新页 `apps/frontend/src/pages/ProposalsPage.tsx`（路由 `/proposals`，「关系审批队列」）：顶部「扫描候选」按钮（POST scan）；表格列待审批项（来源实体/目标实体/relationType/置信度/理由/创建时间）；每行「通过」「拒绝」按钮（`decidedBy` 取占位 `"运营"`，真实鉴权后续）；决策后刷新。AntD Table 风格一致。
- `AppShell` 导航加「关系审批」+ 首页卡片入口（集成首页原则）。
- `RelatedPage`：调用改 `getRelated(...,{includeCandidates:true})`；若有 candidates，**独立**渲染「候选关系（待审批）」分组（标注置信度+理由），与权威 concept/nodeType 分组数据/视觉分离，不混入。
- ref 单元格直跳（兑现 §18.0 line823）：`EntityTable` 中 `f.type==="ref"` 单元格非编辑态值渲染 `<Link>` → **被引用实体**关联页。解析：调既有 `/api/related/${nodeType}/${rowId}` 取 outgoing 中 `field===f.id` 对端 node，链到 `/related/${对端.nodeType}/${对端.id}`（attackTicket→`/attack/:id`）；未解析到则**回退**原行为（链到本行关联页，不破坏 §18.5/FE-R1）。纯加法、可回退。

### 20.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`RelationProposal`/`RelationProposer`/Repository 提议契约类型测试（tsc-clean）。
- 后端 e2e（新 `apps/backend/test/proposals.e2e.test.ts`）：①两近似名 person（非精确）→ scan 生成 1「待审批」`SAME_AS`，精确同名不提议；②`GET /proposals?status=待审批` 返回；③`decide 通过`→两 person 合并（边迁移/字段并/原引用可达）+ 提议「已通过」+ audit；同 id 再 decide→409；④`decide 拒绝`→「已拒绝」+ 再 scan 不重复该三元组；⑤`/api/related?includeCandidates=1` 含 `candidates` 且权威 outgoing/incoming 不含候选，无参时与 3b 一致；⑥proposer 确定性（同输入同输出）。
- 前端 Playwright（新 `apps/frontend/e2e/proposals.spec.ts`）：首页/导航→`/proposals`；「扫描候选」后现待审批行；「通过」后该行消失且合并可见；RelatedPage 现独立「候选关系（待审批）」分组且不污染权威组；ref 单元格点击直达被引用实体关联页。
- 随后跑全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 20.5 关键设计决策（补充 §12/§14.4/§18.6/§19.5）

| 决策 | 选择 | 理由 |
|---|---|---|
| Proposer 形态 | 可插拔 `RelationProposer` + 内置确定性 `HeuristicRelationProposer` | §13#9 Hermes 接口未定；确定性启发式可 TDD/无外部依赖即端到端兑现 §0.3 模糊兜底+审批门；真实 LLM/Hermes 后续按接口接入 |
| 提议存储 | 独立 `proposals` 表（append+审计），非派生图边/非权威 | 严守 §0.3 唯一权威写路径、KG 派生只读；提议仅审批通过才落权威 |
| 审批动作 | 通过/拒绝/修正；非待审批→409 | §14.4 强制人审门；不可重复决策保审计一致 |
| 通过的权威效果 | `SAME_AS`→走既有 §2.1 person 合并（不可逆+审计） | 复用实体解析；Agent 只提议不直写 |
| 样本回流 | 持久化决策；启发式据「已拒绝」抑制重复（MVP，无在线学习） | YAGNI；先闭环可用 |
| 并集呈现 | `/api/related?includeCandidates` 另出 `candidates[]`，UI 独立分组 | §0.3 并集但确定/模糊分离、模糊须人审、权威列表纯净 |
| ref 单元格直跳 | 前端经 /api/related 解析对端；失败回退原行为 | 兑现 §18.0 line823；加法可回退不破坏 §18.5/FE-R1 |
| 真实 LLM/在线学习/力导图 | 不在 3c | YAGNI；§13#9 后续 |

### 20.6 验收标准

- [x] shared `RelationProposal`/`RelationProposer`/Repository 提议契约生效（shared 类型测试 11/11，tsc-clean），现有不破坏
- [x] `POST /api/proposals/scan`：近似（非精确）同类型实体生成「待审批」`SAME_AS`，精确相等不提议；幂等（proposals.e2e 用例1）
- [x] `GET /api/proposals?status=待审批` 列表正确（proposals.e2e 用例1）
- [x] `decide 通过`→结构化权威合并（proposals.e2e 用例2 断言边迁移/原引用可达 titles=["T1","T3"]）+ 提议「已通过」+ merge.ts 顶层 MERGE 审计；`decide 拒绝`→「已拒绝」+ 后续 scan 抑制三元组（用例3）；非待审批再 decide→409
- [x] `GET /api/related?includeCandidates=1` 含 `candidates[]` 且权威 outgoing/incoming 绝不含候选；无参与 3b 一致（proposals.e2e 用例4）
- [x] `/proposals` 审批队列页：扫描→列待审批→通过（FE-P1）/拒绝（FE-P3）可用并持久；空状态中文无 AntD 英文（FE-P0）；AppShell+首页入口集成（coverage GAP-3c）
- [x] `RelatedPage` 独立「候选关系（待审批）」分组（标注置信度/理由），不污染权威分组（FE-P1）
- [x] `EntityTable` ref 单元格直跳被引用实体关联页（§18.0 line823 兑现，FE-P2）；未解析回退原行为不破坏 FE-R1（e2e 23/23 含 related.spec）
- [x] 全功能 e2e 覆盖审计门通过（审计补齐 空状态/拒绝/首页卡片 缺口）；`npm run test:all` 连续两次全绿（shared11/backend59/FEunit13/e2e23）；完成后部署测试服务器

---

## 21. 增量3d：跨颗粒度——共享最细锚点派生关联 开发依据

> 兑现 §14.3③「**(最强、首选)经共享最细粒度锚点实体关联**——粗对象不互连，统一连到共享原子，跨 view 关系由共享锚点派生」+ §18.0 row 3d + 解决 §13#8（锁定锚点权威清单）。依赖 3a（派生边机制）。复用 3a `syncRefEdges`/3b `concept` 形态（配置驱动字段标注 → 写入时派生边，KG 派生只读、唯一权威写路径、审计）。本节是本增量的实现依据。

### 21.0 范围与定向

交付：①字段可配置标注 `anchor:"<kind>"`（与 `refType`/`concept` 同性质，纯加法）；②写入时按锚点字段值解析/建**共享锚点实体**并建**类型化边 `ANCHORED_TO`**（`properties.anchorKind`），幂等（先删本节点旧 ANCHORED_TO 再按当前值重建，镜像 3a）；③粗对象**不互连**——跨 view 关联**派生**自"共享同一锚点"（node→anchor→其它 view node 的 2 跳）；④`/api/related` 纳入 ANCHORED_TO 边（可经锚点 2 跳钻取，复用 3a/3b 既有形态）并新增派生 `跨颗粒度（共享锚点）` 同锚点对端 view 节点分组；⑤锁定锚点权威清单（§13#8）。锚点实体即 §14.3④ 的桥接节点（关系属性挂锚点节点）。YAGNI：不做显式 `PART_OF/ROLLS_UP` 层级 nodeType 体系（无层级字段，留后续）、不做 depth-N 遍历/冲突检测。

### 21.1 契约（@combat/shared）

`FieldSchema` 增可选 `anchor?: string`（值为锚点种类/共享原子 nodeType，如 `问题单号`/`事件单号`/`domain`/`客户`；纯加法，与 `refType`/`concept`/`aliases`/`retired` 同性质，不破坏现有数据/配置/校验）。`FieldOp` 增变体 `| { op: "setAnchor"; id: string; anchor: string }`（追加在 `setConcept` 之后；空串=清除）。锚点权威清单（§13#8 锁定，配置可扩展）：`问题单号`（含 OSM问题单号/关联需求·问题单）、`事件单号`、`domain`、`客户`（含 涉及客户/影响客户）——异名 anchor 字段经同一 `anchor` 值归一到同一共享原子 nodeType。

### 21.2 后端

- `apps/backend/src/registry.ts` `applyFieldOp`：在 `setConcept` 分支后、未知 op `else` 前新增 `} else if (op.op === "setAnchor") { if (typeof op.anchor !== "string") throw new Error("setAnchor 需要 anchor 字符串"); find(op.id).anchor = op.anchor;`（沿用 setConcept 守卫教训；写盘前抛错→400→配置不变；复用既有 writeFileSync→reload→回滚尾）。
- 新模块 `apps/backend/src/anchors.ts` `syncAnchorEdges(repo, registry, node, body, actor)`（单一职责，镜像 `refs.ts`）：先 `repo.deleteEdges({ sourceId: node.id, edgeType: "ANCHORED_TO" }, actor)`（幂等）；对该 nodeType schema 每个 `f.anchor` 非空字段，若 `body[f.id]` trim 后非空值 `v`：在 `repo.queryNodes(f.anchor)` 中找 `properties["key"]===v` 的锚点节点，否则 `repo.createNode(f.anchor, { key: v }, actor)` 建共享锚点；`repo.createEdge("ANCHORED_TO", node.id, anchor.id, { anchorKind: f.anchor, field: f.id }, actor)`。**粗对象间不建任何直接边**。**同一节点同一 `anchorKind` 仅一条 ANCHORED_TO 边**（锚点即原子身份，一节点对一种锚点只能锚定一个值）：若多字段映射同一 anchorKind，按 schema 字段顺序后者胜（异名同 anchor 归一的必然推论，§21.5）。
- 在 `POST /api/nodes/:nodeType`（创建后）与 `PUT /api/nodes/:id`（更新后）各加一行 `syncAnchorEdges` 调用（与既有 `syncRefEdges` 并存，互不冲突）。
- `apps/backend/src/related.ts`：`queryEdges` 取边时由 `edgeType:"REF"` 扩展为同时含 `ANCHORED_TO`（outgoing/incoming 项保留既有 `{field,concept,node}` 形，锚点边 `concept` 取 `""`，`node` 为锚点实体或对端，使既有 1 跳钻取与 3b 分组对锚点自然生效——锚点按 nodeType 分组）；并新增**派生** `coAnchored: [{ anchorKind, anchorKey, node }]`：对本节点每条 ANCHORED_TO 的锚点，列出该锚点其它 incoming 源节点（≠本节点），即"共享同一锚点的其它 view 节点"（粗对象跨颗粒度对端，派生不落边）。无锚点字段时 `coAnchored: []`，其余响应与 3c 一致。
- seed：`config/schemas/attackTicket.json` 增字段或标注现有——为可演示，给 attackTicket 增 `{ name:"问题单号", type:"string", label:"问题单号", anchor:"问题单号" }`；`config/schemas/contribution.json` 增 `{ name:"关联问题单", type:"string", label:"关联问题单", anchor:"问题单号" }`（异名同 anchor）。仅追加字段，其余 JSON 字节不变，Chinese 完好；现存数据不受影响（解析仅新写触发）。

### 21.3 前端

- `apps/frontend/src/api.ts`：`RelatedResult` 增可选 `coAnchored?: { anchorKind: string; anchorKey: string; node: GraphNode }[]`。
- `apps/frontend/src/pages/RelatedPage.tsx`：现有权威/concept 分组**不变**（ANCHORED_TO 边经 3b 分组按锚点 nodeType 自然成组，可继续 2 跳钻取——与 FE-R1 同形态）；**新增独立** `跨颗粒度（共享锚点）` 分组渲染 `coAnchored`（标注 `anchorKind:anchorKey`，链到对端 detailLink），与权威/候选分组数据/视觉分离。`label/detailLink` 不变。
- `apps/frontend/src/pages/EntityTable.tsx`：列头在「概念」旁加「锚点」按钮 `aria-label="anchor-${f.id}"` + Modal（`okText="确定"`，`Input aria-label="anchor-input"` 预填 `f.anchor`）→ `api.patchSchema(nodeType,{op:"setAnchor",id,anchor})`，镜像 `概念` 编辑器（`cp`→`an`/`setAn`）。纯加法不改既有。
- `apps/frontend/src/api.ts` 已有 `patchSchema` 泛型透传，无需改签名。

### 21.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`FieldSchema.anchor?` + `FieldOp.setAnchor` 类型测试（tsc-clean）。
- 后端 e2e（新 `apps/backend/test/anchor.e2e.test.ts`）：①写带 anchor 字段节点→建共享锚点+ANCHORED_TO 边（`properties.anchorKind` 正确）；②不同 nodeType 异名 anchor 字段（attackTicket.问题单号 / contribution.关联问题单）填同值→共享同一锚点节点（仅 1 个）；③`/api/related` 该 attackTicket 的 `coAnchored` 含该 contribution（经共享锚点派生，**无**直接粗-粗边）且对称；④粗对象间 `repo.queryEdges` 无直接互连边；⑤`PATCH setAnchor` 持久化+reload，非字符串→400 配置不变；⑥更新节点改锚点值→旧 ANCHORED_TO 删、新建（幂等）。
- 前端 Playwright（新 `apps/frontend/e2e/anchor.spec.ts`）：建 attackTicket(问题单号=X)+contribution(关联问题单=X)→该 attackTicket 关联页出现独立「跨颗粒度（共享锚点）」分组且含该 contribution；列头「锚点」编辑器设置 anchor 经 schema 端点验证持久化。
- 既有断言加法不破坏；随后跑全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 21.5 关键设计决策（补充 §12/§14.4/§18.6/§19.5/§20.5）

| 决策 | 选择 | 理由 |
|---|---|---|
| 跨颗粒度机制 | 共享最细锚点派生（粗对象不互连，2 跳经锚点） | §14.3③ 明列为**最强、首选**；与 §0.2/§4 派生 KG 一致 |
| 锚点承载 | 字段级 `anchor?`（配置驱动）→ 写入派生 `ANCHORED_TO` 边 | 与 `refType`/`concept` 同形态；异名字段同 anchor 归一；零 DDL |
| 桥接节点 | 锚点实体本身即桥接（关系属性挂锚点节点） | §14.3④；MVP 无需独立关联节点构造 |
| 锚点权威清单（§13#8） | `问题单号`/`事件单号`/`domain`/`客户`（含异名归并），配置可扩展 | req.md 现成锚点；锁定即解 §13#8 |
| 类型化层级 nodeType（PART_OF/ROLLS_UP 体系） | 不在 3d（仅 `ANCHORED_TO` 单类型边 + anchorKind） | 无显式层级字段，YAGNI；锚点派生已兑现首选机制；显式层级留后续 |
| /api/related 集成 | ANCHORED_TO 复用既有 outgoing/incoming（按 nodeType 2 跳钻取）+ 新增派生 `coAnchored` 分组 | 复用 3a/3b 形态、最小新面；粗-粗关联派生不落边 |
| depth-N/冲突检测/独立 KG 引擎 | 不在 3d | §18.0 明列后续 |

### 21.6 验收标准

- [x] shared `FieldSchema.anchor?` + `FieldOp.setAnchor` 契约生效（shared 类型测试 12/12，tsc RED→GREEN 验证），现有不破坏
- [x] 写带 anchor 字段节点 → 建/复用共享锚点实体 + `ANCHORED_TO` 边（`properties.anchorKind` 正确）；改值幂等（anchor.e2e 用例1+用例4 断言唯一边存活）
- [x] 不同 nodeType 异名 anchor 字段（attackTicket.问题单号 / contribution.关联问题单）填同值 → 共享同一锚点节点（仅 1 个）；粗对象间无任何直接互连边（anchor.e2e 用例2）
- [x] `GET /api/related` 含派生 `coAnchored`（经共享锚点的其它 view 对端节点，对称、不落边）；无锚点时 `coAnchored:[]`；其余与 3c 一致（anchor.e2e 用例2/3）
- [x] `PATCH /api/schema {op:"setAnchor"}` 持久化+reload；非字符串(缺键+`7`)→400+配置不变（anchor.e2e 用例4）；空串=清除（§21.1，FE-AN2 teardown 验证）
- [x] `EntityTable` 列头「锚点」编辑器可设 anchor 并持久化（FE-AN2 经 schema 端点轮询验证；编辑器为配置驱动 EntityTable 列头，/attack /contributions 同组件）
- [x] `RelatedPage` 独立「跨颗粒度（共享锚点）」分组（标注 anchorKind:anchorKey），不污染权威/concept/候选分组（FE-AN1）；ANCHORED_TO 可经锚点 2 跳钻取（anchor.e2e 用例3 + 故障快照实证 问题单号 组）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared12/backend63/FEunit13/e2e25）；完成后部署测试服务器

---

## 22. 增量4：Hermes 只读数据访问契约（Phase 3.1）开发依据

> 兑现 §6.1「提供只读数据访问接口（结构化 + 派生 KG）供 Hermes Agent 问答/关联分析/上钻下钻」+ §1「P0-① 在文档/历史攻关中检索相关信息」+ 解决 §13#1（"先定义只读数据访问契约"，传输形态 SDK/HTTP/MCP 待 Hermes 侧确认后再绑定）。是 Phase 3.2 自动日报 / 3.3 找人推荐的数据底座。本节是本增量的实现依据。

### 22.0 范围与定向

交付一个**传输无关的 HTTP 只读查询契约**（任何客户端/未来 Hermes SDK·MCP 适配器皆可包装）：①`GET /api/query/search`——跨全部节点对属性值做大小写不敏感子串检索（可选 nodeType 过滤），确定性排序、限量；②`GET /api/query/context/:id`——单节点 + 其 1 跳派生邻域（REF/ANCHORED_TO 出入向 + concept + coAnchored，复用既有 related 派生）+ 进展序列，作为 Agent 推理的"上下文包"；③最小可用「信息检索」前端页（集成导航+首页）使能力可人工验证；④**严格只读**不变量。YAGNI：不做 NL 理解（属 Agent 侧）、不做具体 Hermes 传输绑定、不做检索打分排序高级化、不做向量检索。**严格只读**：本增量所有接口仅 GET 且仅调用 `getNode/queryNodes/queryEdges/listProgress/listProposals`，绝不写库/不触发审计；写仍只走结构化模型（§0.3/§6.1 边界）。

### 22.1 契约（@combat/shared）

- `QueryHit`：`{ id: string; nodeType: string; summary: string; score: number }`（`summary`=该节点最佳人读标签：properties 中 `标题` ‖ `name` ‖ `贡献人` ‖ `key` ‖ `id`）。
- `QueryContext`：`{ node: GraphNode; related: { outgoing: RelatedItem[]; incoming: RelatedItem[]; coAnchored: CoAnchoredItem[] }; progress: ProgressLog[] }`，其中 `RelatedItem = { field: string; concept: string; node: GraphNode }`、`CoAnchoredItem = { anchorKind: string; anchorKey: string; node: GraphNode }`（与 §18/§21 既有 `/api/related` 形一致，复用类型）。
- 纯加法，不改既有契约；无新增 `FieldOp`（只读，不改 schema）。

### 22.2 后端

- 重构（DRY，服务本增量且消除复制）：抽出 `apps/backend/src/related-core.ts` 导出 `buildRelated(repo, id): { outgoing; incoming; coAnchored }`（把 `related.ts` 现有 REF+ANCHORED_TO 出入向 + coAnchored 派生逻辑原样迁入，**行为零变更**）。`apps/backend/src/related.ts` 改为调用 `buildRelated`（候选 `candidates` 分支保留在 related.ts）。既有全部 related/anchor/concept/ref/proposals e2e 必须保持全绿以证明零回归。
- 新模块 `apps/backend/src/query.ts` 路由（挂 `/api`、全局错误中间件前）：
  - `GET /api/query/search?q=<term>&type=<nodeType?>&limit=<n=50>`：`q` 空 → 400 `{error:"q 必填"}`。遍历 `repo.queryNodes(type?)`（无 type 则对每个已知 nodeType 取并集；nodeType 列表取 `registry.getConfig().nodeTypes` 的 `nodeType` ∪ 派生锚点种类——简化为遍历 registry 配置的 nodeType 即可，派生节点经其引用方命中已足够 MVP），对每节点构造 `hay = Object.values(node.properties).map(String).join(" ").toLowerCase()`，若含 `q.trim().toLowerCase()` 则计 `score = 出现次数`；按 `score desc, updatedAt desc, id asc` 确定性排序，截断 `limit`；返回 `QueryHit[]`。
  - `GET /api/query/context/:id`：`repo.getNode(id)` 不存在 → 404 `{error:"not found"}`；否则返回 `QueryContext`：`{ node, related: buildRelated(repo, id), progress: repo.listProgress(id) }`。
  - 二者**只读**：仅上述 reader 原语，无任何 create/update/delete/createEdge/applyFieldOp 调用。
- `apps/backend/src/app.ts`：`app.use("/api", makeQueryRouter(deps.repo, deps.registry));`（related 路由之后、错误中间件前）。

### 22.3 前端

- `apps/frontend/src/api.ts`：加 `search(q, type?)` → `GET /api/query/search`（`QueryHit[]`）；`getContext(id)` → `GET /api/query/context/:id`（`QueryContext`）。
- 新页 `apps/frontend/src/pages/SearchPage.tsx` 路由 `/search`「信息检索」：`Input.Search`（`aria-label="query-input"`）→ `api.search` → 结果 `List`，每项 `summary`（`nodeType`）`Link` 到 detailLink（attackTicket→`/attack/:id` 否则 `/related/${nodeType}/${id}`）；空查询提示；无结果 `role="status"` 文案「无匹配结果」。
- `AppShell` 导航加「信息检索」、`HomePage` 加卡片入口（集成首页原则）。
- 不在本增量做 NL 问答框 / context 可视化（Agent 侧 & 后续）。

### 22.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`QueryHit`/`QueryContext` 契约类型测试（tsc RED→GREEN）。
- 后端 e2e（新 `apps/backend/test/query.e2e.test.ts`）：①建多节点，`search?q=` 命中属性子串、大小写不敏感、`type` 过滤生效、空 `q`→400、`limit` 截断、排序确定（score desc/updatedAt desc/id asc）；②`search` 调用前后 `audit_log` 行数不变（只读证明）；③`context/:id`：返回 node+related(REF/ANCHORED_TO/coAnchored)+progress；不存在→404；与 `/api/related` 派生一致（buildRelated 复用）；④related-core 重构零回归（既有 related/anchor/concept e2e 仍绿——由全套回归保证）。
- 前端 Playwright（新 `apps/frontend/e2e/search.spec.ts`）：首页/导航→`/search`；输入关键词→结果含该节点 summary；点结果跳到其详情/关联页；空/无结果状态可见。
- 随后跑全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 22.5 关键设计决策（补充 §6/§13#1）

| 决策 | 选择 | 理由 |
|---|---|---|
| Hermes 接入形态 | 仅定义**传输无关 HTTP 只读契约**；不绑定 SDK/MCP | §13#1：Hermes 侧接口未定；HTTP 契约可被任意适配器包装；先打底座 |
| 检索实现 | 属性值拼接子串、大小写不敏感、确定性排序、限量 | 无外部依赖、可 TDD；向量/全文引擎属后续 YAGNI |
| context 邻域 | 复用 `buildRelated`（抽 related-core）+ progress | DRY 消除与 /api/related 的派生复制；一次读取给 Agent 足够上下文 |
| 只读保证 | GET-only + 仅 reader 原语 + 审计行数不变断言 | §0.3/§6.1 边界：Agent 只读不破坏写权威性 |
| 最小检索 UI | 含一个集成的「信息检索」页 | 可人工验证/e2e；产品已具完整 CRUD，此为附加分析面（不违反 MVP-UX 底线） |
| NL 问答 / Hermes 传输 / 向量检索 | 不在增量4 | YAGNI；§6.2/§6.3 与后续 |

### 22.6 验收标准

- [x] shared `QueryHit`/`QueryContext` 契约生效（shared 类型测试 13/13，tsc RED→GREEN），现有不破坏
- [x] `GET /api/query/search?q=` 跨节点属性子串、大小写不敏感、`type` 过滤、空`q`→400、`limit` 截断、确定性排序（score/updatedAt/id）；req 数组参数安全（query.e2e 用例1）
- [x] `search` 为只读：调用前后 `audit_log` 行数不变（query.e2e 用例2）
- [x] `GET /api/query/context/:id` → `{node, related(REF/ANCHORED_TO/coAnchored), progress}`；不存在→404；与 `/api/related` 三字段全一致（query.e2e 用例3）
- [x] `related-core` 抽取后 `/api/related` 行为零变更（既有 related/anchor/concept/ref/proposals e2e 全绿，backend 66/66）
- [x] `/search`「信息检索」页：查询→结果→点击跳详情/关联页；空/无结果状态；AppShell+首页入口集成（FE-S1）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared13/backend66/FEunit13/e2e26）；完成后部署测试服务器

---

## 23. 增量5：找人推荐（Phase 3.3）开发依据

> 兑现 §6.3「基于 KG 的人-任务-知识关联，推荐"谁能帮"」+ §10 P2「找人推荐（资源断裂）」。复用 3a(REF 当前处理人/贡献人)+3c(person)+3d(ANCHORED_TO 共享问题单)+honor(CONTRIBUTED_TO/贡献等级)既有 KG，**确定性打分、只读**（推荐为派生，不写库；与 §6.1/增量4 只读哲学一致）。本节是本增量的实现依据。

### 23.0 范围与定向

交付 ①确定性 KG 打分推荐器（无外部 LLM、可 TDD）；②只读 `GET /api/recommend/helpers/:attackTicketId`；③`AttackDetail` 集成「找帮手」区（排名人选+理由+跳人关联页）。MVP 只做 **"谁能帮"（履历/胜任度证据）**；§6.3 的 **"谁有空"（需 OncallSchedule/排班可用性，未实现）/"谁必须帮"（义务）留后续**（§23.5 记录）。**严格只读**：仅 `getNode/queryNodes/queryEdges/listProgress` 等 reader 原语 + 复用 `buildRelated`/锚点遍历，绝不写库/不审计。

### 23.1 契约（@combat/shared）

`HelperRecommendation`：`{ person: GraphNode; score: number; reasons: string[] }`（`reasons` 为中文证据串，引用具体攻关单/问题单/贡献）。纯加法；无新增 `FieldOp`（只读）。

### 23.2 后端

- 新模块 `apps/backend/src/recommend.ts` `recommendHelpers(repo, ticketId): HelperRecommendation[]`（确定性、只读）：
  1. 取 T=`getNode(ticketId)`；其经 `REF`(field=当前处理人) 指向的 person 集为 `selfPersons`（**排除**，已在处理）。
  2. 取 T 的 `ANCHORED_TO` 锚点；对每个锚点取其它 `ANCHORED_TO` 源节点（共享问题单的 attackTicket / contribution，≠T）。
  3. 候选累加（确定性权重）：
     - 共享锚点的**另一 attackTicket** 的当前处理人 P：`+3`，reason「曾处理共享问题单「{key}」的攻关单「{标题}」」。
     - 共享锚点关联的 **contribution** 的贡献人 P：`+level`（核心=3/关键=2/普通=1，缺省 1），reason「在共享问题单「{key}」相关贡献「{贡献描述‖贡献类型}」（{贡献等级}）」。
     - **通用胜任度兜底**（last-resort，保证无锚点重叠时仍有用）：仅对**未被上述共享锚点证据计分**的 P（排除 self 与已在 `acc` 者），P 作为任意 contribution 贡献人且 `贡献等级∈{核心,关键}`，每次 `+1`（该项每人累计上限 `+3`），reason 为定值聚合串「历史核心/关键贡献 {n} 次」（n 为该人核心+关键贡献总次数，不分级展开）。
  4. 排除 `selfPersons`；`score=证据和`；按 `score desc, person summary(姓名/name) asc, id asc` 确定性排序；截断 `limit`（默认 10，可 `?limit=` 1–50）。
- `apps/backend/src/recommend.ts` 路由（或并入；挂 `/api`、错误中间件前）`GET /api/recommend/helpers/:id?limit=`：`getNode` 不存在→404 `{error:"not found"}`；存在但 `nodeType!=="attackTicket"`→400 `{error:"仅支持 attackTicket"}`；否则返回 `HelperRecommendation[]`。
- 只读：仅上述 reader 原语；调用前后 `audit_log` 行数不变（e2e 断言）。
- `apps/backend/src/app.ts`：`app.use("/api", makeRecommendRouter(deps.repo));`（query 路由之后、错误中间件前）。

### 23.3 前端

- `apps/frontend/src/api.ts`：加 `recommendHelpers(id, limit?)` → `GET /api/recommend/helpers/:id`（`HelperRecommendation[]`）。
- `apps/frontend/src/pages/AttackDetail.tsx`：在「关联全景」与 Descriptions 之间或进展序列之前，加「找帮手」区——加载时（或按钮）调 `api.recommendHelpers(id)`，渲染排名 `List`：每项 person summary（`Link` → `/related/person/${person.id}`）+ `score` + `reasons`（逐行）；空 → `<p role="status">暂无可推荐人选</p>`；错误 `message.error`。`aria-label="find-helpers"` 区块。纯加法，不改既有 AttackDetail 行为/aria-label。
- 无新增路由（推荐按攻关单维度，归属 AttackDetail）。

### 23.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`HelperRecommendation` 契约类型测试（tsc RED→GREEN）。
- 后端 e2e（新 `apps/backend/test/recommend.e2e.test.ts`）：场景——T(问题单号 PB-1,当前处理人 甲)；T2(问题单号 PB-1,当前处理人 乙)；contribution(贡献人 丙,关联问题单 PB-1,贡献等级 核心)；contribution(贡献人 丁,贡献等级 关键, 无锚点)。`GET /helpers/T`：含 乙(+3 共享锚点处理人)、丙(+3 共享锚点核心贡献)，**不含 甲**(self)；丁 出现于通用兜底(+1)且排名最低；reasons 含「PB-1」；按 score 确定性排序；不存在 id→404；非 attackTicket→400；调用前后 audit_log 行数不变（只读）；同输入同输出（确定性）。
- 前端 Playwright（新 `apps/frontend/e2e/recommend.spec.ts`）：建上述数据→打开 T 的 AttackDetail→「找帮手」区出现推荐人(含理由文案 PB-1)→点人跳其关联页；无证据攻关单→空态文案可见。
- 既有断言加法不破坏；随后跑全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 23.5 关键设计决策（补充 §6.3/§14.4）

| 决策 | 选择 | 理由 |
|---|---|---|
| 推荐机制 | 确定性 KG 证据打分（共享锚点履历 + 贡献等级胜任度 + 兜底） | 无外部依赖、可 TDD、可解释（reasons 引证）；LLM 化属后续 |
| 数据面 | 复用 3a/3c/3d/honor 既有边与锚点，不新增写 | §0.3 KG 派生；推荐是只读派生，写仍走结构化 |
| 排除 self | 排除本单当前处理人 | 推荐"能帮的别人"，非已在处理者 |
| 排序 | score desc, 姓名 asc, id asc | 确定性、可测、稳定 |
| "谁有空"/"谁必须帮" | 不在增量5 | 需排班/可用性(OncallSchedule 未实现)与义务模型；§6.3 后续 |
| 入口 | AttackDetail 内「找帮手」区，无新路由 | 推荐按攻关单维度；最小集成面 |
| LLM 解释/学习 | 不在增量5 | YAGNI；reasons 已可解释 |

### 23.6 验收标准

- [x] shared `HelperRecommendation` 契约生效（shared 类型测试 14/14，tsc RED→GREEN），现有不破坏
- [x] `GET /api/recommend/helpers/:id`：共享问题单另一攻关单当前处理人(+3) + 共享问题单相关贡献人(按等级 核心3/关键2/普通1)；通用核心/关键贡献兜底(last-resort，排除已锚点计分者，每人封顶+3)；**排除本单当前处理人**（recommend.e2e 用例1，断言 乙=丙=3、丁=1、丙 reasons 仅1条）
- [x] 排序确定（score desc, 姓名 asc, id asc）、`limit` 截断、`reasons` 引用具体问题单/攻关单/贡献；同输入同输出（recommend.e2e 用例1/3）
- [x] 不存在 id→404；存在但非 `attackTicket`→400（recommend.e2e 用例2）
- [x] 只读：调用前后 `audit_log` 行数不变（recommend.e2e 用例2）
- [x] `AttackDetail`「找帮手」区：排名人选+score+reasons，点击跳该人关联页（FE-RC1）；空态（FE-RC2 路由拦截确定性覆盖）；纯加法不破坏既有（e2e 28/28）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared14/backend69/FEunit13/e2e28）；完成后部署测试服务器

---

## 24. 增量6：数据大盘（Phase 3.6）开发依据

> 兑现 §10 Phase 3.6「数据大盘」+ §0.2「作战平台首页」用户反馈（首页应是可一览的作战态势盘，而非仅模块卡片）。**只读聚合派生**（与 §6.1/增量4 只读哲学一致；不写库/不审计）。复用既有 attackTicket/contribution/proposals 数据。本节是本增量的实现依据。

### 24.0 范围与定向

交付 ①只读 `GET /api/dashboard` 聚合快照（攻关单按状态分布/open/resolved、贡献总数 + 按贡献条数 Top 贡献人、待审批提议数）；②`HomePage` 在模块卡片之上集成统计面板（一览态势），错误降级不破坏首页。**严格只读**：仅 `queryNodes/listProposals` reader 原语，绝不写库/不审计。YAGNI：不做图表可视化（AntD `Statistic`/数字即可）、不做增量导入（3.6 另一子项，另增量）、不做时间序列/趋势。

### 24.1 契约（@combat/shared）

`DashboardSummary`：
```ts
{
  tickets: { total: number; byStatus: Record<string, number>; open: number; resolved: number };
  contributions: { total: number; topContributors: { 贡献人: string; count: number }[] };
  proposalsPending: number;
}
```
`open` = 状态 ∈ {待响应,处理中,进行中}；`resolved` = 状态 ∈ {已解决,已关闭}（§2.3 规范枚举，verbatim）。纯加法；无新增 `FieldOp`（只读）。

### 24.2 后端

- 新模块 `apps/backend/src/dashboard.ts` 路由（挂 `/api`、错误中间件前）`GET /api/dashboard`（只读）：
  - `const tks = repo.queryNodes("attackTicket")`；`byStatus`：对每个非空 `t.properties["状态"]`（trim 后空者跳过，避免 `""` 噪声键污染响应）计数；`total=tks.length`；`open=∈{待响应,处理中,进行中}` 计数；`resolved=∈{已解决,已关闭}` 计数（**不变式**：仅当所有 ticket 的状态都在这两个集合之内时 `open+resolved==total`；非规范/缺省状态仍计入 `total` 但不计入 open/resolved）。
  - `const cs = repo.queryNodes("contribution")`；`contributions.total=cs.length`；`topContributors`：按 `c.properties["贡献人"]`（字符串值；空者跳过）分组计数，按 `count desc, 贡献人 asc` 确定排序，取前 5。
  - `proposalsPending = repo.listProposals({ status: "待审批" }).length`。
  - 返回 `DashboardSummary`。仅上述 reader 原语；调用前后 `audit_log` 行数不变（e2e 断言）。
- `apps/backend/src/app.ts`：`app.use("/api", makeDashboardRouter(deps.repo));`（recommend 路由之后、错误中间件前）。

### 24.3 前端

- `apps/frontend/src/api.ts`：加 `getDashboard()` → `GET /api/dashboard`（`DashboardSummary`）。
- `apps/frontend/src/pages/HomePage.tsx`：mount 时 `api.getDashboard()`；渲染统计面板 `aria-label="dashboard"` 于 `<h1>作战平台</h1>` 与模块卡片之间——AntD `Statistic`/`Descriptions` 展示：攻关单总数、进行中(open)、已闭环(resolved)、按状态分布（逐项 `状态: n`）、贡献总数、待审批提议数、Top 贡献人（`贡献人 ×count`）。失败 → `message.error("大盘加载失败")` 且**不渲染面板但模块卡片照常**（首页不可因大盘失败而崩）。模块卡片（含既有 6 项）保持不变。
- 不新增路由（大盘即首页一部分，集成首页原则）。

### 24.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`DashboardSummary` 契约类型测试（tsc RED→GREEN）。
- 后端 e2e（新 `apps/backend/test/dashboard.e2e.test.ts`）：建若干 attackTicket（不同 状态：待响应/进行中/已解决/已关闭）+ contribution（同一/不同 贡献人）+ scan 候选；`GET /api/dashboard`：`tickets.total`、`byStatus` 各值、`open`/`resolved` 正确；`contributions.total`、`topContributors` 顺序确定（count desc, 贡献人 asc）取前 5；`proposalsPending` 正确；调用前后 `audit_log` 行数不变（只读）；同输入同输出。
- 前端 Playwright（新 `apps/frontend/e2e/dashboard.spec.ts`）：建数据→首页 `dashboard` 面板显示总数/状态分布/贡献/待审批与数据一致；模块卡片仍全部可见；导航卡片仍可用。
- 既有断言加法不破坏（HomePage 仅新增面板，模块卡片 `home-card-*` 不变——既有 coverage/honor nav 用例仍绿）；随后跑全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 24.5 关键设计决策（补充 §6/§10）

| 决策 | 选择 | 理由 |
|---|---|---|
| 大盘机制 | 只读聚合 `GET /api/dashboard`（reader 原语，无写/审计） | §0.3/§6.1 只读派生；与增量4/5 一致 |
| Top 贡献人口径 | 按贡献**条数**计数（非荣誉殿堂加权分） | 大盘为一览快照；加权榜在 /honor 自有页；count 简单自洽，不耦合/重构 honor.ts（YAGNI）|
| open/resolved 切分 | 待响应/处理中/进行中 vs 已解决/已关闭 | §2.3 规范枚举；态势一览语义 |
| 失败降级 | 大盘失败 → message.error + 不渲染面板，模块卡片照常 | 首页是入口，不可因聚合失败而不可用（MVP-UX 底线）|
| 入口 | 集成进 HomePage，无新路由 | §0.2「作战平台首页」即态势盘 |
| 图表/趋势/增量导入 | 不在增量6 | YAGNI；可视化与时间序列后续；增量导入属 3.6 另一子项 |

### 24.6 验收标准

- [x] shared `DashboardSummary` 契约生效（shared 类型测试 15/15，tsc RED→GREEN），现有不破坏
- [x] `GET /api/dashboard`：`tickets.total`/`byStatus`(非空状态)/`open`(待响应,处理中,进行中)/`resolved`(已解决,已关闭) 正确（dashboard.e2e 用例1）
- [x] `contributions.total` 正确；`topContributors` 按贡献条数 `count desc, 贡献人 asc` 取前 5（dashboard.e2e 用例1：张三×2，李四×1）
- [x] `proposalsPending` = 待审批提议数（dashboard.e2e 用例1：≥1，张伟≈张玮 SAME_AS）
- [x] 只读：调用前后 `audit_log` 行数不变（dashboard.e2e 用例2）；同输入同输出；空系统→零值（用例3）
- [x] `HomePage` `dashboard` 面板与数据一致；大盘失败时 message.error+模块卡片仍全部可用；既有 `home-card-*` 不破坏（FE-D1）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared15/backend72/FEunit13/e2e29）；完成后部署测试服务器

---

## 25. 增量7：发布包 / 权重文件 归档（Phase 3.5）开发依据

> 兑现 §1.4 李嘉⑤⑥ + §10 Phase 3.5 + 解决 §13#6（已锁定**元数据 + 链接登记**，文件托管后续按需）。本增量是 **§0.4 配置驱动 schema** 架构的优雅证伪：两个全新业务实体几乎零后端代码——只增两份 JSON 配置 + 两个前端路由/卡片即落地，泛型 CRUD/导入/导出/检索/关联/锚点全部自动复用。本节是本增量的实现依据。

### 25.0 范围与定向

交付 ①`releasePackage`（发布包）与 ②`weightFile`（权重文件）两个 nodeType（**仅 config，无后端代码新增**）；③前端 `/releases` 与 `/weights` 两路由（复用既有 `EntityTable`）+ AppShell 导航 + HomePage 卡片；④通过既有 anchor「问题单号」与共享 person `负责人` concept 自动并入跨 view 关联与找帮手数据面。**YAGNI**：不做文件上传/托管/校验和（仅链接登记，§13#6 拍板）、不专门改 dashboard（资源数据非作战态势聚合面，后续按需）、不专门改 recommendHelpers（仍 attackTicket 维度）。

### 25.1 配置（无 shared 契约改动）

新建 `config/schemas/releasePackage.json`（最小可演示字段集，配置驱动 → UI 可后续增减）：
```json
{
  "nodeType": "releasePackage",
  "label": "发布包",
  "identityKeys": ["版本号"],
  "derivedToKG": true,
  "fields": [
    { "id": "版本号", "name": "版本号", "type": "string", "label": "版本号", "required": true },
    { "id": "产品", "name": "产品", "type": "string", "label": "产品" },
    { "id": "发布日期", "name": "发布日期", "type": "date", "label": "发布日期" },
    { "id": "链接", "name": "链接", "type": "string", "label": "下载/仓库链接" },
    { "id": "责任人", "name": "责任人", "type": "ref", "refType": "person", "label": "责任人", "concept": "负责人" },
    { "id": "关联问题单", "name": "关联问题单", "type": "string", "label": "关联问题单", "anchor": "问题单号" },
    { "id": "描述", "name": "描述", "type": "string", "label": "描述" },
    { "id": "备注", "name": "备注", "type": "string", "label": "备注" }
  ]
}
```
新建 `config/schemas/weightFile.json`：
```json
{
  "nodeType": "weightFile",
  "label": "权重文件",
  "identityKeys": ["名称"],
  "derivedToKG": true,
  "fields": [
    { "id": "名称", "name": "名称", "type": "string", "label": "名称/版本", "required": true },
    { "id": "模型", "name": "模型", "type": "string", "label": "模型" },
    { "id": "链接", "name": "链接", "type": "string", "label": "存储链接" },
    { "id": "责任人", "name": "责任人", "type": "ref", "refType": "person", "label": "责任人", "concept": "负责人" },
    { "id": "训练日期", "name": "训练日期", "type": "date", "label": "训练日期" },
    { "id": "关联问题单", "name": "关联问题单", "type": "string", "label": "关联问题单", "anchor": "问题单号" },
    { "id": "备注", "name": "备注", "type": "string", "label": "备注" }
  ]
}
```
两者通过 `责任人 ref→person concept="负责人"` 自动并入 3b 异名同 concept 归并；通过 `关联问题单 anchor="问题单号"` 自动并入 3d 跨颗粒度共享锚点派生（与同一问题单号下的 attackTicket/contribution 在 `coAnchored` 互见）。

### 25.2 后端

**无新增代码。**既有泛型 `POST/PUT/DELETE /api/nodes/:nodeType`、`GET /api/nodes/:nodeType`、`syncRefEdges`、`syncAnchorEdges`、`/api/related`、`/api/query/search`、`/api/export/:nodeType`、`/api/import` 对任意配置 nodeType 自动生效。仅需后端 e2e **证伪/确认**这种泛型复用对新 nodeType 端到端工作。

### 25.3 前端

- `apps/frontend/src/App.tsx`：加路由 `<Route path="/releases" element={<EntityTable nodeType="releasePackage" />} />` 与 `<Route path="/weights" element={<EntityTable nodeType="weightFile" />} />`（紧接 `/search` 之后）。
- `apps/frontend/src/pages/AppShell.tsx`：`ITEMS` 增「发布包」`/releases` 与「权重文件」`/weights`（置于「信息检索」之后）。
- `apps/frontend/src/pages/HomePage.tsx`：`MODULES` 增两条卡片（标题/描述同上）。
- 不改 EntityTable、不改 dashboard、不改 recommendHelpers。

### 25.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- 后端 e2e（新 `apps/backend/test/archive.e2e.test.ts`）：①`POST /api/nodes/releasePackage` 与 `POST /api/nodes/weightFile` 成功（required 校验生效）；②`GET /api/nodes/:nodeType` 列出；③`PUT /api/nodes/:id` 修改；④`syncRefEdges` 对 `责任人` 建 REF→person；⑤`syncAnchorEdges` 对 `关联问题单` 建 ANCHORED_TO 锚点；⑥同一问题单号 X 下：attackTicket + releasePackage + weightFile 三者经 `/api/related/...?` 互在 `coAnchored`（跨 view 跨 nodeType 共享锚点派生贯通）；⑦`/api/query/search` 命中 releasePackage/weightFile 内属性子串；⑧`DELETE /api/nodes/:id` 删除并清边（既有 deleteNode 行为）。
- 前端 Playwright（新 `apps/frontend/e2e/archive.spec.ts`）：首页导航至 `/releases` 与 `/weights`；新增行（valid required）并显示；导出 Excel 按钮可见；信息检索命中新建行。
- 全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 25.5 关键设计决策（补充 §0.4/§14.4）

| 决策 | 选择 | 理由 |
|---|---|---|
| 数据形态 | 元数据 + 链接登记，**非文件托管** | §13#6 拍板；MVP YAGNI；文件托管涉及存储/校验/权限，后续按需评估 |
| 实现路径 | **仅 config + 前端路由**，零后端代码 | §0.4 配置驱动；证实泛型 CRUD/导入/导出/检索/关联/锚点对新 nodeType 自动生效 |
| 关联机制 | `责任人 ref→person concept=负责人` + `关联问题单 anchor=问题单号` | 自动并入 3b 异名归并 + 3d 跨颗粒度共享锚点（与 attackTicket/contribution 互见 coAnchored）|
| dashboard / 推荐器 | **不动** | dashboard 是作战态势面（tickets+contribs），资源面不在范畴；recommendHelpers 是攻关单维度 |
| 文件上传/校验/权限 | 不在增量7 | YAGNI；§13#6 后续 |
| 字段集 | 最小可演示 + UI 可后续增减 | §0.4 字段可运行时增减写回 config |

### 25.6 验收标准

- [x] `config/schemas/releasePackage.json` / `weightFile.json` 加载生效；后端 ZERO 新源代码（apps/backend/src/* 未改）、ZERO 新 shared 契约（archive.e2e 经 import.meta.url 绝对路径加载真实配置；架构验证通过）
- [x] 两 nodeType 的 CRUD（POST/PUT/GET/DELETE）经泛型路由生效；`required` 字段（版本号 / 名称）违反 → 400（archive.e2e 用例1/2）
- [x] `责任人` ref 写入 → REF→person 边自动建立（archive.e2e 用例1 断言 properties.field="责任人"）
- [x] `关联问题单` 非空 → ANCHORED_TO 问题单号 锚点（用例1）；同 X 下 attackTicket + releasePackage + weightFile 经 `/api/related` `coAnchored` 三方互见（用例3 跨 view 跨 nodeType 派生贯通）
- [x] `/api/query/search` 命中新 nodeType 属性子串（用例4）；summarize() 补充 攻关单号/版本号/名称 识别键，新 nodeType 返回人读标签（非 UUID）
- [x] 前端 `/releases` / `/weights` 路由 + AppShell 导航 + HomePage 卡片可达；EntityTable 渲染/新增/导出 Excel 全部复用（FE-AR1/FE-AR2）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared15/backend76/FEunit13/e2e31）；完成后部署测试服务器

---

## 26. 增量8：增量导入（Phase 3.6）开发依据

> 兑现 §10 Phase 3.6「增量导入」+ 用户实际需求（重新导入更新后的 Excel 不能制造重复行）。把现有全量 create 导入升级为 **按 identityKey upsert** 的增量导入，并把 `/api/import` **参数化到任意 nodeType**（attackTicket / contribution / releasePackage / weightFile / person），自然继承增量7 的两个新归档表的导入能力。**写权威路径不变**（仍经 validateNode + 结构化模型；UPDATE 仍触发 `syncRefEdges`/`syncAnchorEdges`/audit）。

### 26.0 范围与定向

交付 ①`POST /api/import?type=<nodeType>` 参数化（默认 `attackTicket` 向后兼容）；②按 nodeType 的 `identityKeys` upsert——任一 identityKey 在请求中有非空值且匹配既有节点 → `updateNode`（属性合并）；否则 `createNode`；③响应 `{ created, updated }` 加法；④`attackTicket` 既有 `ASSIGNED_TO 攻关申请人` 边在 upsert 时**幂等**（先删该节点的 ASSIGNED_TO 边再按当前请求重建）；⑤`ImportPage` 加 nodeType 选择 + 新消息「导入新增 N · 已更新 M」。**YAGNI**：不做 CSV、不做并行 worker、不做大文件流式、不做去重冲突 UI（首匹配确定胜出）、不做事务回滚整批（每行独立校验+导入，失败行跳过——既有行为保留）。

### 26.1 后端

- `apps/backend/src/import.ts`：
  - `req.query.type` 解析为 `nodeType`（默认 `"attackTicket"`，数组安全）。`schema = registry.getNodeSchema(nodeType)`；缺则 400 `{error:"unknown nodeType: <type>"}`。
  - 每行：`props = mapColumns(raw, schema)`；`validateNode(nodeType, props)` 失败则跳过（既有）。
  - **upsert 查找**：遍历 `schema.identityKeys`，第一个在 `props` 中有非空值（trim 后非空）的 key 取 `repo.queryNodes(nodeType, { [key]: value }).at(0)` 作为匹配；找到→`updateNode(found.id, props, "import")`（合并），`updated++`；未找到（包括全部 identityKey 为空）→`createNode(nodeType, props, "import")`，`created++`。
  - **REF / ANCHORED_TO 自动同步**：调用 `syncRefEdges(repo, registry, node, props, "import")` 与 `syncAnchorEdges(repo, registry, node, props, "import")`（创建与更新两条路径均调用，保持与正常 POST/PUT 一致——既有 3a/3d 派生不被绕过）。
  - **ASSIGNED_TO 幂等**（仅 `nodeType==="attackTicket"`，保留原 `攻关申请人` 边语义，向后兼容）：upsert 后 `repo.deleteEdges({ sourceId: node.id, edgeType: "ASSIGNED_TO" }, "import")`；若 `resolvePerson(...)` 非空则重建。
  - 响应 `{ created, updated }`（向后兼容：旧调用方仅读 `.created` 仍工作）。

### 26.2 前端

- `apps/frontend/src/api.ts`：`importXlsx(file, type?)` 改签名 → `POST /api/import?type=<type>`（无 type 不带查询）→ `Promise<{ created: number; updated: number }>`。
- `apps/frontend/src/pages/ImportPage.tsx`：加 `Select aria-label="import-type"` 含 5 个选项（`attackTicket`/`contribution`/`releasePackage`/`weightFile`/`person`，默认 `attackTicket`）；上传成功消息改为 `导入新增 ${r.created} · 已更新 ${r.updated}`；标题改为「导入数据」（覆盖原「导入攻关单」更通用，FE-IM-1 既有断言用 `getByText("导入攻关单")` 需要随之更新——属于有意识更新，等价 3b 既有断言更新先例）。

### 26.3 测试（TDD + 前后台全 e2e + 覆盖审计门）

- 后端 e2e（新 `apps/backend/test/import-upsert.e2e.test.ts`）：①xlsx with 2 rows (新 攻关单号 A1+A2) → created=2, updated=0；②同 xlsx 再次导入（同 identityKey）→ created=0, updated=2；③同行修改属性值 → updateNode 合并；④`?type=releasePackage` + xlsx (版本号 v1, v2) → 新 nodeType upsert 生效；⑤未知 type → 400；⑥validate 失败行跳过且不计 created/updated；⑦attackTicket upsert + ASSIGNED_TO 边幂等（一次导入只剩一条该边）；⑧UPDATE 后 syncRefEdges 重建（当前处理人 改值 → REF 边更新）。
- 前端 Playwright（既有 `coverage.spec.ts` 的 "GAP Import" 与新 `apps/frontend/e2e/import-upsert.spec.ts`）：选 attackTicket 上传 → 显示「新增 N · 已更新 M」；选 releasePackage 上传 → 同；既有失败路径（route 500）仍显示「导入失败，请重试」（不变）。
- 既有 coverage.spec 「GAP Import：failure path」与首页/导航相关断言中的「导入攻关单」标题改为新标题 → 等价有意识更新（同 3b 先例）。
- 随后跑全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 26.4 关键设计决策（补充 §0.4/§14.4）

| 决策 | 选择 | 理由 |
|---|---|---|
| 写权威路径 | 全部经 validateNode + `createNode`/`updateNode` + `syncRefEdges`/`syncAnchorEdges` + audit | §0.3：导入也是写，必须走唯一权威写路径 |
| 匹配键 | nodeType.identityKeys 顺序遍历、首个非空且命中胜出 | 简单可预测；多 identityKey 节点（如 person:employeeId/email）任一命中即视为同一实体 |
| 全部 identityKey 为空 | 视为新行，create | 无身份信号无法 upsert；旧 create-only 行为的兼容 |
| 多个既有节点都命中？ | 取 `queryNodes` 首个 | 实际罕见（identity 已保证唯一）；保留确定性，复杂去重留后续 |
| ASSIGNED_TO 边 | 仅 attackTicket、upsert 时先删后建 | 保留向后兼容；幂等避免重复 |
| CSV / 大文件流式 / 整批事务 | 不在 8 | YAGNI |
| nodeType 选择 UI | 5 项固定列表 | MVP；后续可改 registry-driven |

### 26.5 验收标准

- [x] `POST /api/import?type=<nodeType>`（默认 attackTicket 向后兼容）；未知 type → 400（import-upsert.e2e 用例4）
- [x] 首次导入新数据 → `{created:N, updated:0}`；再次导入相同 identityKey 行 → `{created:0, updated:N}`（用例1）；混合 → 各自计数正确（用例2）
- [x] UPDATE 合并属性（既有字段保留，新值覆盖；`当前处理人` 改值 → `syncRefEdges` 重建 REF；`问题单号` 改值 → ANCHORED_TO 重定向）（用例6）
- [x] `?type=releasePackage` 按 `版本号` upsert；`?type=weightFile` 按 `名称` upsert（用例3 架构验证：泛型导入对增量7 的新 nodeType 自动适用）
- [x] validateNode 失败行不计入 created/updated（用例5 — VL-2 缺 标题+状态 被跳过）
- [x] attackTicket：ASSIGNED_TO `攻关申请人` 边 upsert 幂等（每节点至多 1 条；用例7）
- [x] `ImportPage`：nodeType Select 可用（FE-IU1 经 `getByRole(combobox)`）；上传成功显示「导入新增 N · 已更新 M」；既有失败路径不变（coverage GAP Import 仍绿，已适配 `?type=` 查询匹配）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared15/backend83/FEunit13/e2e32）；完成后部署测试服务器

---

## 27. 增量9：自动日报生成器（Phase 3.2 上半）开发依据

> 兑现 §10 Phase 3.2「自动日报」+ §6.2 + Tony「信息断裂 → 自动日报」。本增量交付**生成器 + 预览 UI**，**不**实现外发渠道（§13#2 邮件/eSpace/welink 待你确认 + §13#3 welinkcli 抓取攻关群消息可行性/合规未定）：用户在页面预览今日日报，点「复制到剪贴板」粘进任意 IM/邮件。当 §13#2/#3 落实后，另增量加 channel adapter（pluggable outbox）即可。**严格只读**派生，不写库/不审计（同 §6.1/增量4 哲学）。

### 27.0 范围与定向

交付 ①`GET /api/daily-report?date=YYYY-MM-DD`（缺省今日 UTC）从既有 ProgressLog + attackTicket 派生当日按 ticket 分组的进展条目 + 摘要（被触达 ticket 数 / 进展条目总数 / 各状态 ticket 分布）；②前端 `/daily-report` 页（DatePicker 默认今日，预览结构化日报，**复制到剪贴板** 按钮把日报渲染为中文纯文本）；③AppShell 导航 + HomePage 卡片。**YAGNI**：不做外发渠道（待 §13#2/#3）、不做 welinkcli 抓取攻关群作为输入源、不做调度（手工触发即可）、不做 PDF/Excel 导出（先纯文本+剪贴板）、不做按人分组（先按 ticket）。

### 27.1 契约（@combat/shared）

```ts
export interface DailyReportEntry {
  seqNo: number; statusSnapshot: string; content: string; updatedBy: string; at: string;
}
export interface DailyReportSection {
  ticketId: string; 标题: string; latestStatus: string; entries: DailyReportEntry[];
}
export interface DailyReport {
  date: string; // YYYY-MM-DD
  sections: DailyReportSection[]; // 仅含当日有进展的 ticket
  summary: { ticketsTouched: number; entriesTotal: number; openByStatus: Record<string, number> };
}
```
纯加法；无新 `FieldOp`（只读）。

### 27.2 后端

- 新模块 `apps/backend/src/daily-report.ts` 路由 `GET /api/daily-report?date=YYYY-MM-DD`（只读）：
  - `date` 解析：`req.query.date` 若缺省/无效 → 当日 UTC `YYYY-MM-DD`；通过 `new Date(date+"T00:00:00Z").getTime()` 与 +1 天上界判断属于该日（按 `progress.updatedAt` ISO 字符串前缀 `YYYY-MM-DD` 直接比对——更简单、时区一致：日报按报告者所在地的日历日意义留待后续，MVP 用 UTC 日期前缀匹配，确定性可测）。
  - 遍历 `repo.queryNodes("attackTicket")`；对每个 t 取 `repo.listProgress(t.id)`；过滤 `p.updatedAt.startsWith(date)`；若该 ticket 当日有 ≥1 条 → 加入 `sections`（条目按 seqNo asc）。
  - `latestStatus`：取该 ticket 当日**最后一条**进展的 `statusSnapshot`（按 seqNo 取末位）；当日无则取 ticket 当前 `状态` 属性。
  - `summary`：`ticketsTouched = sections.length`；`entriesTotal = sum sections.entries.length`；`openByStatus`：所有 attackTicket（不限当日）按当前 `状态` 计数（同 dashboard 口径）。
  - 仅 reader 原语 `queryNodes/listProgress`；调用前后 `audit_log` 行数不变（e2e 断言）。
- `apps/backend/src/app.ts`：`app.use("/api", makeDailyReportRouter(deps.repo));`（dashboard 之后、错误中间件前）。

### 27.3 前端

- `apps/frontend/src/api.ts`：`getDailyReport(date?)` → `GET /api/daily-report` (+ optional `?date=YYYY-MM-DD`) → `Promise<DailyReport>`。
- 新页 `apps/frontend/src/pages/DailyReportPage.tsx`（路由 `/daily-report`，标题「攻关日报」）：
  - AntD `DatePicker` 默认今日，`aria-label="report-date"`；变更后 fetch 新日期。
  - 渲染：日期标题 + 摘要（`Statistic`：被触达 ticket / 进展条目数 + `Descriptions` 状态分布）+ 各 section 卡片（标题=`【标题】（latestStatus）`，下方 List 列进展条目 `#seqNo [statusSnapshot] content — updatedBy at`）。
  - **复制到剪贴板** Button `aria-label="copy-report"`：渲染为中文纯文本（标准 Markdown-like：日期标题、摘要行、`- 【ticket标题】(latestStatus): #seqNo [status] content — by/at`），写入 `navigator.clipboard`；成功 `message.success("已复制")`，失败 `message.error("复制失败")`。
  - 空日（sections=[]）显示 `<p role="status">该日无进展记录</p>`。
- `AppShell.tsx`：`ITEMS` 加 `{ key:"/daily-report", label: <Link to="/daily-report">攻关日报</Link> }`（置于「权重文件」之后）。
- `HomePage.tsx`：`MODULES` 加 `{ to: "/daily-report", title: "攻关日报", desc: "自动汇总当日各攻关单进展，复制到剪贴板（待外发渠道接入）" }`。

### 27.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`DailyReport`/`DailyReportSection`/`DailyReportEntry` 契约类型测试（tsc RED→GREEN）。
- 后端 e2e（新 `apps/backend/test/daily-report.e2e.test.ts`）：①建 attackTicket A/B/C，给 A 在 `date1` 加 2 进展、B 在 `date1` 加 1 进展、C 在 `date2` 加 1 进展；`GET ?date=date1` → `sections.length===2`（A+B）、`entries.length` 正确、`summary.ticketsTouched===2`、`summary.entriesTotal===3`；`?date=date2` → C only；`?date=` 空 → 今日；`latestStatus` = 该日最后一条 statusSnapshot；②空日 → `sections:[]`、`ticketsTouched:0`、`entriesTotal:0`、`openByStatus` 仍含所有 ticket；③只读：audit_log 前后不变 + 同输入同输出；④无效 date 字符串 → 缺省到今日（不 400，等价空查询语义）。
- 前端 Playwright（新 `apps/frontend/e2e/daily-report.spec.ts`）：首页/导航 → `/daily-report`；mock 路由返回固定 JSON（{date, sections:[1 section], summary}）→ 验证页渲染（日期标题、ticket 标题、进展条目文本）；点「复制到剪贴板」（mock `navigator.clipboard.writeText`）→ 验证 `已复制` 提示。空日 mock → `role="status"` 文案可见。
- 全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 27.5 关键设计决策（补充 §6/§13）

| 决策 | 选择 | 理由 |
|---|---|---|
| 生成机制 | 只读派生（reader 原语 + audit 不变） | §0.3/§6.1 与增量 4/5/6 一致 |
| 数据源 | 仅内部 ProgressLog + attackTicket | welinkcli 抓攻关群（§13#3）可行性/合规未定；MVP 内部数据已构成实用日报 |
| 外发渠道 | **不在 9** | §13#2 通道未定（先邮件 vs eSpace vs welink）；MVP 用户用「复制到剪贴板」粘进任何 IM |
| 日期匹配 | `progress.updatedAt.startsWith("YYYY-MM-DD")`（UTC 日历日前缀比对） | 确定性可测；本地时区/工作日历留待 §13 后续讨论 |
| 分组 | 按 attackTicket | 主要日报使用场景；按人/部门分组留后续 |
| 调度 | 手工触发（页内 DatePicker） | YAGNI；定时调度待外发渠道接入 |
| 入口 | `/daily-report` + 导航 + 首页卡片 | 集成首页原则；与 dashboard/search/proposals 同形 |

### 27.6 验收标准

- [x] shared `DailyReport`/`DailyReportSection`/`DailyReportEntry` 契约生效（shared 类型测试 16/16，tsc RED→GREEN），现有不破坏
- [x] `GET /api/daily-report?date=YYYY-MM-DD`：sections 仅含当日有进展的 ticket，entries 按 seqNo asc，`latestStatus` 取当日最后条；summary 正确（daily-report.e2e 用例1）
- [x] 只读：audit_log 行数不变 + 同输入同输出（用例3）；缺省/无效 date → 今日不 400（用例4）；空日 sections=[] + openByStatus 仍全局（用例2）
- [x] `/daily-report` 页：DatePicker 默认今日；预览渲染日期/ticket/进展条目/摘要；空日 `role="status"` 「该日无进展记录」（FE-DR1/DR2）；AppShell+首页入口集成
- [x] 「复制到剪贴板」按钮成功复制中文纯文本日报（FE-DR1：经 `Object.defineProperty` 剪贴板桩 + window.__copied 直接断言，避免 AntD 提示生命周期不稳）
- [x] 既有断言加法不破坏（home-card-*、AppShell nav 既有项不变，e2e 34/34 含全部既有用例）
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared16/backend87/FEunit13/e2e34）；完成后部署测试服务器

---

## 28. 增量10：跟催/提醒引擎（Phase 3.4 上半）开发依据

> 兑现 §10 Phase 3.4 + 李嘉①③（②CCB 提醒延后——需新字段决策，见 §28.5）。本增量交付**规则引擎 + 通知 outbox + 可插拔 ChannelAdapter（默认 stub：记录但不真发）**——架构同 3c 提议队列（scan → 待发送 → 决定 发送/忽略）。**真实外发** 待 §13#2 通道确认（邮件 SMTP / eSpace / welink）后另增量挂接相应 adapter；本增量产出的 outbox 已可作为信源（用户可在 /reminders 页人工查看待催并复制内容到任意 IM）。**写权威路径**：notifications 表+审计；规则计算只读。

### 28.0 范围与定向

交付 ①`notifications` 表（id, kind, ticket_id, recipient_person_id?, subject, body, status, decided_by?, decided_at?, created_at；append+audit）；②`Reminder*` 契约；③可插拔 `ChannelAdapter`（内置 `StubChannelAdapter`：`send()` 解析为 `已发送` 时间戳并 audit，不外发）；④规则引擎 2 条（**问题单跟催**：状态∈{待响应,处理中,进行中} + 距今 ProgressLog 末次更新 ≥`STALE_DAYS=3` → 发给 `当前处理人`；**FE Deadline 提醒**：`客户要求解决时间` 在未来 ≤`DEADLINE_WARN_DAYS=3` 天 + 状态未闭环 → 发给 `当前处理人`）；⑤API：`POST /api/reminders/scan`（幂等：同 (kind,ticketId) 待发送或最近已发送/已忽略 不重复生成）、`GET /api/reminders?status=`、`POST /api/reminders/:id/send`（走 ChannelAdapter，stub 仅置 `已发送`）、`POST /api/reminders/:id/ignore`；⑥前端 `/reminders` 队列页（镜像 `/proposals`）+ AppShell 导航 + HomePage 卡片。**YAGNI**：不做 CCB 规则（②，待 schema 字段决策）、不做真实 SMTP/eSpace/welink 接入（待 §13#2）、不做定时调度（手工触发 scan；定时器待外发渠道接入）、不做 i18n。

### 28.1 契约（@combat/shared）

- `ReminderStatus = "待发送" | "已发送" | "已忽略"`（中文字面，规范）。
- `ReminderKind = "问题单跟催" | "FE Deadline 提醒"`（规则名作为类型）。
- `Reminder`：`{ id; kind: ReminderKind; ticketId: string; recipientPersonId?: string; recipientName: string; subject: string; body: string; status: ReminderStatus; decidedBy?: string; decidedAt?: string; createdAt: string }`。
- `Repository` 增（纯加法、镜像 3c proposals）：`createReminder(p, actor): Reminder`、`listReminders(opts?:{status?:ReminderStatus}): Reminder[]`、`getReminder(id): Reminder | undefined`、`updateReminderStatus(id, status, decidedBy, actor): Reminder`。
- `ChannelAdapter` 接口：`send(r: Reminder, actor: string): { sentAt: string } | Promise<...>`（同步实现允许；stub 直接返回当前时间）；`StubChannelAdapter` 默认 export。

### 28.2 后端

- `apps/backend/src/db.ts`：新增 DDL（同 proposals 形态）：
  ```sql
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT NOT NULL,
    recipient_person_id TEXT, recipient_name TEXT,
    subject TEXT, body TEXT,
    status TEXT NOT NULL, decided_by TEXT, decided_at TEXT, created_at TEXT);
  ```
- `apps/backend/src/repository.ts`：实现 §28.1 4 方法（事务 + audit）；`mapReminder` 与 proposals 同形态。
- 新模块 `apps/backend/src/rules.ts`：`scanReminders(repo, registry, now): { kind; ticketId; recipientPersonId?; recipientName; subject; body }[]` 确定性、只读：
  - **问题单跟催**：对每个 `attackTicket` 状态∈OPEN：取最近 `progress.updatedAt` 或 `node.updatedAt`，若 `now - lastAt ≥ STALE_DAYS*86400000` → emit；recipient = REF(field=当前处理人) 解析（若不存在则跳过）；subject/body 含 ticket 标题/编号/已停滞天数。
  - **FE Deadline 提醒**：对每个 `attackTicket` 状态∈OPEN + `客户要求解决时间` 可解析为日期且 `0 ≤ deadline - now ≤ DEADLINE_WARN_DAYS*86400000` → emit；recipient 同上；subject/body 含剩余天数。
- 新模块 `apps/backend/src/channel.ts`：`ChannelAdapter` 接口 + `StubChannelAdapter`（send 返回 `{ sentAt: now.toISOString() }`，并由 repo audit 记录）。
- 新模块 `apps/backend/src/reminders.ts`：
  - `POST /api/reminders/scan`：跑 `scanReminders`；对每个 candidate `(kind,ticketId,recipientPersonId)` 三元组：若 `listReminders` 中已有该三元组 status∈{待发送,已发送,已忽略}**最近 7 天**记录 → 跳过（避免噪声重发）；否则 `createReminder({status:"待发送", ...})`；返回 `{ created: n }`。
  - `GET /api/reminders?status=`：默认按 createdAt desc 全部。
  - `POST /api/reminders/:id/send`：404/409 同 proposals/decide；`channel.send(r)` 成功后 `updateReminderStatus("已发送", decidedBy)`；audit。
  - `POST /api/reminders/:id/ignore`：404/409；`updateReminderStatus("已忽略", decidedBy)`。
  - 注入 `ChannelAdapter`（默认 `StubChannelAdapter`）。
- `app.ts`：`app.use("/api", makeRemindersRouter(deps.repo, deps.registry));`（daily-report 之后、错误中间件前）。

### 28.3 前端

- `apps/frontend/src/api.ts`：`listReminders(status?)`、`scanReminders()`、`sendReminder(id, decidedBy)`、`ignoreReminder(id, decidedBy)`。
- 新页 `apps/frontend/src/pages/RemindersPage.tsx`：标题「跟催/提醒队列」；顶部「扫描提醒」按钮 + 状态过滤；表格列 kind/ticketId/recipientName/subject/createdAt + 每行「发送(stub)」「忽略」按钮（`aria-label` 同 proposals 风格）；空态 `<p role="status">暂无待发送提醒</p>`。
- `AppShell` + `HomePage` 加导航 + 卡片：「跟催提醒」`/reminders`（置于「攻关日报」之后）。
- 描述文案显式标注 stub：「（当前为 stub 渠道：点'发送'仅标记已发送并记录；接入 SMTP/IM 后真实外发）」。

### 28.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`ReminderStatus`/`ReminderKind`/`Reminder` + Repository 契约类型测试 tsc-clean。
- 后端 e2e（新 `apps/backend/test/reminders.e2e.test.ts`）：①问题单跟催规则：建 ticket 状态进行中 + 当前处理人 + 直接 SQL 插入旧 progress(updatedAt 7 天前)→`scan`→出 1 条 `问题单跟催`；②FE Deadline 规则：建 ticket 客户要求解决时间 = 今天+2天 + 状态进行中→`scan`→出 1 条 `FE Deadline 提醒`；③幂等：连续两次 scan，二次 `created:0`；④`send` stub：状态→已发送，channel 调用计数（注入测试 channel）；⑤`ignore`：状态→已忽略；⑥`send`/`ignore` 在非待发送上→409；⑦不存在 id→404；⑧解析失败（无当前处理人、客户要求解决时间不可解析）→该规则跳过该 ticket。
- 前端 Playwright（新 `apps/frontend/e2e/reminders.spec.ts`）：mock 路由提供 1 条 `待发送`→`/reminders` 渲染→点「发送(stub)」→该行消失（refresh 后 `待发送` 列表空）；空态 mock 验证 role=status。
- 全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 28.5 关键设计决策（补充 §6/§13）

| 决策 | 选择 | 理由 |
|---|---|---|
| 队列形态 | 通知 outbox（notifications 表，append+审计）+ ChannelAdapter | 镜像 3c proposals 模式；外发与生成解耦，便于后续插拔 SMTP/IM |
| 默认 channel | StubChannelAdapter（仅置 `已发送`，不真发） | §13#2 通道未定；不假装外发，但 outbox 已可作为信源 |
| 规则集 | ①问题单跟催(N天无进展) + ③FE Deadline 临近 + **②CCB 提醒（§29 已交付）** | ②已加 `是否需CCB` enum 字段 + CCB 规则；李嘉①②③ 全部到位 |
| 阈值 | STALE_DAYS=3、DEADLINE_WARN_DAYS=3 | 经验默认；后续可配置 |
| 幂等 | 同 (kind,ticketId,recipient) 7 天内已生成则跳过 | 避免重复打扰 |
| 调度 | 手工触发（前端按钮） | YAGNI；定时器待外发渠道接入 |
| welinkcli 抓群消息 | 不在 10 | §13#3 未定；规则不依赖 IM 输入 |

### 28.6 验收标准

- [x] shared `Reminder*` 契约 + Repository 通知方法（shared 17/17，tsc RED→GREEN），现有不破坏
- [x] `POST /api/reminders/scan`：问题单跟催 + FE Deadline 两规则产出（reminders.e2e 用例1/2）；幂等（用例3，7天窗口）；无收件人跳过（用例6）
- [x] `GET /api/reminders?status=` 列表与过滤；createdAt desc
- [x] `POST /api/reminders/:id/send`：stub Channel→`已发送`+audit；非待发送→409；不存在→404（用例4）
- [x] `POST /api/reminders/:id/ignore`：`已忽略`+audit；非待发送→409（用例5）
- [x] `/reminders` 页：扫描+列+发送/忽略+空态 `暂无待发送提醒`（FE-RM1/FE-RM2）；AppShell+首页入口集成；卡片描述显式标注 stub 渠道
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared17/backend93/FEunit13/e2e36）；完成后部署测试服务器

---

## 29. 增量11：CCB 提醒规则（Phase 3.4 李嘉②）开发依据

> 兑现 §10 Phase 3.4 + 李嘉② "CCB 提醒：需要 CCB 的问题单提醒上会"。补齐增量10 延后的②规则——通过新增配置字段 `是否需CCB` + rules.ts 加 1 条规则，复用增量10 全部 outbox/channel/UI 基础设施。**纯加法**：架构、表结构、路由、前端页面**零变化**；仅扩展枚举与配置。再次证伪 §0.4 配置驱动 + 模块化规则引擎设计。**§28.5 决策表 ②CCB 提醒延后 由本节正式解决**。

### 29.0 范围与定向

交付 ①`attackTicket.json` 新字段 `{ id:"是否需CCB", type:"enum", enumValues:["是","否"] }`（不 required，默认未设）；②`ReminderKind` 扩展加 `"CCB 提醒"`；③`rules.ts` 加 CCB 规则：`是否需CCB === "是"` + 状态 ∈ {待响应,处理中,进行中} + 当前处理人 存在 → emit「CCB 提醒」（recipient=当前处理人；subject/body 含标题/攻关单号）；④复用增量10 的 outbox + 7天幂等窗口 + stub channel + /reminders UI（**零前端代码改动**）。YAGNI：不引入"CCB 已开"时间戳（用户在 /reminders 标记忽略即可）。

### 29.1 配置 + 契约改动

- `config/schemas/attackTicket.json` 追加字段 `{ "id":"是否需CCB", "name":"是否需CCB", "type":"enum", "label":"是否需CCB", "enumValues":["是","否"] }`（不 required，纯加法）。
- `packages/shared/src/types.ts` `ReminderKind` 由 `"问题单跟催" | "FE Deadline 提醒"` 扩展为 `"问题单跟催" | "FE Deadline 提醒" | "CCB 提醒"`。

### 29.2 后端

- `apps/backend/src/rules.ts` `scanReminders`：在既有两规则后增加第三规则（同 OPEN 集 + 当前处理人解析复用）：
  ```ts
  if (String(t.properties["是否需CCB"] ?? "").trim() === "是") {
    drafts.push({
      kind: "CCB 提醒", ticketId: t.id,
      recipientPersonId: handler.id, recipientName: handler.name,
      subject: `[CCB] 攻关单「${title}」需上 CCB 评审`,
      body: `攻关单「${title}」（${t.properties["攻关单号"] ?? t.id}）状态「${status}」标记为需要 CCB 评审，请安排上会。`,
    });
  }
  ```
- `apps/backend/src/reminders.ts` 不改（router/idempotency 自动适用）。
- 既有 7 天幂等窗口 + `(kind,ticketId,recipientPersonId)` 三元组天然防重，无需额外修改。

### 29.3 前端

**零改动**：增量10 的 `/reminders` 页是数据驱动的——`Reminder.kind` 作为字符串显示，新增枚举项无需 UI 改动；EntityTable 的 enum 字段渲染由 `是否需CCB` 的 `enumValues` 配置驱动，用户在 /attack 攻关单详情/编辑表上即可下拉选「是」/「否」。

### 29.4 测试（TDD + 前后台全 e2e + 覆盖审计门）

- shared：`ReminderKind` 扩展类型测试（"CCB 提醒" 可赋值给 `Reminder.kind`），tsc-clean。
- 后端 e2e（新 `apps/backend/test/ccb-reminder.e2e.test.ts`）：①ticket 是否需CCB="是" + 状态进行中 + 当前处理人=甲 → scan 出 1 条 `CCB 提醒` reicipient=甲、body 含"CCB 评审"；②是否需CCB="否" → 不生成；③是否需CCB 未设 → 不生成；④是否需CCB="是" 但状态=已解决 → 不生成；⑤是否需CCB="是" 无 当前处理人 → 不生成；⑥幂等（同 ticket+CCB 连续 scan 第二次 created:0）。
- 既有 reminders.e2e 仍全绿（向后兼容验证）。
- 前端 Playwright：无新增。既有 FE-RM1/RM2 仍绿。
- 全功能 Playwright e2e 覆盖审计门 + `npm run test:all` 连续两次全绿。

### 29.5 §28.5 决策表同步

§28.5 「规则集」行原文：「①问题单跟催(N天无进展) + ③FE Deadline 临近；**②CCB 提醒延后**」 → 更新为：「①问题单跟催 + ③FE Deadline + **②CCB 提醒（§29 已交付）**」。

### 29.6 验收标准

- [x] `ReminderKind` 扩展（shared 18/18，tsc RED→GREEN），现有不破坏
- [x] `attackTicket.json` 加 `是否需CCB` enum；现存 ticket 不受影响（不 required）
- [x] `scanReminders` CCB 规则：=是+状态open+有处理人 → emit；其它分支(否/未设/已解决/无处理人)不 emit；7天幂等（ccb-reminder.e2e 6 用例）
- [x] /reminders 页无需改动即可展示 CCB 提醒行（架构验证：数据驱动 UI；既有 FE-RM1/RM2 仍绿）
- [x] §28.5 决策表 ②CCB 提醒已更新为「§29 已交付」
- [x] 全功能 e2e 覆盖审计门通过；`npm run test:all` 连续两次全绿（shared18/backend99/FEunit13/e2e36）；完成后部署测试服务器

---

## 30. 增量12：§13#9 reload 回滚粒度修补 开发依据

> 解决 §13#9：`applyFieldOp` 的 `reload()` 重解析全目录，无关 sibling 配置损坏会触发**误回滚本次有效变更**。修补策略：①把 `reload()` 改为**容错**——sibling 文件解析失败时 `console.warn` 跳过，注册表保留其余可解析 nodeType；仅当**全部**文件解析失败才抛错（启动时仍能给出明确信号）；②`applyFieldOp` 写盘后**仅校验被写文件**，如果该文件本身解析合法→提交；reload 因 sibling 失败的，不再回滚本次变更。**纯加固**：现有所有 schema 操作行为不变；只是当系统中存在多 schema 且某个 sibling 损坏时，仍能正确推进**有效**变更。

### 30.1 后端

`apps/backend/src/registry.ts` 修改：
- `reload()`：把 `.map(...).throw on bad)` 改为 `.flatMap(...)`：每个文件用 `try/catch` 包裹，损坏文件 `console.warn(\`Schema 配置文件 ${f} 解析失败，跳过：${msg}\`)` 并返回 `[]`，合法文件返回 `[ns]`。仅当**所有**文件失败 → 抛 `Error("config/schemas 下无可解析的 schema 文件")`。
- `applyFieldOp`：在 `writeFileSync(file, ...)` 之后、`reload()` 之前，新增**自校验**——`try { JSON.parse(readFileSync(file)) }` + 结构检查（nodeType/fields），失败立即 `writeFileSync(file, prev)` 抛错（我们写的东西必须可解析；理论不会发生，防御）。**自校验通过**则 `reload()`（已容错）：reload 不再抛错（最多 warn），变更落地。删除既有 `try { reload } catch { rollback }`，由自校验承担"本次变更安全"的判断。

### 30.2 测试

后端 e2e（新 `apps/backend/test/registry-resilience.e2e.test.ts`）：①tmpdir 含合法 `attackTicket.json` + 损坏 `bad.json`（非 JSON）→ `new FileSchemaRegistry(tmpdir)` 不抛错；`getNodeSchema("attackTicket")` 返回合法；②对 attackTicket 发 `PATCH setConcept` 成功；③全部文件损坏 → 构造抛错（启动失败信号保留）；④`applyFieldOp` 写出的新文件即使 sibling 损坏也成功；⑤回归：所有现有 schema 操作 e2e（concept/anchor/aliases/setAnchor 等）保持绿。

无前端改动；无 shared 改动。

### 30.3 验收

- [x] `reload()` 容错：sibling 损坏 → `console.warn` 跳过，其余 nodeType 可用（registry-resilience.e2e 用例1 + registry.test 更新断言）
- [x] 全部文件损坏 → 构造抛错（用例3 保留明确信号）
- [x] `applyFieldOp` 自校验合法 + sibling 损坏 → 变更落地不误回滚（用例2 PATCH setConcept 成功+磁盘验证）
- [x] 现有 registry/concept/anchor/aliases/ref/proposals 等 e2e 全部保持绿（backend 103/103，零回归）
- [x] §13#9 已标记**已解决**
- [x] `npm run test:all` 连续两次全绿（shared18/backend103/FEunit13/e2e36）；完成后部署

---

## 31. 增量13：SQL WHERE 推下 + 索引利用 开发依据

> 解决 3c/8/10 评审一致定位的"门后真问题"：`queryEdges`/`listProposals`/`listReminders` 一律 `SELECT *` + JS 端 filter，索引（`idx_edges_source` 已建却用不上）形同虚设；多 schema/边/通知累积后端到端响应时间线性退化。**纯性能加固**：行为字节级不变（既有 103 测试为回归保障）；仅改 SQL 构造 + 增加索引。

### 31.1 后端

- `apps/backend/src/db.ts` 加索引：
  ```sql
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(targetId);
  CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edgeType);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
  ```
  既有 `idx_edges_source ON edges(sourceId)`/`idx_nodes_type ON nodes(nodeType)` 保留。

- `apps/backend/src/repository.ts`:
  - `queryEdges(opts)`：按 opts 构造 WHERE（sourceId/targetId/edgeType 任意组合或全 undefined）+ 参数化 prepared statement；空 opts 即 `SELECT *`。
  - `listProposals(opts)`：`status` 推下到 WHERE；无 status 即全表（小表，影响小，索引仍可被规划器用）。
  - `listReminders(opts)`：同上 + 保留 `ORDER BY created_at DESC`。

### 31.2 测试

无新 e2e：既有 103 backend 测试**重度**使用这三方法（refs/anchors/related/concept/recommend/dashboard/proposals/reminders/import-upsert/archive 全部）——任何返回集差异都会立即体现。`npm run test:all` 两次全绿即回归证明。

### 31.3 验收

- [x] `db.ts` 加 4 个新索引（idx_edges_target / idx_edges_type / idx_proposals_status / idx_notifications_status）；现有索引保留
- [x] `queryEdges` 改 SQL WHERE；空/单参/多参组合均正确（既有 refs/anchors/related/recommend/dashboard 测试为证）
- [x] `listProposals` / `listReminders` 改 SQL WHERE；`createdAt DESC` 保留（既有 proposals/reminders e2e 为证）
- [x] 既有 backend 103/103 e2e + shared 18 + FE unit 13 + Playwright 36 **零回归**
- [x] `npm run test:all` 连续两次全绿（shared18/backend103/FEunit13/e2e36）；完成后部署

---

## 32. 增量15：depth-N 关联遍历 开发依据

> 兑现 PRD §4 「depth-N 遍历」+ §18.0 row「多跳/冲突/独立KG引擎」之 depth-N 子项（其余子项：冲突检测 / 独立可重建 KG 引擎，仍为后续）。在既有 `/api/related/:nodeType/:id` 上加可选 `?depth=<1-5>` 参数：当 `depth>1` 时返回额外 `expanded: ExpandedItem[]`（BFS over REF+ANCHORED_TO 的 N-hop 扩展，每节点首次访问入列以保证最短路径），既有 1-跳 `outgoing/incoming/coAnchored/candidates` **行为字节级不变**——纯加法。前端 `RelatedPage` 加深度选择 Select 触发可选扩展面板。值给 Hermes 单次推理上下文与探索 UX 同时带来更深视野。

### 32.1 契约（@combat/shared）

`RelatedResult` 追加可选字段：
```ts
expanded?: { node: GraphNode; depth: number; viaEdgeType: string; viaField: string; parentId: string }[];
```
- `depth ∈ [1, requested]`（首次到达的最短路径深度，1=root 的直接邻居，N=N 跳到达）。
- `viaEdgeType ∈ {REF, ANCHORED_TO}`（命中本节点的边类型）。
- `viaField` = 边 `properties.field`（REF 时是字段名；ANCHORED_TO 时是关联问题单/字段名）。
- `parentId` = 上一跳节点 id（树重构用）。
- 不含 root；不含锚点节点（透明遍历）。

### 32.2 后端

- `apps/backend/src/related-core.ts` 加 `buildExpanded(repo, rootId, depth): ExpandedItem[]`：
  - 维护 `visited: Set<id>`（含 root，防重）+ FIFO 队列 `[{id, depth}]`。
  - 每出队 → 取该节点的所有 REF + ANCHORED_TO 边（出/入向）→ 对端节点 id 若未 visited → push 一条 ExpandedItem + 入队（depth+1 ≤ requested）。
  - 出向锚点节点的反向边（其它视图）也算 1 跳遍历（沿用 §21 cross-nodeType 派生贯通）；锚点节点本身不入 expanded（透明节点）。
- `apps/backend/src/related.ts`：解析 `?depth=` clamp 到 [1, 5]（无 / NaN / <1 → 1）；当 depth>1 调 `buildExpanded` 并在响应加 `expanded`；depth=1 时 **不**带 expanded 字段（保持现有响应字节级一致）。

### 32.3 前端

- `apps/frontend/src/api.ts`：`getRelated(nodeType, id, opts)` 扩展接收 `{ includeCandidates?, depth? }`；depth 拼为 `&depth=N`。
- `apps/frontend/src/pages/RelatedPage.tsx`：顶部加 `Select aria-label="depth-select"` 含 1/2/3 三档（默认 1）；切换时重新拉数据；当返回有 `expanded` 时下方加「扩展（深度 N）」面板，列各项 `node label`（点击同样跳 detailLink）+ `[depth=N viaEdgeType viaField]` 标注。
- 既有概念/候选/跨颗粒度分组的渲染与断言 **不变**。

### 32.4 测试

- shared：`RelatedResult.expanded?` 契约类型测试 tsc-clean。
- 后端 e2e（新 `apps/backend/test/related-depth.e2e.test.ts`）：建链 A→(REF)P，A→(ANCHORED_TO)anchor 同时 B→(ANCHORED_TO)anchor；`?depth=1` 不返回 expanded；`?depth=2` 返回 P + B（B 是经锚点跨颗粒度 2 跳到达）；`?depth=3` 进一步扩展；环路（A→B→A）只入一次；`depth=99` clamp 到 5；既有 1-hop fields 字节级一致（snapshot 对比）。
- 前端 Playwright（在 `related.spec.ts` 或新 `depth.spec.ts`）：mock 含 `expanded` 的响应 → 选择深度 2 → 扩展面板出现 + 节点 label 可见 + depth/via 标注可见。
- 既有 36 e2e 全部保持绿（向后兼容）。

### 32.5 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 默认 depth | 1 | 既有调用方零变更 |
| 上限 | 5 | 防爆炸（节点数指数级）；探索深度足够 |
| 锚点节点入扩展 | 否（透明节点） | 让 expanded 仅含业务节点，可读性 |
| 遍历方向 | 出向 + 入向 + 跨锚点 | 与 1-hop `outgoing/incoming/coAnchored` 语义一致 |
| 重复访问 | 仅首次入列（BFS 最短路径） | 避免重复；保证深度=最短路径 |
| 冲突检测 / 独立可重建 KG 引擎 | 不在 15 | §18.0 后续 |

### 32.6 验收

- [x] `RelatedResult.expanded?` 契约类型测试 tsc-clean；现有契约不破坏
- [x] `/api/related?depth=N`（1-5）；`depth=1`/缺省时响应字节级与既有一致（不含 `expanded`）
- [x] `depth=2..5` 时 BFS 正确：每节点首次访问入扩展；环路防重；锚点透明
- [x] `depth=99` clamp 到 5；`depth=0` / 非数字 → 默认 1
- [x] RelatedPage 深度 Select 切换 → 拉取新数据 + 扩展面板渲染
- [x] 既有 36 e2e + 新增 FE-DP1 共 37 e2e 全部绿（零回归）；`test:all` 连续两次全绿；待部署

---

## 33. 增量 16：冲突 / 重叠检测（兑现 §4.3 / §11 Phase 2「冲突边红色高亮」）

> 兑现 §4.3 + §11 Phase 2 残留：自动检测同人多活跃单（负荷）、同问题单号（重叠），建派生 `CONFLICTS_WITH` / `OVERLAPS_WITH` 边，关联页红色高亮，并提供 `/conflicts` 汇总面。**派生边、可全量重建、不接受直接写入**（与 KG 派生原则一致：§0.4 / §0.7）。

### 33.1 契约（@combat/shared）

```ts
export interface ConflictItem {
  edgeType: "CONFLICTS_WITH" | "OVERLAPS_WITH";
  reason: string;        // 中文人类可读理由
  node: GraphNode;       // 冲突对端
}
export interface ConflictRow {
  edgeType: "CONFLICTS_WITH" | "OVERLAPS_WITH";
  reason: string;
  source: GraphNode;
  target: GraphNode;
}
export interface ScanConflictsResult { conflicts: number; overlaps: number; }
```
`RelatedResult` 追加可选字段 `conflicts?: ConflictItem[]`（仅在节点有冲突时出现；保持 1-跳响应字节级兼容）。

### 33.2 后端 — `apps/backend/src/conflicts.ts`

- `syncConflicts(repo)`：
  1. 删除所有既有 `CONFLICTS_WITH` 和 `OVERLAPS_WITH` 边（派生数据，全量重建）。
  2. **Rule 1 同人多活跃单**：取所有 `attackTicket` 节点，按 `当前处理人` 属性分组（非空），若同人下 `状态 ∈ {待响应, 处理中, 进行中}` 的活跃单 ≥ 2 个，则两两建 `CONFLICTS_WITH` 边，`properties.reason = "同负责人多并发：" + 人员名`。
  3. **Rule 2 同问题单号**：取所有 `attackTicket`，按 `问题单号` 属性分组（非空），若同问题单号下 ≥ 2 个工单，两两建 `OVERLAPS_WITH` 边，`properties.reason = "同问题单：" + 单号`。
  4. 一条无向规则两端各建一条有向边（避免 RelatedPage 只能看到一向）。
  5. 返回 `{ conflicts, overlaps }` 计数。
- `POST /api/conflicts/scan` → 调用 `syncConflicts` 并返回计数。
- `GET /api/conflicts` → 返回 `ConflictRow[]`（按 edgeType 分组后由前端拆分到 Tabs）。
- `/api/related/:nodeType/:id` 响应追加 `conflicts?: ConflictItem[]`（仅在该节点是 conflict 边端点之一时出现）。

### 33.3 前端

- `api.scanConflicts(): Promise<ScanConflictsResult>` / `api.listConflicts(): Promise<ConflictRow[]>`。
- 新页 `/conflicts`（`apps/frontend/src/pages/ConflictsPage.tsx`）：
  - 顶部 `重新扫描` 按钮（红色 danger），右侧显示「冲突 N · 重叠 M」。
  - AntD Tabs：「冲突（同负责人）」/「重叠（同问题单）」两个 Tab，各自 Table 列：`源节点 / 目标节点 / 理由`，可点击跳关联页。
- `AppShell` 加 `/conflicts` 导航项（标签：「冲突」，红色 dot 当 count>0）。
- `HomePage` 加 `home-card-conflicts`（红色描边）。
- `RelatedPage`：当 `data.conflicts && length>0`，在最末渲染红色虚线边框区（`#cf1322`）「冲突 / 重叠」，每条目展示对端节点链接 + `[edgeType 中文标签 · reason]`。

### 33.4 测试

- 后端 e2e (`conflicts.e2e.test.ts`) 至少 4 项：
  1. 同人两单 active → CONFLICTS_WITH 双向出现，reason 含人员名。
  2. 同问题单号两单 → OVERLAPS_WITH 双向出现，reason 含单号。
  3. 把其中一单 `状态=已解决` → 重扫后该单不再出现于 CONFLICTS_WITH（活跃过滤生效）。
  4. RelatedPage payload 在该节点上含 `conflicts`，无冲突的孤立节点不含。
- 前端 e2e (`conflicts.spec.ts`) 路由 mock：扫描按钮、Tabs 切换、行点击跳关联页、RelatedPage 红色区可见。

### 33.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 边存储 | 当作派生边写入 `edges` 表（清旧重建） | 复用现有 traversal/index；与 KG 派生原则一致 |
| 边方向 | 双向各建一条（A→B 与 B→A） | RelatedPage 任一端都能看见对端，无需特殊查询 |
| 检测面 | Rule 1 同人活跃 + Rule 2 同问题单号 | §4.3 子集；SLA/优先级依赖需更多字段→后续 |
| 活跃状态集 | `{待响应, 处理中, 进行中}` | 与 §4.4 一致 |
| 扫描触发 | 手动按钮（MVP） | 简单可控；定时器→后续 |
| `状态` 字段取值面 | 兼容 attackTicket.json 里 `状态` 当前枚举 + retired enum | 现表 retired=true，但属性值仍按字符串读 |
| 重启幂等 | scan 删旧建新 | 全量派生；多次扫描结果一致 |

### 33.6 验收

- [x] `ConflictItem` / `ConflictRow` / `ScanConflictsResult` 契约 tsc-clean；既有契约不破坏
- [x] `POST /api/conflicts/scan` 同人 2 活跃单 → conflicts ≥ 1；同问题单号 2 单 → overlaps ≥ 1
- [x] 把活跃单转为 `已解决` 再 scan → 该单不再在 CONFLICTS_WITH 边
- [x] `GET /api/related/...` 在涉及节点上含 `conflicts`；无关节点不含（向后兼容）
- [x] `/conflicts` 页 Tabs/扫描按钮/点击跳关联页全部可用
- [x] RelatedPage 红色「冲突 / 重叠」区在涉冲突节点上渲染
- [x] 既有 37 e2e + 新增 FE-CF1/FE-CF2 共 39 e2e 全部绿（零回归）；`test:all` 连续两次全绿；待部署

---

## 34. 增量 17：独立可重建 KG 引擎（兑现 §0.4 / §0.7 / §18.0 最后一项）

> §0.7 KG 是**派生**且**全量可重建**。当前虽然 `syncRefEdges`/`syncAnchorEdges`/`syncConflicts` 都是幂等增量，但缺一键全量重建，发生增量漂移（如手工修 sqlite、批量改 properties、迁移恢复）后无法收敛。本增量提供 `rebuildKG(repo, registry)` 统一入口：从权威结构化数据（nodes + properties）清洗并重建所有派生边类型。

### 34.1 契约（@combat/shared）

```ts
export interface RebuildKGResult {
  refEdges: number;       // 重建 REF 边总数
  anchorEdges: number;    // 重建 ANCHORED_TO 边总数
  conflicts: number;      // 无向对数（与 ScanConflictsResult.conflicts 含义一致）
  overlaps: number;       // 无向对数
  durationMs: number;
}
```

### 34.2 后端 — `apps/backend/src/kg-rebuild.ts`

`rebuildKG(repo, registry): RebuildKGResult`：

1. **清旧**：删除所有派生边 `REF`、`ANCHORED_TO`、`CONFLICTS_WITH`、`OVERLAPS_WITH`（按 edgeType 单条件批量删，复用 §33 已有的 deleteEdges）。
2. **重建 REF + ANCHORED_TO**：对每个 nodeType（含 attackTicket/contribution/releasePackage/weightFile 等），`queryNodes(nodeType)` 全表遍历，对每个 node 调 `syncRefEdges(repo, registry, node, node.properties, "system:rebuild-kg")` 与 `syncAnchorEdges(repo, registry, node, node.properties, "system:rebuild-kg")`。注意：`syncRefEdges` 内部已会先 deleteEdges({sourceId, edgeType:"REF"})，但我们外层已清空，重复 delete 无副作用。
3. **重建冲突/重叠**：调 `syncConflicts(repo)`。
4. 统计：返回 `{ refEdges, anchorEdges, conflicts, overlaps, durationMs }`。`refEdges`/`anchorEdges` 通过 `queryEdges({edgeType})` 取最终边表计数；`conflicts`/`overlaps` 取 syncConflicts 返回。
5. 路由 `POST /api/kg/rebuild` → 调 `rebuildKG` 返回 `RebuildKGResult`，无请求体。

### 34.3 前端

- `api.rebuildKG(): Promise<RebuildKGResult>`。
- `ConflictsPage` 顶部 Space 追加「全量重建 KG」按钮（次级 default Button，不抢眼），点击 → `api.rebuildKG()` → 成功 message 显示重建统计 + 重新 `listConflicts()`。
- 不新建独立路由（YAGNI；重建是低频运维动作，挂在冲突页够用）。

### 34.4 测试

后端 `apps/backend/test/kg-rebuild.e2e.test.ts`：
1. 建若干 ticket / contribution / person，触发增量同步建好 REF/ANCHORED_TO 边 → 记录数 R0/A0。
2. 手工 `repo.deleteEdges` 删掉所有 REF 边（模拟漂移）→ R 边数 = 0。
3. `POST /api/kg/rebuild` → 响应 `refEdges === R0`，且 anchor 数 == A0（幂等）。
4. 再次 rebuild → 数字仍一致（多次幂等）。
5. 同人多活跃单存在时 → rebuildKG 后 conflicts ≥ 1。

前端 `apps/frontend/e2e/kg-rebuild.spec.ts`：路由 mock `/api/kg/rebuild` 返回固定 result → 访问 `/conflicts` → 点「全量重建 KG」按钮 → 断言重建结果文本（refEdges 等）出现。

### 34.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 暴露面 | 仅 POST `/api/kg/rebuild`，无 GET 状态 | 同步执行；返回结果即状态；MVP 不做后台任务 |
| 调用入口 | `/conflicts` 页二级按钮 | 重建低频；与冲突 scan 是同类「派生数据维护」语义 |
| 漂移检测 | 不在本增量做（YAGNI） | 只提供"修复手段"；漂移监控待真实运维需求出现再做 |
| 并发 | 同步执行，单进程 SQLite | 后端单实例；不做锁 |
| 触发条件 | 手动 | MVP；定时器/钩子→后续 |

### 34.6 验收

- [x] `RebuildKGResult` 契约 tsc-clean
- [x] 删掉所有 REF 边后 `POST /api/kg/rebuild` → 边数恢复到原值（与增量同步一致）
- [x] 二次 rebuild 数字幂等（同一图无新增/丢失）
- [x] 冲突边在 rebuild 后自动重建（与 `/api/conflicts/scan` 一致）
- [x] `/conflicts` 页「全量重建 KG」按钮可点击并显示结果
- [x] 既有 39 e2e + 新增 FE-KG1 共 40 e2e 全部绿（零回归）；`test:all` 连续两次全绿；待部署

---

## 35. 增量 18：Hermes 只读问答 MVP（兑现 §1.4 P0-④ / §10 Phase 3.1）

> 兑现 §1.4 P0-④「Hermes Agent 问答分析」与 §10 Phase 3.1。**无 LLM 凭据**前提下交付**规则版**意图分类引擎：解析常见中文问句，映射到现有只读 API（`queryNodes` / `related` / `progress`），返回中文答案 + 引用节点链接。日后接入 LLM 时只需替换意图解析层，对外契约 / UI 不变（§14.4 LLM 只提议、不直写 KG 不破坏：Hermes 一直是只读）。

### 35.1 契约（@combat/shared）

```ts
export interface HermesCitation {
  nodeId: string;
  nodeType: string;
  summary: string;       // 人类可读标题（标题 / 攻关单号 / name / key 等）
  link: string;          // 前端跳转 URL，如 /attack/<id> 或 /related/<nodeType>/<id>
}
export type HermesIntent =
  | "status"             // X 现在状态 / 进展
  | "owner"              // X 是谁负责
  | "ticket-by-pb"       // 问题单号 PB-xxx 下的攻关单
  | "person-workload"    // 谁负载最重 / 谁活跃单最多
  | "fallback-search";   // 兜底全文检索
export interface HermesAnswer {
  question: string;
  intent: HermesIntent;
  answer: string;        // 中文回答（multi-line allowed）
  citations: HermesCitation[];
}
```

### 35.2 后端 — `apps/backend/src/hermes.ts`

`answerQuestion(repo, registry, question): HermesAnswer`：

1. 规范化输入：`trim` + 去除前后中英文标点 + 不区分大小写。
2. **意图匹配（按优先级顺序，先匹配先返回）**：
   - **ticket-by-pb**：正则 `/(PB-?\d+)|问题单号.*?[：:\s]([A-Z0-9-]+)/i` 命中 → 在所有 attackTicket 里筛 `问题单号` 精确匹配；列出标题 + 当前处理人 + 状态。
   - **owner**：包含「谁负责」/「谁在做」/「谁的」/「owner」+ 一个引号或裸词 → 在 attackTicket.标题 模糊匹配；返回 `<标题>` 的当前处理人是 `<人>`，状态 `<状态>`。
   - **status**：包含「状态」/「进展」/「怎么样」/「现在」+ 标题片段 → 在 attackTicket.标题 模糊匹配，输出最近一条 progress（无则报"暂无进展"）。
   - **person-workload**：包含「负载最重」/「最忙」/「活跃单最多」 → group active attackTickets by 当前处理人，按数量降序输出 Top 5。
   - **fallback-search**：以上不命中 → 既有 `/api/query/search?q=` 取 top 5，列出 summary。
3. citations 至多 5 条，按相关度从高到低；link 规则：attackTicket → `/attack/<id>`；其他 → `/related/<nodeType>/<id>`；anchor 节点跳本身关联页。
4. 路由 `POST /api/hermes/ask`：body `{ question: string }`，返回 `HermesAnswer`；`question` 空 → 400 `{error:"question 必填"}`。

### 35.3 前端 — `apps/frontend/src/pages/HermesPage.tsx`

- 顶部 `Input.TextArea`（中文 placeholder 示例：「PB-12345 涉及哪些单？」「断网攻关谁在做？」「谁现在最忙？」），右侧「提问」按钮（primary）。
- 回答区：`Card` 显示 `HermesAnswer.intent` 中文标签 + `answer` 文本（保留换行）；下方 `List` 渲染 `citations`，每项可点击跳 `link`。
- 历史列表（本地内存，单次会话）：左侧 `List` 显示已问问题，点击回显答案。
- `AppShell` 加 nav「Hermes 问答」；`HomePage` 加 `home-card-hermes` 卡片。

### 35.4 测试

后端 `apps/backend/test/hermes.e2e.test.ts`，至少 5 个意图各 1 个测试：
1. PB 意图：建两个共问题单号 attackTicket → ask `PB-123 涉及哪些单？` → answer 含两个标题 + 2 个 citations
2. owner 意图：建 attackTicket(标题=断网攻关, 当前处理人=甲) → ask `断网攻关谁负责？` → answer 含「甲」
3. status 意图：建 ticket + 追加 progress → ask `断网攻关 现在状态` → answer 含 latest progress.content
4. person-workload：建 3 active tickets 同人 + 1 active 单他人 → ask `谁现在最忙？` → 第一名是「3 单的那个人」
5. fallback：ask 一个完全不相关的字 → 走 search

前端 `apps/frontend/e2e/hermes.spec.ts`：路由 mock `/api/hermes/ask` 返回固定 HermesAnswer（intent=owner，answer="..."，citations=2 个），访问 `/hermes`，TextArea 输入，点提问，断言 answer 文本 + 引用链接可见。

### 35.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| LLM 接入 | MVP 不接入；规则匹配 | 无凭据；§14.4 LLM 永远只提议、不直写——Hermes 改 LLM 实现时对外契约不变 |
| 意图集 | 5 类（status/owner/ticket-by-pb/person-workload/fallback-search） | 覆盖最常见 P0 问句；可逐步扩展 |
| 引用上限 | 5 条 | UI 简洁 |
| 状态机 | 单 turn 一问一答 | MVP；多轮上下文留后续 |
| 模糊匹配 | 子串包含（`includes`） | 简单稳；中文不分词；后续可换 |

### 35.6 验收

- [x] `HermesAnswer` / `HermesCitation` / `HermesIntent` 契约 tsc-clean
- [x] 5 类意图 e2e 全部通过
- [x] 空问题 → 400 中文错误
- [x] `/hermes` 页 TextArea+提问按钮+回答+引用链接可用
- [x] AppShell + HomePage 入口可达 `/hermes`
- [x] 既有 52 e2e + 新增 FE-HM1 + console-clean `/hermes` 覆盖 共 54 e2e 全部绿（零回归）；`test:all` 连续两次全绿；待部署

---

## 36. 增量 19：作战态势大盘升级（兑现 §10 Phase 3.6 一半 / §11 Phase 2 态势可视化）

> 现首页大盘只看见 ticket/contribution/proposal 三个静态计数，看不到"今日动了啥/谁在冲突上/最近改了谁"——这是作战指挥最需要的实时视图。本增量在 `GET /api/dashboard` 上**追加** 3 段（不破坏既有字段，向后兼容），首页态势区扩展可视化。

### 36.1 契约（@combat/shared）

`DashboardSummary` 现有结构不动，**追加**：
```ts
export interface DashboardSummary {
  tickets: { total: number; byStatus: Record<string, number>; open: number; resolved: number };
  contributions: { total: number; topContributors: { 贡献人: string; count: number }[] };
  proposalsPending: number;
  // §36 新增
  conflicts: { count: number; topReasons: string[] };       // count = 无向对总数；topReasons 最多 5 条
  today: { progressEntries: number; ticketsTouched: number };  // 当日 progress 累计
  recentActivity: { ticketId: string; 标题: string; 状态: string; lastChangedAt: string }[]; // 最近 5 个变动的攻关单
}
```

### 36.2 后端

`apps/backend/src/dashboard.ts` 扩展：

1. **conflicts**：调 `listConflictRows(repo)`（来自 §33）取 ConflictRow[]；`count = rows.length`；`topReasons = [...new Set(rows.map(r=>r.reason))].slice(0,5)`。
2. **today**：本地日期边界（取系统时区当日 00:00→24:00），遍历所有 attackTicket 的 progress，统计今日条数 + 涉及 ticket 数（去重）。可以 reuse `repo.listProgress` per ticket 或一次性 query；保持简单：循环 `queryNodes("attackTicket")` 调 `listProgress`。
3. **recentActivity**：取所有 attackTicket，按 `updatedAt` 降序，取 Top 5；输出 `{ticketId, 标题, 状态, lastChangedAt: node.updatedAt}`。

### 36.3 前端 — `apps/frontend/src/pages/HomePage.tsx`

dashboard 区扩展（保持既有 Row + Descriptions 不动）：
- 在状态分布/Top 贡献人 下方加 `Descriptions` 一行：
  - `冲突/重叠`：红色字 `${dash.conflicts.count} 对` + 若有则附 1 个示例 reason
  - `今日动态`：`${dash.today.progressEntries} 条进展 / ${dash.today.ticketsTouched} 个攻关单`
- 在 Descriptions 下方加 `recent-activity` 区（小卡片）：「最近活跃攻关单」+ List：每行 `Link 标题 + Tag 状态 + 时间`
- 给新区一个 `aria-label="dashboard-extras"` 容器供 e2e 锁定。

### 36.4 测试

后端 `apps/backend/test/dashboard-extras.e2e.test.ts` 至少 3 个测试：
1. 大盘新字段 shape：空 db → `{conflicts:{count:0,topReasons:[]}, today:{progressEntries:0,ticketsTouched:0}, recentActivity:[]}`
2. 同人 2 active → conflicts.count ≥ 1，topReasons 含「同负责人多并发」
3. 追加 2 条 progress → today.progressEntries === 2，ticketsTouched 正确；recentActivity 第一项是最新 update 的 ticket

前端 `apps/frontend/e2e/dashboard-extras.spec.ts` FE-D2：路由 mock dashboard 返回带新字段的 payload，访问 `/`，断言 `dashboard-extras` 容器、冲突计数、今日动态、recent-activity 列表渲染。

### 36.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 字段位置 | 追加到 DashboardSummary（不破坏既有） | 既有 FE-D1 / unit 不需要改；前端可渐进显示 |
| 今日边界 | 服务器本地时间 00:00–24:00 | MVP；UTC 偏移留后续 |
| recentActivity 来源 | attackTicket.updatedAt 排序 Top 5 | 包含状态变更、progress、edit 任何写入；与"作战态势"一致 |
| 冲突 reason 列表 | dedupe 去重前 5 | 避免同一 reason 重复刷屏 |

### 36.6 验收

- [x] DashboardSummary 三段新字段 tsc-clean；既有 FE-D1 调整为 first() 不破坏（recent-activity 出现多个 "进行中" Tag 是预期）
- [x] 空 db → 新字段 0/空数组
- [x] 同人 2 active → conflicts.count ≥ 1，reason 含「同负责人多并发」
- [x] 当日 progress 计入 today.progressEntries；recentActivity 按 updatedAt 倒序
- [x] 首页态势区可见冲突计数 + 今日动态 + 最近活跃列表
- [x] 既有 54 e2e + 新增 FE-D2 共 55 e2e 全部绿（零回归）；`test:all` 连续两次全绿（含 reset:schemas 防漂移）；待部署

---

## 37. 增量 20：Hermes 意图扩展 v2（兑现 §10 Phase 3.1 深化）

> §35 MVP 已覆盖 status/owner/ticket-by-pb/person-workload/fallback-search 5 类。本增量再补 3 类高频问句：贡献查询 / 近期变更 / 找帮手——后两类直接复用既有 `recentActivity` 计算与 `recommendHelpers()`，零新查询路径。

### 37.1 契约（@combat/shared）

`HermesIntent` 联合类型**追加**：
```ts
export type HermesIntent =
  | "status" | "owner" | "ticket-by-pb" | "person-workload" | "fallback-search"
  | "contribution-by-person"      // X 贡献了什么 / X 做了什么贡献
  | "recent-changes"              // 今天 / 本周 / 最近 谁动了什么
  | "find-helpers";               // PB-xxx 找谁帮忙 / X 找谁帮忙
```
`HermesAnswer` / `HermesCitation` 不变。

### 37.2 后端 `apps/backend/src/hermes.ts` 扩 answerQuestion

意图优先级（先匹配先返回，新意图插入到 fallback 之前）：

1. ticket-by-pb（已有）
2. **find-helpers**（新）：包含「找谁帮忙」/「找帮手」/「谁能帮」+ PB 号 或 标题片段：
   - 若有 PB 号：通过 anchor 节点反查到 attackTicket（任一），取该 ticket id 调 `recommendHelpers(repo, id, 5)`。
   - 否则按标题模糊匹配定位 attackTicket。
   - 没匹配到 ticket → 答「请先指明问题单号或攻关单标题」+ 0 引用。
   - 返回每个 helper：`「<name>（分数 N）：理由 1; 理由 2」`，引用项是 person 节点。
3. owner（已有）
4. status（已有）
5. **contribution-by-person**（新）：包含「贡献」+ 人名（最后一个非疑问词）：
   - `queryNodes("contribution")` 按 `贡献人 === name` 过滤，列出 Top 5：`贡献等级 · 贡献类型 · 贡献描述`
   - citations: contribution 节点 → `/related/contribution/<id>`
6. person-workload（已有）
7. **recent-changes**（新）：包含「今天」/「本周」/「最近」/「谁动」/「谁改」：
   - 窗口默认本日 00:00→ 现在；含「本周」改为周一→现在。
   - 取 attackTicket 按 updatedAt 过滤 + `listProgress` 落在窗口内的 entries 数总和。
   - 答：`<窗口名> 共 N 条进展、M 个攻关单变动；最近：<标题>(状态)、…`
   - citations: 变动 ticket Top 5
8. fallback-search（兜底）

### 37.3 前端

- `HermesPage` 占位符示例扩展：
  ```
  · PB-12345 涉及哪些单？
  · 断网攻关 谁负责？
  · 数据迁移攻关 现在状态
  · 张三 贡献了什么？
  · 最近谁动了什么？
  · PB-12345 找谁帮忙？
  ```
- `INTENT_LABEL` / `INTENT_COLOR` 加 3 个键。

### 37.4 测试

后端 `apps/backend/test/hermes-v2.e2e.test.ts` 至少 3 个：
1. contribution-by-person：建 1 person + 2 贡献 → ask 「张三 贡献了什么」 → answer 含两个贡献描述
2. recent-changes：建 2 ticket + 追加 1 progress → ask 「今天谁动了什么」 → answer 含 2 ticket、≥1 条进展
3. find-helpers：seed 共享问题单号 + 历史贡献 → ask 「PB-xxx 找谁帮忙」 → answer 含 helper name + 分数；空 PB+无匹配 → 提示

前端：现有 FE-HM1 + 路由 mock 已足够覆盖新颜色/标签；无新 e2e（intent 来自 mock）。

### 37.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 新意图触发字 | 中文关键词集 | 简单；后续接 LLM 时只改 classifier 内部 |
| 时间窗口 | 今天 = 本地 00:00→ 现在；本周 = 周一 00:00→ 现在 | 与既有 today.* 一致；MVP |
| find-helpers 入口 | 复用 `recommendHelpers()` | 零代码重复 |

### 37.6 验收

- [x] HermesIntent 联合类型扩 3 项；既有 5 类不破坏
- [x] contribution-by-person / recent-changes / find-helpers 各 1 个 e2e 通过（+1 find-helpers 无定位提示）
- [x] HermesPage 占位符扩展可见
- [x] 既有 55 e2e 零回归 + 后端新增 4 e2e（hermes-v2）；`test:all` 连续两次全绿；待部署

---

## 38. 增量 21：KG 图形视图 MVP（兑现 §8.3 Graph viz 一部分）

> §8.3 列出 D3.js / vis-network 作为图可视化选型，但都引入新 dep。**MVP 用纯 SVG 径向布局**，零新 dep；可视化 4 类派生边（REF / ANCHORED_TO / CONFLICTS_WITH / OVERLAPS_WITH），点击节点钻取。日后接入 D3/vis-network 时只需替换 viewer 组件，对外契约 `GraphSnapshot` 不变。

### 38.1 契约（@combat/shared）

```ts
export interface GraphSnapshotNode { id: string; nodeType: string; label: string; }
export interface GraphSnapshotEdge { source: string; target: string; edgeType: string; }
export interface GraphSnapshot { rootId: string; nodes: GraphSnapshotNode[]; edges: GraphSnapshotEdge[]; }
```

### 38.2 后端

`apps/backend/src/graph.ts`：
- `buildSnapshot(repo, rootId, maxDepth): GraphSnapshot`
  - BFS 起点 root，遍历出 + 入边类型 `{REF, ANCHORED_TO, CONFLICTS_WITH, OVERLAPS_WITH}`
  - 节点 dedup（按 id），边 dedup（按 source+target+edgeType）
  - label 复用 §35 `summarize()`
- 路由 `GET /api/graph/snapshot/:nodeType/:id?depth=N`：clamp depth ∈ [1,3]（默认 1）；node 不存在 → 404

### 38.3 前端

- `apps/frontend/src/pages/GraphPage.tsx`：
  - 调 `api.graphSnapshot(nodeType, id, depth)`；顶部深度 Select(1/2/3)
  - **径向布局**：root 在中心 (0,0)；其余节点按邻居均分圆周（半径 = 180px × depth）；如果有更多 ring（depth>1 时），按 BFS 层放在外圈
  - 边线段直接 SVG line，颜色按 edgeType：
    - REF: `#1677ff` 蓝
    - ANCHORED_TO: `#722ed1` 紫
    - CONFLICTS_WITH: `#cf1322` 红
    - OVERLAPS_WITH: `#fa8c16` 橙
  - 节点圆 + label；点击节点 → 跳 `/graph/<nodeType>/<id>`（重新中心）
  - 容器 `aria-label="graph-svg"` 供 e2e 锁定
- RelatedPage 顶部加「图形视图」链接到 `/graph/<nodeType>/<id>`
- AppShell **不**加菜单（图形是从 Related 钻取，不是顶级入口）

### 38.4 测试

后端 e2e (`graph.e2e.test.ts`) 至少 3 个：
1. 单节点：rootId + 0 邻居 → `{rootId, nodes:[1], edges:[]}`
2. REF + ANCHORED_TO 都纳入 + depth=2 BFS：建 attackTicket A ref→person + anchor 问题单号；asks depth=2 from A 应含 person、anchor、共享 anchor 的另一单
3. depth clamp：`depth=99` → 同 depth=3 输出；`depth=0` / 非数字 → 默认 1

前端 e2e (`graph.spec.ts`) FE-GR1：路由 mock GraphSnapshot 返回 root + 2 邻居 + 2 边 → 访问 `/graph/attackTicket/t1` → 断言 `graph-svg` 容器、3 个 SVG circle、2 条 line 可见

### 38.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 渲染库 | 纯 SVG | 零 dep；可视化只要"能看到关系"；炫酷动画 YAGNI |
| 布局算法 | 径向（root center + concentric rings） | 简单、确定性、可测；force-directed 留后续 |
| 边类型 | 4 类派生（REF/ANCHORED_TO/CONFLICTS_WITH/OVERLAPS_WITH） | 与 §32 / §33 derived 边一致；不含 CONTRIBUTED_TO（contribution 已有专用 view） |
| 深度上限 | clamp [1,3] | 防屏幕爆炸；MVP；可扩 |
| 入口 | RelatedPage 链接（不上顶级菜单） | 钻取式，不是首页门 |

### 38.6 验收

- [x] `GraphSnapshot` / `GraphSnapshotNode/Edge` 契约 tsc-clean
- [x] `GET /api/graph/snapshot/:nodeType/:id` depth=1/2/3 返回符合契约；depth=99 clamp；depth=0 默认 1
- [x] 节点 dedup + 边 dedup
- [x] `/graph/:nodeType/:id` SVG 渲染（节点圆 + 边线 + 4 类边色 + 点击钻取）
- [x] RelatedPage 入口可达 `/graph/...`
- [x] 既有 55 e2e 零回归 + 后端新增 3 e2e（graph）+ FE-GR1；`test:all` 连续两次全绿；待部署

---

## 39. 增量 22：审计日志查看器（兑现 §11 Phase 1「audit_log 留痕」可视化）

> `audit_log` 表早已记录所有写操作（CREATE/UPDATE/DELETE/MERGE/ESCALATE/SCHEMA），但**没有只读出口**，运维 / 复盘只能直查 SQLite。本增量加 `/api/audit` 只读 API + `/audit` 页（带过滤）+ AttackDetail 内嵌该单审计条目区。

### 39.1 契约（@combat/shared）

```ts
export interface AuditLogEntry {
  id: string;
  action: string;            // CREATE / UPDATE / DELETE / MERGE / ESCALATE / SCHEMA…
  entityType: string;        // node / edge / schema / progress / proposal / reminder
  entityId: string;          // 主体 id（schema 类型时是 nodeType）
  changes: unknown;          // 反序列化后的对象（任意结构）
  performedBy: string;
  performedAt: string;       // ISO
}
```

### 39.2 后端

`Repository` 接口增 `listAuditLog(filter: { action?, entityType?, entityId?, limit? }): AuditLogEntry[]`，SqliteRepository 用 prepared statement + WHERE 拼接 + `LIMIT`（clamp [1, 500]，默认 100），按 `performedAt DESC, id` 排序。`changes` 字段从 TEXT 反序列化为 unknown（`JSON.parse`，解析失败保留原字符串）。

路由 `apps/backend/src/audit.ts`：`GET /api/audit?action=...&entityType=...&entityId=...&limit=N` 返回 `AuditLogEntry[]`。

### 39.3 前端

- `apps/frontend/src/pages/AuditPage.tsx`：
  - 顶部过滤表单：`action`（select：全部/CREATE/UPDATE/DELETE/MERGE/SCHEMA/ESCALATE）+ `entityType` (string input) + `entityId` (string input) + 「查询」按钮 + 「重置」按钮
  - Table 列：时间 / 操作 / 实体类型 / 实体 ID（短显示 + 复制按钮）/ 操作人 / 变更（JSON pre 展开 / 折叠）
  - 默认进入页拉取最近 100 条
- `AttackDetail` 末尾追加 `aria-label="audit-section"` 区，调 `api.listAudit({ entityId: id, limit: 30 })`，按时间倒序 List 显示 `[时间] action by performer：changes(JSON 摘要)`
- AppShell nav 加「审计日志」入口；HomePage 加 `home-card-audit`

### 39.4 测试

后端 `apps/backend/test/audit.e2e.test.ts` 至少 3 个：
1. 建 node 触发 CREATE → GET /api/audit 含该条；按 entityId 过滤精确
2. 更新该 node 触发 UPDATE → 历史含 CREATE + UPDATE 两条；按 action=UPDATE 过滤只有 1 条
3. limit clamp：limit=999 ≤ 500；limit=0/NaN → default 100

前端 `apps/frontend/e2e/audit.spec.ts` FE-AU1：路由 mock 返回 3 条 audit；访问 `/audit`，断言 table 渲染 3 行；select action=UPDATE 触发新请求；reset 恢复。/audit 加入 console-clean.spec.ts PAGES。

### 39.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| API 形态 | 只读 GET，无写 | audit_log 不可篡改 |
| changes 表达 | 反序列化为对象，UI JSON pre 展开 | 已序列化字符串读起来差 |
| 过滤组合 | action + entityType + entityId（AND） | 覆盖最常用筛选 |
| 排序 | performedAt DESC | 最新在最上 |
| limit | clamp [1, 500] 默认 100 | 防 DOS；MVP 不分页 |
| 入口 | AppShell + 首页卡片 + AttackDetail 内嵌 | 运维入口 + 单据上下文 |

### 39.6 验收

- [x] `AuditLogEntry` 契约 tsc-clean
- [x] `GET /api/audit` 默认/过滤/limit clamp 行为正确（3 个 e2e）
- [x] AttackDetail 末尾该单审计条目区可见（attack/coverage 测试用 first() 适配避免与 Descriptions/Timeline 冲突）
- [x] `/audit` 页过滤表单 + table 可用
- [x] AppShell + HomePage 入口可达 `/audit`
- [x] 既有 56 e2e 零回归 + 后端 3 e2e + FE-AU1 + console-clean /audit 共 58 e2e；`test:all` 连续两次全绿；待部署

---

## 40. 增量 23：手动人员合并（兑现 §2.4 实体解析 manual 层）

> §0.3 / §2.4 实体解析按置信度降序：精确 ID → 别名 → 模糊(+人审) → **手动**。前三层已通过 ref 解析 + SAME_AS 提议审批覆盖；**手动合并**这一兜底层缺失——用户明知两个 person 是同一人时无法直接合并。后端 `mergePerson()` 已实现（并集字段、迁移边、删源、审计 MERGE），仅缺直接入口。本增量补 preview + commit API + `/merge` 页。

### 40.1 契约（@combat/shared）

```ts
export interface MergePreview {
  from: GraphNode;             // 将被合并（消失）的人
  to: GraphNode;               // 保留的规范人
  unionedFields: string[];     // from 上、to 缺失或空 → 将补到 to 的字段 id
  edgesToMigrate: number;      // 将从 from 迁移到 to 的边数（排除 from↔to 直连）
}
```

### 40.2 后端 `apps/backend/src/merge.ts` + 路由

- 新增 `previewMerge(repo, fromId, toId): MergePreview`：只读计算 unionedFields + edgesToMigrate，不写库。
- 路由 `apps/backend/src/merge-route.ts`：
  - `GET /api/merge/preview?fromId=&toId=`：两 id 必填且都为 `person` 节点，否则 400；返回 `MergePreview`
  - `POST /api/merge/person` body `{ fromId, toId }`：校验同上 → 调既有 `mergePerson(repo, fromId, toId, "ui")` → 返回合并后的规范 `to` 节点
  - `fromId === toId` → 400「不能与自身合并」

### 40.3 前端 `apps/frontend/src/pages/MergePage.tsx`

- 加载所有 person（`api.listNodes("person")`）
- 两个 AntD Select：「被合并（消失）」`from` + 「保留（规范）」`to`，选项 label = name(+employeeId)
- 「预览」按钮 → 调 preview，展示：将补字段列表 + 迁移边数 + from/to 名称
- 「确认合并」按钮（danger）外包 Popconfirm（中文不可逆警告「合并不可逆，from 将被删除并把所有关系迁移到 to，确认？」）→ 调 POST → 成功 message + 清空选择 + 刷新 person 列表
- `aria-label="merge-from" / "merge-to" / "merge-preview" / "merge-confirm"` 供 e2e

- AppShell nav 加「人员合并」；HomePage 加 `home-card-merge`

### 40.4 测试

后端 `apps/backend/test/merge.e2e.test.ts` 至少 3 个：
1. preview：建两 person（A 有 email，B 有 employeeId）+ A 当 attackTicket 当前处理人 → preview(fromId=A,toId=B) 显示 unionedFields 含 email，edgesToMigrate ≥ 1
2. commit：POST merge → A 节点消失（getNode 404/null）；B 拿到 A 的 email；A 的 REF 入边迁移到 B；audit 出现 MERGE
3. 校验：fromId===toId → 400；非 person 节点 → 400

前端 `apps/frontend/e2e/merge.spec.ts` FE-MG1：路由 mock person 列表 + preview + commit，选两人 → 预览显示字段 → 确认（Popconfirm）→ 成功提示。/merge 加入 console-clean。

### 40.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 复用 mergePerson | 是 | 已实现并经 SAME_AS 审批验证；本增量只补直接入口 |
| 不可逆确认 | Popconfirm 中文警告 | §2.4 合并不可逆；防误操作 |
| 字段并集策略 | to 缺失/空 → 取 from（既有逻辑） | 与 mergePerson 一致 |
| 仅限 person | 是 | §2.4 仅 person 自动/手动合并；task/attackTicket 不合并 |
| preview 只读 | 是 | 让用户先看清后果再 commit |

### 40.6 验收

- [x] `MergePreview` 契约 tsc-clean
- [x] `GET /api/merge/preview` 返回 unionedFields + edgesToMigrate；非 person / 自身 → 400
- [x] `POST /api/merge/person` 合并后 from 消失、to 获并集字段、边迁移、审计 MERGE
- [x] `/merge` 页两 Select + 预览 + Popconfirm 不可逆合并可用
- [x] AppShell + HomePage 入口可达 `/merge`
- [x] 既有 58 e2e 零回归 + 后端 3 e2e + FE-MG1 + console-clean /merge 共 60 e2e；`test:all` 连续两次全绿；待部署

---

## 41. 增量 24：攻关单状态流转（兑现"进度 append-only、状态变更可追溯"核心原则）

> 当前改 `状态` 只能在 EntityTable inline 编辑，**不会留下流转痕迹**——违背 §2.3「ProgressLog 带状态快照、可追溯」。本增量加一个原子流转端点：更新 `状态` 的同时自动追加一条 ProgressLog（状态快照 = 目标状态，内容含「X→Y」+ 备注），并在 AttackDetail 提供流转 UI。

### 41.1 契约（@combat/shared）

```ts
export const ATTACK_STATUSES = ["待响应", "处理中", "进行中", "已解决", "已关闭"] as const;
export type AttackStatus = typeof ATTACK_STATUSES[number];
export interface TransitionResult { node: GraphNode; progress: ProgressLog; }
```

### 41.2 后端 路由（`apps/backend/src/routes.ts` 内新增）

`POST /api/nodes/:id/transition` body `{ toStatus: string; note?: string }`：
- 节点不存在 → 404；非 `attackTicket` → 400「仅攻关单支持状态流转」
- `toStatus` 不在该 nodeType `状态` 字段 enumValues → 400「非法目标状态」（从 registry 取，尊重配置驱动；不硬编码）
- 读当前 `状态` 作为 `fromStatus`
- `repo.updateNode(id, { 状态: toStatus }, "api")`（复用既有校验 + 审计 UPDATE）
- `repo.appendProgress(id, "状态变更：<from>→<to>" + (note? "；" + note : ""), toStatus, "api")`
- 返回 `{ node, progress }`
- 单进程同步 better-sqlite3 → update + append 之间无交错（与 §40 merge 一致的原子性假设）

### 41.3 前端 `AttackDetail`

- 在「进展序列」上方加流转区 `aria-label="transition"`：
  - 状态 `Select`（aria-label="transition-status"，选项来自 `ATTACK_STATUSES`）
  - 备注 `Input`（aria-label="transition-note"，可选）
  - 「流转」按钮 → `api.transition(id, toStatus, note)` → 成功 message + refresh（节点 + 进展时间线一并更新）
- 复用现有 `refresh()`

### 41.4 测试

后端 `apps/backend/test/transition.e2e.test.ts` 至少 3 个：
1. 正常流转：建 `进行中` 单 → transition→`已解决` → 节点状态变 `已解决`；progress 末条 statusSnapshot=`已解决`、content 含「进行中→已解决」
2. 带备注：note 出现在 progress.content
3. 校验：非法状态 → 400；非 attackTicket（person）→ 400

前端：复用 attack.spec.ts 流程 or 新增最小断言；§41 不强制新增 FE spec（流转是 updateNode+appendProgress 组合，已有 FE-1..4 覆盖追加进展）。新增 1 个 FE-TR1 验证流转按钮触发请求 + 时间线出现新状态。

### 41.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 原子流转 vs 两次调用 | 后端单端点 | update+progress 原子、单次审计语义清晰 |
| 目标状态校验 | 从 registry enumValues 动态取 | 配置驱动；不硬编码（§0.4） |
| 进展内容格式 | `状态变更：X→Y；备注` | 人类可读、可追溯 |
| 适用实体 | 仅 attackTicket | 任务/单据状态机；person 无状态 |

### 41.6 验收

- [x] `ATTACK_STATUSES` / `TransitionResult` 契约 tsc-clean
- [x] `POST /api/nodes/:id/transition` 更新状态 + 原子追加 progress（快照=目标态，含 X→Y）
- [x] note 写入 progress.content
- [x] 非法状态 / 非 attackTicket → 400
- [x] AttackDetail 流转 UI（Select + 备注 + 流转）可用，时间线即时更新
- [x] 既有 60 e2e 零回归 + 后端 3 e2e + FE-TR1 共 61 e2e；`test:all` 连续两次全绿；待部署

---

## 42. 增量 25：导入 dry-run 预览 + 跳过行可见（修复静默丢行）

> 现 `/import` 立即写库且 `if (!v.ok) continue` **静默丢弃校验失败行**——用户不知道哪些数据没进来，是数据丢失隐患。本增量：①加 `?dryRun=1` 只读预览（逐行 create/update/skip + 原因，不写库）；②提交路径也返回 `skipped` 计数 + 跳过原因；③前端「预览(不写入)」按钮 + 结果表。**举一反三**：把"静默丢行"整类问题（导入任何 nodeType）一次解决。

### 42.1 契约（@combat/shared）

```ts
export interface ImportRowResult {
  rowIndex: number;                       // 0-based 数据行序号
  action: "create" | "update" | "skip";
  reason?: string;                        // skip 时为校验错误（"; " 连接）
  summary: string;                        // 该行人类可读标识（标题/单号/name 等）
}
export interface ImportPreview {
  nodeType: string;
  willCreate: number;
  willUpdate: number;
  skipped: number;
  rows: ImportRowResult[];
}
```
`/import` 提交响应在既有 `{created, updated}` 上**追加** `skipped: number` 与 `skippedRows: ImportRowResult[]`（仅含 skip 行，向后兼容：既有字段不变）。

### 42.2 后端

抽出纯函数 `analyzeImport(repo, registry, nodeType, rows): ImportPreview`（只读：mapColumns + validateNode + findByIdentity 判定 create/update/skip，**不写库**）。
- `GET/POST /import?dryRun=1`：解析上传文件 → `analyzeImport` → 返回 `ImportPreview`（HTTP 200，不写库）。
- 提交路径（无 dryRun）：先 `analyzeImport` 得到计划，再对 create/update 行执行实际写入（含 syncRef/syncAnchor/ASSIGNED_TO，与现状一致），返回 `{ created, updated, skipped, skippedRows }`。
- skip 原因 = `registry.validateNode` 的 `errors.join("; ")`。

### 42.3 前端 `ImportPage`

- 现有上传组件旁加「预览(不写入)」按钮：走 `?dryRun=1`，渲染 `aria-label="import-preview"` 表格：列 `行号 / 动作 / 原因 / 摘要`（动作用中文 Tag：新增/更新/跳过；跳过红色）。
- 实际导入完成后，若 `skipped>0`，message.warning 提示「N 行被跳过」并展示 skippedRows 表。
- 保持既有「导入完成」「新增/已更新」提示不破坏（FE-5 / FE-IU1）。

### 42.4 测试

后端 `apps/backend/test/import-dryrun.e2e.test.ts` 至少 3 个：
1. dryRun：含 1 有效新行 + 1 缺必填行的 xlsx → preview.willCreate=1, skipped=1, skip 行 reason 含字段名；**库内无新增节点**（queryNodes 仍空）
2. dryRun update：先建一条 identity 命中的，再 dryRun 同 identity → willUpdate=1
3. 提交返回 skipped + skippedRows：实际 POST（无 dryRun）→ `{created,updated,skipped,skippedRows}`，created 行确实入库

前端 `apps/frontend/e2e/import-dryrun.spec.ts` FE-IM2：route-mock `/import?dryRun=1` 返回固定 preview，点「预览(不写入)」→ 断言预览表渲染含 新增/跳过 行。/import 已在 console-clean。

### 42.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| dryRun 触发 | query `?dryRun=1` | 复用同一上传端点，少一个路由 |
| analyze 纯函数 | 抽离只读判定 | dryRun 与 commit 共用，杜绝逻辑分叉 |
| 静默丢行修复 | 返回 skipped + 原因 | 数据可见性；举一反三覆盖所有 nodeType |
| 向后兼容 | 既有 created/updated 不动，追加字段 | 不破坏 FE-5/FE-IU1 |

### 42.6 验收

- [x] `ImportPreview` / `ImportRowResult` 契约 tsc-clean
- [x] `?dryRun=1` 返回逐行计划且**不写库**
- [x] 校验失败行计入 skipped 且带字段级原因
- [x] 提交响应追加 `skipped` + `skippedRows`，既有 `created/updated` 不变（既有 upsert 测试改 toMatchObject）
- [x] ImportPage「预览(不写入)」表格 + 导入后跳过提示可用（独立预览 Upload，保留立即导入 Upload 不破坏 FE-5/FE-IU1）
- [x] 既有 61 e2e 零回归 + 后端 3 e2e + FE-IM2 共 62 e2e；`test:all` 连续两次全绿；待部署

---

## 43. 增量 26：全 API 命令行（Linux shell，agent 可自查自调）— 核心原则

> **标准核心原则**（用户指令）：每个后台 API 必须有对应命令行命令，供 agent（如 Hermes）操作。CLI 是 **Linux shell 命令**（服务部署在 Linux）。CLI 提供 `help` 命令，列出所有命令的格式/用法/功能，让 agent 自查命令目录后自调用。**后续新增任何后台 API 必须在同一增量同步实现 CLI 命令**（纳入后端 definition-of-done）。

### 43.1 设计

- `apps/backend/src/cli-core.ts`（纯逻辑、可测）：
  - `COMMANDS: CliCommand[]` 声明式注册表，每条 `{ name, summary, usage, build(pos, opts) → { method, path, body? } }`
  - `parseArgs(argv) → { positional, opts }`：`--key value` / `--flag` / 位置参数
  - `renderHelp(cmd?) → object`：无参返回全部命令的 `{name,summary,usage}` JSON 数组；带 `cmd` 返回该命令详情
  - `runCli(argv, http) → Promise<result>`：解析 → 查命令 → `build` → `http(method, path, body)` → 返回；`help` 走 renderHelp（不发 HTTP）；未知命令报错列出可用命令
  - `http` 注入（测试用 fake，生产用 fetch）——纯函数核心，零网络耦合，可单测
- `apps/backend/src/cli.ts`（薄入口）：读 `COMBAT_API`（默认 `http://localhost:3001`）；`runCli(process.argv.slice(2), fetchHttp)`；打印 JSON；错误 → stderr + exit 1
- Linux 可执行：`npm run cli -- <command> ...`（package.json script `"cli": "tsx src/cli.ts"`）；部署服务器上 `cd app/apps/backend && npm run cli -- help` 即用

### 43.2 命令覆盖（与 §所有路由 1:1）

读：`dashboard` `nodes:list` `nodes:get` `progress:list` `schema:get` `related` `graph` `conflicts:list` `audit:list` `merge:preview` `daily-report` `honor:leaderboard` `honor:person` `proposals:list` `reminders:list` `recommend:helpers` `search` `context`
写：`nodes:create` `nodes:update` `nodes:delete` `nodes:transition` `progress:add` `schema:patch` `schema:scan` `conflicts:scan` `kg:rebuild` `hermes:ask` `merge:person` `proposals:scan` `proposals:decide` `reminders:scan` `reminders:send` `reminders:ignore`
元：`help [command]`
（`import`/`export` 涉及文件上传/二进制下载，CLI MVP 暂以提示说明走 HTTP，后续补 `--file` 流式；记录在 §43.5）

### 43.3 测试

`apps/backend/test/cli.e2e.test.ts`（注入 fake http，纯逻辑）≥ 6：
1. `help` 返回所有命令，每条含 name/summary/usage；命令数 = 注册表长度
2. `help hermes:ask` 返回该命令详情（usage 含 `<question>`）
3. `nodes:create attackTicket --data '{"标题":"x","状态":"进行中"}'` → build 出 `POST /api/nodes/attackTicket` body 正确
4. `hermes:ask "谁最忙"` → `POST /api/hermes/ask` body `{question:"谁最忙"}`
5. `related attackTicket t1 --depth 2 --candidates` → `GET /api/related/attackTicket/t1?depth=2&includeCandidates=1`
6. 未知命令 → 抛错且消息含可用命令提示
另：1 个真链路 e2e——`runCli` 接 supertest app 包成的 http，`nodes:create` 后 `nodes:get` 能读回（验证 CLI↔真实后端闭环）。

### 43.4 验收

- [x] `cli-core` 纯函数：parseArgs / renderHelp / runCli tsc-clean
- [x] `help` 列出全部命令（name/summary/usage）；`help <cmd>` 详情
- [x] 读/写命令各覆盖、build 出正确 method/path/body（8 单测）
- [x] CLI↔真实后端闭环 e2e（create→get 读回）
- [x] `npm run cli -- help` 本地已验证；Linux 部署机待部署后验证
- [x] 既有 62 e2e 零回归；后端新增 cli 测试（backend 151）；`test:all` 连续两次全绿；待部署
- [x] CLI 原则写入 CLAUDE.md（后续 API 同步加命令）

### 43.5 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| CLI 形态 | HTTP 客户端（非直连 repo） | 对任意运行中后端（含部署机）通用；与 UI 同源数据 |
| help 输出 | JSON 目录（默认）| agent 友好、可解析；人读也清晰 |
| http 注入 | 是 | 纯函数核心可单测，零网络耦合 |
| import/export | 暂缓（文件/二进制）→ §44 补全 | 多部分上传 CLI 较繁；记录后续 `--file`（增量 27 已补） |
| 入口 | `npm run cli --` + tsx | 与现有 tsx 运行链一致，Linux 直跑 |

---

## 44. 增量 27：CLI import/export 补全（兑现"每个 API 都有 CLI"原则）

> §43 CLI 暂缓了文件/二进制端点。CLI 核心原则要求**每个后台 API 都有命令**——本增量补 `import`（多部分上传 + dryRun 预览）与 `export`（二进制落盘），关闭 §43 自己留的缺口（举一反三）。

### 44.1 cli-core 扩展

`HttpRequest` 追加可选字段（向后兼容，既有命令不受影响）：
```ts
export interface HttpRequest {
  method: string; path: string; body?: unknown;
  uploadFile?: string;   // 本地文件路径 → multipart field "file"
  saveTo?: string;       // 二进制响应写入此本地路径
}
```
新增命令：
- `import <nodeType> --file <path> [--dryRun]` → `{ method:"POST", path:"/api/import?type=<nodeType>[&dryRun=1]", uploadFile:<path> }`；缺 `--file` 报错
- `export <nodeType> --out <path>` → `{ method:"GET", path:"/api/export/<nodeType>", saveTo:<path> }`；缺 `--out` 报错
两命令进 `COMMANDS`，`help` 自动收录。

### 44.2 cli.ts 真实 http 扩展

- `uploadFile`：`readFileSync` → `Blob` → `FormData.append("file", blob, filename)` → fetch POST（不手设 content-type，让 fetch 带 boundary）
- `saveTo`：fetch → `arrayBuffer()` → `writeFileSync(saveTo, Buffer)`；返回 `{ saved: <path>, bytes: N }`
- 其余（JSON）路径不变

### 44.3 测试

`cli.e2e.test.ts` 追加：
1. `import attackTicket --file /x.xlsx --dryRun` → build `POST /api/import?type=attackTicket&dryRun=1` + uploadFile 设对
2. `export releasePackage --out /tmp/r.xlsx` → build `GET /api/export/releasePackage` + saveTo 设对
3. `import` 缺 `--file` → 抛错；`export` 缺 `--out` → 抛错
4. CLI→真实后端闭环：构造 xlsx buffer，注入的 http 适配 uploadFile→supertest `.attach`，`import` 后 `nodes:list` 能读回导入的节点

### 44.4 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 上传 | FormData blob，fetch 自带 boundary | 标准、跨 Linux node 18+ |
| 下载 | arrayBuffer 落盘，返回 {saved,bytes} | agent 可知落点；不污染 stdout 二进制 |
| 契约扩展 | HttpRequest 加可选字段 | 向后兼容，既有命令零改 |

### 44.5 验收

- [x] `HttpRequest.uploadFile/saveTo` tsc-clean；既有命令不受影响
- [x] `import`/`export` 命令进注册表，`help` 收录
- [x] build 正确（dryRun query、type、uploadFile/saveTo）；缺参报错
- [x] CLI→真实后端 import 闭环 e2e（导入后能读回）；本地实测 export 落盘 28727 bytes、import created:1
- [x] 既有 62 e2e 零回归；后端 cli 测试增补（12，backend 155）；`test:all` 连续两次全绿；待部署

---

## 45. 增量 28：Email 通知能力（兑现 §13#2 通知通道之 Email 子集）

> 用户需求：把 app 内信息通过 **Email** 发给相关人员。可配置 SMTP 服务器地址/用户名/密码/发件人；发送时可查询用户 email（person 已有 `email` 字段）；可增删改查**邮件群组**。welinkcli 仍待凭据，本增量只做 Email。**遵循 CLI 核心原则**：邮件相关 API 同步实现 CLI 命令。

### 45.1 契约（@combat/shared）

```ts
export interface SmtpConfig {
  host: string; port: number; secure: boolean;     // secure=true → 465/SSL
  username: string; password: string;
  fromEmail: string; fromName?: string;
}
export type SmtpConfigMasked = Omit<SmtpConfig, "password"> & { passwordSet: boolean };
export interface EmailSendRequest {
  to?: string[];            // 原始邮箱
  groupNames?: string[];    // 邮件群组名 → 展开成员
  personNames?: string[];   // 人员姓名/工号 → 查 person.email
  subject: string; body: string;
}
export interface EmailSendResult {
  recipients: string[];     // 去重后的最终收件人
  ok: boolean; messageId?: string; error?: string;
}
```

### 45.2 数据/存储

- 新建通用键值表 `app_settings(key TEXT PRIMARY KEY, value TEXT)`；`Repository.getSetting(key)/setSetting(key,value,actor)`（setSetting 审计 `SETTING`）。SMTP 配置存 key `"smtp"`（JSON）。
- 新建配置 `config/schemas/emailGroup.json`：`组名`(required, identity) + `成员邮箱`(string, 逗号分隔) + `描述`。邮件群组即 nodeType，复用泛型 CRUD/CLI/EntityTable（**零后端代码新增**，配置驱动证伪）。
- person 已有 `email` 字段（无需改）。

### 45.3 后端

- 依赖：`nodemailer`（+ `@types/nodemailer`）。
- `apps/backend/src/mailer.ts`：`interface MailSender { send(cfg, msg): Promise<{messageId}> }`；`NodemailerSender` 实 nodemailer createTransport；`createApp` 增可选 `mailSender` 注入（测试用 fake，生产用 nodemailer）。
- `apps/backend/src/email.ts` 路由：
  - `GET /api/email/config` → `SmtpConfigMasked`（不回传 password，回 `passwordSet`）
  - `PUT /api/email/config` → 存 SMTP；body 含 password 才更新密码，空/缺则保留旧密码
  - `POST /api/email/test` body `{ to }` → 用当前配置发一封测试邮件，返回 EmailSendResult
  - `POST /api/email/send` body `EmailSendRequest` → 解析收件人（to + groupNames 展开 + personNames 查 email）去重 → 发送；无配置 → 400「未配置 SMTP」；无收件人 → 400
- recipient 解析：group 名→查 emailGroup 节点 `成员邮箱` 拆逗号；person 名/工号→查 person `email`；全部 trim + 去空 + 去重 + 简单 email 正则过滤。

### 45.4 CLI（核心原则）

`email:config-get`、`email:config-set --data '<json>'`、`email:test --to <邮箱>`、`email:send --to a,b --groups g1,g2 --persons 张三 --subject S --body B`（逗号分隔转数组）。邮件群组用既有 `nodes:*`（nodeType=emailGroup）。

### 45.5 前端

- 新页 `/email`（`EmailPage.tsx`）：
  - **SMTP 配置**卡：host/port/secure(Switch)/username/password/fromEmail/fromName + 保存；password 占位「已设置则留空保持不变」；「发送测试」按钮（输入 to）
  - **撰写发送**卡：收件人 = 多选（来源：person 列表中有 email 的 + emailGroup 列表）+ 自由输入邮箱；subject + body（TextArea）+ 发送；结果显示最终收件人 + 成功/失败
- 邮件群组管理：复用 `EntityTable nodeType="emailGroup"`，路由 `/emailgroups`
- AppShell nav 加「邮件」「邮件群组」；HomePage 加 `home-card-email`

### 45.6 测试

后端 `email.e2e.test.ts`（注入 fake MailSender，记录发送）≥ 5：
1. config PUT→GET 掩码：GET 不含 password，含 passwordSet=true；PUT 不带 password 时保留旧密码（再 test 仍能发）
2. send 解析 to + group 展开 + person email：建 emailGroup(成员邮箱="a@x.com,b@x.com") + person(email="c@x.com")，send {groupNames:["G"],personNames:["张三"],to:["d@x.com"]} → recipients 去重含 4 个；fake sender 收到
3. 未配置 SMTP → /send 400
4. 无有效收件人 → 400
5. emailGroup CRUD 走泛型 nodes API（建/查）
CLI：`email:send` build 出 POST /api/email/send body 数组正确；`email:config-set` build PUT。

前端 `email.spec.ts` FE-EM1（route-mock）：填 SMTP 配置保存→提示成功；撰写选收件人+主题+正文→发送→显示最终收件人。/email、/emailgroups 加入 console-clean。

### 45.7 决策表

| 决策 | 选择 | 理由 |
|---|---|---|
| 邮件库 | nodemailer | Node SMTP 事实标准；Linux 部署 OK |
| 配置存储 | 通用 app_settings 键值表 | 不为单功能建专表；后续其它设置复用 |
| 密码处理 | 服务端明文存、GET 掩码、PUT 空则保留 | 内部运维工具；用户明确要存密码 |
| 邮件群组 | 配置驱动 nodeType | 复用 CRUD/CLI/UI，零后端码 |
| 发送可测性 | MailSender 注入 | 无真实 SMTP 也能确定性 e2e |
| 收件人解析 | to + groups + persons 合并去重 | 满足"查询用户 email + 群组" |

### 45.8 验收

- [x] 契约 tsc-clean；`app_settings` 表 + getSetting/setSetting
- [x] SMTP 配置 PUT/GET（掩码、空密码保留）
- [x] `/api/email/send` 解析 to+group+person 去重并经 MailSender 发送；未配置/无收件人 → 400
- [x] emailGroup 配置驱动 CRUD 可用（零后端码，复用泛型）
- [x] CLI：email:config-get/set、email:test、email:send 可用且 build 正确
- [x] 前端 /email 配置+撰写发送、/emailgroups CRUD 可用
- [x] 既有 62 e2e 零回归 + 后端 email(8)/cli(+3) e2e + FE-EM1 + console-clean(/email,/emailgroups) 共 65 e2e；`test:all` 两次全绿（backend 166）；待部署








---

## 46. 增量 29：req.md 作战表 + 经验总结 view（兑现 §0.2 一模型多 view / §3.2 内置 view）

> 此前只建了 attackTicket 等少数 nodeType；req.md 的 7 张作战表 + 经验总结尚未纳入。本增量把它们建为**配置驱动 nodeType**（零后端新代码）——泛型 CRUD/导入/导出/CLI/Hermes 检索/关联(coAnchored)自动覆盖。通过 ref→person(concept 负责人) 与 anchor(问题单号/事件单号/domain/客户) 让新表**自动参与跨 view 关联**，真正落地"一模型多 view"。

### 46.1 新增 nodeType（config/schemas/*.json，全部配置驱动）

| nodeType | label | 关键字段（ref/anchor 标注） |
|---|---|---|
| incidentTracking | 现网问题跟踪 | 问题说明(req) · 影响客户[anchor 客户] · 风险等级(enum) · 状态(enum) · 运维责任人/研发责任人[ref person,concept 负责人] · 关联需求问题单[anchor 问题单号] |
| changeIssue | 变更相关问题 | 问题说明(req) · 严重程度 · 状态(enum) · 研发责任人[ref person] · 关联需求问题单[anchor 问题单号] |
| alarmGovernance | 告警治理跟踪 | 告警问题(req) · 问题和措施 · 状态(enum) · 责任人[ref person] · 问题单需求单号[anchor 问题单号] |
| p3Incident | 未闭环P3事件单 | 事件单号(req,identity)[anchor 事件单号] · 事件标题 · 事件处理人[ref person] · 客户级别 |
| dailyTask | 日常事项跟踪 | 事项描述(req) · 涉及客户[anchor 客户] · 优先级(enum) · 状态(enum) · 责任人[ref person] |
| issue400 | 现网400问题梳理 | 客户(req)[anchor 客户] · domainId[anchor domain] · MaaS报错信息 · model · 说明 |
| issue5xx | 现网5xx问题梳理 | domainId(req)[anchor domain] · MaaS报错信息 · 错误码 · model · 下一步 |
| experience | 经验总结 | 经验(req) · 责任人[ref person] · 计划完成时间 · 链接 · 内容（作为 Hermes 文档检索的 Document） |

状态 enum 复用 `待响应/处理中/进行中/已解决/已关闭`；优先级/风险等级 enum `高/中/低`。

### 46.2 后端

**零新代码**——仅新增 8 份配置。验证：
- 配置全部可被 FileSchemaRegistry 加载（registry coverage 测试）。
- 跨 view 关联：incidentTracking 与 attackTicket 共享 `问题单号` anchor → `/api/related` coAnchored 互见。
- ref→person：现网问题的 运维责任人 写入即建 person + REF 边（concept 负责人），与 attackTicket 当前处理人 在 related 同 concept 归并。
- Hermes 全文检索自动覆盖新 nodeType（fallback-search 命中 experience/incidentTracking）。
- 泛型导入/导出/CLI `nodes:*` 自动支持新 nodeType。

### 46.3 前端

- App.tsx 注册 8 路由：`/incidents /changes /alarms /p3 /daily /issue400 /issue5xx /experience` → `<EntityTable nodeType=...>`。
- AppShell 增二级子菜单「作战表」收纳新 8 项（保持既有顶层 首页/贡献录入/导入/关系审批 等扁平项不动，导航回归测试不破）。
- HomePage 增 8 张卡片。
- console-clean PAGES 追加 8 路由。

### 46.4 验收

- [x] 8 份配置加载通过；registry coverage 测试列出全部 nodeType
- [x] 现网问题 ↔ 攻关单 共享问题单号 → coAnchored 互见（跨 view 关联 e2e）
- [x] ref 责任人写入建 person + REF（concept 负责人）
- [x] Hermes 全文检索命中新 nodeType（experience）
- [x] 前端 8 路由 EntityTable 渲染 + 子菜单/首页卡片可达 + console-clean 全绿
- [x] 既有 65 e2e 零回归；后端 views(4) + 前端 FE-VW1 + console-clean(8) 共 74 e2e；`test:all` 两次全绿（backend 170）；待部署

---

## 47. 增量 30：多形态视图切换（表格 ↔ 卡片）（兑现 §3.3/§11 Phase2 视图切换）

> §11 Phase2「同一数据可在表格/布局/图/时间线间切换且一致」此前只有表格 + 独立图页 + 详情时间线，缺**统一切换器与卡片/布局形态**。本增量给 `EntityTable` 加 `表格 ↔ 卡片` Segmented 切换，同一数据两形态一致；图谱保留 RelatedPage 的「📊 图形视图」入口，时间线保留 AttackDetail，形成完整四形态闭环。

### 47.1 前端
- `EntityTable` 顶部加 AntD `Segmented`（aria-label="view-mode"，选项 表格/卡片）。
- 卡片形态：`Row/Col` 栅格，每节点一张 `Card`，标题取该 nodeType 第一个 required string 字段（或 标题/name/组名等回退），正文列出前若干非空字段 `label: value`；ref 字段保持可跳关联页；提供「编辑」「删除」按钮复用既有逻辑（或卡片只读 + 跳详情，MVP 卡片只读 + 删除）。
- 切换不重新请求，纯前端渲染同一 `rows`，保证数据一致。
- 默认表格；切到卡片再切回表格数据不变。

### 47.2 测试
- 单测：渲染 mode=card 时出现卡片容器。
- e2e `view-mode.spec.ts` FE-VM1：/attack 切到卡片→断言卡片(aria-label="entity-card")出现且含某行标题；切回表格→表头出现。
- console-clean 不新增路由（同页切换）。

### 47.3 验收
- [x] EntityTable 表格↔卡片 Segmented 切换，数据一致
- [x] 卡片展示标题+关键字段，ref 可跳转
- [x] FE-VM1 e2e；既有 e2e 零回归；test:all 两次绿；待部署

---

## 48. 增量 31：SLA 上升 + 责任矩阵 + Oncall（兑现 §2.7/§5.1/§5.2 自动化）

> §5 自动化规则引擎（责任矩阵 / Oncall 排班 / SLA 超时自动上升）此前未实现。复用既有 settings(app_settings) + reminders/notification 基础设施做 MVP，不引新表。

### 48.1 责任矩阵 / SLA 配置（app_settings key "escalation"）
```ts
export interface EscalationRule { 事件级别: string; slaHours: number; 上升角色: string; }
export interface EscalationConfig { rules: EscalationRule[]; }
```
- 默认种子：P4A→4h、P3→24h、P2→8h、P1→2h（可配）。
- API：`GET /api/escalation/config`、`PUT /api/escalation/config`；CLI：`escalation:config-get/set`。

### 48.2 SLA 扫描上升（POST /api/escalation/scan）
- 遍历活跃 attackTicket（状态 ∈ 待响应/处理中/进行中）；按 `事件级别` 查 SLA 小时数；若 `now - createdAt > slaHours` 且尚未上升 → 写 `ESCALATED_TO` 边（目标=当前处理人或上升角色占位）+ 生成一条 `Reminder`(kind 复用或新增「SLA上升」) + 审计 `ESCALATE`。
- 幂等：已有 ESCALATED_TO 边的单不重复上升（或按 level 递增，MVP 单级）。
- 返回 `{ escalated: number }`。
- CLI：`escalation:scan`。

### 48.3 Oncall 排班（MVP 最小）
- emailGroup 已证伪"配置驱动 nodeType"。Oncall 同法：新增 `config/schemas/oncall.json`（nodeType oncall：domain、值班人[ref person]、起、止）。仅登记 + 泛型 CRUD/CLI，自动化轮换留后续（记录在案）。

### 48.4 前端
- `/escalation` 页：SLA 配置表（事件级别/slaHours/上升角色 增删）+「扫描上升」按钮 + 已上升列表；AppShell nav + 首页卡片。
- Oncall 走 `/oncall` EntityTable（复用泛型）。

### 48.5 测试
- 后端 e2e：配置 PUT/GET；建超期 P4A 单(createdAt 回拨)→scan→escalated≥1 + ESCALATED_TO 边 + 审计 ESCALATE；未超期不升；二次 scan 幂等。CLI build。
- 前端 e2e FE-ES1：/escalation 配置+扫描+列表（route-mock）。console-clean 加 /escalation /oncall。

### 48.6 验收
- [x] EscalationConfig GET/PUT + 默认种子
- [x] scan 对超期活跃单上升（ESCALATED_TO + 审计 ESCALATE），未超期不升，幂等
- [x] oncall 配置驱动 CRUD
- [x] CLI escalation:config-get/set/scan
- [x] 前端 /escalation 配置+扫描+列表、/oncall 表
- [x] 既有 e2e 零回归；test:all 两次绿；待部署

---

## 49. 增量 32：attackTicket 字段补全（覆盖 req.md 攻关单详情全字段）

> §11 Phase1「字段覆盖 req.md 实际字段」此前部分覆盖。req.md 真实攻关单详情含约 20+ 字段，现 seed 缺：事件单号、影响及现存风险、局点、根因服务、当前处理部门、攻关发起说明、攻关响应时长、攻关时长、挂起开始时间、总挂起时长、解除挂起时间、结束攻关时间、日报发布数量、攻关成员。配置驱动——仅改 `config/schemas/attackTicket.json`，零代码。

### 49.1 新增字段（attackTicket.json，全部非 required，保持既有创建/导入兼容）
- `事件单号`[anchor 事件单号]、`影响及现存风险`、`局点`、`根因服务`、`当前处理部门`、`攻关发起说明`、`攻关响应时长`、`攻关时长`、`挂起开始时间`(datetime)、`总挂起时长`、`解除挂起时间`(datetime)、`结束攻关时间`(datetime)、`日报发布数量`(number)、`攻关成员`。
- `事件单号` 加 anchor「事件单号」→ 与 p3Incident 跨 view 关联。

### 49.2 验收
- [x] attackTicket schema 含上述新字段；既有创建/导入/e2e 不破坏
- [x] 事件单号 anchor → 与 p3Incident 共享事件单号 coAnchored 互见
- [x] test:all 两次绿；待部署

> 注：welinkcli（§13#3 抓群自动日报/找人）、eSpace 通道（§13#2）、RBAC 权限模型（§13#4 贡献等级仅 Leader）三项需外部凭据/身份认证方案，**待用户提供后实现**，非本轮可补。

---

## 50. 增量 33：轻量角色门禁 RBAC MVP（兑现 §13#4 贡献等级仅 Leader 可标定）

> §13#4 权限模型此前推迟（无登录体系）。本增量做**可升级的最小角色门禁**：用 `X-Role` 请求头表达角色，后端在敏感操作上强制；**无 X-Role 头视为可信系统访问**（CLI/导入/测试不受影响），前端交互用户始终携带角色头。明确这是 MVP，非认证；接入真实登录后只需让登录态注入 X-Role。

### 50.1 契约（@combat/shared）
```ts
export type Role = "普通" | "Leader" | "管理员";
export const PRIVILEGED_ROLES: Role[] = ["Leader", "管理员"];
```

### 50.2 后端门禁
- 读 `X-Role` 头（缺省 = 可信，等价管理员）。
- 规则：`POST /api/nodes/contribution` 与 `PUT /api/nodes/:id`（contribution 节点）中，若提交含**非空 `贡献等级`** 且 `X-Role` 头存在但不属于 `PRIVILEGED_ROLES` → `403 {error:"仅 Leader 可标定贡献等级"}`。
- 无 X-Role 头 → 放行（CLI/导入/系统/既有测试不破坏）。

### 50.3 前端
- `AppShell` 头部加角色 `Select`（普通/Leader/管理员），持久化 localStorage `combat-role`，默认「普通」。
- `api.req` 给所有请求带 `X-Role: <当前角色>` 头。
- 贡献录入（contribution EntityTable）：非特权角色提交含 贡献等级 → 后端 403 → 前端提示「仅 Leader 可标定贡献等级」。

### 50.4 CLI
- `cli.ts` httpFetch 读 `COMBAT_ROLE` 环境变量（缺省不带头=可信），带上 `X-Role`。agent 默认可信。

### 50.5 测试
- 后端 e2e：X-Role:普通 + 贡献等级 → 403；X-Role:Leader → 201；普通但不含贡献等级 → 201；无头 + 贡献等级 → 201（系统可信）。既有 contribution 测试（无头）不破坏。
- 前端 e2e FE-RB1：角色 Select 存在；切到普通后录贡献含等级→提示 403 文案（route-mock 403）。
- console-clean 不新增路由。

### 50.6 验收
- [x] Role 契约（ASCII token）+ PRIVILEGED_ROLES + ROLE_LABELS
- [x] 后端贡献等级门禁（普通 403 / Leader 201 / 无头放行）
- [x] 前端角色 Select + X-Role 头注入 + 403 提示
- [x] CLI COMBAT_ROLE 注入
- [x] 既有 e2e 零回归（honor 改为 Leader 角色）；test:all 两次绿；待部署

---

## 51. 增量 34：后台自动化机制补全（仅后端，无前端 UI）

> 用户指令：后台机制全部实现，前台 UI 暂不做。补齐 §11 Phase3 / §5.3 中属于后台机制的几项。全部含 CLI（核心原则），不加前端页面。

### 51.1 日报发布数量自增（§11 Phase3「自动日报…计入日报发布数量」）
- `POST /api/daily-report/publish?date=YYYY-MM-DD`：对当日有进展的每个 attackTicket，其 `日报发布数量`(number)+1，审计 `DAILY_REPORT_PUBLISH`，返回 `{ date, ticketsTouched, published }`。
- CLI：`daily-report:publish [--date]`。

### 51.2 定时任务机制（§5.3 定时扫描）
- `tickScheduledJobs(repo, registry)`：依次跑 `syncConflicts` + `scanEscalation` + `scanReminders`，返回各计数汇总 `{ conflicts, overlaps, escalated, reminders }`。
- `POST /api/jobs/tick`：手动触发，返回汇总（可测）。
- `server.ts`：`setInterval(tick, 1h)` 启动定时（仅生产入口，createApp 不启定时，测试不受影响）。
- CLI：`jobs:tick`。

### 51.3 Oncall 当前值班推导（§5.3 Oncall 轮换）
- `GET /api/oncall/current?domain=`：在 oncall 节点中按 domain 过滤，取今天落在 [起,止] 区间者，返回当前值班人列表（按 domain 分组或单 domain）。日期派生，无状态写入。
- CLI：`oncall:current [--domain]`。

### 51.4 荣誉团队聚合（数据基础 + 后端）
- person 增 `团队` 字段（配置）。`GET /api/honor/leaderboard?groupBy=team`：按贡献人所属 person 的 `团队` 聚合加权得分；无 groupBy 时维持按人（向后兼容）。
- CLI：既有 `honor:leaderboard` 加 `--groupBy team` 透传。

### 51.5 测试（全后端 e2e + CLI build）
- 日报发布：建单+当日进展→publish→该单 日报发布数量=1；二次 publish=2；审计留痕。
- jobs:tick：造冲突+超期单→tick→汇总含 conflicts≥1、escalated≥1。
- oncall:current：建今天区间内/外的 oncall→current 只返回区间内值班人。
- 团队聚合：两人不同团队各核心贡献→groupBy=team 返回团队加权。
- CLI：daily-report:publish / jobs:tick / oncall:current / honor:leaderboard --groupBy build 正确。

### 51.6 验收
- [x] 日报 publish 自增 日报发布数量 + 审计 + CLI
- [x] jobs:tick 汇总跑 conflicts/escalation/reminders + server 定时 + CLI
- [x] oncall:current 日期派生 + CLI
- [x] 荣誉 groupBy=team 聚合 + person 团队字段 + CLI 透传
- [x] 无前端改动；既有 e2e 零回归；test:all 两次绿；部署

---

## 52. 增量 35：手工备注关联线（ad-hoc schemaless KG link，并集呈现）— 仅后端

> 用户澄清：管理员对**单条记录的某个字段**手工拉一条**带备注的关联线**连到另一条数据（只连这一条，非字段级 schema 规则）；该 ad-hoc 链接存入知识图谱，查询/分析时以**传统查询 ∪ KG**并集呈现。本增量补此后端机制（无前端 UI）。

### 52.1 契约
`ManualLinkView { edgeId, direction:"out"|"in", sourceField?, reason, node }`；`RelatedResult` 在涉及节点上追加 `manualLinks?`（仅非空时出现，向后兼容）。`Repository` 增 `deleteEdgeById(id,actor):boolean`。

### 52.2 后端
- 边类型复用 §2.4 通用 `RELATES_TO`，属性 `{ reason(备注), sourceField?, manual:true }`。
- `POST /api/relations/manual {sourceId,targetId,sourceField?,reason}` → 校验两节点存在、非自身 → 建边 + 审计；`GET /api/relations/manual?nodeId=` 列出双向；`DELETE /api/relations/manual/:edgeId`。
- `/api/related/:type/:id` 响应并集追加 `manualLinks`（结构化边 ∪ 锚点 ∪ 候选 ∪ 手工备注线）。
- CLI：`relations:link --from --to [--field] --reason`、`relations:list --node`、`relations:unlink <edgeId>`。

### 52.3 验收
- [x] 人工任意两记录拉线+备注+源字段 → 入 KG；related 并集呈现 manualLinks（双向）
- [x] list/unlink + 校验(自身400/不存在404)
- [x] CLI relations:link/list/unlink
- [x] 无前端；既有 e2e 零回归；test:all 两次绿；部署

---

## 53. 增量 37：字段补全 + 人员 ref 化（强化跨视图关联）— 仅后端/配置

> 依据 req.md 攻关单详情真实表头（§“客户所属资源ID、租户id，故障局点”）与现网400「邮件」列，补全缺失业务字段；并把攻关单上的「攻关组长 / 攻关申请人」由纯字符串升级为 `ref→person`，使其进入派生 KG（兑现 §0 核心问题：同一人在多视图被关联）。纯配置 + 后端，无前端 UI。

### 53.1 字段补全（全部非 required，导入/创建向后兼容）
- attackTicket：新增 `资源ID`(string)、`租户ID`(string)；`局点` 增 alias `故障局点`。
- issue400：新增 `邮件`(string)。
- person：新增 `角色`(string，如 攻关组长/SRE/研发)。

### 53.2 人员 ref 化（cross-view linking）
- attackTicket `攻关组长` `攻关申请人`：`type:"string"` → `type:"ref", refType:"person", concept:"负责人"`（保留既有 alias）。创建/导入时按既有 ref 解析机制建 person + REF 边；`kg:rebuild` 可从存量字符串值回灌 REF 边。
- `攻关成员`（多人逗号串）暂保持 string（ref 仅单值），列入后续多值 ref 支持。

### 53.3 测试
- 建带 `资源ID/租户ID/故障局点(alias→局点)/邮件` 的单/400 → 字段落库、alias 命中。
- 建 attackTicket `攻关组长:"王组长"` → 自动建 person 且 `related` 可见该 REF 关联；`kg:rebuild` 后仍在。
- 既有 attackTicket/issue400 e2e 零回归。

### 53.4 验收
- [x] attackTicket 资源ID/租户ID + 局点 alias 故障局点
- [x] issue400 邮件；person 角色
- [x] 攻关组长/攻关申请人 ref→person + REF 边 + rebuild 回灌
- [x] 无前端；既有 e2e 零回归；test:all 两次绿；部署

---

## 54. 增量 39：自定义命令（自然语言高阶命令封装成带参 UI 脚本）— 后端 + 前端

> 用户需求：把常用的自然语言驱动操作（如「将 {内容} 发送邮件给 {收件人}」）由 agent 在对话中翻译成一条**带参数占位符的 CLI 模板**，保存为「自定义命令」。终端用户在自定义命令页点击 → 提示输入参数 → 系统填充模板 → 经既有 CLI/API 执行并展示结果。**存储的可执行产物是参数化 CLI 模板**（NL→模板的翻译发生在 agent 创作期），运行期确定性执行，复用全部既有 50+ CLI 命令作为执行底座。

### 54.1 契约（@combat/shared）
`CustomCommand { id, name, description?, template, params: string[], createdAt }`。`params` 由 `template` 中 `{占位符}` 自动抽取（去重、保序）。

### 54.2 后端（custom-commands.ts，存 app_settings key `customCommands` JSON 数组）
- `GET /api/commands` → 列表。
- `POST /api/commands {name, template, description?}` → 校验 name/template 非空、template 首 token ∈ 已注册 CLI 命令名；抽取 params；存储返回。非法 → 400。
- `DELETE /api/commands/:id` → 200/404。
- `POST /api/commands/:id/run {args}` → 校验所有 params 均有值（缺 → 400）；将 `{p}` 替换为 `args[p]`；`parseArgs` + `COMMANDS.build` → 返回 `{ resolved, request }`（request 即 `{method, path, body?}`）。前端拿到 request 后用既有 fetch 执行并展示（后端保持纯解析，不自调用）。
- 每步审计 `CUSTOM_COMMAND_*`。
- CLI：`commands:list`、`commands:create --name --template [--description]`、`commands:delete <id>`、`commands:run <id> --args '<json>'`。

### 54.3 前端（CustomCommandsPage，路由 `/commands`，首页卡片）
- 列表展示 name/description/template/params。
- 「新建命令」表单：name、description、template（textarea，提示用 `{参数}` 占位）。
- 每条「运行」→ 弹窗按 params 逐个输入 → 「执行」→ `POST run` 得 request → 前端 fetch 执行 → 展示 JSON 结果；「删除」。

### 54.4 测试
- 后端 e2e：创建（参数抽取）、列表、校验（缺 name/template→400、未知命令→400）、run（解析 request 正确、缺参→400）、删除（200/404）。
- CLI build 断言 4 命令。
- 前端浏览器 e2e：进页 → 新建一条包装 `nodes:list attackTicket --状态 {st}` 的命令 → 运行填 `st=进行中` → 见结果 → 删除。

### 54.5 验收
- [x] CRUD + 参数抽取 + run 解析 + 校验
- [x] CLI commands:list/create/delete/run
- [x] 前端页面 新建/运行/删除 + 首页卡片 + 路由
- [x] 既有 e2e 零回归；test:all 两次绿；部署

---

## 55. 增量 41：跨 view 记录对账分析（查重 + 关联候选 → 管理者确认）— 后端

> 用户需求：各 view 独立录入会产生重复/应关联未关联的记录；需要一个**可定期或手动启动**的后台对账任务，分析后把发现的问题（疑似重复、应合并）提交**管理者确认**（关联/合并）。复用既有「关系提议队列 + 人工审批 + mergePerson」闭环，补齐分析触发与查重盲区。

### 55.1 查重盲区修复（proposer）
- 现 `HeuristicRelationProposer` 跳过**完全同名**（`A.key === B.key` continue），只提近似名。补：对**规范化后完全同名**的 person 也提 `SAME_AS`（confidence 1.0，rationale「完全同名」），除非二者 employeeId 均存在且不同（判定为不同人，跳过）。近似名（编辑距离≤阈值）维持。

### 55.2 对账分析纳入定期/手动任务
- 抽出 `runProposalScan(repo, registry): number`（去重持久化逻辑，原在 `/proposals/scan` 路由内联），路由与 jobs 共用。
- `tickScheduledJobs` 增跑 `runProposalScan`，`JobsTickResult` 增 `proposals` 字段。→ 每小时定时 + 手动 `POST /api/jobs/tick`（CLI `jobs:tick`）+ 既有手动 `POST /api/proposals/scan`（CLI `proposals:scan`）均可触发对账。
- 发现的候选进入既有「待审批」提议队列；管理者经 `/proposals`（或 CLI `proposals:list`/`proposals:decide`）确认 → `通过` 触发 `mergePerson` 合并去重，`拒绝` 抑制该三元组。

### 55.3 说明：应关联未关联已由派生 KG 覆盖
- 跨 view 同 `问题单号`/`客户`/`domain` 等通过锚点自动 co-anchored，同一人多 view 引用经 REF + SAME_AS 合并后边迁移统一——「该关联的进行关联」已由结构化派生机制保证；本增量聚焦补齐「查重」触发与同名盲区。

### 55.4 验收
- [x] 完全同名 person → 提 SAME_AS（employeeId 冲突则不提）
- [x] jobs:tick 汇总含 proposals；定期+手动均触发对账
- [x] 端到端：两 view 各自录入同一人 → tick → 提议入队 → 管理者通过 → 合并去重
- [x] 既有 e2e 零回归；test:all 两次绿；部署
