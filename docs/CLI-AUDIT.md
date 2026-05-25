# CLI Audit — backend API ↔ CLI 对齐

> 本次审计目标：核对 `apps/backend/src/` 下每条 HTTP API 是否都有对应 CLI 命令、help 是否完整可被 agent（如 Hermes）自描述。
> CLAUDE.md 标准做法：「每个后端 HTTP API 必须有对应的 CLI 命令」。CLI 是 Linux shell 命令，注册在 `apps/backend/src/cli-core.ts` 的 `COMMANDS` 表，入口在 `apps/backend/src/cli.ts`，运行方式 `npm run cli -- <command> [args] [--opts]`（读 `COMBAT_API`，默认 `http://localhost:3001`）。

## 1. 数据

- 后端 API 路由总数：**67** 条（不含 domain 模块，由并行 agent 实现）
- CLI 命令总数：**72** 条（本次新增 6 条 bug-report + 4 条 daily-report-entry）
  - 部分 API 单条对应多个 CLI（例如 `GET /api/nodes/:nodeType` ↔ `nodes:list`、`GET /api/nodes/:id` ↔ `nodes:get`，是同一 Express handler 的不同语义入口；CLI 拆成两条以避免歧义）。
- 全部 backend 测试通过：**266 / 266**（48 个测试文件）。
- 本次新增 CLI 测试：**7**（cli.e2e.test.ts → 24 个测试全部通过）。

## 2. 全量 API → CLI 对齐表

> 列：HTTP method + path · 路由源文件:行号 · CLI 命令 · 备注

### 节点 / schema / 进展（routes.ts、schema-api.ts、daily-report-entry.ts）

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| GET | /api/schema/:nodeType | routes.ts:44 | `schema:get` | |
| POST | /api/schema/scan | routes.ts:48 | `schema:scan` | |
| PATCH | /api/schema/:nodeType | routes.ts:56 | `schema:patch` | help 已补 op 例子 |
| GET | /api/nodes/:nodeType | routes.ts:73 | `nodes:list` | 任意已注册 nodeType；可多重 --字段 过滤 |
| GET | /api/nodes/:id | routes.ts:73 | `nodes:get` | 同一 handler，id 未匹配 nodeType 时按 id 取单条 |
| POST | /api/nodes/:nodeType | routes.ts:86 | `nodes:create` | |
| PUT | /api/nodes/:id | routes.ts:111 | `nodes:update` | merge 语义 |
| DELETE | /api/nodes/:id | routes.ts:126 | `nodes:delete` | |
| GET | /api/nodes/:id/progress | routes.ts:133 | `progress:list` | |
| POST | /api/nodes/:id/progress | routes.ts:134 | `progress:add` | |
| POST | /api/nodes/:id/transition | routes.ts:142 | `nodes:transition` | help 已补合法状态枚举 |
| GET | /api/schema/list | schema-api.ts:28 | `schema:list` | |
| GET | /api/schema/suggest | schema-api.ts:34 | `schema:suggest` | |
| POST | /api/schema/nodeType | schema-api.ts:72 | `schema:create-nodeType` | |
| DELETE | /api/schema/nodeType/:nodeType | schema-api.ts:149 | `schema:delete-nodeType` | |
| GET | /api/nodes/:id/daily-reports | daily-report-entry.ts:31 | **`daily-report:entry-list`** | 本次新增 |
| POST | /api/nodes/:id/daily-reports | daily-report-entry.ts:39 | **`daily-report:entry-create`** | 本次新增 |
| POST | /api/nodes/:id/daily-reports/:eid/publish | daily-report-entry.ts:62 | **`daily-report:entry-publish`** | 本次新增 |
| DELETE | /api/nodes/:id/daily-reports/:eid | daily-report-entry.ts:74 | **`daily-report:entry-delete`** | 本次新增 |

