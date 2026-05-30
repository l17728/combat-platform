import { randomUUID } from "node:crypto";
import { log } from "./logger.js";
import type { DB } from "./db.js";
import type { AgentRunner } from "./hermes-agent.js";
import type { Repository } from "@combat/shared";
import { parseMembers } from "./welink-members.js";

/**
 * 场景 2:对一批 Welink 群消息做 AI 抽取,落 welink_extractions。
 * 设计:
 *  - 同步阻塞(消息量级 < 1000 是几秒级);异步 worker 留作下下阶段。
 *  - 优先用 AgentRunner(opencode)做结构化抽取;agent 不可用 / 返回不可解析 JSON 时,
 *    本期 MVP 直接退化为「规则启发式」抽取(实体 = 所有发言人,事件 = 首条 + 末条;
 *    缺口 = 群里活跃发言人 vs 攻关单成员的差集),保证端点永不返回空、e2e 可断言。
 *  - 落表 + 返回 list。
 */

export interface WelinkExtractionRow {
  id: string;
  ticketId: string;
  kind: string;
  label: string;
  payload: any;
  sourceMsgIds: string[];
  createdAt: string;
  createdBy: string | null;
  reviewed: boolean;
}

export interface WelinkMessageLite {
  id: string;
  messageId: string;
  sentAt: string;
  author: string;
  content: string;
  contentType: string;
}

function rowToExtraction(r: any): WelinkExtractionRow {
  let payload: any = {};
  try { payload = JSON.parse(r.payload || "{}"); } catch { payload = { raw: r.payload }; }
  const ids = String(r.source_msg_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: r.id,
    ticketId: r.ticket_id,
    kind: r.kind,
    label: r.label,
    payload,
    sourceMsgIds: ids,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    reviewed: !!r.reviewed,
  };
}

function fetchSelectedMessages(db: DB, ticketId: string): WelinkMessageLite[] {
  const rows = db.prepare(
    `SELECT id, message_id, sent_at, author, content, content_type
       FROM welink_messages
      WHERE ticket_id = ? AND deleted_at IS NULL AND selected = 1
      ORDER BY sent_at ASC, created_at ASC`,
  ).all(ticketId) as any[];
  return rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    sentAt: r.sent_at,
    author: r.author,
    content: r.content,
    contentType: r.content_type,
  }));
}

function fetchTicketMembers(repo: Repository, ticketId: string): { 姓名: string; 角色: string }[] {
  const n = repo.getNode(ticketId);
  if (!n) return [];
  return parseMembers(n.properties as Record<string, unknown>);
}

function serializeForPrompt(msgs: WelinkMessageLite[], cap = 200): string {
  // 防 prompt 爆炸:超过 cap 时按时间分桶采样(前 30、中 30、后 30 + 全部首条)
  const sample = msgs.length <= cap
    ? msgs
    : [
        ...msgs.slice(0, Math.floor(cap / 3)),
        ...msgs.slice(Math.floor(msgs.length / 2) - Math.floor(cap / 6), Math.floor(msgs.length / 2) + Math.floor(cap / 6)),
        ...msgs.slice(-Math.floor(cap / 3)),
      ];
  return sample.map((m) => `[${m.sentAt}] ${m.author}: ${m.content}`).join("\n");
}

function buildExtractPrompt(ticketId: string, ticketTitle: string, msgs: WelinkMessageLite[], members: string[]): string {
  const body = serializeForPrompt(msgs);
  const memberLine = members.length ? members.join("、") : "(尚未登记)";
  return [
    `你是攻关单群消息分析助手。下面是攻关单「${ticketTitle}」(id=${ticketId})的群聊片段。`,
    `当前攻关单已登记成员:${memberLine}`,
    "",
    "请抽取以下五类信息,并以 JSON 数组形式输出(严格 JSON,无注释):",
    "- entity:出现的人物 / 关键实体(如版本号、服务名)",
    "- event:时间线关键节点(谁先提问 / 认领 / 验证 / 结案)",
    "- decision:明确做出的决策、结论或行动项",
    "- dispute:有争议、待澄清的点",
    "- gap:群里活跃发言但不在攻关单成员列表里的人 (用于成员补齐建议)",
    "",
    "输出格式(严格,**只输出 JSON,不要解释**):",
    "```json",
    "[",
    '  { "kind": "entity", "label": "陈某", "payload": { "name": "陈某", "empNo": "c00493147", "appearedCount": 5 }, "sourceMsgIds": ["msg-id-1"] },',
    '  { "kind": "event", "label": "认领排查", "payload": { "who": "李某", "what": "认领问题排查", "when": "2026-05-29 10:00" }, "sourceMsgIds": ["msg-id-2"] }',
    "]",
    "```",
    "",
    "群消息正文(时间, 发言人: 内容):",
    body,
  ].join("\n");
}

