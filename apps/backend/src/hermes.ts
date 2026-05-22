import { Router } from "express";
import type { Repository, SchemaRegistry, HermesAnswer, HermesCitation, GraphNode, UiSpec } from "@combat/shared";
import { recommendHelpers } from "./recommend.js";

const ACTIVE_STATUSES = new Set(["待响应", "处理中", "进行中"]);

function cacheKey(intent: string, q: string): string {
  return `${intent}:${q.toLowerCase().replace(/\s+/g, "")}`;
}
function tableSpec(title: string, columns: string[], nodes: GraphNode[], pick: (n: GraphNode) => Record<string, string | number | null>): UiSpec {
  return { widget: "TABLE", params: { title, columns, rows: nodes.map(pick) }, cacheKey: "" };
}
function cardSpec(title: string, nodes: GraphNode[], buildCard: (n: GraphNode) => { title: string; description?: string; link?: string; tags?: string[] }): UiSpec {
  return { widget: "CARD_GRID", params: { title, cards: nodes.map(buildCard) }, cacheKey: "" };
}

function summarize(n: GraphNode): string {
  const p = n.properties;
  return String(p["标题"] ?? p["攻关单号"] ?? p["版本号"] ?? p["名称"] ?? p["name"] ?? p["贡献人"] ?? p["key"]
    // §46 new view nodeTypes' title-ish fields
    ?? p["经验"] ?? p["问题说明"] ?? p["告警问题"] ?? p["事件标题"] ?? p["事项描述"] ?? p["组名"] ?? n.id);
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
    const ck = cacheKey("find-helpers", question);
    return {
      question, intent: "find-helpers",
      answer: `《${summarize(ticket)}》推荐帮手 Top ${helpers.length}：\n${lines.join("\n")}`,
      citations: helpers.slice(0, 5).map(h => cite(h.person)),
      uiSpec: { ...cardSpec("推荐帮手", helpers.slice(0, 5).map(h => h.person), n => ({
        title: String(n.properties["name"] ?? n.id),
        description: helpers.find(h => h.person.id === n.id)?.reasons.join("；"),
        link: linkFor(n),
        tags: [`分数 ${helpers.find(h => h.person.id === n.id)?.score ?? 0}`],
      })), cacheKey: ck },
    };
  }

  // 2) ticket-by-pb: explicit 问题单号 reference (no 找帮手 keyword)
  if (pb) {
    const tickets = findTicketsByPB(repo, pb).slice(0, 10);
    if (tickets.length > 0) {
      const lines = tickets.map(t => `· ${summarize(t)}（状态：${t.properties["状态"] ?? "未知"}，负责人：${t.properties["当前处理人"] ?? "未填"}）`);
      const ck = cacheKey("ticket-by-pb", question);
      return {
        question, intent: "ticket-by-pb",
        answer: `问题单 ${pb} 下找到 ${tickets.length} 个攻关单：\n${lines.join("\n")}`,
        citations: tickets.slice(0, 5).map(cite),
        uiSpec: { ...tableSpec("攻关单列表", ["标题", "状态", "当前处理人"], tickets.slice(0, 10), n => ({
          标题: String(n.properties["标题"] ?? n.id),
          状态: String(n.properties["状态"] ?? ""),
          当前处理人: String(n.properties["当前处理人"] ?? ""),
        })), cacheKey: ck },
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
      const ck = cacheKey("owner", question);
      return {
        question, intent: "owner",
        answer: `按标题匹配到 ${candidates.length} 个攻关单：\n${lines.join("\n")}`,
        citations: candidates.map(cite),
        uiSpec: { ...tableSpec("负责人", ["标题", "当前处理人", "状态"], candidates, n => ({
          标题: String(n.properties["标题"] ?? n.id),
          当前处理人: String(n.properties["当前处理人"] ?? ""),
          状态: String(n.properties["状态"] ?? ""),
        })), cacheKey: ck },
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
      const ck = cacheKey("status", question);
      return {
        question, intent: "status",
        answer: blocks.join("\n"),
        citations: candidates.map(cite),
        uiSpec: { ...cardSpec("进展状态", candidates, n => {
          const seq = repo.listProgress(n.id);
          const latest = seq.length > 0 ? seq[seq.length - 1] : null;
          return {
            title: summarize(n),
            description: latest ? `${latest.statusSnapshot}：${latest.content}` : "暂无进展",
            link: linkFor(n),
            tags: [String(n.properties["状态"] ?? "未知")],
          };
        }), cacheKey: ck },
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
      const ck = cacheKey("contribution-by-person", question);
      return {
        question, intent: "contribution-by-person",
        answer: `${who} 贡献记录 ${matched.length} 条（取 Top ${top.length}）：\n${lines.join("\n")}`,
        citations: top.map(cite),
        uiSpec: { ...tableSpec(`${who} 贡献`, ["贡献等级", "贡献类型", "贡献描述"], top, n => ({
          贡献等级: String(n.properties["贡献等级"] ?? "普通"),
          贡献类型: String(n.properties["贡献类型"] ?? ""),
          贡献描述: String(n.properties["贡献描述"] ?? ""),
        })), cacheKey: ck },
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
      const top = ranked[0]?.[1] ?? [];
      const ck = cacheKey("person-workload", question);
      return {
        question, intent: "person-workload",
        answer: `当前活跃工作量排名（Top ${ranked.length}）：\n${lines.join("\n")}`,
        citations: top.slice(0, 5).map(cite),
        uiSpec: {
          widget: "STATS",
          params: { title: "人员工作量排名", items: ranked.map(([who, ts]) => ({ label: who, value: ts.length })) },
          cacheKey: ck,
        },
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
    const ck = cacheKey("recent-changes", question);
    return {
      question, intent: "recent-changes",
      answer: `${windowName}共 ${progressTotal} 条进展、${touched.size} 个攻关单变动：\n${lines.join("\n")}`,
      citations: tickets.map(cite),
      uiSpec: { ...tableSpec(`${windowName}变动`, ["标题", "状态", "最后更新"], tickets, n => ({
        标题: String(n.properties["标题"] ?? n.id),
        状态: String(n.properties["状态"] ?? ""),
        最后更新: n.updatedAt.slice(0, 16).replace("T", " "),
      })), cacheKey: ck },
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
    const ck = cacheKey("fallback-search", question);
    return {
      question, intent: "fallback-search",
      answer: `按关键词检索到 ${top.length} 条相关记录：\n${lines.join("\n")}`,
      citations: top.map(h => cite(h.node)),
      uiSpec: { ...tableSpec("检索结果", ["类型", "摘要"], top.map(h => h.node), n => ({
        类型: n.nodeType,
        摘要: summarize(n),
      })), cacheKey: ck },
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