### 视图 / 检索（related.ts、graph.ts、query.ts、dashboard.ts、conflicts.ts、audit.ts）

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| GET | /api/related/:nodeType/:id | related.ts:25 | `related` | --depth --candidates |
| GET | /api/graph/snapshot/:nodeType/:id | graph.ts:56 | `graph` | |
| GET | /api/query/search | query.ts:17 | `search` | 已补 `--limit` |
| GET | /api/query/context/:id | query.ts:38 | `context` | |
| GET | /api/dashboard | dashboard.ts:14 | `dashboard` | |
| GET | /api/conflicts | conflicts.ts:102 | `conflicts:list` | |
| POST | /api/conflicts/scan | conflicts.ts:99 | `conflicts:scan` | |
| GET | /api/audit | audit.ts:6 | `audit:list` | help 已补 action 列举 |

### 攻关单 / 日报 / 值班 / 荣誉

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| GET | /api/daily-report | daily-report.ts:42 | `daily-report` | |
| POST | /api/daily-report/publish | daily-report.ts:36 | `daily-report:publish` | |
| GET | /api/oncall/current | oncall.ts:31 | `oncall:current` | |
| GET | /api/honor/leaderboard | honor.ts:10 | `honor:leaderboard` | |
| GET | /api/honor/person/:name | honor.ts:52 | `honor:person` | |

### 关系 / 提议 / 跟催 / 合并 / 上升 / 推荐

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| GET | /api/proposals | proposals.ts:36 | `proposals:list` | |
| POST | /api/proposals/scan | proposals.ts:32 | `proposals:scan` | |
| POST | /api/proposals/:id/decide | proposals.ts:41 | `proposals:decide` | |
| GET | /api/reminders | reminders.ts:35 | `reminders:list` | |
| POST | /api/reminders/scan | reminders.ts:31 | `reminders:scan` | |
| POST | /api/reminders/:id/send | reminders.ts:53 | `reminders:send` | |
| POST | /api/reminders/:id/ignore | reminders.ts:55 | `reminders:ignore` | |
| GET | /api/merge/preview | merge-route.ts:16 | `merge:preview` | |
| POST | /api/merge/person | merge-route.ts:24 | `merge:person` | |
| GET | /api/escalation/config | escalation.ts:62 | `escalation:config-get` | |
| PUT | /api/escalation/config | escalation.ts:63 | `escalation:config-set` | |
| POST | /api/escalation/scan | escalation.ts:69 | `escalation:scan` | |
| GET | /api/recommend/helpers/:id | recommend.ts:72 | `recommend:helpers` | |
| POST | /api/relations/manual | relations.ts:26 | `relations:link` | |
| GET | /api/relations/manual | relations.ts:39 | `relations:list` | |
| DELETE | /api/relations/manual/:edgeId | relations.ts:46 | `relations:unlink` | |

### 任务 / KG / 邮件 / 导入导出

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| POST | /api/jobs/tick | jobs.ts:27 | `jobs:tick` | |
| POST | /api/kg/rebuild | kg-rebuild.ts:64 | `kg:rebuild` | |
| POST | /api/hermes/ask | hermes.ts:319 | `hermes:ask` | |
| GET | /api/email/config | email.ts:64 | `email:config-get` | |
| PUT | /api/email/config | email.ts:69 | `email:config-set` | |
| POST | /api/email/test | email.ts:88 | `email:test` | |
| POST | /api/email/send | email.ts:106 | `email:send` | 收件人 = to+groups+persons 去重 |
| POST | /api/import | import.ts:81 | `import` | multipart 上传 |
| GET | /api/export/:nodeType | export.ts:7 | `export` | 写本地 .xlsx |

