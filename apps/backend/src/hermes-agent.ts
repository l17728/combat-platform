import type {
  Repository,
  SchemaRegistry,
  HermesAnswer,
  HermesCitation,
  GraphNode,
  HermesToolTrace,
} from "@combat/shared";
import type { DB } from "./db.js";
import { TOOL_SCHEMAS, callToolUnwrap as defaultCallTool, type ToolCtx, type ToolSchema } from "./hermes-tools.js";

/**
 * Hermes 的"agent"实现层。Hermes 是"用 agent 做只读问答"这一稳定概念,
 * AgentRunner 是可替换的具体 agent(opencode)。本模块只负责确定性的编排:
 * 构造提示(数据字典 + a2 引用约定)→ 跑 agent → 解析答案与引用 ID →
 * 按 ID 回查节点做 a2 校验(防幻觉:不存在的 ID 一律丢弃)→ 组装 HermesAnswer。
 */
export interface AgentRunner {
  /** 接收完整提示,返回 agent 的最终文本输出(由具体实现负责解析底层协议)。 */
  run(prompt: string): Promise<string>;
}

function summarize(n: GraphNode): string {
  const p = n.properties;
  return String(
    p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"] ?? p["姓名"] ?? p["贡献人"] ?? p["组名"] ?? p["name"] ?? n.id
  );
}

function linkFor(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}

/** 数据字典 + a2 引用约定 + 问题。给 agent 一张"地图",数据由只读工具按需取。
 *  context: 调用方提供的上下文(如当前攻关单),让"本组/本单"等指代可解析。 */
export function buildHermesPrompt(registry: SchemaRegistry, question: string, context?: string): string {
  const dict = registry
    .getConfig()
    .nodeTypes.map((ns) => {
      const fields = ns.fields
        .map((f) => (f.enumValues && f.enumValues.length ? `${f.name}(枚举:${f.enumValues.join("/")})` : f.name))
        .join(", ");
      return `- ${ns.nodeType}「${ns.label}」: ${fields}`;
    })
    .join("\n");

  return [
    "你是作战管理系统的只读问答助手 Hermes。",
    "",
    "可查询的数据类型与字段(数据字典):",
    dict,
    "",
    "规则:",
    "1. 只能通过提供的只读工具查询真实数据,严禁编造记录、字段或 ID。",
    "2. 查不到就如实回答「未找到相关记录」,不要杜撰。",
    "3. 用简体中文回答,简洁直接。",
    "4. filter 的 key 必须用数据字典中的中文属性名(如「状态」「姓名」「事件级别」),",
    "   value 必须用中文枚举值(如「已关闭」「处理中」「P1」),绝不能用英文翻译。",
    '   例: 查已关闭攻关单 → filter: {"状态": "已关闭"} 而非 {"status": "closed"}。',
    "5. 「攻关成员/攻关组长」等优先读结构化字段(getContext);若问及组员名单等非结构化信息,",
    "   可用 hermes_ticketTabs(ticketId) 读该攻关单的自定义笔记标签 MD 文档。",
    "6. 回答正文之后另起一行输出你据以作答的真实节点 ID,格式:",
    "   CITATIONS: <id1>, <id2>   (没有可引用记录时输出 CITATIONS: 空)",
    "7. 若答案是从 hermes_welinkSearch / hermes_welinkTimeline 的群消息里得到的(场景 3),",
    "   除 CITATIONS 行之外再追加一行 JSON 数组,标记每条群消息引用,格式:",
    '   WELINK_CITATIONS: [{"messageId":"<welink 原 id>","brief":"前 30 字摘要"}]',
    "   答案正文里也要用 [YYYY-MM-DD HH:MM] 格式标注每条引用消息发生时间。",
    ...(context ? ["", `当前上下文:${context}`] : []),
    "",
    `问题:${question}`,
  ].join("\n");
}

