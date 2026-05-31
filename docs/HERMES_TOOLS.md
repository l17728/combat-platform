# Hermes 通用工具集 (v2.5)

> Hermes 从 v2.4 的「intent 路由器」升级为「Tool-using Agent」。LLM 自决调哪个工具,而不是开发者硬编码 intent 正则。

## 架构

```
用户问句
   ↓
HERMES_MODE = auto | tool | intent
   ↓
auto: 短问题 + 命中 intent 正则 → intent 路由 (旧 v2.4 路径,毫秒级)
      其他 → tool agent
tool: 强制走 tool agent
intent: 强制走 intent 路由
   ↓
[tool agent]
   LLM (opencode + glm) 看 TOOL_SCHEMAS
   ↓
   返回 tool_calls → 本地调 callToolUnwrap(name, input, ctx) → 结果回填 messages
   ↓ (最多 MAX_TOOL_HOPS=6 轮)
   返回 content → 返回给前端 (含 trace 用于 UI 展示)
   失败 / 超 hop → 自动 fallback 到 intent 路由 (trace 标 fallback_reason)
```

## 14 个工具

按 `docs/V2.5_DESIGN.md §2` 实现。`apps/backend/src/hermes-tools.ts::ALL_TOOLS`。

| #   | 工具                                                        | 用途                                    | 入参                                                   |
| --- | ----------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| 1   | `list_node_types`                                           | 列出所有 nodeType + 字段                | `{}`                                                   |
| 2   | `describe_node_type`                                        | 单类型完整 schema + sample              | `{nodeType}`                                           |
| 3   | `count_nodes`                                               | 计数                                    | `{nodeType, filter?}`                                  |
| 4   | `query_nodes`                                               | 列表                                    | `{nodeType, filter?, limit?, offset?, sort?}`          |
| 5   | `get_node`                                                  | 详情(含 progress 5 条 + related in/out) | `{id}`                                                 |
| 6   | `search_text`                                               | 全文检索                                | `{q, scope?, limit?}`                                  |
| 7   | `traverse_graph`                                            | 图遍历 (1-3 跳, ≤200 节点)              | `{startId, edgeTypes?, depth?}`                        |
| 8   | `get_progress`                                              | 进展时间线                              | `{nodeId, limit?}`                                     |
| 9   | `get_audit`                                                 | 审计历史                                | `{entityId?, actor?, action?, since?, until?, limit?}` |
| 10  | `aggregate`                                                 | 分组聚合 (count/sum/avg)                | `{nodeType, groupBy, agg?, filter?, having?}`          |
| 11  | `dashboard_metric`                                          | 预聚合指标                              | `{key}`                                                |
| 12  | `recommend_helpers`                                         | 找帮手推荐                              | `{ticketId}`                                           |
| 13  | `ticket_tabs`                                               | 攻关单动态标签                          | `{ticketId}`                                           |
| 14  | `welink_search` / `welink_timeline` / `welink_gap_analysis` | Welink 消息 (统一出口)                  | 各自参数                                               |

## 统一 filter DSL

```jsonc
{
  "状态": "处理中", // 简写等值
  "updatedAt": { "op": "gte", "val": "2026-05-01" }, // 时间窗
  "当前处理人": { "op": "in", "val": ["张三", "李四"] }, // 多值
  "标题": { "op": "like", "val": "%支付%" }, // 模糊
}
```

允许 op: `eq / ne / gt / gte / lt / lte / in / like`。

**安全收口**(`apps/backend/src/hermes-tools.ts::validateFilter`):

- 顶层字段白名单: `nodeType / id / createdAt / updatedAt`
- 其余走 `json_extract(properties, '$."<key>"')`
- key 正则 `/^[A-Za-z0-9_一-鿿]+$/` — 兼容中文,拒绝任何符号注入
- 所有 SQL 参数化,绝不拼接

## 私单收口

`nodeType === "attackTicket"` 的所有读工具(`query/count/aggregate/search/get_node/traverse/audit`)在返回前必经 `filterAccessibleTickets(rows, ctx.user)`。