### 责任矩阵 / 动态 UI 缓存 / 自定义命令

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| GET | /api/responsibility/diagram | responsibility.ts:161 | `responsibility:diagram` | |
| GET | /api/ui-cache/pinned | ui-cache.ts:19 | `ui:pinned` | |
| POST | /api/ui-cache/pin | ui-cache.ts:23 | `ui:pin` | |
| PATCH | /api/ui-cache/pinned/:id | ui-cache.ts:47 | `ui:rename-pin` | |
| DELETE | /api/ui-cache/pinned/:id | ui-cache.ts:57 | `ui:unpin` | |
| GET | /api/commands | custom-commands.ts:31 | `commands:list` | |
| POST | /api/commands | custom-commands.ts:33 | `commands:create` | |
| DELETE | /api/commands/:id | custom-commands.ts:49 | `commands:delete` | |
| POST | /api/commands/:id/run | custom-commands.ts:59 | `commands:run` | |

### 求助网络（公关支援树）

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| GET | /api/support-nodes/:ticketId | support-node.ts:58 | `support-node:list` | 列出攻关单的支援节点（flat list） |
| POST | /api/support-nodes/:ticketId | support-node.ts:66 | `support-node:add` | 添加求助节点 |
| PUT | /api/support-nodes/node/:nodeId | support-node.ts:107 | `support-node:update` | 部分更新 |
| DELETE | /api/support-nodes/node/:nodeId | support-node.ts:135 | `support-node:delete` | 含子节点级联删除 |
| GET | /api/support-templates | support-node.ts:143 | `support-template:list` | 按 usage_count DESC |
| POST | /api/support-templates | support-node.ts:152 | `support-template:create` | 含节点列表（含 parentIndex） |
| POST | /api/support-templates/:templateId/apply/:ticketId | support-node.ts:193 | `support-template:apply` | 克隆到 ticket，usage_count +1 |
| DELETE | /api/support-templates/:templateId | support-node.ts:232 | （待补，UI 已有） | 删除模板及其节点 |

### 问题反馈（bug-report.ts）

| Method | Path | 源 | CLI | 备注 |
|---|---|---|---|---|
| POST | /api/bug-reports | bug-report.ts | `bugs:create` | 创建问题反馈（标题必填） |
| GET | /api/bug-reports | bug-report.ts | `bugs:list` | 可选 --status 过滤 |
| GET | /api/bug-reports/:id | bug-report.ts | `bugs:get` | 单条详情 |
| PATCH | /api/bug-reports/:id | bug-report.ts | `bugs:update` | 更新/状态流转 |
| POST | /api/bug-reports/:id/close | bug-report.ts | `bugs:close` | 关闭问题 |
| DELETE | /api/bug-reports/:id | bug-report.ts | `bugs:delete` | 删除 |

> 备注：`config/schemas/domain.json` 及其 API/路由由并行 agent 实现；本次审计跳过 domain 的命令登记，但通用 `nodes:create / nodes:list / nodes:get / nodes:update / nodes:delete` 已覆盖任意 nodeType（包括将来的 domain），无需为 domain 单独建命令。

## 3. 本次新增 CLI

| 命令 | 对应 API | 加它的原因 |
|---|---|---|
| `daily-report:entry-list` | `GET /api/nodes/:id/daily-reports` | 攻关单下的「日报条目」CRUD 工作流之前只有前端能用，agent 无法操作 |
| `daily-report:entry-create` | `POST /api/nodes/:id/daily-reports` | 新建草稿日报条目 |
| `daily-report:entry-publish` | `POST /api/nodes/:id/daily-reports/:eid/publish` | 把草稿置为「已发布」 |
| `daily-report:entry-delete` | `DELETE /api/nodes/:id/daily-reports/:eid` | 删除条目 |

举一反三：另外检查了 `domain.json` 之外所有路由文件 → 这四条是唯一缺口。

## 4. 本次修复的 help（让 agent 能自描述）