const CITE_RE = /CITATIONS\s*[:：]\s*(.*)$/im;
const WELINK_CITE_RE = /WELINK_CITATIONS\s*[:：]\s*(\[[\s\S]*?\])/i;

export interface WelinkCiteHint {
  messageId: string;
  brief?: string;
}

/** 从 agent 文本里拆出答案正文 / 节点 ID 引用 / Welink 消息引用提示(场景 3)。 */
export function parseAgentOutput(text: string): {
  answer: string;
  citedIds: string[];
  welinkHints: WelinkCiteHint[];
} {
  // 1) 先抽 WELINK_CITATIONS(它在 CITATIONS 之后,先切掉避免污染答案)
  let body = text;
  const welinkHints: WelinkCiteHint[] = [];
  const wm = body.match(WELINK_CITE_RE);
  if (wm && wm.index !== undefined) {
    try {
      const arr = JSON.parse(wm[1]);
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const mid = String(it?.messageId ?? "").trim();
          if (mid) welinkHints.push({ messageId: mid, brief: it?.brief ? String(it.brief) : undefined });
        }
      }
    } catch {
      /* 解析失败,welinkHints 保持空 */
    }
    body = body.slice(0, wm.index) + body.slice(wm.index + wm[0].length);
  }
  // 2) 再抽 CITATIONS
  const m = body.match(CITE_RE);
  if (!m || m.index === undefined) return { answer: body.trim(), citedIds: [], welinkHints };
  const answer = body.slice(0, m.index).trim();
  const raw = m[1].trim();
  const citedIds =
    raw === "" || raw === "空" || raw === "无"
      ? []
      : raw
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
  return { answer, citedIds, welinkHints };
}

/**
 * a2 + 防幻觉:逐个回查节点,只有真实存在的 ID 才回填成 citation。
 * agent 编造的 ID 在此被静默丢弃,保证引用永远指向真实记录。
 */
export async function buildCitations(repo: Repository, citedIds: string[]): Promise<HermesCitation[]> {
  const seen = new Set<string>();
  const out: HermesCitation[] = [];
  for (const id of citedIds) {
    if (seen.has(id)) continue;
    const n = await repo.getNode(id);
    if (!n) continue;
    seen.add(id);
    out.push({ nodeId: n.id, nodeType: n.nodeType, summary: summarize(n), link: linkFor(n) });
  }
  return out;
}

/**
 * 把 agent 给的 welink messageId 回查 DB,只有真实存在的消息才能成为 citation。
 * 防止 agent 编 messageId — 前端跳转的锚点必须可达。
 * - db: welink 消息存储 DB(可选;无 db 则直接丢弃所有 welink 引用)
 * - ticketIdHint: 从 context 解析出的当前攻关单 id(用于优先用 ticket 维度查;无则全库查)
 */
export function buildWelinkCitations(
  db: DB | undefined,
  hints: WelinkCiteHint[],
  ticketIdHint?: string
): HermesCitation[] {
  if (!db || hints.length === 0) return [];
  const seen = new Set<string>();
  const out: HermesCitation[] = [];
  const stmtByTicket = db.prepare(
    "SELECT id, ticket_id, message_id, sent_at, author, content FROM welink_messages WHERE ticket_id = ? AND message_id = ? AND deleted_at IS NULL LIMIT 1"
  );
  const stmtAny = db.prepare(
    "SELECT id, ticket_id, message_id, sent_at, author, content FROM welink_messages WHERE message_id = ? AND deleted_at IS NULL LIMIT 1"
  );
  for (const h of hints) {
    const key = `${ticketIdHint || "*"}:${h.messageId}`;
    if (seen.has(key)) continue;
    let row: any = null;
    if (ticketIdHint) row = stmtByTicket.get(ticketIdHint, h.messageId);
    if (!row) row = stmtAny.get(h.messageId);
    if (!row) continue;
    seen.add(key);
    const brief = h.brief ? h.brief.slice(0, 60) : String(row.content || "").slice(0, 60);
    out.push({
      nodeId: `welink:${row.id}`,
      nodeType: "welinkMessage",
      summary: `${row.author} · ${String(row.sent_at).slice(0, 16).replace("T", " ")}${brief ? " · " + brief : ""}`,
      link: `/attack/${row.ticket_id}?tab=welink&welinkMsg=${encodeURIComponent(row.message_id)}`,
      kind: "welink",
      messageId: String(row.message_id),
      ticketId: String(row.ticket_id),
    });
  }
  return out;
}

