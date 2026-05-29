import type { Repository, SchemaRegistry, HermesAnswer, HermesCitation, GraphNode } from "@combat/shared";

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
    ...(context ? ["", `当前上下文:${context}`] : []),
    "",
    `问题:${question}`,
  ].join("\n");
}

const CITE_RE = /CITATIONS\s*[:：]\s*(.*)$/im;

/** 从 agent 文本里拆出答案正文与其申明的引用 ID(a2)。 */
export function parseAgentOutput(text: string): { answer: string; citedIds: string[] } {
  const m = text.match(CITE_RE);
  if (!m || m.index === undefined) return { answer: text.trim(), citedIds: [] };
  const answer = text.slice(0, m.index).trim();
  const raw = m[1].trim();
  const citedIds = (raw === "" || raw === "空" || raw === "无")
    ? []
    : raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  return { answer, citedIds };
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

/** 编排一次 agent 问答,产出与规则引擎同契约的 HermesAnswer。 */
export async function answerWithAgent(
  repo: Repository,
  registry: SchemaRegistry,
  question: string,
  runner: AgentRunner,
  context?: string,
): Promise<HermesAnswer> {
  const prompt = buildHermesPrompt(registry, question, context);
  const text = await runner.run(prompt);
  const { answer, citedIds } = parseAgentOutput(text);
  const citations = buildCitations(repo, citedIds);
  return { question, intent: "agent", answer: answer || "未找到相关记录。", citations };
}