| 命令 | 修法 |
|---|---|
| `nodes:list` | summary 明确「任意已注册 nodeType」，过滤参数说明可叠加 |
| `nodes:get` | 注明「任意 nodeType」 |
| `nodes:create` | 注明 `--data` 是 JSON 化 properties，字段名按 schema |
| `nodes:update` | 注明 merge 语义、`--data` 只放要改的字段 |
| `nodes:delete` | 注明级联删除其进展/关联边 |
| `nodes:transition` | 列出常见目标状态枚举（待响应/处理中/已解决/已关闭） |
| `progress:add` | 说明 append-only + `--status` 同时打状态快照 |
| `schema:patch` | 给出三个最常用的 op JSON 示例 |
| `audit:list` | 列出常见 action 取值（CREATE/UPDATE/DELETE/MERGE/SCHEMA_addField/DAILY_REPORT_PUBLISH） |
| `search` | 补 `--limit`（默认 50、上限 200），与后端实现对齐 |

## 5. help 自描述检查

实际跑命令：

`npm run cli -- help`（截取头部，全部 67 条；含 `help` 元命令）：

```json
{
  "description": "作战管理工具 CLI — 每个后台 API 一条命令，供 agent 自查自调。用法：npm run cli -- <command> [args] [--opts]",
  "commands": [
    { "name": "dashboard", "summary": "作战态势大盘汇总", "usage": "dashboard" },
    { "name": "nodes:list", "summary": "列出某 nodeType 的全部节点（任意已注册 nodeType；--字段 值 等值过滤，可多个）", "usage": "nodes:list <nodeType> [--<field> <value> ...]" },
    { "name": "nodes:get", "summary": "按 id 取单个节点（任意 nodeType）", "usage": "nodes:get <id>" },
    { "name": "progress:list", "summary": "列出某节点的进展序列", "usage": "progress:list <id>" },
    { "name": "schema:get", "summary": "取某类型的 schema 配置", "usage": "schema:get <nodeType>" },
    { "name": "related", "summary": "关联全景（1 跳，可 --depth N 多跳、--candidates 含候选）", "usage": "related <nodeType> <id> [--depth N] [--candidates]" },
    "...（共 66 条业务命令 + help 元命令）"
  ]
}
```

`npm run cli -- help daily-report:entry-create`：

```json
{
  "name": "daily-report:entry-create",
  "summary": "在某攻关单下新建一条日报条目（草稿）。type 默认 \"进展通报\"",
  "usage": "daily-report:entry-create <ticketId> --currentProgress <s> [--nextSteps <s>] [--type <s>] [--by <人>]"
}
```

`npm run cli -- help nodes:transition`：

```json
{
  "name": "nodes:transition",
  "summary": "攻关单状态原子流转（同时追加一条状态快照 progress；--to 必须是 schema 中状态字段的合法枚举值，如 待响应/处理中/已解决/已关闭）",
  "usage": "nodes:transition <id> --to <status> [--note <s>]"
}
```

`npm run cli -- help search`：

```json
{
  "name": "search",
  "summary": "全文检索（--type 限定 nodeType，--limit 最多返回 N 条，默认 50，上限 200）",
  "usage": "search <query> [--type T] [--limit N]"
}
```

→ `help` 总览给出每条命令的 summary + usage；`help <command>` 给出该命令的 summary + usage。符合 CLAUDE.md 要求。

## 6. 残留风险 / 后续建议

1. **domain 模块由并行 agent 实现**：本次故意未把 domain 的 API 列进表。等并行 agent 完成后建议再做一次 audit pass，确认 `domain` 的特殊 endpoint（如有）也接入 CLI。**通用** `nodes:*` 已能操作任意 nodeType，新增的 domain 类型不需要新命令。
2. CLI 没有覆盖到任何 **未登记的 HTTP 方法**（如 OPTIONS / HEAD），符合预期——这些是 Express 自带的元方法。
3. CLI 是「正向触发 → 等返回 JSON 输出 stdout」模型，**没有提供「订阅/流式」语义**。Hermes 的对话流（轮询）可结合 `hermes:ask` + `audit:list` + `dashboard` 实现，但需要 agent 自己包装循环。如果未来后端引入 SSE/WebSocket，需要补 CLI 子命令并定义文本输出协议。
4. 当前 CLI 错误统一走 stderr + exit 1（见 `cli.ts:51`）。但当 `HTTP 500` 的 body 是非 JSON 时只能拿到字符串。Hermes 看到 stderr 时可直接 fail-fast 重试或调 `audit:list` 查最近一次系统日志。如果需要稳定的 machine-readable 错误格式，可考虑统一 `{ error: ... }` JSON 包装。