const TICKET_ID_HINT_RE = /(?:ticketId|攻关单\s*id|ticket\s*id)\s*[=:：]\s*([a-zA-Z0-9-]+)/i;

function extractTicketIdHint(context?: string): string | undefined {
  if (!context) return undefined;
  const m = context.match(TICKET_ID_HINT_RE);
  return m ? m[1] : undefined;
}

/** 编排一次 agent 问答,产出与规则引擎同契约的 HermesAnswer。 */
export async function answerWithAgent(
  repo: Repository,
  registry: SchemaRegistry,
  question: string,
  runner: AgentRunner,
  context?: string,
  db?: DB
): Promise<HermesAnswer> {
  const prompt = buildHermesPrompt(registry, question, context);
  const text = await runner.run(prompt);
  const { answer, citedIds, welinkHints } = parseAgentOutput(text);
  const nodeCitations = await buildCitations(repo, citedIds);
  const ticketIdHint = extractTicketIdHint(context);
  const welinkCitations = buildWelinkCitations(db, welinkHints, ticketIdHint);
  return {
    question,
    intent: "agent",
    answer: answer || "未找到相关记录。",
    citations: [...nodeCitations, ...welinkCitations],
    engine: "agent",
  };
}

// ===================================================================
// §v2.5: Tool-calling agent (OpenAI-compatible protocol)
// -------------------------------------------------------------------
// 设计要点:
// 1. 多轮: LLM 返回 tool_calls → 本地执行 callTool() → 把结果 role:'tool' 推回
//    messages → 再问 LLM,直到拿到 content 或 hop 顶。
// 2. 硬上限:
//    - MAX_TOOL_HOPS = 6 (env HERMES_MAX_TOOL_HOPS)
//    - 单工具输出 32KB (env HERMES_TOOL_RESULT_MAX_BYTES) 截断,注入 {_truncated:true}
//    - messages 累计 80KB (env HERMES_CONTEXT_MAX_BYTES) 触发"折叠":
//      早期 tool result 改写为 {summary:'<previous tool call N>', nodeIds?, count?}
// 3. trace 协议: 每次 tool 调用记录 {tool, input, outputSize, ms, error?, _truncated?},
//    最终透传给 HTTP 调用方,供前端 ToolTrace UI 与 r-trace-ui (桶 C) 使用。
// 4. 集成:开发期 import `./hermes-tools-mock.js`,集成期 (桶 D)整文件 import 换成
//    `./hermes-tools.js` 即可 — 函数签名/工具协议保持一致。
// ===================================================================

export const MAX_TOOL_HOPS = Math.max(1, Number(process.env.HERMES_MAX_TOOL_HOPS) || 6);
export const TOOL_RESULT_MAX_BYTES = Math.max(1024, Number(process.env.HERMES_TOOL_RESULT_MAX_BYTES) || 32 * 1024);
export const CONTEXT_MAX_BYTES = Math.max(8 * 1024, Number(process.env.HERMES_CONTEXT_MAX_BYTES) || 80 * 1024);

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 单轮 LLM 调用返回结构。要么有 content(终态),要么有 toolCalls(需要继续)。 */
export interface LlmTurnResult {
  content?: string;
  toolCalls?: LlmToolCall[];
}

/** OpenAI ChatCompletions-shaped 消息;运行期累加。 */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  /** assistant 触发 tool 时挂的 tool_calls 列表(便于 LLM 端识别 id 对齐) */
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  /** role:'tool' 时,对应 assistant.tool_calls[i].id */
  tool_call_id?: string;
  /** role:'tool' 时,对应工具名 */
  name?: string;
}

