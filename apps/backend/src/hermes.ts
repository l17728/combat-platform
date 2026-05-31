import { Router } from "express";
import type { Repository, SchemaRegistry, HermesAnswer, HermesCitation, GraphNode, UiSpec } from "@combat/shared";
import { recommendHelpers } from "./recommend.js";
import { log, asyncHandler } from "./logger.js";
import { answerWithAgent, answerWithToolCalling, type AgentRunner, type ToolCallingRunner } from "./hermes-agent.js";
import type { DbAdapter } from "./db-adapter.js";
import type { DB } from "./db.js";
import {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  appendMessage,
  loadRecentMessages,
  updateSessionTitle,
  pruneExpiredSessions,
  resetSessionCache,
  type HermesMessage,
} from "./hermes-sessions.js";

// §v2.5 桶 B: HERMES_MODE 控制 ask 路径
//   - 'tool'  : 强制走 tool-calling agent;失败 fallback intent
//   - 'intent': 强制走规则引擎(不调 LLM,纯本地)
//   - 'auto'  : 短问题 + 命中 intent 正则走 intent;否则走 tool (默认)
export type HermesMode = "tool" | "intent" | "auto";

const INTENT_REGEX =
  /找谁帮忙|找帮手|谁能帮|PB[-_]|问题单号|谁负责|谁在做|owner|负责人|状态|进展|怎么样|现在|贡献|最忙|负载最重|今天|本周|最近/i;

function parseMode(raw: unknown): HermesMode {
  const s = String(raw ?? "").toLowerCase();
  if (s === "tool" || s === "intent" || s === "auto") return s as HermesMode;
  const env = String(process.env.HERMES_MODE ?? "").toLowerCase();
  if (env === "tool" || env === "intent" || env === "auto") return env as HermesMode;
  return "auto";
}

function chooseEngineForAuto(question: string): "tool" | "intent" {
  // 短问题(<30 字符)且命中已知 intent 正则 → intent 快路径
  if (question.length < 30 && INTENT_REGEX.test(question)) return "intent";
  return "tool";
}

const ACTIVE_STATUSES = new Set(["待响应", "处理中", "进行中"]);

function cacheKey(intent: string, q: string): string {
  return `${intent}:${q.toLowerCase().replace(/\s+/g, "")}`;
}
function tableSpec(
  title: string,
  columns: string[],
  nodes: GraphNode[],
  pick: (n: GraphNode) => Record<string, string | number | null>
): UiSpec {
  return { widget: "TABLE", params: { title, columns, rows: nodes.map(pick) }, cacheKey: "" };
}
function cardSpec(
  title: string,
  nodes: GraphNode[],
  buildCard: (n: GraphNode) => { title: string; description?: string; link?: string; tags?: string[] }
): UiSpec {
  return { widget: "CARD_GRID", params: { title, cards: nodes.map(buildCard) }, cacheKey: "" };
}