- admin → 全部可见
- leader / normal → 仅"非私单 ∪ 私密授权列表包含 user.username"
- 单测覆盖:用户 A 私单对用户 B 在所有工具下都不可见

## 32KB 出参截断

`MAX_OUTPUT_BYTES = 32 * 1024`,`enforceSize(data)`:

- 数组:二分截尾找最大可容子集 → `{data: slice, _truncated: true}`
- 对象:整体置错信息 `{_error: "output exceeds 32KB", _byteSize}`
- LLM 看到 `_truncated: true` 知道结果不完整,可二次 `query` 翻页或缩窄 filter

## HTTP API

```
GET  /api/hermes/tools                    # 列工具
POST /api/hermes/tool/:name { input }     # 调用单个工具
POST /api/hermes/ask { question, mode? }  # LLM agent 问答 (返回 answer/citations/trace/engine)
```

全部走 `authMiddleware` + audit log。

## CLI (agent-operable)

```bash
npm run cli -- hermes:tools              # 列工具
npm run cli -- hermes:tool count_nodes --input '{"nodeType":"person"}'
```

## env 配置

| 变量                           | 默认    | 用途                                           |
| ------------------------------ | ------- | ---------------------------------------------- |
| `HERMES_MODE`                  | `auto`  | `tool` / `intent` / `auto` 三模式              |
| `HERMES_MAX_TOOL_HOPS`         | `6`     | 单次问答最多串多少工具调用                     |
| `HERMES_TOOL_RESULT_MAX_BYTES` | `32768` | 单工具出参上限                                 |
| `HERMES_CONTEXT_MAX_BYTES`     | `81920` | LLM messages 累积上限,超则折叠早期 tool result |
| `HERMES_ENABLE_WRITE`          | `0`     | 写工具(create/update/delete)开关,默认禁用      |

## 评测 golden set (15 题)

`docs/V2.5_DESIGN.md §5`。集成阶段在 `apps/frontend-v2/e2e/hermes-golden-set.spec.ts` 跑现网,通过门槛 12/15。

典型题:

- 「有多少员工」→ `count_nodes(person)` (这是 v2.4 现网 bug 报告的真问题,fallback-search 命不中,工具时代直接命中)
- 「张三参加过哪些攻关」→ `search_text` + `traverse_graph`
- 「本月新增几条攻关单」→ `query_nodes(attackTicket, filter:{createdAt:{op:'gte',val:'2026-05-01'}})`
- 「admin 改过哪些 schema」→ `get_audit(actor:'admin', action:'SCHEMA_*')`
- 「处理中的高优单子」→ `query_nodes(attackTicket, filter:{状态:'处理中', 事件级别:{op:'in',val:['P0','P1']}})`

## v2.4 → v2.5 切换

| 项           | v2.4 (intent)               | v2.5 (tool)                         |
| ------------ | --------------------------- | ----------------------------------- |
| "有多少员工" | fallback-search 空          | `count_nodes(person) → {count: 32}` |
| 新问题       | 加 intent 正则 + endpoint   | LLM 自动选工具,无需改代码           |
| 评测/调试    | 看 `hermes.ask.intent` 日志 | 看 trace.steps + UI 展开            |
| 写操作       | 不支持                      | env 开关支持 (默认禁)               |

## 集成层 (集成阶段切换点)

`apps/backend/src/hermes-agent.ts:10`:

```diff
- import { TOOL_SCHEMAS, callTool as defaultCallTool, type ToolCtx, type ToolSchema } from "./hermes-tools-mock.js";
+ import { TOOL_SCHEMAS, callToolUnwrap as defaultCallTool, type ToolCtx, type ToolSchema } from "./hermes-tools.js";
```

`hermes-tools.ts` 末尾的兼容层导出 `TOOL_SCHEMAS / ToolSchema / ToolCtx / callToolUnwrap` 给 agent;`callToolUnwrap` 拆解 `ToolResult{ok, data, error}` 为「成功返 data, 失败抛 Error」。