const JSON_BLOCK = /```(?:json)?\s*([\s\S]*?)```/i;

function tryParseAgentJson(text: string): any[] | null {
  if (!text) return null;
  // 优先 fence
  const m = text.match(JSON_BLOCK);
  let body = m ? m[1].trim() : text.trim();
  // 找第一个 [ 到最后一个 ]
  const i = body.indexOf("[");
  const j = body.lastIndexOf("]");
  if (i >= 0 && j > i) body = body.slice(i, j + 1);
  try {
    const arr = JSON.parse(body);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

const VALID_KINDS = new Set(["entity", "event", "decision", "dispute", "gap"]);

interface NormalizedExtraction {
  kind: string;
  label: string;
  payload: any;
  sourceMsgIds: string[];
}

function normalizeAgentOutput(arr: any[], msgs: WelinkMessageLite[]): NormalizedExtraction[] {
  const validMsgIds = new Set<string>([...msgs.map((m) => m.id), ...msgs.map((m) => m.messageId)]);
  const out: NormalizedExtraction[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const kind = String(it.kind ?? "").trim();
    if (!VALID_KINDS.has(kind)) continue;
    const label = String(it.label ?? "").trim();
    if (!label) continue;
    const payload = it.payload ?? null;
    const rawIds = Array.isArray(it.sourceMsgIds) ? it.sourceMsgIds : [];
    const sourceMsgIds = rawIds.map((s: any) => String(s)).filter((s: string) => validMsgIds.has(s));
    out.push({ kind, label, payload, sourceMsgIds });
  }
  return out;
}

/** 规则回退抽取:agent 不可用 / 解析失败时保底产出。 */
export function heuristicExtract(msgs: WelinkMessageLite[], members: { 姓名: string; 角色: string }[]): NormalizedExtraction[] {
  if (msgs.length === 0) return [];
  // 1) entity = 所有发言人 + 出现次数
  const senderCount = new Map<string, number>();
  const senderMsgIds = new Map<string, string[]>();
  for (const m of msgs) {
    senderCount.set(m.author, (senderCount.get(m.author) ?? 0) + 1);
    const list = senderMsgIds.get(m.author) ?? [];
    if (list.length < 3) list.push(m.id);
    senderMsgIds.set(m.author, list);
  }
  const entities: NormalizedExtraction[] = [];
  for (const [sender, count] of [...senderCount.entries()].sort((a, b) => b[1] - a[1])) {
    entities.push({
      kind: "entity",
      label: sender,
      payload: { name: sender, appearedCount: count },
      sourceMsgIds: senderMsgIds.get(sender) ?? [],
    });
  }
  // 2) event = 首条 + 末条
  const events: NormalizedExtraction[] = [];
  const first = msgs[0];
  events.push({
    kind: "event",
    label: "首次发言",
    payload: { who: first.author, what: first.content.slice(0, 60), when: first.sentAt },
    sourceMsgIds: [first.id],
  });
  if (msgs.length > 1) {
    const last = msgs[msgs.length - 1];
    events.push({
      kind: "event",
      label: "最后发言",
      payload: { who: last.author, what: last.content.slice(0, 60), when: last.sentAt },
      sourceMsgIds: [last.id],
    });
  }
  // 3) decision/dispute 启发式空(规则回退不强行编)
  // 4) gap = 活跃发言人 - 已登记成员
  const memberSet = new Set(members.map((m) => m.姓名));
  const gaps: NormalizedExtraction[] = [];
  for (const sender of senderCount.keys()) {
    if (memberSet.has(sender)) continue;
    gaps.push({
      kind: "gap",
      label: `${sender} 未登记`,
      payload: {
        name: sender,
        appearedCount: senderCount.get(sender) ?? 0,
        suggestion: "建议加入攻关成员",
      },
      sourceMsgIds: senderMsgIds.get(sender) ?? [],
    });
  }
  return [...entities, ...events, ...gaps];
}

function insertExtractions(db: DB, ticketId: string, items: NormalizedExtraction[], createdBy: string): WelinkExtractionRow[] {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO welink_extractions (id, ticket_id, kind, label, payload, source_msg_ids, created_at, created_by, reviewed)
     VALUES (@id, @ticket_id, @kind, @label, @payload, @source_msg_ids, @created_at, @created_by, 0)`,
  );
  const out: WelinkExtractionRow[] = [];
  const tx = db.transaction((arr: NormalizedExtraction[]) => {
    for (const it of arr) {
      const id = randomUUID();
      const payload = it.payload == null ? "{}" : JSON.stringify(it.payload);
      const sourceMsgIds = it.sourceMsgIds.join(",");
      stmt.run({
        id,
        ticket_id: ticketId,
        kind: it.kind,
        label: it.label,
        payload,
        source_msg_ids: sourceMsgIds,
        created_at: now,
        created_by: createdBy,
      });
      out.push({
        id,
        ticketId,
        kind: it.kind,
        label: it.label,
        payload: it.payload,
        sourceMsgIds: it.sourceMsgIds,
        createdAt: now,
        createdBy,
        reviewed: false,
      });
    }
  });
  tx(items);
  return out;
}

export interface RunExtractionResult {
  queued: number;
  extracted: number;
  source: "agent" | "heuristic" | "agent+heuristic";
  extractions: WelinkExtractionRow[];
}

/**
 * 跑一次抽取流程:取 selected 消息 → 调 agent(可选) → 规则回退 → 落库 → 返回。
 * runner 为 undefined 时直接用启发式。
 */
export async function runWelinkExtraction(
  db: DB,
  repo: Repository,
  ticketId: string,
  runner: AgentRunner | undefined,
): Promise<RunExtractionResult> {
  const msgs = fetchSelectedMessages(db, ticketId);
  if (msgs.length === 0) {
    return { queued: 0, extracted: 0, source: "heuristic", extractions: [] };
  }
  const ticket = repo.getNode(ticketId);
  const title = String((ticket?.properties?.["标题"] as string) ?? ticketId);
  const members = fetchTicketMembers(repo, ticketId);

  let source: RunExtractionResult["source"] = "heuristic";
  let normalized: NormalizedExtraction[] = [];

  if (runner) {
    try {
      const prompt = buildExtractPrompt(ticketId, title, msgs, members.map((m) => m.姓名));
      const text = await runner.run(prompt);
      const parsed = tryParseAgentJson(text);
      if (parsed && parsed.length > 0) {
        normalized = normalizeAgentOutput(parsed, msgs);
        if (normalized.length > 0) source = "agent";
      } else {
        log.warn("welink.extract.agent_unparseable", { ticketId, textLen: text.length });
      }
    } catch (e) {
      log.warn("welink.extract.agent_fail", { ticketId, error: (e as Error).message });
    }
  }

  // runner 未启用或失败 → 启发式全集
  // runner 成功但漏了关键类(gap / entity)→ 启发式补全
  const heuristic = heuristicExtract(msgs, members);
  if (normalized.length === 0) {
    normalized = heuristic;
    source = "heuristic";
  } else {
    const haveGap = normalized.some((n) => n.kind === "gap");
    const haveEntity = normalized.some((n) => n.kind === "entity");
    if (!haveGap || !haveEntity) {
      const fill = heuristic.filter((h) => (!haveGap && h.kind === "gap") || (!haveEntity && h.kind === "entity"));
      if (fill.length > 0) {
        normalized = [...normalized, ...fill];
        source = "agent+heuristic";
      }
    }
  }

  const inserted = insertExtractions(db, ticketId, normalized, source === "heuristic" ? "heuristic" : "hermes");
  log.info("welink.extract.done", {
    ticketId,
    queued: msgs.length,
    extracted: inserted.length,
    source,
  });
  return { queued: msgs.length, extracted: inserted.length, source, extractions: inserted };
}

// CRUD on welink_extractions
export function listExtractions(db: DB, ticketId: string, opts?: { kind?: string; reviewed?: boolean | null }): WelinkExtractionRow[] {
  let sql = "SELECT * FROM welink_extractions WHERE ticket_id = ?";
  const params: any[] = [ticketId];
  if (opts?.kind) { sql += " AND kind = ?"; params.push(opts.kind); }
  if (opts?.reviewed != null) { sql += " AND reviewed = ?"; params.push(opts.reviewed ? 1 : 0); }
  sql += " ORDER BY created_at DESC";
  return (db.prepare(sql).all(...params) as any[]).map(rowToExtraction);
}

export function getExtraction(db: DB, id: string): WelinkExtractionRow | null {
  const r = db.prepare("SELECT * FROM welink_extractions WHERE id = ?").get(id) as any;
  return r ? rowToExtraction(r) : null;
}

export function updateExtraction(
  db: DB,
  id: string,
  patch: { reviewed?: boolean; label?: string; payload?: any },
): WelinkExtractionRow | null {
  const cur = getExtraction(db, id);
  if (!cur) return null;
  const next = {
    reviewed: patch.reviewed != null ? (patch.reviewed ? 1 : 0) : (cur.reviewed ? 1 : 0),
    label: patch.label != null ? patch.label : cur.label,
    payload: patch.payload != null ? JSON.stringify(patch.payload) : JSON.stringify(cur.payload),
  };
  db.prepare(
    "UPDATE welink_extractions SET reviewed = ?, label = ?, payload = ? WHERE id = ?",
  ).run(next.reviewed, next.label, next.payload, id);
  return getExtraction(db, id);
}

export function deleteExtraction(db: DB, id: string): boolean {
  const r = db.prepare("DELETE FROM welink_extractions WHERE id = ?").run(id);
  return r.changes > 0;
}
