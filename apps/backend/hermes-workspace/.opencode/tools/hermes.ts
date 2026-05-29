import { tool } from "@opencode-ai/plugin";

// Read-only data tools for the Hermes agent. They call the combat backend's
// existing read endpoints on localhost. Auth: optional Bearer from HERMES_TOKEN
// (set by the backend when it spawns opencode on prod); omitted locally under
// COMBAT_NO_AUTH. Read-only is guaranteed here — only GET wrappers exist.
const API = process.env.HERMES_API || "http://localhost:3001";
const TOKEN = process.env.HERMES_TOKEN || "";

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${API}/api${path}`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) return { error: `HTTP ${res.status}`, path };
  return res.json();
}

// 一步到位检索:search + context 合并,把多轮工具往返压成一次。多数问答一次即可作答。
export const lookup = tool({
  description:
    "一步检索作战管理系统。按关键词(问题单号、攻关单标题片段、人名等)搜索,并直接返回最匹配的若干条记录的" +
    "完整字段(node)、近期进展(progress)、关联关系(related),以及命中的真实节点 id。多数问题一次调用即可作答。",
  args: {
    q: tool.schema.string().describe("检索关键词"),
    limit: tool.schema.number().optional().describe("展开详情的最大记录数,默认 3"),
  },
  async execute(args) {
    const hitsRaw = await getJson(`/query/search?q=${encodeURIComponent(args.q)}&limit=20`);
    const hits = Array.isArray(hitsRaw) ? hitsRaw : [];
    const top = hits.slice(0, Math.max(1, Math.min(args.limit ?? 3, 5)));
    const matches: any[] = [];
    for (const h of top) {
      const ctx = await getJson(`/query/context/${encodeURIComponent(h.id)}`);
      matches.push({
        id: h.id,
        nodeType: h.nodeType,
        summary: h.summary,
        properties: ctx?.node?.properties ?? null,
        progress: Array.isArray(ctx?.progress) ? ctx.progress.slice(-5) : [],
        related: ctx?.related ?? null,
      });
    }
    return JSON.stringify({ matches, totalHits: hits.length });
  },
});

export const recommendHelpers = tool({
  description: "对某个攻关单 id 推荐合适的帮手(基于贡献记录、共享问题单等),返回候选人员与推荐理由。",
  args: { ticketId: tool.schema.string().describe("攻关单节点 id(来自 lookup 结果)") },
  async execute(args) {
    return JSON.stringify(await getJson(`/recommend/helpers/${encodeURIComponent(args.ticketId)}`));
  },
});

// 读攻关单的自定义笔记标签(MD 文档),用于组员名单、排查记录等非结构化信息。
export const ticketTabs = tool({
  description:
    "读取某攻关单下的自定义笔记标签(Markdown 文档)正文,如组员名单、排查记录等非结构化信息。" +
    "当问题涉及笔记里记录的内容(而非结构化字段)时使用。",
  args: { ticketId: tool.schema.string().describe("攻关单节点 id") },
  async execute(args) {
    const tabs = await getJson(`/tickets/${encodeURIComponent(args.ticketId)}/tabs`);
    const out = (Array.isArray(tabs) ? tabs : [])
      .filter((t: any) => t?.tabType === "custom")
      .map((t: any) => {
        let text = String(t?.content ?? "");
        try {
          const blocks = JSON.parse(text);
          if (Array.isArray(blocks)) text = blocks.map((b: any) => String(b?.content ?? "")).join("\n").trim();
        } catch { /* content 非 JSON,原样作为 MD */ }
        return { title: t?.title ?? "", content: text };
      });
    return JSON.stringify(out);
  },
});
