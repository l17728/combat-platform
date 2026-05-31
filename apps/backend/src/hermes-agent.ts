import type {
  Repository,
  SchemaRegistry,
  HermesAnswer,
  HermesCitation,
  GraphNode,
  HermesToolTrace,
} from "@combat/shared";
import type { DB } from "./db.js";
import { TOOL_SCHEMAS, callTool as defaultCallTool, type ToolCtx, type ToolSchema } from "./hermes-tools-mock.js";

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
    "4. 「攻关成员/攻关组长」等优先读结构化字段(getContext);若问及组员名单等非结构化信息,",
    "   可用 hermes_ticketTabs(ticketId) 读该攻关单的自定义笔记标签 MD 文档。",
    "5. 回答正文之后另起一行输出你据以作答的真实节点 ID,格式:",
    "   CITATIONS: <id1>, <id2>   (没有可引用记录时输出 CITATIONS: 空)",
    "6. 若答案是从 hermes_welinkSearch / hermes_welinkTimeline 的群消息里得到的(场景 3),",
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
  /** 覆盖工具列表(默认 TOOL_SCHEMAS) */
  tools?: ToolSchema[];
  /** 覆盖执行器(默认 mock callTool;集成期切换 hermes-tools.callTool) */
  executor?: ToolExecutor;
  /** 调试覆盖跳数上限(默认读 MAX_TOOL_HOPS) */
  maxHops?: number;
}

export interface RunToolCallingResult {
  content: string;
  trace: HermesToolTrace[];
}

function buildToolSystemPrompt(registry: SchemaRegistry, context?: string): string {
  const dict = registry
    .getConfig()
    .nodeTypes.map((ns) => `- ${ns.nodeType}「${ns.label}」`)
    .join("\n");
  return [
    "你是作战管理系统的只读问答助手 Hermes。你可调用工具查询真实数据。",
    "",
    "可查询的数据类型(精简清单,完整字段用 describe_node_type 取):",
    dict,
    "",
    "工作规则:",
    "1. 优先用工具核对事实,严禁编造记录、字段或 ID;答不出来就如实说「未找到相关记录」。",
    "2. 工具返回若含 `_truncated:true` 表示已截断,请缩小范围或加 filter 再查。",
    "3. 用简体中文回答,简洁直接。",
    "4. 回答正文之后另起一行输出真实节点 ID,格式:CITATIONS: <id1>, <id2> (无引用时输出 CITATIONS: 空)。",
    ...(context ? ["", `当前上下文:${context}`] : []),
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
        raw = await executor(tc.name, tc.arguments ?? {}, opts.ctx ?? {});
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
  opts?: { executor?: ToolExecutor; tools?: ToolSchema[]; maxHops?: number }
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