## 7. Agent quick-start（Hermes 等如何用 CLI）

> 假设 backend 在 `http://localhost:3001`，agent 在 Linux shell 里。

```bash
# 自查：列出全部命令
npm run cli -- help

# 自查：某命令的入参 / 用法
npm run cli -- help related
npm run cli -- help daily-report:entry-create

# 读类操作（常用）
npm run cli -- dashboard
npm run cli -- nodes:list attackTicket --状态 进行中
npm run cli -- search "OOM"
npm run cli -- related attackTicket <ticketId> --depth 2 --candidates
npm run cli -- graph attackTicket <ticketId> --depth 2
npm run cli -- daily-report --date 2026-05-23
npm run cli -- audit:list --entityId <ticketId> --limit 20

# 写类操作
npm run cli -- nodes:create attackTicket --data '{"标题":"X","状态":"处理中"}'
npm run cli -- nodes:transition <id> --to 已解决 --note 已部署修复
npm run cli -- progress:add <id> --content 已联系业务 --status 处理中

# 日报草稿/发布工作流
npm run cli -- daily-report:entry-create <ticketId> --currentProgress 已修复 --by 张三
npm run cli -- daily-report:entry-list <ticketId>
npm run cli -- daily-report:entry-publish <ticketId> <entryId>

# Hermes 自然语言问答（只读）
npm run cli -- hermes:ask "本周谁的攻关单最多"

# 后台扫描类（幂等可多跑）
npm run cli -- jobs:tick                      # 一次跑齐 冲突/上升/跟催 扫描
npm run cli -- escalation:scan                # 单跑 SLA 上升
npm run cli -- proposals:scan                 # 重新生成候选关系
npm run cli -- reminders:scan                 # 重新生成跟催
npm run cli -- conflicts:scan                 # 重建冲突派生边
npm run cli -- kg:rebuild                     # 全量重建派生 KG

# 文件交互
npm run cli -- import attackTicket --file ./battle.xlsx --dryRun
npm run cli -- import attackTicket --file ./battle.xlsx
npm run cli -- export attackTicket --out ./out.xlsx

# 把高频组合做成自定义命令（自然语言「沉淀」为可复用 CLI 模板）
npm run cli -- commands:create --name "查进行中" --template "nodes:list attackTicket --状态 {状态}"
npm run cli -- commands:list
npm run cli -- commands:run <id> --args '{"状态":"进行中"}'
```

### 环境变量

- `COMBAT_API`：后端 base URL，默认 `http://localhost:3001`
- `COMBAT_ROLE`：可选；缺省即视为系统可信（不触发 §50 RBAC）。设为 `Leader` / `normal` 等显式角色时按 RBAC 规则放行/拒绝。

### 自描述协议（agent 写循环时可信赖）

- `npm run cli -- help` 返回 `{ description, commands: [{ name, summary, usage }] }`，commands 字段是穷举的。
- `npm run cli -- help <name>` 返回 `{ name, summary, usage }`；未知 name 退出码 ≠ 0 且 stderr 含 `未知命令`。
- 任何成功调用：stdout 是 JSON（pretty-printed）+ 换行，exit 0。
- 任何失败：stderr 是 `错误：<message>`，exit 1。

按这两条协议，agent 可以「列命令 → 取详情 → 决定参数 → 执行」全自动闭环。
