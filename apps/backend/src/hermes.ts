import { Router } from "express";
import type { Repository, SchemaRegistry, HermesAnswer, HermesCitation, HermesIntent, GraphNode } from "@combat/shared";

const ACTIVE_STATUSES = new Set(["待响应", "处理中", "进行中"]);

function summarize(n: GraphNode): string {
  const p = n.properties;
  return String(p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"] ?? p["name"] ?? p["贡献人"] ?? p["key"] ?? n.id);
}
function linkFor(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
function cite(n: GraphNode): HermesCitation {
  return { nodeId: n.id, nodeType: n.nodeType, summary: summarize(n), link: linkFor(n) };
}

function findTicketsByPB(repo: Repository, pb: string): GraphNode[] {
  return repo.queryNodes("attackTicket").filter(n => String(n.properties["问题单号"] ?? "").trim() === pb);
}
function fuzzyTicketsByTitle(repo: Repository, hint: string): GraphNode[] {
  const needle = hint.trim().toLowerCase();
  if (!needle) return [];
  return repo.queryNodes("attackTicket").filter(n => {
    const t = String(n.properties["标题"] ?? "").toLowerCase();
    return t.includes(needle);
  });
}

/**
 * §35 Hermes rule-based intent engine. No LLM credentials needed —
 * each intent maps to existing read-only repository APIs and returns
 * Chinese text + citation list. The intent classification order is
 * deliberate (most specific → fallback search).
 */
export function answerQuestion(
  repo: Repository, registry: SchemaRegistry, raw: string,
): HermesAnswer {
  const question = raw.trim();
  const lower = question.toLowerCase();

  // 1) ticket-by-pb: explicit 问题单号 reference
  const pbMatch = question.match(/((?:pb[-_]?\d+)|(?:PB[-_]?\d+))/i)
    ?? question.match(/问题单号\s*[：:]\s*([A-Za-z0-9_-]+)/);
  if (pbMatch) {
    const pb = (pbMatch[1] ?? pbMatch[0]).toUpperCase().replace(/[_]/g, "-");
    const tickets = findTicketsByPB(repo, pb).slice(0, 10);
    if (tickets.length > 0) {
      const lines = tickets.map(t => `· ${summarize(t)}（状态：${t.properties["状态"] ?? "未知"}，负责人：${t.properties["当前处理人"] ?? "未填"}）`);
      return {
        question, intent: "ticket-by-pb",
        answer: `问题单 ${pb} 下找到 ${tickets.length} 个攻关单：\n${lines.join("\n")}`,
        citations: tickets.slice(0, 5).map(cite),
      };
    }
  }

  // 2) owner: 谁负责 / 谁在做 / owner
  if (/谁负责|谁在做|谁的|owner|负责人/i.test(lower)) {
    // strip the intent keywords + interrogatives, leaving a likely title fragment
    const stripped = question.replace(/[?？。，,!！谁负责在做的owner负责人是哪个]/gi, "").trim();
    const candidates = fuzzyTicketsByTitle(repo, stripped).slice(0, 5);
    if (candidates.length > 0) {
      const lines = candidates.map(t => `· 《${summarize(t)}》当前处理人：${t.properties["当前处理人"] ?? "未填"}（状态：${t.properties["状态"] ?? "未知"}）`);
      return {
        question, intent: "owner",
        answer: `按标题匹配到 ${candidates.length} 个攻关单：\n${lines.join("\n")}`,
        citations: candidates.map(cite),
      };
    }
  }

  // 3) status / 进展 / 现在怎么样
  if (/状态|进展|怎么样|现在/.test(question)) {
    const stripped = question.replace(/[?？。，,!！状态进展怎么样现在的是]/g, "").trim();
    const candidates = fuzzyTicketsByTitle(repo, stripped).slice(0, 3);
    if (candidates.length > 0) {
      const blocks = candidates.map(t => {
        const seq = repo.listProgress(t.id);
        const latest = seq.length > 0 ? seq[seq.length - 1] : null;
        const tail = latest ? `最新进展（${latest.statusSnapshot}）：${latest.content}` : "暂无进展记录";
        return `· 《${summarize(t)}》状态：${t.properties["状态"] ?? "未知"}\n  ${tail}`;
      });
      return {
        question, intent: "status",
        answer: blocks.join("\n"),
        citations: candidates.map(cite),
      };
    }
  }

  // 4) person-workload: 谁最忙 / 负载最重 / 活跃单最多
  if (/最忙|负载最重|活跃单最多|谁最重|工作量最多/.test(question)) {
    const byOwner = new Map<string, GraphNode[]>();
    for (const t of repo.queryNodes("attackTicket")) {
      const owner = String(t.properties["当前处理人"] ?? "").trim();
      const status = String(t.properties["状态"] ?? "").trim();
      if (!owner || !ACTIVE_STATUSES.has(status)) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(t);
    }
    const ranked = [...byOwner.entries()]
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      .slice(0, 5);
    if (ranked.length > 0) {
      const lines = ranked.map(([who, ts], i) => `${i + 1}. ${who}：${ts.length} 个活跃攻关单`);
      // top-1 person's tickets as citations
      const top = ranked[0]?.[1] ?? [];
      return {
        question, intent: "person-workload",
        answer: `当前活跃工作量排名（Top ${ranked.length}）：\n${lines.join("\n")}`,
        citations: top.slice(0, 5).map(cite),
      };
    }
  }

  // 5) fallback: full-text search across all nodeTypes
  const needle = question.toLowerCase();
  const hits: { node: GraphNode; score: number }[] = [];
  if (needle) {
    for (const nt of registry.getConfig().nodeTypes.map(n => n.nodeType)) {
      for (const n of repo.queryNodes(nt)) {
        const hay = Object.values(n.properties).map(v => String(v)).join(" ").toLowerCase();
        let score = 0, i = hay.indexOf(needle);
        while (i !== -1) { score++; i = hay.indexOf(needle, i + needle.length); }
        if (score > 0) hits.push({ node: n, score });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, 5);
  if (top.length > 0) {
    const lines = top.map(h => `· [${h.node.nodeType}] ${summarize(h.node)}`);
    return {
      question, intent: "fallback-search",
      answer: `按关键词检索到 ${top.length} 条相关记录：\n${lines.join("\n")}`,
      citations: top.map(h => cite(h.node)),
    };
  }

  return {
    question, intent: "fallback-search",
    answer: "暂未找到相关记录。可换关键词，或具体提及攻关单标题 / 问题单号 / 负责人。",
    citations: [],
  };
}

export function makeHermesRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/hermes/ask", (req, res) => {
    const q = String(req.body?.question ?? "").trim();
    if (!q) return res.status(400).json({ error: "question 必填" });
    res.json(answerQuestion(repo, registry, q));
  });
  return r;
}
