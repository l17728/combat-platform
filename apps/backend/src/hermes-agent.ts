import type { Repository, SchemaRegistry, HermesAnswer, HermesCitation, GraphNode } from "@combat/shared";
import type { DB } from "./db.js";

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
    p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"] ?? p["姓名"] ??
    p["贡献人"] ?? p["组名"] ?? p["name"] ?? n.id,
  );
}

function linkFor(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}

/** 数据字典 + a2 引用约定 + 问题。给 agent 一张"地图",数据由只读工具按需取。
 *  context: 调用方提供的上下文(如当前攻关单),让"本组/本单"等指代可解析。 */
export function buildHermesPrompt(registry: SchemaRegistry, question: string, context?: string): string {
  const dict = registry.getConfig().nodeTypes.map((ns) => {
    const fields = ns.fields
      .map((f) => (f.enumValues && f.enumValues.length ? `${f.name}(枚举:${f.enumValues.join("/")})` : f.name))
      .join(", ");
    return `- ${ns.nodeType}「${ns.label}」: ${fields}`;
  }).join("\n");

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
    "   WELINK_CITATIONS: [{\"messageId\":\"<welink 原 id>\",\"brief\":\"前 30 字摘要\"}]",
    "   答案正文里也要用 [YYYY-MM-DD HH:MM] 格式标注每条引用消息发生时间。",
    ...(context ? ["", `当前上下文:${context}`] : []),
    "",
    `问题:${question}`,
  ].join("\n");
}

const CITE_RE = /CITATIONS\s*[:：]\s*(.*)$/im;
const WELINK_CITE_RE = /WELINK_CITATIONS\s*[:：]\s*(\[[\s\S]*?\])/i;

export interface WelinkCiteHint { messageId: string; brief?: string }

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
    } catch { /* 解析失败,welinkHints 保持空 */ }
    body = body.slice(0, wm.index) + body.slice(wm.index + wm[0].length);
  }
  // 2) 再抽 CITATIONS
  const m = body.match(CITE_RE);
  if (!m || m.index === undefined) return { answer: body.trim(), citedIds: [], welinkHints };
  const answer = body.slice(0, m.index).trim();
  const raw = m[1].trim();
  const citedIds = (raw === "" || raw === "空" || raw === "无")
    ? []
    : raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  return { answer, citedIds, welinkHints };
}

/**
 * a2 + 防幻觉:逐个回查节点,只有真实存在的 ID 才回填成 citation。
 * agent 编造的 ID 在此被静默丢弃,保证引用永远指向真实记录。
 */
export function buildCitations(repo: Repository, citedIds: string[]): HermesCitation[] {
  const seen = new Set<string>();
  const out: HermesCitation[] = [];
  for (const id of citedIds) {
    if (seen.has(id)) continue;
    const n = repo.getNode(id);
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
  ticketIdHint?: string,
): HermesCitation[] {
  if (!db || hints.length === 0) return [];
  const seen = new Set<string>();
  const out: HermesCitation[] = [];
  const stmtByTicket = db.prepare(
    "SELECT id, ticket_id, message_id, sent_at, author, content FROM welink_messages WHERE ticket_id = ? AND message_id = ? AND deleted_at IS NULL LIMIT 1",
  );
  const stmtAny = db.prepare(
    "SELECT id, ticket_id, message_id, sent_at, author, content FROM welink_messages WHERE message_id = ? AND deleted_at IS NULL LIMIT 1",
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
  db?: DB,
): Promise<HermesAnswer> {
  const prompt = buildHermesPrompt(registry, question, context);
  const text = await runner.run(prompt);
  const { answer, citedIds, welinkHints } = parseAgentOutput(text);
  const nodeCitations = buildCitations(repo, citedIds);
  const ticketIdHint = extractTicketIdHint(context);
  const welinkCitations = buildWelinkCitations(db, welinkHints, ticketIdHint);
  return {
    question,
    intent: "agent",
    answer: answer || "未找到相关记录。",
    citations: [...nodeCitations, ...welinkCitations],
  };
}
