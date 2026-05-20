import { Router } from "express";
import type { Repository, SchemaRegistry, HermesAnswer, HermesCitation, GraphNode } from "@combat/shared";
import { recommendHelpers } from "./recommend.js";

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

  // Helper: extract PB number from question (used by both ticket-by-pb and find-helpers)
  // Match PB-... (alphanumeric tail to support PB-FH-001 etc.) or explicit 问题单号 prefix
  const pbMatch = question.match(/(PB[-_]?[A-Z0-9][A-Z0-9_-]*)/i)
    ?? question.match(/问题单号\s*[：:]\s*([A-Za-z0-9_-]+)/);
  const pb = pbMatch ? (pbMatch[1] ?? pbMatch[0]).toUpperCase().replace(/_/g, "-") : "";

  // 1) find-helpers: 找谁帮忙 / 找帮手 / 谁能帮 (check before ticket-by-pb so a PB
  //    inside a "找谁帮忙" question goes to helpers, not the plain ticket listing)
  if (/找谁帮忙|找帮手|谁能帮/.test(question)) {
    let ticket: GraphNode | undefined;
    if (pb) ticket = findTicketsByPB(repo, pb)[0];
    if (!ticket) {
      const stripped = question.replace(/[?？。，,!！找谁帮忙帮手能帮的]/g, "").replace(pb, "").trim();
      ticket = fuzzyTicketsByTitle(repo, stripped)[0];
    }
    if (!ticket) {
      return { question, intent: "find-helpers",
        answer: "未定位到具体攻关单。请补充问题单号（如 PB-123）或攻关单标题片段。",
        citations: [] };
    }
    const helpers = recommendHelpers(repo, ticket.id, 5);
    if (helpers.length === 0) {
      return { question, intent: "find-helpers",
        answer: `攻关单《${summarize(ticket)}》暂未找到合适帮手。可考虑补充共享问题单号或贡献记录后再问。`,
        citations: [cite(ticket)] };
    }
    const lines = helpers.map((h, i) => {
      const name = String(h.person.properties["name"] ?? h.person.id);
      return `${i + 1}. ${name}（分数 ${h.score}）：${h.reasons.join("；")}`;
    });
    return {
      question, intent: "find-helpers",
      answer: `《${summarize(ticket)}》推荐帮手 Top ${helpers.length}：\n${lines.join("\n")}`,
      citations: helpers.slice(0, 5).map(h => cite(h.person)),
    };
  }

  // 2) ticket-by-pb: explicit 问题单号 reference (no 找帮手 keyword)
  if (pb) {
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

  // 4a) contribution-by-person: 「<人名> 贡献了什么 / 做了什么贡献」
  if (/贡献/.test(question)) {
    // Look for a name token — strip interrogatives + keywords, keep what's left as candidate name
    const stripped = question.replace(/[?？。，,!！贡献了什么做的最近近期]/g, "").trim();
    // Try exact match first, fall back to substring on 贡献人
    const allC = repo.queryNodes("contribution");
    let matched = allC.filter(c => String(c.properties["贡献人"] ?? "") === stripped);
    if (matched.length === 0 && stripped) {
      matched = allC.filter(c => String(c.properties["贡献人"] ?? "").includes(stripped));
    }
    if (matched.length > 0) {
      const top = matched.slice(0, 5);
      const lines = top.map(c => {
        const lvl = c.properties["贡献等级"] ?? "普通";
        const ty = c.properties["贡献类型"] ?? "";
        const desc = c.properties["贡献描述"] ?? "";
        return `· [${lvl}${ty ? "·" + ty : ""}] ${desc || summarize(c)}`;
      });
      const who = String(top[0].properties["贡献人"] ?? stripped);
      return {
        question, intent: "contribution-by-person",
        answer: `${who} 贡献记录 ${matched.length} 条（取 Top ${top.length}）：\n${lines.join("\n")}`,
        citations: top.map(cite),
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

  // 4b) recent-changes: 今天 / 本周 / 最近 谁动了什么
  if (/今天|本周|最近|谁动|谁改/.test(question)) {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    if (/本周/.test(question)) {
      // monday = 1 ... sunday = 0, normalize to monday
      const dow = (start.getDay() + 6) % 7; // 0..6 from monday
      start.setDate(start.getDate() - dow);
    }
    let progressTotal = 0;
    const touched = new Map<string, GraphNode>();
    for (const t of repo.queryNodes("attackTicket")) {
      if (new Date(t.updatedAt) >= start) touched.set(t.id, t);
      for (const p of repo.listProgress(t.id)) {
        if (new Date(p.updatedAt) >= start) { progressTotal++; touched.set(t.id, t); }
      }
    }
    const tickets = [...touched.values()]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, 5);
    const windowName = /本周/.test(question) ? "本周" : /今天/.test(question) ? "今天" : "最近";
    if (tickets.length === 0 && progressTotal === 0) {
      return { question, intent: "recent-changes",
        answer: `${windowName}暂无攻关单变动。`, citations: [] };
    }
    const lines = tickets.map(t => `· ${summarize(t)}（${t.properties["状态"] ?? "未知"}）`);
    return {
      question, intent: "recent-changes",
      answer: `${windowName}共 ${progressTotal} 条进展、${touched.size} 个攻关单变动：\n${lines.join("\n")}`,
      citations: tickets.map(cite),
    };
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
