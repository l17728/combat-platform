# Hermes 通用工具集 (v2.3.3/v2.3.4)

> Hermes 从 v2.3.1 的「intent 路由器」升级为「Tool-using Agent」。LLM 自决调哪个工具,而不是开发者硬编码 intent 正则。
> v2.3.4 起,LLM 通信走纯 fetch OpenAI 兼容协议,配置全部从 DB(UI 可改)读取,不再依赖 opencode SDK / 子进程。

## 架构 (v2.3.4)

```
用户问句
   ↓
HERMES_MODE = auto | tool | intent
   ↓
auto: 短问题 + 命中 intent 正则 → intent 路由 (旧 v2.3.1 路径,毫秒级)
      其他 → tool agent
tool: 强制走 tool agent
intent: 强制走 intent 路由
   ↓
[tool agent]
   OpenAICompatibleRunner (纯 fetch) → POST {baseURL}/chat/completions
     baseURL/apiKey/model/thinking 全部从 DB llm_settings 表实时读
     (admin 在前端 /llm-settings 改保存即生效,后端无需重启)
   ↓
   LLM 看 TOOL_SCHEMAS (OpenAI 兼容 tools)
   ↓
   返回 tool_calls → 本地调 callToolUnwrap(name, input, ctx) → 结果回填 messages
   ↓ (最多 MAX_TOOL_HOPS=6 轮,maxHops 也可在 UI 调)
   返回 content → 返回给前端 (含 trace 用于 UI 展示)
   失败 / 超 hop → 自动 fallback 到 intent 路由 (trace 标 fallback_reason)
```

> v2.3.4 起 backend **不再 spawn opencode 子进程**,也不再依赖 `@opencode-ai/sdk`。
> 全部走 OpenAI 兼容协议直接打 `POST {baseURL}/chat/completions`。这让切换 provider
> (智谱/华为云/自部 vLLM)只需在前端 UI 改 baseURL+model,不动代码、不重启服务。
> 旧的 `OpencodeAgentRunner`(SDK 路径)保留为 `HERMES_AGENT=1` 时的可选 fallback。

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

## LLM 配置 (v2.3.4 — UI 优先)

LLM 的 baseURL / apiKey / defaultModel / smallModel / thinking / maxHops / timeoutMs
**全部** 在前端「系统管理 → LLM 设置」(`/llm-settings`, admin only)配置,
保存到 DB `llm_settings` 表(apiKey AES-256-GCM 加密)。OpenAICompatibleRunner 通过
`getConfig` 钩子每次调用前重读,**保存即生效,无需重启 backend**。详见 [`./LLM_SETTINGS.md`](./LLM_SETTINGS.md)。

CLI 等价命令:

```bash
npm run cli -- llm:get
npm run cli -- llm:set --provider zhipuai-coding-plan --base-url https://open.bigmodel.cn/api/paas/v4 --api-key sk-... --model glm-4.6
npm run cli -- llm:test
```

下表的 env 仅用作 fallback(DB 无配置时回退使用),仍可用于初始部署引导:

| 变量                           | 默认                                   | 用途                                               |
| ------------------------------ | -------------------------------------- | -------------------------------------------------- |
| `HERMES_MODE`                  | `auto`                                 | `tool` / `intent` / `auto` 三模式                  |
| `HERMES_MAX_TOOL_HOPS`         | `6`                                    | 单次问答最多串多少工具调用(UI 也可调 maxHops)      |
| `HERMES_TOOL_RESULT_MAX_BYTES` | `32768`                                | 单工具出参上限                                     |
| `HERMES_CONTEXT_MAX_BYTES`     | `81920`                                | LLM messages 累积上限,超则折叠早期 tool result     |
| `HERMES_ENABLE_WRITE`          | `0`                                    | 写工具(create/update/delete)开关,默认禁用          |
| `HERMES_LLM_BASE_URL`          | `https://open.bigmodel.cn/api/paas/v4` | DB 未配时的 baseURL fallback                       |
| `HERMES_LLM_API_KEY`           | (无)                                   | DB 未配时的 apiKey fallback;**生产建议走 UI 配置** |
| `HERMES_MODEL`                 | `glm-4.6`                              | DB 未配时的 model fallback                         |
| `HERMES_AGENT`                 | `0`                                    | `1` 时启用旧 `OpencodeAgentRunner` SDK 路径(可选)  |
| `COMBAT_CRYPTO_KEY`            | (派生于 JWT_SECRET)                    | AES-256-GCM 加密 apiKey 用的根密钥                 |