/** Tool-calling LLM runner — 必须接收 messages + tools,返回单轮 LlmTurnResult。 */
export interface ToolCallingRunner {
  chat(messages: LlmMessage[], tools: ToolSchema[]): Promise<LlmTurnResult>;
}

/** 工具执行器(便于测试注入)。生产用 hermes-tools-mock.callTool。 */
export type ToolExecutor = (name: string, input: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;

export interface RunToolCallingOptions {
  runner: ToolCallingRunner;
  registry: SchemaRegistry;
  question: string;
  context?: string;
  ctx?: ToolCtx;
  tools?: ToolSchema[];
  executor?: ToolExecutor;
  maxHops?: number;
  priorMessages?: LlmMessage[];
}

export interface RunToolCallingResult {
  content: string;
  trace: HermesToolTrace[];
}

/**
 * §v2.6: 完整的 Hermes 系统提示。原内容来自
 *   apps/backend/hermes-workspace/.opencode/agents/hermes.md
 * 现内联进 backend 源码,去掉对 opencode workspace 的依赖。
 *
 * 编排策略:
 *  - 前置:角色 + 工作规则 + a2 引用约定 + 场景 3 welink。
 *  - 中段:运行期注入的数据字典 + 上下文。
 *  - 字段细节用 describe_node_type / list_node_types 现取,不在 prompt 里 dump。
 */
export const HERMES_SYSTEM_PROMPT = [
  "你是作战管理系统的问答 + 协作助手 Hermes。绝大多数请求是只读问答;少数请求(用户明确指示)可以通过专用工具做攻关单成员维护。",
  "",
  "## 只读工具(回答用)",
  "",
  "1. `hermes_getContext(id)`:**当「当前上下文」已给出节点 id 时,首选这个**——一步直取节点全字段、关联、进展,**不要再用 lookup 关键词检索**(关键词常命中不到目标)。",
  "2. `hermes_lookup(q)`:按关键词检索(仅在 context 没有 id 时用)。一次调用即可作答,不要再追加多余的工具调用。",
  "3. `hermes_recommendHelpers`:对某攻关单 id 推荐帮手(仅在明确问「找谁帮忙」时用)。",
  "4. `hermes_ticketTabs`:读某攻关单的自定义笔记标签(MD 文档),如组员名单、排查记录等非结构化信息。「攻关成员/攻关组长」优先看 lookup 返回的结构化字段,缺失时再查笔记。",
  "5. `hermes_welinkSearch(ticketId, q)`:在某攻关单的 Welink 群消息里关键词搜索;用户问「群里谁说过 X」时用。",
  "6. `hermes_welinkTimeline(ticketId, limit?)`:按时间升序读取群消息时间线;用户问时间脉络时用。",
  "7. `hermes_gapAnalysis(ticketId)`:**当用户进入 Welink 场景、提到群消息/聊天/补成员/活跃 等关键字时,主动调本工具看是否有缺口**。返回未登记发言人列表,然后主动询问用户是否要加入。",
  "",
  "## 写工具(仅在用户明确指示时调用)",
  "",
  "8. `hermes_welinkAddMembers(ticketId, names[], role?)`:把姓名批量加入攻关单成员;典型触发用户原话「把 X、Y 加进来」、「除 Z 外都加进来」、「先把活跃发言的人都拉进成员」。",
  "   - 「除 Z 外都加进来」的处理:先调 `hermes_gapAnalysis` 拿活跃发言人,过滤掉 Z,再 `hermes_welinkAddMembers`。",
  "   - 默认 role=组员;只有用户明说「做组长」才传 「组长」。",
  "9. `hermes_welinkSetMemberRole(ticketId, name, role)`:改某成员角色;触发例「把张三设为组长」。",
  "10. `hermes_createEmailGroup(groupName, emails[], description?)`:建邮件群组;触发例「拉一个 xxx 邮件群」。",
  "11. `create_node(nodeType, properties, _confirm)`:创建新节点(人员/攻关单/贡献等)。触发例「帮我新建一个攻关单」「添加一个人员」。必须传 `_confirm:'yes'` 才执行。",
  "12. `update_node(id, properties, _confirm)`:更新节点字段。触发例「把这个攻关单的状态改为已解决」「更新张三的部门」。必须传 `_confirm:'yes'` 才执行。",
  "13. `add_progress(nodeId, content, _confirm)`:给攻关单追加进展。触发例「追加一条进展」「记录今天做了XXX」。必须传 `_confirm:'yes'` 才执行。",
  "- **所有写工具需要 admin/leader 角色,且参数必须包含 `_confirm:'yes'`。** 用户只说「帮我做X」不算确认——你需要在回答中先描述操作,再调用工具并附带 `_confirm:'yes'`。",
  "",
  "## 通用规则",
  "",
  "1. 严禁编造记录、字段或 ID。查不到就如实回答「未找到相关记录」。",
  "2. 拿到 lookup 结果后**优先直接据此组织答案**;若结构化字段已能回答,**不要再追加 ticketTabs 或其它工具**——多调一次工具就多 50s+。",
  "3. 若提供了「当前上下文(攻关单)」,「本组/本单/这个攻关」等指代即指该攻关单,用其 id 调工具。",
  "4. 用简体中文、简洁直接地回答。",
  "5. 工具返回若含 `_truncated:true` 表示已截断,请缩小范围或加 filter 再查。",
  "6. 回答正文之后必须另起一行输出你据以作答的真实节点 id,格式:`CITATIONS: <id1>, <id2>`。没有可引用记录时输出:`CITATIONS: 空`。",
  "",
  "## 审计追溯类问题(优先 get_audit,不要让用户澄清)",
  "",
  "- 用户问「X 改过哪些」「X 干过什么」「X 最近改了啥」「X 操作过哪些表/单据」等审计追溯类问题 → **直接调 `get_audit(actor='X', limit=20)`**,不要先反问用户「您是指哪一类记录」。",
  "- 哪怕用户名疑似拼写错误(例如「amind」「admni」「张三 」),**仍然尝试用原样 actor 调 get_audit**;查不到再如实回答「未找到 X 的操作记录」。常见做法:把空格 trim 掉,其它字符保持原样。",
  "- 同理「最近做了什么动作 / 谁创建了 Y」也走 `get_audit(action=..., entityId=...)`,不要去翻 query_nodes。",
  "- get_audit 返回数组后,按时间倒序简要列出最新几条:动作类型(CREATE/UPDATE/DELETE 等)+ 实体类型 + 实体名 + 时间。",
  "",
  "## 场景 3 — Welink 群消息问答带溯源",
  "",
  "当用户问到「谁说过 X」「谁最早提到 Y」「小王是几号介入的」「第一个认领 OOM 的是谁」等**群消息相关问题**时:",
  "",
  "1. **优先调用** `hermes_welinkSearch(ticketId, q)` 或 `hermes_welinkTimeline(ticketId, limit?)` 取消息。",
  "2. 答案正文里每引用一条消息,标注 `[YYYY-MM-DD HH:MM]` 时间(从消息的 sentAt 取);例:「陈挺 于 [2026-05-29 10:22] 提到 OOM」。",
  "3. 除标准 `CITATIONS` 行之外,**再追加一行 JSON 数组**列出每条引用的 welink 消息,格式:",
  "",
  '   `WELINK_CITATIONS: [{"messageId":"<welink 原 id,即工具返回的 messageId 字段>","brief":"前 30 字摘要"}]`',
  "",
  "   - `messageId` 必须是工具返回里出现过的真实 id(后端会回查校验,编造的会被丢弃)。",
  "   - `brief` 取消息内容前 30 字,方便前端 Tag 上预览。",
  "   - 没有 welink 引用就**不要输出** WELINK_CITATIONS 行(不要输出空数组)。",
  "",
  "## Welink 场景对话模式",
  "",
  "- 进入 Welink 场景的标志:用户提到「群」「聊天」「成员」「Welink」「活跃」「补齐」「漏掉」等关键字。",
  "- 行动顺序:",
  "  1. 当前上下文有 ticketId → 直接调 `hermes_gapAnalysis(ticketId)`。",
  "  2. 有 gap → 主动报告:「群里有 N 个活跃发言但未登记的人(列表);要把他们加进来吗?」",
  "  3. 无 gap → 简短回答「成员名单已覆盖所有活跃发言人」。",
  "  4. 用户回复「都加」「加 X、Y」「除 Z 外都加」→ 解析为 `hermes_welinkAddMembers` 调用。",
].join("\n");

function buildToolSystemPrompt(registry: SchemaRegistry, context?: string): string {
  const dict = registry
    .getConfig()
    .nodeTypes.map((ns) => `- ${ns.nodeType}「${ns.label}」`)
    .join("\n");
  return [
    HERMES_SYSTEM_PROMPT,
    "",
    "## 可查询的数据类型(精简清单,完整字段用 describe_node_type 取)",
    "",
    dict,
    ...(context ? ["", `## 当前上下文`, "", context] : []),
  ].join("\n");
}

function byteLen(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** 把 unknown 转成 LLM 看的 string;超过上限截断,附 _truncated 标志(返回值附带元数据)。 */
function packToolResult(value: unknown): { text: string; size: number; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) text = "null";
  const size = byteLen(text);
  if (size <= TOOL_RESULT_MAX_BYTES) return { text, size, truncated: false };
  // 截断策略:保留前 (CAP - 元数据余量),拼上 _truncated 提示
  const head = text.slice(0, TOOL_RESULT_MAX_BYTES - 200);
  const wrapped = JSON.stringify({
    _truncated: true,
    note: "工具结果超过 32KB 上限,已截断;请加 filter 缩小范围。",
    head,
  });
  return { text: wrapped, size, truncated: true };
}

/** 估算 messages 总字节数(content + tool_calls.arguments)。 */
function messagesByteLen(messages: LlmMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.content) total += byteLen(m.content);
    if (m.tool_calls) {
      for (const tc of m.tool_calls) total += byteLen(tc.function.arguments);
    }
  }
  return total;
}

