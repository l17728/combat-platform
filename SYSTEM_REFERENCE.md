# 系统能力参考手册

> 本文档记录系统的完整能力清单、API 端点、数据模型、配置驱动 schema、前端页面结构、
> 部署基础设施等关键信息，供开发新前端时快速查阅。
> 基于 PRD.md（2909 行）、docs/*、源码分析、服务器探查整理。

---

## 0. 部署基础设施

### 0.1 网络拓扑

```
[开发机 Windows] --SSH--> [跳板机 47.103.99.229] --SSH--> [目标机 60.204.199.234]
                              │                            │
                              │  参考前端部署在这里          │  新前端 v2 部署在这里
                              │  /opt/combat/               │  /opt/combat-v2/
                              │  前端 :5173 后端 :3001      │  前端 :TBD 后端 :3001
```

- **不能直连目标机 60.204.199.234**，必须经跳板机 SSH 跳转
- 跳板机 lg.sh 内容：`ssh root@60.204.199.234`

### 0.2 跳板机（47.103.99.229，参考前端部署服务器）
| 项目 | 值 |
|------|-----|
| OS | Alibaba Cloud Linux (kernel 5.10) |
| 用户 | root / Pass@865342（见 .env.deploy） |
| Node | /opt/node22/bin/node v22.14.0（run-deploy.sh 安装的） |
| 路径 | /opt/combat/ |
| 前端 | vite preview :5173 |
| 后端 | tsx src/server.ts :3001 |
| SSH 密钥 | /root/.ssh/id_ed25519（已生成，已拷贝到目标机） |
| sshpass | 已安装（/usr/bin/sshpass） |

### 0.3 目标机（60.204.199.234，新前端 v2 部署服务器）
| 项目 | 值 |
|------|-----|
| OS | Ubuntu 24.04.3 LTS |
| 内核 | 6.8.0-87-generic x86_64 |
| RAM | 30GB（可用 ~26GB） |
| 磁盘 | 296GB（已用 9.3GB，可用 274GB） |
| 系统 Node | v24.13.0（**不兼容 better-sqlite3@11，不能用**） |
| 系统 npm | v11.6.2 |
| 运行 Node | v22.14.0（`/opt/node22-v2/bin/node`，run-backend.sh 自动安装） |
| nginx | 未安装 |
| pm2 | 未安装 |
| 监听端口 | :22(SSH), :25565, :18789, :18791/18792(本地), **:3001(后端,已启动)** |
| /opt/ | containerd/, pairproxy/, **combat-v2/** |
| 部署路径 | `/opt/combat-v2/`（已部署，后端运行中） |

### 0.4 SSH 跳转链路（已验证可用）
```
跳板机 → 目标机：ssh -o StrictHostKeyChecking=no root@60.204.199.234
```
- 跳板机已生成 ed25519 密钥，公钥已写入目标机 authorized_keys
- 代码中通过 `scripts/deploy-v2/` 脚本自动化部署

### 0.5 部署脚本位置
| 用途 | 路径 |
|------|------|
| 新前端 v2 部署 | `scripts/deploy-v2/` |
| 参考前端部署（勿改） | `scripts/deploy/` |
| 部署凭据（gitignored） | `.env.deploy` |

### 0.6 部署流程（新前端 v2）
1. 本地构建 `apps/frontend-v2/`（`npm run build --workspace=@combat/frontend-v2`）
2. 打包代码 + dist
3. 经跳板机 SCP 到目标机 `/opt/combat-v2/`
4. 目标机 npm install + 启动后端 + 启动前端（vite preview 或后续 nginx）

---

## 1. 后端 API 端点清单（50+）

Base URL: `http://localhost:3001`（开发）/ `http://47.103.99.229:3001`（部署）

### 1.1 通用节点 CRUD
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/nodes/:nodeType` | 创建节点（触发 syncRefEdges + syncAnchorEdges + audit） |
| GET | `/api/nodes/:nodeType` | 列出该类型全部节点，支持 `?<field>=<value>` 等值过滤 |
| GET | `/api/nodes/:id` | 单节点详情 |
| PUT | `/api/nodes/:id` | 更新节点（合并属性），同样触发 syncRef/syncAnchor 重建 |
| DELETE | `/api/nodes/:id` | 硬删 + 级联删边/ProgressLog + audit |

### 1.2 进展时间序列
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/nodes/:id/progress` | 列出该节点全部 ProgressLog（seqNo asc） |
| POST | `/api/nodes/:id/progress` | 追加一条 ProgressLog，body: `{content, statusSnapshot, actor}` |

### 1.3 状态流转
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/nodes/:id/transition` | 原子状态变更 + 追加 ProgressLog，body: `{toStatus, note?}`，仅 attackTicket |

### 1.4 Schema 元数据
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schema/:nodeType` | 返回该 nodeType 的 NodeSchema |
| PATCH | `/api/schema/:nodeType` | 应用 FieldOp（addField/renameLabel/editEnum/retire/unretire/setAliases/setConcept/setAnchor） |
| POST | `/api/schema/scan` | 重新加载全部 schema 配置 |
| GET | `/api/schema/list` | 列出全部 NodeSchema（Schema Wizard） |
| GET | `/api/schema/suggest?q=` | 字段建议（Schema Wizard） |
| POST | `/api/schema/nodeType` | 创建新 nodeType |
| DELETE | `/api/schema/nodeType/:nodeType` | 删除 nodeType |

### 1.5 跨视图关联
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/related/:nodeType/:id` | 1 跳关联全景（outgoing/incoming/coAnchored/conflicts/manualLinks），可选 `?includeCandidates=1&depth=N` |

### 1.6 关系审批（增量3c）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/proposals/scan` | 运行 HeuristicRelationProposer，幂等 |
| GET | `/api/proposals?status=` | 列出候选关系 |
| POST | `/api/proposals/:id/decide` | 通过/拒绝/修正，body: `{decision, decidedBy, patch?}` |

### 1.7 Hermes 问答
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/hermes/ask` | body: `{question}`，返回 HermesAnswer（8 类意图） |

### 1.8 只读查询（增量4）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/query/search?q=&type=&limit=` | 全文子串检索，返回 QueryHit[] |
| GET | `/api/query/context/:id` | 节点 + 1 跳邻域 + ProgressLog |

### 1.9 找帮手（增量5）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/recommend/helpers/:id?limit=` | 仅 attackTicket，返回 HelperRecommendation[] |

### 1.10 数据大盘（增量6/19）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard` | DashboardSummary：tickets/contributions/proposalsPending/conflicts/today/recentActivity |

### 1.11 荣誉殿堂（增量 P0-②）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/honor/leaderboard?period=&groupBy=` | 加权排行榜（默认按人，?groupBy=team 按团队） |
| GET | `/api/honor/person/:name` | 个人贡献档案 |

### 1.12 导入/导出（增量1.5/8/25）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/import?type=&dryRun=1` | Excel 上传，multipart "file" 字段。dryRun=1 只预览不写库 |
| GET | `/api/export/:nodeType` | 全量导出 xlsx（application/vnd.openxmlformats...） |

### 1.13 日报（增量9）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/daily-report?date=` | DailyReport：sections + summary |
| POST | `/api/daily-report/publish?date=` | 日报发布数量自增 + 审计 |

### 1.14 跟催提醒（增量10/11）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/reminders/scan` | 规则引擎扫描（问题单跟催/FE Deadline/CCB 提醒） |
| GET | `/api/reminders?status=` | 列出提醒 |
| POST | `/api/reminders/:id/send` | 发送（stub channel） |
| POST | `/api/reminders/:id/ignore` | 忽略 |

### 1.15 冲突检测（增量16）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/conflicts/scan` | 扫描同人活跃单 + 同问题单号，建 CONFLICTS_WITH/OVERLAPS_WITH 边 |
| GET | `/api/conflicts` | 列出 ConflictRow[] |

### 1.16 KG 全量重建（增量17）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/kg/rebuild` | 删旧重建 REF + ANCHORED_TO + 冲突边 |

### 1.17 KG 图可视化（增量21）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/graph/snapshot/:nodeType/:id?depth=` | BFS 图快照（GraphSnapshot） |

### 1.18 审计日志（增量22）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/audit?action=&entityType=&entityId=&limit=` | AuditLogEntry[] |

### 1.19 人员合并（增量23）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/merge/preview?fromId=&toId=` | 预览合并（unionedFields + edgesToMigrate） |
| POST | `/api/merge/person` | 执行合并，body: `{fromId, toId}`，不可逆 |

### 1.20 导入 dry-run（增量25）
- 已合并在 `/api/import?dryRun=1` 中，返回 ImportPreview

### 1.21 邮件（增量28）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/email/config` | SMTP 配置（密码掩码） |
| PUT | `/api/email/config` | 保存 SMTP 配置 |
| POST | `/api/email/test` | 发测试邮件，body: `{to}` |
| POST | `/api/email/send` | 发邮件，body: EmailSendRequest |

### 1.22 SLA 上升（增量31）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/escalation/config` | 责任矩阵配置 |
| PUT | `/api/escalation/config` | 保存配置 |
| POST | `/api/escalation/scan` | 扫描超期单 + 上升 |

### 1.23 定时任务（增量34）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/jobs/tick` | 手动触发：syncConflicts + scanEscalation + scanReminders + runProposalScan |

### 1.24 自定义命令（增量39）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/commands` | 列出自定义命令 |
| POST | `/api/commands` | 创建命令 |
| DELETE | `/api/commands/:id` | 删除 |
| POST | `/api/commands/:id/run` | 运行（解析模板 + 返回 request） |

### 1.25 手工关联线（增量35）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/relations/manual` | 建带备注 RELATES_TO 边，body: `{sourceId, targetId, sourceField?, reason}` |
| GET | `/api/relations/manual?nodeId=` | 列出双向手工关联 |
| DELETE | `/api/relations/manual/:edgeId` | 删除手工关联 |

### 1.26 责任矩阵图（增量31）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/responsibility/diagram` | Mermaid 格式责任矩阵图 |

### 1.27 UI 固定（增量31）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ui-cache/pinned` | 列出固定 UI |
| POST | `/api/ui-cache/pin` | 固定 UI |
| DELETE | `/api/ui-cache/pinned/:id` | 取消固定 |

### 1.28 Oncall（增量31/34）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/oncall/current?domain=` | 当前值班人（按日期区间派生） |

---

## 2. 数据模型

### 2.1 核心表结构
```sql
nodes (id TEXT PK, nodeType TEXT NOT NULL, properties TEXT NOT NULL, search_text TEXT, created_at TEXT, updated_at TEXT)
edges (id TEXT PK, edgeType TEXT NOT NULL, sourceId TEXT NOT NULL, targetId TEXT NOT NULL, properties TEXT NOT NULL, created_at TEXT, updated_at TEXT)
progress_log (id TEXT PK, ownerId TEXT NOT NULL, seqNo INTEGER NOT NULL, content TEXT NOT NULL, statusSnapshot TEXT, updatedBy TEXT, updatedAt TEXT)
audit_log (id TEXT PK, action TEXT NOT NULL, entityType TEXT, entityId TEXT, changes TEXT, performedBy TEXT, performedAt TEXT)
proposals (id TEXT PK, source_node_id TEXT, target_node_id TEXT, relation_type TEXT, confidence REAL, proposer_source TEXT, rationale TEXT, status TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT)
notifications (id TEXT PK, kind TEXT, ticket_id TEXT, recipient_person_id TEXT, recipient_name TEXT, subject TEXT, body TEXT, status TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT)
app_settings (key TEXT PK, value TEXT)
daily_report_entry (id TEXT PK, ticket_id TEXT, type TEXT, current_progress TEXT, next_steps TEXT, status TEXT, created_by TEXT, created_at TEXT, published_at TEXT)
support_template / support_node (辅助支持功能)
```

### 2.2 边类型
| 边类型 | 语义 | 派生方式 |
|--------|------|----------|
| REF | ref 字段引用（properties.field + refType + concept） | syncRefEdges（写入时自动） |
| ANCHORED_TO | 共享锚点（properties.anchorKind + field） | syncAnchorEdges（写入时自动） |
| CONTRIBUTED_TO | contribution → attackTicket | POST contribution 时自动 |
| ASSIGNED_TO | attackTicket → person（攻关申请人） | import 时自动 |
| CONFLICTS_WITH | 同人多活跃单 | syncConflicts（扫描时派生） |
| OVERLAPS_WITH | 同问题单号 | syncConflicts（扫描时派生） |
| ESCALATED_TO | SLA 上升 | scanEscalation |
| RELATES_TO | 手工关联线（properties.reason, sourceField, manual:true） | 手动创建 |
| SAME_AS | 提议合并（proposals 表，非权威边） | proposals/scan |

### 2.3 nodeType 清单（16 个配置文件）
| nodeType | label | identityKeys | 特殊字段 |
|----------|-------|-------------|----------|
| attackTicket | 攻关单 | 攻关单号 | ref: 当前处理人/攻关组长/攻关申请人→person(concept:负责人); anchor: 问题单号/事件单号 |
| person | 人员 | employeeId, email | 被各 nodeType ref 引用 |
| contribution | 贡献记录 | 贡献人 | ref: 贡献人→person(concept:负责人); anchor: 关联问题单→问题单号 |
| releasePackage | 发布包 | 版本号 | ref: 责任人→person; anchor: 关联问题单→问题单号 |
| weightFile | 权重文件 | 名称 | ref: 责任人→person; anchor: 关联问题单→问题单号 |
| emailGroup | 邮件群组 | 组名 | 成员邮箱（逗号分隔） |
| oncall | 排班 | domain | ref: 值班人→person |
| incidentTracking | 现网问题跟踪 | 问题说明 | ref: 运维/研发责任人→person; anchor: 关联需求问题单→问题单号, 影响客户→客户 |
| changeIssue | 变更相关问题 | 问题说明 | ref: 研发责任人→person; anchor: 关联需求问题单→问题单号 |
| alarmGovernance | 告警治理跟踪 | 告警问题 | ref: 责任人→person; anchor: 问题单需求单号→问题单号 |
| p3Incident | 未闭环P3事件单 | 事件单号 | ref: 事件处理人→person; anchor: 事件单号→事件单号 |
| dailyTask | 日常事项跟踪 | 事项描述 | ref: 责任人→person; anchor: 涉及客户→客户 |
| issue400 | 现网400问题梳理 | 客户 | anchor: 客户→客户, domainId→domain |
| issue5xx | 现网5xx问题梳理 | domainId | anchor: domainId→domain |
| experience | 经验总结 | 经验 | ref: 责任人→person |
| domain | 责任田 | name | 被引用的锚点 kind |

### 2.4 FieldSchema 完整结构
```ts
interface FieldSchema {
  id: string;           // 不可变内部键
  name: string;         // 原始名
  type: "string" | "number" | "date" | "datetime" | "enum" | "ref" | "sequence";
  label: string;        // 可改展示名
  required?: boolean;
  enumValues?: string[];
  refType?: string;     // type=ref 时指向的 nodeType
  retired?: boolean;    // 非破坏退休
  aliases?: string[];   // 导入列名归一
  concept?: string;     // 语义角色（跨 view 异名归并）
  anchor?: string;      // 共享锚点 kind
}
```

### 2.5 FieldOp 类型
```ts
type FieldOp =
  | { op: "addField"; field: { name; type; label; required?; enumValues? } }
  | { op: "renameLabel"; id; label }
  | { op: "editEnum"; id; enumValues }
  | { op: "retire"; id }
  | { op: "unretire"; id }
  | { op: "setAliases"; id; aliases: string[] }
  | { op: "setConcept"; id; concept: string }
  | { op: "setAnchor"; id; anchor: string }
```

---

## 3. 前端参考实现结构（apps/frontend/，只读参考）

### 3.1 路由清单（27 个）
| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | HomePage | 作战态势大盘 + 模块卡片 |
| `/attack` | EntityTable(attackTicket) | 攻关单表格/卡片 |
| `/attack/:id` | AttackDetail | 攻关单详情（Descriptions + 关联 + 找帮手 + 进展 + 流转 + 审计） |
| `/contributions` | EntityTable(contribution) | 贡献录入 |
| `/honor` | HonorPage | 荣誉殿堂排行榜 |
| `/honor/:name` | PersonHonor | 个人贡献档案 |
| `/related/:nodeType/:id` | RelatedPage | 关联全景（concept 分组 + 锚点 + 候选 + 冲突 + 手工关联） |
| `/graph/:nodeType/:id` | GraphPage | KG 图可视化（SVG 径向） |
| `/proposals` | ProposalsPage | 关系审批队列 |
| `/search` | SearchPage | 信息检索 |
| `/import` | ImportPage | Excel 导入（nodeType 选择 + dry-run 预览） |
| `/releases` | EntityTable(releasePackage) | 发布包 |
| `/weights` | EntityTable(weightFile) | 权重文件 |
| `/daily-report` | DailyReportPage | 攻关日报 |
| `/reminders` | RemindersPage | 跟催提醒 |
| `/conflicts` | ConflictsPage | 冲突/重叠汇总 + KG 重建 |
| `/hermes` | HermesPage | Hermes 问答 |
| `/audit` | AuditPage | 审计日志 |
| `/merge` | MergePage | 人员合并 |
| `/email` | EmailPage | SMTP 配置 + 邮件发送 |
| `/emailgroups` | EntityTable(emailGroup) | 邮件群组 |
| `/escalation` | EscalationPage | SLA 上升配置 + 扫描 |
| `/oncall` | EntityTable(oncall) | 排班 |
| `/commands` | CustomCommandsPage | 自定义命令 |
| `/responsibility` | ResponsibilityPage | 责任矩阵图 |
| `/schema-wizard` | SchemaWizardPage | Schema 管理向导 |
| `/people` | PeoplePage | 人员列表 |
| `/domains` | DomainsPage | 责任田 |
| `/tasks` | TasksPage | 任务列表 |
| `/settings` | SettingsPage | 设置 |
| `/support-templates` | SupportTemplatePage | 支持模板 |

### 3.2 核心前端组件
- **Api class** (`api.ts`)：封装全部 fetch 调用，单例 `api`。所有请求带 `X-Role` 头（从 localStorage `combat-role` 读取）
- **EntityTable**：配置驱动通用表格，支持：行内编辑/新增/删除/字段管理（改名/退休/别名/概念/锚点/+字段）/导出 Excel/表格↔卡片切换/status 过滤
- **AppShell**：AntD Layout 统一外壳，顶部菜单导航
- **AttackDetail**：Descriptions + 关联链接 + 找帮手区 + 流转区 + 进展 Timeline + 审计区
- **RelatedPage**：concept 分组 + 锚点分组 + 候选分组 + 冲突红色区 + depth 选择 + 扩展面板 + 图形视图链接
- **RefCell**：ref 字段单元格渲染为 Link，直跳被引用实体关联页

### 3.3 前端技术栈
- React 18 + TypeScript + Vite
- Ant Design 5（Table, Form, Modal, Select, DatePicker, Descriptions, Timeline, Card, Row/Col, Segmented...）
- react-router-dom v6（BrowserRouter + Routes + Route）
- mermaid.js（责任矩阵图）
- 无状态管理库（纯 hooks）

---

## 4. 关键领域概念

### 4.1 中文枚举值（不可翻译）
```
状态: 待响应 | 处理中 | 进行中 | 已解决 | 已关闭
贡献类型: 发现 | 设计 | 实施 | 协调 | 公关
贡献等级: 普通 | 关键 | 核心（加权: 1/3/8 或 1/2/3）
优先级/风险等级: 高 | 中 | 低
ReminderKind: 问题单跟催 | FE Deadline 提醒 | CCB 提醒
ReminderStatus: 待发送 | 已发送 | 已忽略
ProposalStatus: 待审批 | 已通过 | 已拒绝
Role: 普通 | Leader | 管理员
```

### 4.2 锚点权威清单
```
问题单号（含 OSM问题单号/关联需求·问题单）
事件单号
domain
客户（含 涉及/影响客户）
```

### 4.3 concept 归并示例
- attackTicket.当前处理人 / contribution.贡献人 / releasePackage.责任人 / incidentTracking.运维责任人 → concept = "负责人"
- 异名字段同 concept 在 RelatedPage 归并到同一组

### 4.4 核心设计原则
1. **一个数据模型，多个 view**：每张表是 nodes 按 nodeType 的投影
2. **配置驱动 schema**：字段增减改配置不改库，UI 动态渲染
3. **结构化为权威源，KG 为派生层**：KG 不接受直接写入
4. **显式优先 → 模糊兜底 → 并集检索**：精确匹配走结构化，模糊走 KG 候选+人审
5. **合并不可逆**：person 合并需 Popconfirm 确认

---

## 5. CLI 命令参考（50+ 命令）

```bash
npm run cli -- help                    # 列出全部命令
npm run cli -- help <command>          # 查看命令详情

# 读命令
dashboard, nodes:list, nodes:get, progress:list, schema:get, related, graph,
conflicts:list, audit:list, merge:preview, daily-report, honor:leaderboard,
honor:person, proposals:list, reminders:list, recommend:helpers, search, context,
oncall:current, email:config-get, escalation:config-get, commands:list, relations:list

# 写命令
nodes:create, nodes:update, nodes:delete, nodes:transition, progress:add,
schema:patch, schema:scan, conflicts:scan, kg:rebuild, hermes:ask, merge:person,
proposals:scan, proposals:decide, reminders:scan, reminders:send, reminders:ignore,
import, export, email:config-set, email:test, email:send, escalation:config-set,
escalation:scan, daily-report:publish, jobs:tick, commands:create, commands:delete,
commands:run, relations:link, relations:unlink
```

---

## 6. 测试概况

| 包 | 框架 | 测试文件数 | 说明 |
|---|------|-----------|------|
| packages/shared | vitest | 3 | 类型测试、registry 测试、repository 测试 |
| apps/backend | vitest + supertest | ~50 | 每个 API 模块独立 e2e 文件，in-memory SQLite |
| apps/frontend (unit) | vitest | 5 | React 组件渲染测试 |
| apps/frontend (e2e) | Playwright | ~40 | 浏览器端到端，fullyParallel:false, workers:1 |

运行命令：`npm run test:all`（含 schema reset 间隔）
单文件：`npx vitest run test/xxx.e2e.test.ts`（在 apps/backend 目录下）
Playwright 单文件：`npx playwright test e2e/xxx.spec.ts`（在 apps/frontend 目录下）

---

## 7. 共享类型关键契约（@combat/shared）

```ts
// 核心数据
GraphNode, GraphEdge, ProgressLog, NodeSchema, FieldSchema, FieldOp

// 关联
RelatedItem { field, concept, node }
CoAnchoredItem { anchorKind, anchorKey, node }
ExpandedItem { node, depth, viaEdgeType, viaField, parentId }
ConflictItem { edgeType, reason, node }
ConflictRow { edgeType, reason, source, target }

// 查询
QueryHit { id, nodeType, summary, score }
QueryContext { node, related, progress }

// Hermes
HermesAnswer { question, intent, answer, citations[] }
HermesIntent: status | owner | ticket-by-pb | person-workload | fallback-search
            | contribution-by-person | recent-changes | find-helpers
HermesCitation { nodeId, nodeType, summary, link }

// 大盘
DashboardSummary { tickets, contributions, proposalsPending, conflicts, today, recentActivity }

// 荣誉
LeaderboardEntry, PersonHonor

// 提议
RelationProposal, RelationProposalStatus, RelationProposer

// 提醒
Reminder, ReminderStatus, ReminderKind, ChannelAdapter

// 导入
ImportPreview, ImportRowResult { rowIndex, action, reason?, summary }

// 图
GraphSnapshot, GraphSnapshotNode, GraphSnapshotEdge

// 审计
AuditLogEntry

// 合并
MergePreview { from, to, unionedFields, edgesToMigrate }
TransitionResult { node, progress }

// 邮件
SmtpConfig, SmtpConfigMasked, EmailSendRequest, EmailSendResult

// 上升
EscalationConfig, EscalationScanResult

// 自定义命令
CustomCommand, CustomCommandRunResult

// UI
PinnedUi

// 角色
Role = "普通" | "Leader" | "管理员"
PRIVILEGED_ROLES = ["Leader", "管理员"]

// 推荐
HelperRecommendation { person, score, reasons[] }

// 常量
ATTACK_STATUSES = ["待响应", "处理中", "进行中", "已解决", "已关闭"]
```