## 评测 golden set (15 题)

`docs/V2.5_DESIGN.md §5`。集成阶段在 `apps/frontend-v2/e2e/hermes-golden-set.spec.ts` 跑现网,通过门槛 12/15。

典型题:

- 「有多少员工」→ `count_nodes(person)` (这是 v2.3.1 现网 bug 报告的真问题,fallback-search 命不中,工具时代直接命中)
- 「张三参加过哪些攻关」→ `search_text` + `traverse_graph`
- 「本月新增几条攻关单」→ `query_nodes(attackTicket, filter:{createdAt:{op:'gte',val:'2026-05-01'}})`
- 「admin 改过哪些 schema」→ `get_audit(actor:'admin', action:'SCHEMA_*')`
- 「处理中的高优单子」→ `query_nodes(attackTicket, filter:{状态:'处理中', 事件级别:{op:'in',val:['P0','P1']}})`

## v2.3.1 → v2.3.3 切换

| 项           | v2.3.1 (intent)             | v2.3.3 (tool)                       |
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

## v2.3.5 — 模型列表动态获取 + 审计追溯类问题指引

### GET /api/llm-settings/models endpoint

从 v2.3.5 起新增 `GET /api/llm-settings/models`(admin only),透传 provider 的 OpenAI 兼容 `/models` endpoint。前端「LLM 设置」页面的「刷新模型列表」按钮调本接口,把硬编码的 `PROVIDER_DEFAULTS.models` 替换成 provider 真实可用的列表。

**实现要点**:

- 凭据来源:DB `llm_settings` → env `HERMES_LLM_BASE_URL` / `HERMES_LLM_API_KEY` fallback
- 调 `${baseURL}/models`,15s 超时
- 兼容三种返回格式:`{data: [...]}` (OpenAI 标准) / 数组 / `{models: [...]}`
- 返回:`{models: [{id, owned_by?}]}` 或 `{error: 'HTTP 404: ...'}`(失败不抛 500,仅返结构化错误)
- 失败时前端降级为内置 PROVIDER_DEFAULTS.models + `message.warning`

**CLI 暂未提供** — UI 上的「刷新」按钮即可,CLI 场景里 provider 模型列表查找通常已有别的渠道。

### POST /api/llm-settings/test 的 env-fallback (v2.3.5)

`/test` 的凭据优先级链由 v2.3.4 的 `body → DB` 扩展为 `body → DB → env`:

- 新部署时 admin 还没存 DB,直接走 systemd Environment=HERMES_LLM_API_KEY 启动 → UI 一进「测试连接」就能验通
- 单测覆盖三条 fallback 路径

### Hermes prompt — 审计追溯类问题指引

SYSTEM_PROMPT 新增章节,LLM 应"直接调 `get_audit(actor='X')`,不要让用户澄清":

- 用户问「X 改过哪些 / 干过什么 / 操作过哪些」 → 直接 `get_audit`
- 用户名疑似拼写错误(`amind` / `admni`)仍尝试用原样 actor 调,查不到再如实回答
- get_audit 结果按时间倒序简要列出动作类型 + 实体 + 时间

golden set Q7 强化为「验证返回每条记录 performedBy === 'admin'」,15/15 通过。

### 默认 model — glm-4-flash

`apps/backend/src/app.ts` 三层 fallback 链最末端的默认 model 由 `glm-4.5-air` 改为 `glm-4-flash`(免费可用,无需余额),前端 `PROVIDER_DEFAULTS.zhipuai-coding-plan.defaultModel` 同步。