/**
 * 上下文折叠:若 messages 总字节数 > CONTEXT_MAX_BYTES,
 * 把"最早的若干个 tool result"折叠为 summary,保留 _truncated 提示与可能的 nodeIds/count 关键字段。
 * 保留最近 N 对 (assistant tool_call + tool result),早期的折叠。
 */
function foldContext(messages: LlmMessage[]): LlmMessage[] {
  if (messagesByteLen(messages) <= CONTEXT_MAX_BYTES) return messages;
  // 收集 tool message 的索引(role:'tool')
  const toolIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "tool") toolIdxs.push(i);
  if (toolIdxs.length <= 2) return messages; // 只剩 2 轮以内不折叠
  // 折叠:把前一半 tool message 改写为 summary(保留 size 元信息),保留最近 2 轮原貌
  const out = messages.slice();
  const keepLastN = 2;
  const foldUpto = toolIdxs[toolIdxs.length - keepLastN - 1];
  for (let i = 0; i <= foldUpto; i++) {
    if (out[i].role !== "tool") continue;
    const raw = out[i].content ?? "";
    let preview = "";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) preview = JSON.stringify({ summary: "previous tool result", count: parsed.length });
      else if (parsed && typeof parsed === "object") {
        const keys = Object.keys(parsed).slice(0, 3);
        preview = JSON.stringify({ summary: "previous tool result", keys });
      } else preview = JSON.stringify({ summary: "previous tool result" });
    } catch {
      preview = JSON.stringify({ summary: "previous tool result", chars: raw.length });
    }
    out[i] = { ...out[i], content: preview };
  }
  return out;
}