function summarize(n: GraphNode): string {
  const p = n.properties;
  return String(
    p["标题"] ??
      p["攻关单号"] ??
      p["版本号"] ??
      p["名称"] ??
      p["姓名"] ??
      p["贡献人"] ??
      p["key"] ??
      // §46 new view nodeTypes' title-ish fields
      p["经验"] ??
      p["问题说明"] ??
      p["告警问题"] ??
      p["事件标题"] ??
      p["事项描述"] ??
      p["组名"] ??
      p["name"] ??
      n.id
  );
}
function linkFor(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
function cite(n: GraphNode): HermesCitation {
  return { nodeId: n.id, nodeType: n.nodeType, summary: summarize(n), link: linkFor(n) };
}

async function findTicketsByPB(repo: Repository, pb: string): Promise<GraphNode[]> {
  // v2.2 P1 §2: SQL 下推 attackTicket.问题单号 等值查找,走 json_extract 索引
  // 注意:queryNodes 历史路径用 .trim() 兼容前导/尾随空格存储 — pushdown 用精确等值,
  // 调用方已保证 pb 来自正则匹配的 toUpperCase().replace(/_/g, "-"),无空格污染。
  return repo.queryNodesByProperty("attackTicket", "问题单号", pb);
}
async function fuzzyTicketsByTitle(repo: Repository, hint: string): Promise<GraphNode[]> {
  const needle = hint.trim().toLowerCase();
  if (!needle) return [];
  return (await repo.queryNodes("attackTicket")).filter((n) => {
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
export async function answerQuestion(repo: Repository, registry: SchemaRegistry, raw: string): Promise<HermesAnswer> {
  const question = raw.trim();
  const lower = question.toLowerCase();

  // Helper: extract PB number from question (used by both ticket-by-pb and find-helpers)
  // Match PB-... (alphanumeric tail to support PB-FH-001 etc.) or explicit 问题单号 prefix
  const pbMatch =
    question.match(/(PB[-_]?[A-Z0-9][A-Z0-9_-]*)/i) ?? question.match(/问题单号\s*[：:]\s*([A-Za-z0-9_-]+)/);
  const pb = pbMatch ? (pbMatch[1] ?? pbMatch[0]).toUpperCase().replace(/_/g, "-") : "";

  // 1) find-helpers: 找谁帮忙 / 找帮手 / 谁能帮 (check before ticket-by-pb so a PB
  //    inside a "找谁帮忙" question goes to helpers, not the plain ticket listing)
  if (/找谁帮忙|找帮手|谁能帮/.test(question)) {
    let ticket: GraphNode | undefined;
    if (pb) ticket = (await findTicketsByPB(repo, pb))[0];
    if (!ticket) {
      const stripped = question
        .replace(/找谁帮忙|找帮手|谁能帮|帮忙找|帮我找/g, "")
        .replace(/[?？。，,!！]/g, "")
        .replace(pb, "")
        .trim();
      ticket = (await fuzzyTicketsByTitle(repo, stripped))[0];
    }
    if (!ticket) {
      return {
        question,
        intent: "find-helpers",
        answer: "未定位到具体攻关单。请补充问题单号（如 PB-123）或攻关单标题片段。",
        citations: [],
      };
    }
    const helpers = await recommendHelpers(repo, ticket.id, 5);
    if (helpers.length === 0) {
      return {
        question,
        intent: "find-helpers",
        answer: `攻关单《${summarize(ticket)}》暂未找到合适帮手。可考虑补充共享问题单号或贡献记录后再问。`,
        citations: [cite(ticket)],
      };
    }
    const lines = helpers.map((h, i) => {
      const name = String(h.person.properties["姓名"] ?? h.person.properties["name"] ?? h.person.id);
      return `${i + 1}. ${name}（分数 ${h.score}）：${h.reasons.join("；")}`;
    });
    const ck = cacheKey("find-helpers", question);
    return {
      question,
      intent: "find-helpers",
      answer: `《${summarize(ticket)}》推荐帮手 Top ${helpers.length}：\n${lines.join("\n")}`,
      citations: helpers.slice(0, 5).map((h) => cite(h.person)),
      uiSpec: {
        ...cardSpec(
          "推荐帮手",
          helpers.slice(0, 5).map((h) => h.person),
          (n) => ({
            title: String(n.properties["姓名"] ?? n.properties["name"] ?? n.id),
            description: helpers.find((h) => h.person.id === n.id)?.reasons.join("；"),
            link: linkFor(n),
            tags: [`分数 ${helpers.find((h) => h.person.id === n.id)?.score ?? 0}`],
          })
        ),
        cacheKey: ck,
      },
    };
  }

  // 2) ticket-by-pb: explicit 问题单号 reference (no 找帮手 keyword)
  if (pb) {
    const tickets = (await findTicketsByPB(repo, pb)).slice(0, 10);
    if (tickets.length > 0) {
      const lines = tickets.map(
        (t) =>
          `· ${summarize(t)}（状态：${t.properties["状态"] ?? "未知"}，负责人：${t.properties["当前处理人"] ?? "未填"}）`
      );
      const ck = cacheKey("ticket-by-pb", question);
      return {
        question,
        intent: "ticket-by-pb",
        answer: `问题单 ${pb} 下找到 ${tickets.length} 个攻关单：\n${lines.join("\n")}`,
        citations: tickets.slice(0, 5).map(cite),
        uiSpec: {
          ...tableSpec("攻关单列表", ["标题", "状态", "当前处理人"], tickets.slice(0, 10), (n) => ({
            标题: String(n.properties["标题"] ?? n.id),
            状态: String(n.properties["状态"] ?? ""),
            当前处理人: String(n.properties["当前处理人"] ?? ""),
          })),
          cacheKey: ck,
        },
      };
    }
  }

  // 2) owner: 谁负责 / 谁在做 / owner
  if (/谁负责|谁在做|谁的|owner|负责人/i.test(lower)) {
    // strip the intent keywords + interrogatives, leaving a likely title fragment
    const stripped = question.replace(/[?？。，,!！谁负责在做的owner负责人是哪个]/gi, "").trim();
    const candidates = (await fuzzyTicketsByTitle(repo, stripped)).slice(0, 5);
    if (candidates.length > 0) {
      const lines = candidates.map(
        (t) =>
          `· 《${summarize(t)}》当前处理人：${t.properties["当前处理人"] ?? "未填"}（状态：${t.properties["状态"] ?? "未知"}）`
      );
      const ck = cacheKey("owner", question);
      return {
        question,
        intent: "owner",
        answer: `按标题匹配到 ${candidates.length} 个攻关单：\n${lines.join("\n")}`,
        citations: candidates.map(cite),
        uiSpec: {
          ...tableSpec("负责人", ["标题", "当前处理人", "状态"], candidates, (n) => ({
            标题: String(n.properties["标题"] ?? n.id),
            当前处理人: String(n.properties["当前处理人"] ?? ""),
            状态: String(n.properties["状态"] ?? ""),
          })),
          cacheKey: ck,
        },
      };
    }
  }

  // 3) status / 进展 / 现在怎么样
  if (/状态|进展|怎么样|现在/.test(question)) {
    const stripped = question.replace(/[?？。，,!！状态进展怎么样现在的是]/g, "").trim();
    const candidates = (await fuzzyTicketsByTitle(repo, stripped)).slice(0, 3);
    if (candidates.length > 0) {
      // Pre-fetch progress for all candidates to avoid awaits in sync map callbacks
      const progressMap = new Map<string, Awaited<ReturnType<Repository["listProgress"]>>>();
      for (const t of candidates) progressMap.set(t.id, await repo.listProgress(t.id));
      const blocks = candidates.map((t) => {
        const seq = progressMap.get(t.id) ?? [];
        const latest = seq.length > 0 ? seq[seq.length - 1] : null;
        const tail = latest ? `最新进展（${latest.statusSnapshot}）：${latest.content}` : "暂无进展记录";
        return `· 《${summarize(t)}》状态：${t.properties["状态"] ?? "未知"}\n  ${tail}`;
      });
      const ck = cacheKey("status", question);
      return {
        question,
        intent: "status",
        answer: blocks.join("\n"),
        citations: candidates.map(cite),
        uiSpec: {
          ...cardSpec("进展状态", candidates, (n) => {
            const seq = progressMap.get(n.id) ?? [];
            const latest = seq.length > 0 ? seq[seq.length - 1] : null;
            return {
              title: summarize(n),
              description: latest ? `${latest.statusSnapshot}：${latest.content}` : "暂无进展",
              link: linkFor(n),
              tags: [String(n.properties["状态"] ?? "未知")],
            };
          }),
          cacheKey: ck,
        },
      };
    }
  }

  // 4a) contribution-by-person: 「<人名> 贡献了什么 / 做了什么贡献」
  if (/贡献/.test(question)) {
    // Look for a name token — strip interrogatives + keywords, keep what's left as candidate name
    const stripped = question.replace(/[?？。，,!！贡献了什么做的最近近期]/g, "").trim();
    // Try exact match first, fall back to substring on 贡献人
    const allC = await repo.queryNodes("contribution");
    let matched = allC.filter((c) => String(c.properties["贡献人"] ?? "") === stripped);
    if (matched.length === 0 && stripped) {
      matched = allC.filter((c) => String(c.properties["贡献人"] ?? "").includes(stripped));
    }
    if (matched.length > 0) {
      const top = matched.slice(0, 5);
      const lines = top.map((c) => {
        const lvl = c.properties["贡献等级"] ?? "普通";
        const ty = c.properties["贡献类型"] ?? "";
        const desc = c.properties["贡献描述"] ?? c.properties["描述"] ?? "";
        return `· [${lvl}${ty ? "·" + ty : ""}] ${desc || summarize(c)}`;
      });
      const who = String(top[0].properties["贡献人"] ?? stripped);
      const ck = cacheKey("contribution-by-person", question);
      return {
        question,
        intent: "contribution-by-person",
        answer: `${who} 贡献记录 ${matched.length} 条（取 Top ${top.length}）：\n${lines.join("\n")}`,
        citations: top.map(cite),
        uiSpec: {
          ...tableSpec(`${who} 贡献`, ["贡献等级", "贡献类型", "贡献描述"], top, (n) => ({
            贡献等级: String(n.properties["贡献等级"] ?? "普通"),
            贡献类型: String(n.properties["贡献类型"] ?? ""),
            贡献描述: String(n.properties["贡献描述"] ?? n.properties["描述"] ?? ""),
          })),
          cacheKey: ck,
        },
      };
    }
  }

  // 4) person-workload: 谁最忙 / 负载最重 / 活跃单最多
  if (/最忙|负载最重|活跃单最多|谁最重|工作量最多/.test(question)) {
    const byOwner = new Map<string, GraphNode[]>();
    for (const t of await repo.queryNodes("attackTicket")) {
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
        question,
        intent: "person-workload",
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
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (/本周/.test(question)) {
      // monday = 1 ... sunday = 0, normalize to monday
      const dow = (start.getDay() + 6) % 7; // 0..6 from monday
      start.setDate(start.getDate() - dow);
    }
    let progressTotal = 0;
    const touched = new Map<string, GraphNode>();
    // BUG-7: filter to recently-updated tickets first to avoid N+1 progress queries
    const allTickets = await repo.queryNodes("attackTicket");
    const recentTickets = allTickets.filter((t) => new Date(t.updatedAt) >= start);
    for (const t of recentTickets) {
      touched.set(t.id, t);
    }
    for (const t of recentTickets) {
      for (const p of await repo.listProgress(t.id)) {
        if (new Date(p.updatedAt) >= start) progressTotal++;
      }
    }
    const tickets = [...touched.values()]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, 5);
    const windowName = /本周/.test(question) ? "本周" : /今天/.test(question) ? "今天" : "最近";
    if (tickets.length === 0 && progressTotal === 0) {
      return { question, intent: "recent-changes", answer: `${windowName}暂无攻关单变动。`, citations: [] };
    }
    const lines = tickets.map((t) => `· ${summarize(t)}（${t.properties["状态"] ?? "未知"}）`);
    const ck = cacheKey("recent-changes", question);
    return {
      question,
      intent: "recent-changes",
      answer: `${windowName}共 ${progressTotal} 条进展、${touched.size} 个攻关单变动：\n${lines.join("\n")}`,
      citations: tickets.map(cite),
      uiSpec: {
        ...tableSpec(`${windowName}变动`, ["标题", "状态", "最后更新"], tickets, (n) => ({
          标题: String(n.properties["标题"] ?? n.id),
          状态: String(n.properties["状态"] ?? ""),
          最后更新: n.updatedAt.slice(0, 16).replace("T", " "),
        })),
        cacheKey: ck,
      },
    };
  }

  // 5) fallback: full-text search across all nodeTypes
  const needle = question.toLowerCase();
  const hits: { node: GraphNode; score: number }[] = [];
  if (needle) {
    for (const nt of registry.getConfig().nodeTypes.map((n) => n.nodeType)) {
      for (const n of await repo.queryNodes(nt)) {
        const hay = Object.values(n.properties)
          .map((v) => String(v))
          .join(" ")
          .toLowerCase();
        let score = 0,
          i = hay.indexOf(needle);
        while (i !== -1) {
          score++;
          i = hay.indexOf(needle, i + needle.length);
        }
        if (score > 0) hits.push({ node: n, score });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, 5);
  if (top.length > 0) {
    const lines = top.map((h) => `· [${h.node.nodeType}] ${summarize(h.node)}`);
    const ck = cacheKey("fallback-search", question);
    return {
      question,
      intent: "fallback-search",
      answer: `按关键词检索到 ${top.length} 条相关记录：\n${lines.join("\n")}`,
      citations: top.map((h) => cite(h.node)),
      uiSpec: {
        ...tableSpec(
          "检索结果",
          ["类型", "摘要"],
          top.map((h) => h.node),
          (n) => ({
            类型: n.nodeType,
            摘要: summarize(n),
          })
        ),
        cacheKey: ck,
      },
    };
  }

  log.warn("hermes.ask.no_results", { question });
  return {
    question,
    intent: "fallback-search",
    answer: "暂未找到相关记录。可换关键词，或具体提及攻关单标题 / 问题单号 / 负责人。",
    citations: [],
  };
}

const WELINK_KEYWORDS = /群里|聊天|welink|说过|提到|介入|最早|第一个|谁先|什么时候|何时|哪天/i;
const TICKET_ID_HINT_RE = /(?:ticketId|攻关单\s*id|ticket\s*id)\s*[=:：]\s*([a-zA-Z0-9-]+)/i;

function extractTicketIdHint(context?: string): string | undefined {
  if (!context) return undefined;
  const m = context.match(TICKET_ID_HINT_RE);
  return m ? m[1] : undefined;
}

// 从 question 里提取若干"关键词"(去标点+停用词后剩下的中英文词)。最多 4 个,长度 >=2。
function extractKeywords(question: string): string[] {
  const stop =
    /^(的|了|和|是|在|有|谁|什么|怎么|为|啥|吗|呢|啊|哪|个|条|条目|消息|群里|聊天|提到|说过|最早|介入|时候|何时|哪天|第一|第一个|起|开始)$/;
  const tokens = question
    .replace(/[?？。，,!！;；:：'"`「」『』()（）\[\]【】<>《》]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    // 去掉单字、去停用词
    if (t.length < 2) continue;
    if (stop.test(t)) continue;
    out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * 场景 3 兜底:agent 关闭或 agent 没给 welink 引用时,直接关键词扫 welink_messages,
 * 取前 3 条返回 welink kind citation。链路保证:即便没 LLM,用户也能拿到溯源跳转。
 */
function welinkFallbackCitations(db: DB, question: string, ticketId: string): HermesCitation[] {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return [];
  // 用 LIKE 串联;为每个 keyword 给一条 hit,按时间升序取前 3 条不重复
  const seen = new Set<string>();
  const out: HermesCitation[] = [];
  for (const kw of keywords) {
    const rows = db
      .prepare(
        `SELECT id, ticket_id, message_id, sent_at, author, content
         FROM welink_messages
        WHERE ticket_id = ? AND deleted_at IS NULL AND content LIKE ?
        ORDER BY sent_at ASC LIMIT 5`
      )
      .all(ticketId, `%${kw}%`) as any[];
    for (const row of rows) {
      const key = String(row.message_id);
      if (seen.has(key)) continue;
      seen.add(key);
      const brief = String(row.content || "").slice(0, 60);
      out.push({
        nodeId: `welink:${row.id}`,
        nodeType: "welinkMessage",
        summary: `${row.author} · ${String(row.sent_at).slice(0, 16).replace("T", " ")}${brief ? " · " + brief : ""}`,
        link: `/attack/${row.ticket_id}?tab=welink&welinkMsg=${encodeURIComponent(row.message_id)}`,
        kind: "welink",
        messageId: String(row.message_id),
        ticketId: String(row.ticket_id),
      });
      if (out.length >= 3) return out;
    }
  }
  return out;
}

export interface HermesRouterOptions {
  runner?: AgentRunner;
  toolRunner?: ToolCallingRunner;
  db?: DB;
  adapter?: DbAdapter;
  defaultMode?: HermesMode;
  auditActor?: string;
}

export function makeHermesRouter(
  repo: Repository,
  registry: SchemaRegistry,
  optsOrRunner?: HermesRouterOptions | AgentRunner,
  db?: DB
): Router {
  // 向后兼容:旧调用 makeHermesRouter(repo, registry, runner, db)
  const opts: HermesRouterOptions =
    optsOrRunner && typeof (optsOrRunner as AgentRunner).run === "function"
      ? { runner: optsOrRunner as AgentRunner, db }
      : ((optsOrRunner as HermesRouterOptions) ?? { db });
  if (db && !opts.db) opts.db = db;

  const r = Router();

  // --- Session REST routes ---
  r.get(
    "/hermes/sessions",
    asyncHandler(async (req, res) => {
      if (!opts.adapter) return res.json([]);
      const userId = (req as any).user?.username ?? "anonymous";
      const sessions = await listSessions(opts.adapter, userId);
      res.json(sessions);
    })
  );

  r.post(
    "/hermes/sessions",
    asyncHandler(async (req, res) => {
      if (!opts.adapter) return res.status(501).json({ error: "session unavailable" });
      const userId = (req as any).user?.username ?? "anonymous";
      const title = String(req.body?.title ?? "").trim() || undefined;
      const session = await createSession(opts.adapter, userId, title);
      res.json(session);
    })
  );

  r.get(
    "/hermes/sessions/:id",
    asyncHandler(async (req, res) => {
      if (!opts.adapter) return res.status(504).json({ error: "session unavailable" });
      const session = await getSession(opts.adapter, req.params.id);
      if (!session) return res.status(404).json({ error: "session not found" });
      const messages = await loadRecentMessages(opts.adapter, req.params.id, 200);
      res.json({ ...session, messages });
    })
  );

  r.delete(
    "/hermes/sessions/:id",
    asyncHandler(async (req, res) => {
      if (!opts.adapter) return res.status(504).json({ error: "session unavailable" });
      const ok = await deleteSession(opts.adapter, req.params.id);
      res.json({ ok });
    })
  );

  r.patch(
    "/hermes/sessions/:id",
    asyncHandler(async (req, res) => {
      if (!opts.adapter) return res.status(504).json({ error: "session unavailable" });
      const title = String(req.body?.title ?? "").trim();
      if (!title) return res.status(400).json({ error: "title 必填" });
      const ok = await updateSessionTitle(opts.adapter, req.params.id, title);
      res.json({ ok });
    })
  );

  // --- Ask endpoint ---
  r.post(
    "/hermes/ask",
    asyncHandler(async (req, res) => {
      const q = String(req.body?.question ?? "").trim();
      if (!q) return res.status(400).json({ error: "question 必填" });
      const context = String(req.body?.context ?? "").trim() || undefined;
      const requestedMode = parseMode(req.body?.mode ?? opts.defaultMode);
      const ticketIdHint = extractTicketIdHint(context);
      const startedAt = Date.now();
      const sessionId = String(req.body?.sessionId ?? "").trim() || undefined;

      let priorMessages: import("./hermes-agent.js").LlmMessage[] | undefined;
      if (sessionId && opts.adapter) {
        const session = await getSession(opts.adapter, sessionId);
        if (session) {
          const history = await loadRecentMessages(opts.adapter, sessionId);
          priorMessages = history.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
        }
      }

      // ===== mode dispatch =====
      // intent: 强制走规则引擎
      // tool : 走 tool-calling agent;失败 fallback intent
      // auto : 有 toolRunner 时按短问题+正则启发式;否则保持旧契约(有 runner 全走 agent)
      let plannedEngine: "tool" | "intent";
      if (requestedMode === "intent") {
        plannedEngine = "intent";
      } else if (requestedMode === "tool") {
        plannedEngine = "tool";
      } else if (opts.toolRunner) {
        plannedEngine = chooseEngineForAuto(q);
      } else if (opts.runner) {
        // 向后兼容:旧路径(只配 runner)始终优先走 agent
        plannedEngine = "tool";
      } else {
        plannedEngine = "intent";
      }

      log.info("hermes.ask.start", {
        question: q,
        mode: requestedMode,
        planned: plannedEngine,
        hasToolRunner: !!opts.toolRunner,
        hasRunner: !!opts.runner,
      });

      // ===== tool-calling path (新) =====
      if (plannedEngine === "tool" && opts.toolRunner) {
        try {
          const answer = await answerWithToolCalling(repo, registry, q, opts.toolRunner, context, opts.db, {
            priorMessages,
          });
          enrichWithWelinkFallback(answer, opts.db, ticketIdHint, q);
          const ms = Date.now() - startedAt;
          if (sessionId && opts.adapter) {
            const sa = opts.adapter;
            await appendMessage(sa, sessionId, "user", q);
            await appendMessage(sa, sessionId, "assistant", answer.answer, JSON.stringify(answer.citations));
            if (q.length <= 40) {
              try {
                await updateSessionTitle(sa, sessionId, q);
              } catch {}
            }
          }
          log.info("hermes.ask.done", {
            intent: answer.intent,
            engine: "tool",
            mode: requestedMode,
            hops: answer.trace?.length ?? 0,
            citationCount: answer.citations.length,
            ms,
          });
          if (opts.auditActor) {
            await repo
              .logAudit({
                action: "HERMES_ASK",
                entityType: "setting",
                entityId: "hermes",
                changes: { mode: requestedMode, engine: "tool", hops: answer.trace?.length ?? 0, ms, ok: true },
                actor: opts.auditActor,
              })
              .catch(() => {});
          }
          return res.json(answer);
        } catch (e) {
          const reason = (e as Error).message || "tool_engine_error";
          log.warn("hermes.ask.tool_fallback", { error: reason });
          plannedEngine = "intent";
          // fallthrough to intent path; 标 fallback_reason
          const answer = await intentPath(repo, registry, q, opts, ticketIdHint, requestedMode);
          answer.fallback_reason = reason;
          log.info("hermes.ask.done", {
            intent: answer.intent,
            engine: "intent",
            mode: requestedMode,
            fallback: true,
            ms: Date.now() - startedAt,
          });
          return res.json(answer);
        }
      }

      // ===== legacy single-turn AgentRunner path (向后兼容) =====
      if (plannedEngine === "tool" && opts.runner) {
        try {
          const answer = await answerWithAgent(repo, registry, q, opts.runner, context, opts.db);
          enrichWithWelinkFallback(answer, opts.db, ticketIdHint, q);
          log.info("hermes.ask.done", {
            intent: answer.intent,
            engine: "agent",
            mode: requestedMode,
            citationCount: answer.citations.length,
            ms: Date.now() - startedAt,
          });
          return res.json(answer);
        } catch (e) {
          log.warn("hermes.ask.agent_fallback", { error: (e as Error).message });
        }
      }

      // ===== intent (rule) path =====
      const answer = await intentPath(repo, registry, q, opts, ticketIdHint, requestedMode);
      log.info("hermes.ask.done", {
        intent: answer.intent,
        engine: "intent",
        mode: requestedMode,
        ms: Date.now() - startedAt,
      });
      res.json(answer);
    })
  );
  return r;
}

async function intentPath(
  repo: Repository,
  registry: SchemaRegistry,
  q: string,
  opts: HermesRouterOptions,
  ticketIdHint: string | undefined,
  _mode: HermesMode
): Promise<HermesAnswer> {
  const answer = await answerQuestion(repo, registry, q);
  enrichWithWelinkFallback(answer, opts.db, ticketIdHint, q);
  (answer as HermesAnswer).engine = "intent";
  return answer;
}

function enrichWithWelinkFallback(
  answer: HermesAnswer,
  db: DB | undefined,
  ticketIdHint: string | undefined,
  q: string
): void {
  if (!db || !ticketIdHint) return;
  if (!WELINK_KEYWORDS.test(q)) return;
  if (answer.citations.some((c) => c.kind === "welink")) return;
  const extra = welinkFallbackCitations(db, q, ticketIdHint);
  if (extra.length > 0) answer.citations.push(...extra);
}
