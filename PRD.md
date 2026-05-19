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
| 1 | Hermes Agent 的具体接入形态（SDK/HTTP/MCP）？ | Phase3 集成 | 待确认 Hermes 提供的接口；先定义只读数据访问契约 |
| 2 | 通知渠道：邮件 / eSpace / welink？ | Phase2-3 跟催/日报 | 先邮件，后接 eSpace/welink |
| 3 | welinkcli 抓取攻关群消息的可行性与权限？ | Phase3 自动日报/找人 | 需确认 welinkcli 能力与合规 |
| 4 | 权限模型（谁可见/可改/可标定贡献等级）？ | 全局 | Phase1 不做，Phase2 加 RBAC（贡献等级仅 Leader） |
| 5 | 图谱规模上限？ | KG 存储/渲染 | 千级先用 SQL+内存图，万级引入图索引/分页聚类 |
| 6 | 发布包/权重文件归档：仅元数据登记还是文件托管？ | 李嘉⑤⑥ | 倾向先做元数据+链接登记，文件托管后评估 |
| 7 | 字段 id 生成策略（新字段 slug 派生算法/唯一化/中文）？ | §14 增量1 | 现有字段 id=原名；新字段：名字派生 slug + 冲突加序号；最终化 §14.2 |
| 8 | 跨颗粒度锚点的权威清单（问题单号/OSM/事件单号/domain id/客户）？ | §14 增量2/3 | 增量2 与用户确认锚点字段集与优先级 |
| 9 | `applyFieldOp` 回滚粒度：`reload()` 全目录重解析，无关 sibling 配置损坏会误回滚本次有效变更 | §14.2B 增量1 已交付（单/少 schema 可接受） | schema 增多前改为"仅校验被写文件"再 reload；现以注释+本条跟踪 |

---

## 14. 可编辑 Schema 与跨 View 关联（演进路线）

> 本章细化并作为 §0.4 / §2.1 / §3.4 / §4 在"用户可手工增删改记录与字段、跨 view 动态关联"方向上的权威规格。**§14.2 是下一次实现（增量1）的开发依据。**

### 14.1 背景

Phase-1 MVP 把范围收敛到"导入+只读+进展"，缺少手工建/改记录与 UI 增删字段——对每天要用的工具这是底线 UX 缺失（用户明确反馈）。同时"用户自改字段名 / 不同 view 字段名不一 / 跟踪对象颗粒度不对齐"需要统一的关联机制。解法分层递进，分多个增量交付。

| 增量 | 内容 | 状态 |
|---|---|---|
| **增量1** | 字段稳定 ID 地基 + 记录 CRUD + UI 字段管理(回写配置) + 可编辑表格 | ✅ 完成、tag、已部署（§14.2） |
| **荣誉殿堂 (P0-②) + 平台集成** | 贡献记录(配置驱动)+CONTRIBUTED_TO+等级加权榜单+个人档案 **+ 统一外壳/导航 + 作战平台首页** | **进行中：本次实现（规格见 §15）** |
| 增量1.5 | **服务端全量导出 Excel**（落实 §7.3 到 EntityTable 界面） | **进行中：本次实现（规格见 §16）** |
| 增量2 | canonical 字段 + 别名/同义词映射（跨 view/导入名字归一，模糊推荐） | 已定向（§14.3） |
| 增量3 | ref→实体 + 语义 concept + 跨颗粒度锚点关联 → 派生 KG 边 | 已定向（§14.3） |

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