/**
 * 跑一遍 tool-calling 多轮编排,直到拿到 final content 或触顶。
 * 返回 final content + trace 列表。失败(超时/MAX/LLM 错)直接抛错,由上层 fallback。
 */
export async function runToolCalling(opts: RunToolCallingOptions): Promise<RunToolCallingResult> {
  const tools = opts.tools ?? TOOL_SCHEMAS;
  const executor = opts.executor ?? defaultCallTool;
  const maxHops = Math.max(1, opts.maxHops ?? MAX_TOOL_HOPS);
  const trace: HermesToolTrace[] = [];

  const messages: LlmMessage[] = [
    { role: "system", content: buildToolSystemPrompt(opts.registry, opts.context) },
    ...(opts.priorMessages ?? []),
    { role: "user", content: opts.question },
  ];

  for (let hop = 0; hop <= maxHops; hop++) {
    // 折叠上下文(防 token 爆)
    const folded = foldContext(messages);
    const turn = await opts.runner.chat(folded, tools);

    // 终态:LLM 直接给文本
    if (turn.content && (!turn.toolCalls || turn.toolCalls.length === 0)) {
      return { content: turn.content, trace };
    }

    // 触顶判断:已用完所有 hop 还在叫工具,直接报错(上层 fallback)
    if (hop >= maxHops) {
      const err = new Error("max_hops_exceeded");
      (err as Error & { code?: string }).code = "max_hops_exceeded";
      throw err;
    }

    if (!turn.toolCalls || turn.toolCalls.length === 0) {
      // 既没有 content 又没有 tool_calls — LLM 输出非法,当 final 空回答处理
      return { content: "", trace };
    }

    // 把 assistant.tool_calls 推入历史
    messages.push({
      role: "assistant",
      content: turn.content ?? "",
      tool_calls: turn.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      })),
    });

    // 依次执行 tool_calls,把结果以 role:'tool' 推回
    for (const tc of turn.toolCalls) {
      const start = Date.now();
      let raw: unknown;
      let error: string | undefined;
      try {
        raw = await executor(tc.name, tc.arguments ?? {}, opts.ctx ?? ({} as ToolCtx));
      } catch (e) {
        error = (e as Error).message;
        raw = { error };
      }
      const packed = packToolResult(raw);
      trace.push({
        tool: tc.name,
        input: tc.arguments ?? {},
        outputSize: packed.size,
        ms: Date.now() - start,
        error,
        ...(packed.truncated ? { _truncated: true } : {}),
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.name,
        content: packed.text,
      });
    }
  }
  // 理论不可达:循环结束未 return
  throw new Error("tool_calling_loop_exhausted");
}

/** 编排一次 tool-calling 问答,产出与 intent 引擎同契约的 HermesAnswer(engine='tool')。 */
export async function answerWithToolCalling(
  repo: Repository,
  registry: SchemaRegistry,
  question: string,
  runner: ToolCallingRunner,
  context?: string,
  db?: DB,
  opts?: { executor?: ToolExecutor; tools?: ToolSchema[]; maxHops?: number; priorMessages?: LlmMessage[] }
): Promise<HermesAnswer> {
  const { content, trace } = await runToolCalling({
    runner,
    registry,
    question,
    context,
    ctx: { repo, registry, db },
    executor: opts?.executor,
    tools: opts?.tools,
    maxHops: opts?.maxHops,
    priorMessages: opts?.priorMessages,
  });
  const { answer, citedIds, welinkHints } = parseAgentOutput(content);
  const nodeCitations = await buildCitations(repo, citedIds);
  const ticketIdHint = extractTicketIdHint(context);
  const welinkCitations = buildWelinkCitations(db, welinkHints, ticketIdHint);
  return {
    question,
    intent: "agent",
    answer: answer || "未找到相关记录。",
    citations: [...nodeCitations, ...welinkCitations],
    engine: "tool",
    trace,
  };
}
