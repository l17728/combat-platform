// v2.5 Hermes 通用检索工具集 (read-only)
//
// 14 个只读工具,由 LLM tool-calling 协议驱动,也由 HTTP `/api/hermes/tool/:name`
// 暴露给外部脚手架。每个工具都有:
//   - inputSchema  : JSON Schema (LLM 用来生成参数 / 后端用来校验)
//   - description  : LLM prompt 用的人类语言说明
//   - execute(input, ctx) : 实际实现
//
// 安全:
//   - 私单 (attackTicket.私密=='是') 必须经过 filterAccessibleTickets() 收口
//   - 所有 SQL 参数化,filter DSL 拒绝任何非白名单字符 key
//   - 输出 >32KB 自动截断,附 _truncated:true
//   - 写工具默认禁用,占位见 hermes-tools-write.ts
//
// 与 hermes-agent.ts / opencode 集成: 提供 callTool(name, input, ctx) 进程内调用入口。

import type { Repository, SchemaRegistry, GraphNode, GraphEdge, ProgressLog, AuditLogEntry } from "@combat/shared";
import type { DbAdapter } from "./db-adapter.js";
import { filterAccessibleTickets, isPrivateTicket } from "./private-tickets.js";
import { buildRelated } from "./related-core.js";
import { recommendHelpers } from "./recommend.js";
import { log } from "./logger.js";
import type { DB } from "./db.js";

// ---------------------------------------------------------------------------
// 通用类型 / context
// ---------------------------------------------------------------------------

export interface HermesToolCtx {
  repo: Repository;
  registry: SchemaRegistry;
  adapter?: DbAdapter;
  db?: DB; // 兼容 welink 工具直接读 sqlite
  user?: { username?: string; displayName?: string; role?: string };
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  detail?: unknown;
  _truncated?: boolean;
}

export type Filter = Record<string, unknown>;

export interface ToolDefinition<I = any, O = any> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema(draft-07 子集)
  execute: (input: I, ctx: HermesToolCtx) => Promise<O>;
}

// ---------------------------------------------------------------------------
// 输出大小约束 (32KB)
// ---------------------------------------------------------------------------

export const MAX_OUTPUT_BYTES = 32 * 1024;

export function enforceSize<T>(data: T): { data: T; _truncated?: true } {
  const json = JSON.stringify(data);
  if (json.length <= MAX_OUTPUT_BYTES) return { data };
  // 数组 → 二分截尾,直到能塞下
  if (Array.isArray(data)) {
    let lo = 0,
      hi = data.length;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const slice = data.slice(0, mid);
      if (JSON.stringify(slice).length <= MAX_OUTPUT_BYTES - 32) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { data: data.slice(0, best) as unknown as T, _truncated: true };
  }
  // 其它结构 → 整体置空对象 + 错误信息
  return { data: { _error: "output exceeds 32KB", _byteSize: json.length } as unknown as T, _truncated: true };
}

// ---------------------------------------------------------------------------
// Filter DSL → SQL
// ---------------------------------------------------------------------------

// 允许的字段名:中文 + 字母数字下划线。拒绝任何 ' " \ ; -- /* */ 等注入字符。
const KEY_RE = /^[A-Za-z0-9_一-鿿]+$/;
const ALLOWED_OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in", "like"]);
const TOP_LEVEL_KEYS: Record<string, string> = {
  nodeType: '"nodeType"',
  id: "id",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export function validateFilter(filter: Filter | undefined): string | null {
  if (!filter) return null;
  if (typeof filter !== "object" || Array.isArray(filter)) return "filter 必须是对象";
  for (const key of Object.keys(filter)) {
    if (!TOP_LEVEL_KEYS[key] && !KEY_RE.test(key)) {
      return `非法字段名: ${JSON.stringify(key)}`;
    }
    const v = (filter as any)[key];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const op = (v as any).op;
      if (typeof op !== "string" || !ALLOWED_OPS.has(op)) {
        return `非法操作符: ${JSON.stringify(op)}`;
      }
      if (op === "in" && !Array.isArray((v as any).val)) {
        return `in 操作符需要 array val`;
      }
    }
  }
  return null;
}

function colExpr(key: string): string {
  if (TOP_LEVEL_KEYS[key]) return TOP_LEVEL_KEYS[key];
  // json_extract 兼容 SQLite + Postgres(我们用 json_extract,Postgres 走 json_extract_path_text
  // 这里 SQLite-first;Postgres 的 properties 是 JSONB,实际部署仍是 SQLite,
  // 后续可在 adapter.kind 分支)
  return `json_extract(properties, '$."${key}"')`;
}

export function filterToSql(filter: Filter | undefined): { sql: string; params: unknown[] } {
  if (!filter) return { sql: "", params: [] };
  const err = validateFilter(filter);
  if (err) throw new Error(err);
  const wh: string[] = [];
  const params: unknown[] = [];
  for (const [key, raw] of Object.entries(filter)) {
    const col = colExpr(key);
    if (raw === null) {
      wh.push(`${col} IS NULL`);
      continue;
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const { op, val } = raw as { op: string; val: unknown };
      switch (op) {
        case "eq":
          wh.push(`${col} = ?`);
          params.push(val);
          break;
        case "ne":
          wh.push(`${col} != ?`);
          params.push(val);
          break;
        case "gt":
          wh.push(`${col} > ?`);
          params.push(val);
          break;
        case "gte":
          wh.push(`${col} >= ?`);
          params.push(val);
          break;
        case "lt":
          wh.push(`${col} < ?`);
          params.push(val);
          break;
        case "lte":
          wh.push(`${col} <= ?`);
          params.push(val);
          break;
        case "in": {
          if (!Array.isArray(val)) throw new Error("in 操作符需要 array val");
          if (val.length === 0) {
            wh.push(`1=0`);
            break;
          }
          const ph = val.map(() => "?").join(", ");
          wh.push(`${col} IN (${ph})`);
          for (const v of val) params.push(v);
          break;
        }
        case "like": {
          wh.push(`${col} LIKE ?`);
          params.push(`%${String(val)}%`);
          break;
        }
        default:
          throw new Error(`非法操作符: ${op}`);
      }
    } else {
      // 简写等值
      wh.push(`${col} = ?`);
      params.push(raw);
    }
  }
  return { sql: wh.join(" AND "), params };
}

// 内存里再过一次,以防 properties 里数字/布尔在 sqlite 下 json_extract 类型不同
function filterInMemory(rows: GraphNode[], filter: Filter | undefined): GraphNode[] {
  if (!filter) return rows;
  return rows.filter((n) => {
    for (const [key, raw] of Object.entries(filter)) {
      const v = TOP_LEVEL_KEYS[key]
        ? key === "nodeType"
          ? n.nodeType
          : key === "id"
            ? n.id
            : key === "createdAt"
              ? n.createdAt
              : n.updatedAt
        : n.properties[key];
      if (raw === null) {
        if (v !== null && v !== undefined) return false;
        continue;
      }
      if (typeof raw === "object" && !Array.isArray(raw)) {
        const { op, val } = raw as { op: string; val: unknown };
        if (!compareOp(op, v, val)) return false;
      } else if (String(v ?? "") !== String(raw)) {
        return false;
      }
    }
    return true;
  });
}

function compareOp(op: string, v: unknown, val: unknown): boolean {
  const s = String(v ?? "");
  const t = String(val ?? "");
  switch (op) {
    case "eq":
      return s === t;
    case "ne":
      return s !== t;
    case "gt":
      return s > t;
    case "gte":
      return s >= t;
    case "lt":
      return s < t;
    case "lte":
      return s <= t;
    case "in":
      return Array.isArray(val) && val.some((x) => String(x) === s);
    case "like":
      return s.toLowerCase().includes(t.toLowerCase());
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// 私单收口
// ---------------------------------------------------------------------------

async function gateAttackTickets(ctx: HermesToolCtx, rows: GraphNode[]): Promise<GraphNode[]> {
  return filterAccessibleTickets(ctx.repo, rows, ctx.user);
}

async function gateNode(ctx: HermesToolCtx, node: GraphNode): Promise<GraphNode | null> {
  if (node.nodeType !== "attackTicket") return node;
  if (!isPrivateTicket(node)) return node;
  const allowed = await filterAccessibleTickets(ctx.repo, [node], ctx.user);
  return allowed.length > 0 ? node : null;
}

// ---------------------------------------------------------------------------
// 入参辅助
// ---------------------------------------------------------------------------

function requireStr(input: any, key: string): string {
  const v = input?.[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`bad_input: 缺少 ${key}`);
  }
  return v;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function summarizeNode(n: GraphNode): string {
  const p = n.properties;
  return String(
    p["标题"] ??
      p["攻关单号"] ??
      p["版本号"] ??
      p["名称"] ??
      p["姓名"] ??
      p["贡献人"] ??
      p["组名"] ??
      p["key"] ??
      p["经验"] ??
      p["问题说明"] ??
      p["告警问题"] ??
      p["事件标题"] ??
      p["事项描述"] ??
      p["name"] ??
      n.id
  );
}

// ---------------------------------------------------------------------------
// Tools — 14 只读工具
// ---------------------------------------------------------------------------

// 1. list_node_types
const listNodeTypes: ToolDefinition = {
  name: "list_node_types",
  description: "列出所有已注册的 nodeType + 字段定义,LLM 在不知道数据形态时第一调用",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute(_input, ctx) {
    const config = ctx.registry.getConfig();
    return config.nodeTypes.map((nt) => ({
      nodeType: nt.nodeType,
      label: nt.label,
      fields: nt.fields.map((f) => ({
        name: f.name,
        type: f.type,
        required: !!f.required,
        ...(f.enumValues ? { enumValues: f.enumValues } : {}),
      })),
    }));
  },
};

// 2. describe_node_type
const describeNodeType: ToolDefinition = {
  name: "describe_node_type",
  description: "返回单个 nodeType 的完整 schema + 一条样例(若有)",
  inputSchema: {
    type: "object",
    properties: { nodeType: { type: "string" } },
    required: ["nodeType"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const nodeType = requireStr(input, "nodeType");
    const schema = ctx.registry.getNodeSchema(nodeType);
    if (!schema) throw new Error(`未知 nodeType: ${nodeType}`);
    let sample: GraphNode | null = null;
    const rows = await ctx.repo.queryNodes(nodeType);
    if (rows.length > 0) {
      // 若是 attackTicket,样例也要尊重私单收口
      const gated = nodeType === "attackTicket" ? await gateAttackTickets(ctx, rows) : rows;
      sample = gated[0] ?? null;
    }
    return { schema, sample };
  },
};

// 3. count_nodes
const countNodes: ToolDefinition = {
  name: "count_nodes",
  description: "按 filter 数 nodeType 节点数 (attackTicket 自动尊重私单可见性)",
  inputSchema: {
    type: "object",
    properties: {
      nodeType: { type: "string" },
      filter: { type: "object" },
    },
    required: ["nodeType"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const nodeType = requireStr(input, "nodeType");
    if (!ctx.registry.getNodeSchema(nodeType)) throw new Error(`未知 nodeType: ${nodeType}`);
    const filter = input.filter as Filter | undefined;
    const vfErr = validateFilter(filter);
    if (vfErr) throw new Error(vfErr);
    let rows = await ctx.repo.queryNodes(nodeType);
    if (nodeType === "attackTicket") rows = await gateAttackTickets(ctx, rows);
    rows = filterInMemory(rows, filter);
    return { count: rows.length };
  },
};

// 4. query_nodes
const queryNodesTool: ToolDefinition = {
  name: "query_nodes",
  description: "按 filter+sort 查 nodeType 节点列表 (limit<=50;attackTicket 私单自动过滤)",
  inputSchema: {
    type: "object",
    properties: {
      nodeType: { type: "string" },
      filter: { type: "object" },
      limit: { type: "number" },
      offset: { type: "number" },
      sort: { type: "object" },
    },
    required: ["nodeType"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const nodeType = requireStr(input, "nodeType");
    if (!ctx.registry.getNodeSchema(nodeType)) throw new Error(`未知 nodeType: ${nodeType}`);
    const filter = input.filter as Filter | undefined;
    {
      const vfErr = validateFilter(filter);
      if (vfErr) throw new Error(vfErr);
    }
    const limit = clampInt(input.limit, 1, 50, 20);
    const offset = clampInt(input.offset, 0, 10000, 0);
    let rows = await ctx.repo.queryNodes(nodeType);
    if (nodeType === "attackTicket") rows = await gateAttackTickets(ctx, rows);
    rows = filterInMemory(rows, filter);
    if (input.sort && typeof input.sort === "object") {
      const { field, dir } = input.sort as { field: string; dir?: string };
      if (field && (KEY_RE.test(field) || TOP_LEVEL_KEYS[field])) {
        const sign = dir === "asc" ? 1 : -1;
        rows.sort((a, b) => {
          const va = TOP_LEVEL_KEYS[field]
            ? field === "nodeType"
              ? a.nodeType
              : field === "id"
                ? a.id
                : field === "createdAt"
                  ? a.createdAt
                  : a.updatedAt
            : (a.properties[field] ?? "");
          const vb = TOP_LEVEL_KEYS[field]
            ? field === "nodeType"
              ? b.nodeType
              : field === "id"
                ? b.id
                : field === "createdAt"
                  ? b.createdAt
                  : b.updatedAt
            : (b.properties[field] ?? "");
          if (va < vb) return -1 * sign;
          if (va > vb) return 1 * sign;
          return 0;
        });
      }
    }
    const slice = rows.slice(offset, offset + limit).map((n) => ({
      id: n.id,
      nodeType: n.nodeType,
      properties: n.properties,
      updatedAt: n.updatedAt,
      createdAt: n.createdAt,
    }));
    return slice;
  },
};

// 5. get_node
const getNodeTool: ToolDefinition = {
  name: "get_node",
  description: "按 id 取节点 + 最近 5 条进展 + in/out 关系(私单不可访问时 404)",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const id = requireStr(input, "id");
    const node = await ctx.repo.getNode(id);
    if (!node) throw new Error("not_found");
    const gated = await gateNode(ctx, node);
    if (!gated) throw new Error("forbidden");
    const progressAll = await ctx.repo.listProgress(id);
    const progress = progressAll.slice(-5);
    const related = await buildRelated(ctx.repo, id);
    return {
      node: gated,
      progress,
      related: {
        outgoing: related.outgoing.map((r) => ({ field: r.field, node: r.node })),
        incoming: related.incoming.map((r) => ({ field: r.field, node: r.node })),
      },
    };
  },
};

// 6. search_text
const searchTextTool: ToolDefinition = {
  name: "search_text",
  description: "跨 nodeType 全文模糊搜索 (limit<=20,attackTicket 私单自动过滤)",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string" },
      scope: { type: "array", items: { type: "string" } },
      limit: { type: "number" },
    },
    required: ["q"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const q = requireStr(input, "q");
    const limit = clampInt(input.limit, 1, 20, 10);
    const needle = q.toLowerCase();
    const allTypes = ctx.registry.getConfig().nodeTypes.map((n) => n.nodeType);
    const scope =
      Array.isArray(input.scope) && input.scope.length > 0
        ? input.scope.filter((t: string) => allTypes.includes(t))
        : allTypes;
    const hits: { id: string; nodeType: string; summary: string; score: number }[] = [];
    for (const nt of scope) {
      let rows = await ctx.repo.queryNodes(nt);
      if (nt === "attackTicket") rows = await gateAttackTickets(ctx, rows);
      for (const n of rows) {
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
        if (score > 0) hits.push({ id: n.id, nodeType: n.nodeType, summary: summarizeNode(n), score });
      }
    }
    hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return hits.slice(0, limit);
  },
};

// 7. traverse_graph
const traverseGraphTool: ToolDefinition = {
  name: "traverse_graph",
  description: "从 startId BFS 遍历图,可指定 edgeTypes 白名单, depth 1-3, 节点上限 200",
  inputSchema: {
    type: "object",
    properties: {
      startId: { type: "string" },
      edgeTypes: { type: "array", items: { type: "string" } },
      depth: { type: "number" },
    },
    required: ["startId"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const startId = requireStr(input, "startId");
    const depth = clampInt(input.depth, 1, 3, 1);
    const edgeTypeFilter = Array.isArray(input.edgeTypes) ? new Set<string>(input.edgeTypes) : null;
    const start = await ctx.repo.getNode(startId);
    if (!start) throw new Error("not_found");
    const gatedStart = await gateNode(ctx, start);
    if (!gatedStart) throw new Error("forbidden");
    const visited = new Map<string, GraphNode>();
    visited.set(start.id, start);
    const edges: GraphEdge[] = [];
    let frontier: string[] = [start.id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const nid of frontier) {
        const out = await ctx.repo.queryEdges({ sourceId: nid });
        const inc = await ctx.repo.queryEdges({ targetId: nid });
        for (const e of [...out, ...inc]) {
          if (edgeTypeFilter && !edgeTypeFilter.has(e.edgeType)) continue;
          edges.push(e);
          const other = e.sourceId === nid ? e.targetId : e.sourceId;
          if (visited.has(other)) continue;
          if (visited.size >= 200) break;
          const peer = await ctx.repo.getNode(other);
          if (!peer) continue;
          // 私单 gating
          if (peer.nodeType === "attackTicket" && isPrivateTicket(peer)) {
            const allowed = await filterAccessibleTickets(ctx.repo, [peer], ctx.user);
            if (allowed.length === 0) continue;
          }
          visited.set(other, peer);
          next.push(other);
        }
        if (visited.size >= 200) break;
      }
      frontier = next;
      if (visited.size >= 200) break;
    }
    return {
      nodes: Array.from(visited.values()).map((n) => ({ id: n.id, nodeType: n.nodeType, properties: n.properties })),
      edges: edges.map((e) => ({ id: e.id, edgeType: e.edgeType, sourceId: e.sourceId, targetId: e.targetId })),
    };
  },
};

// 8. get_progress
const getProgressTool: ToolDefinition = {
  name: "get_progress",
  description: "取节点的 ProgressLog 序列,默认升序,limit<=20",
  inputSchema: {
    type: "object",
    properties: { nodeId: { type: "string" }, limit: { type: "number" } },
    required: ["nodeId"],
    additionalProperties: false,
  },
  async execute(input, ctx): Promise<ProgressLog[]> {
    const nodeId = requireStr(input, "nodeId");
    const node = await ctx.repo.getNode(nodeId);
    if (!node) throw new Error("not_found");
    const gated = await gateNode(ctx, node);
    if (!gated) throw new Error("forbidden");
    const limit = clampInt(input.limit, 1, 20, 20);
    const all = await ctx.repo.listProgress(nodeId);
    return all.slice(-limit);
  },
};

// 9. get_audit
const getAuditTool: ToolDefinition = {
  name: "get_audit",
  description: "审计日志查询 (action/actor/since/until/limit),涉及私单节点自动过滤",
  inputSchema: {
    type: "object",
    properties: {
      entityId: { type: "string" },
      actor: { type: "string" },
      action: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      limit: { type: "number" },
    },
    additionalProperties: false,
  },
  async execute(input, ctx): Promise<AuditLogEntry[]> {
    const limit = clampInt(input.limit, 1, 50, 50);
    const rows = await ctx.repo.listAuditLog({
      action: input.action ? String(input.action) : undefined,
      entityId: input.entityId ? String(input.entityId) : undefined,
      limit: 200, // 多拿点,过滤后再切片
    });
    let filtered = rows;
    if (input.actor) filtered = filtered.filter((r) => r.performedBy === String(input.actor));
    if (input.since) {
      const t = String(input.since);
      filtered = filtered.filter((r) => r.performedAt >= t);
    }
    if (input.until) {
      const t = String(input.until);
      filtered = filtered.filter((r) => r.performedAt <= t);
    }
    // 私单过滤:对 entityType=node + nodeType=attackTicket + 私密 → 用户无权时剔除
    if (ctx.user?.username) {
      const out: AuditLogEntry[] = [];
      for (const r of filtered) {
        if (r.entityType !== "node") {
          out.push(r);
          continue;
        }
        const node = await ctx.repo.getNode(r.entityId);
        if (!node) {
          out.push(r);
          continue;
        }
        if (node.nodeType !== "attackTicket" || !isPrivateTicket(node)) {
          out.push(r);
          continue;
        }
        const allowed = await filterAccessibleTickets(ctx.repo, [node], ctx.user);
        if (allowed.length > 0) out.push(r);
      }
      filtered = out;
    }
    return filtered.slice(0, limit);
  },
};

// 10. aggregate
const aggregateTool: ToolDefinition = {
  name: "aggregate",
  description: "按 groupBy 字段聚合 count/sum/avg (attackTicket 私单自动过滤)",
  inputSchema: {
    type: "object",
    properties: {
      nodeType: { type: "string" },
      groupBy: { type: "string" },
      agg: { type: "string" },
      filter: { type: "object" },
      having: { type: "object" },
    },
    required: ["nodeType", "groupBy"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const nodeType = requireStr(input, "nodeType");
    const groupBy = requireStr(input, "groupBy");
    if (!ctx.registry.getNodeSchema(nodeType)) throw new Error(`未知 nodeType: ${nodeType}`);
    if (!KEY_RE.test(groupBy) && !TOP_LEVEL_KEYS[groupBy]) throw new Error(`非法 groupBy: ${groupBy}`);
    const filter = input.filter as Filter | undefined;
    {
      const vfErr = validateFilter(filter);
      if (vfErr) throw new Error(vfErr);
    }
    const agg = String(input.agg ?? "count");
    let aggOp = "count";
    let aggField = "";
    if (agg.includes(":")) {
      const [op, field] = agg.split(":");
      if (!["sum", "avg"].includes(op)) throw new Error(`非法 agg: ${agg}`);
      if (!KEY_RE.test(field)) throw new Error(`非法 agg 字段: ${field}`);
      aggOp = op;
      aggField = field;
    } else if (agg !== "count") {
      throw new Error(`非法 agg: ${agg}`);
    }
    let rows = await ctx.repo.queryNodes(nodeType);
    if (nodeType === "attackTicket") rows = await gateAttackTickets(ctx, rows);
    rows = filterInMemory(rows, filter);
    const groups = new Map<string, { count: number; sum: number; n: number }>();
    for (const n of rows) {
      const key = TOP_LEVEL_KEYS[groupBy]
        ? groupBy === "nodeType"
          ? n.nodeType
          : groupBy === "id"
            ? n.id
            : groupBy === "createdAt"
              ? n.createdAt
              : n.updatedAt
        : String(n.properties[groupBy] ?? "");
      const e = groups.get(key) ?? { count: 0, sum: 0, n: 0 };
      e.count++;
      if (aggField) {
        const v = Number(n.properties[aggField]);
        if (Number.isFinite(v)) {
          e.sum += v;
          e.n++;
        }
      }
      groups.set(key, e);
    }
    const out: { key: string; value: number }[] = [];
    for (const [key, e] of groups) {
      let value: number;
      if (aggOp === "count") value = e.count;
      else if (aggOp === "sum") value = e.sum;
      else value = e.n > 0 ? e.sum / e.n : 0;
      out.push({ key, value });
    }
    out.sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
    return out;
  },
};

// 11. dashboard_metric
const dashboardMetricTool: ToolDefinition = {
  name: "dashboard_metric",
  description: "预聚合指标 (活跃攻关单/待审批提议/今日进展/...);key 缺省返回全部",
  inputSchema: {
    type: "object",
    properties: { key: { type: "string" } },
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const OPEN = new Set(["待响应", "处理中", "进行中"]);
    const RESOLVED = new Set(["已解决", "已关闭"]);
    let tks = await ctx.repo.queryNodes("attackTicket");
    tks = await gateAttackTickets(ctx, tks);
    let open = 0,
      resolved = 0;
    for (const t of tks) {
      const s = String(t.properties["状态"] ?? "");
      if (OPEN.has(s)) open++;
      else if (RESOLVED.has(s)) resolved++;
    }
    const contributions = await ctx.repo.queryNodes("contribution");
    const proposalsPending = (await ctx.repo.listProposals({ status: "待审批" })).length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    let progressToday = 0;
    for (const p of await ctx.repo.listAllProgress()) {
      const at = new Date(p.updatedAt);
      if (at >= today && at < tomorrow) progressToday++;
    }
    const metrics: Record<string, number> = {
      活跃攻关单: open,
      已完成攻关单: resolved,
      攻关单总数: tks.length,
      贡献总数: contributions.length,
      待审批提议: proposalsPending,
      今日进展: progressToday,
    };
    const key = input?.key ? String(input.key) : undefined;
    if (key) {
      if (!(key in metrics)) throw new Error(`未知指标: ${key}`);
      return { key, value: metrics[key] };
    }
    return metrics;
  },
};

// 12. recommend_helpers
const recommendHelpersTool: ToolDefinition = {
  name: "recommend_helpers",
  description: "为某攻关单推荐合适的帮手 (复用现有推荐算法,Top N)",
  inputSchema: {
    type: "object",
    properties: { ticketId: { type: "string" }, limit: { type: "number" } },
    required: ["ticketId"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const ticketId = requireStr(input, "ticketId");
    const node = await ctx.repo.getNode(ticketId);
    if (!node) throw new Error("not_found");
    if (node.nodeType !== "attackTicket") throw new Error("仅支持 attackTicket");
    const gated = await gateNode(ctx, node);
    if (!gated) throw new Error("forbidden");
    const limit = clampInt(input.limit, 1, 20, 10);
    const helpers = await recommendHelpers(ctx.repo, ticketId, limit);
    return helpers.map((h) => ({
      personId: h.person.id,
      name: String(h.person.properties["姓名"] ?? h.person.properties["name"] ?? h.person.id),
      score: h.score,
      reasons: h.reasons,
    }));
  },
};

// 13. ticket_tabs
const ticketTabsTool: ToolDefinition = {
  name: "ticket_tabs",
  description: "列出某攻关单挂载的动态 Tab (markdown / dashboard 等)",
  inputSchema: {
    type: "object",
    properties: { ticketId: { type: "string" } },
    required: ["ticketId"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const ticketId = requireStr(input, "ticketId");
    const node = await ctx.repo.getNode(ticketId);
    if (!node) throw new Error("not_found");
    const gated = await gateNode(ctx, node);
    if (!gated) throw new Error("forbidden");
    if (!ctx.adapter) return [];
    const rows = await ctx.adapter.query<any>(
      `SELECT id, ticket_id, tab_type, title, tab_order, config, content, created_by, created_at, updated_at
       FROM ticket_tabs WHERE ticket_id = ? ORDER BY tab_order, created_at`,
      [ticketId]
    );
    return rows.map((r) => ({
      id: r.id,
      tabType: r.tab_type,
      title: r.title,
      order: r.tab_order,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },
};

// 14. welink — 三个工具统一聚合到 tools 注册表 (实现复用 welink router 内逻辑)
const welinkSearchTool: ToolDefinition = {
  name: "welink_search",
  description: "在攻关单的 welink 消息里关键词搜索 (limit<=50)",
  inputSchema: {
    type: "object",
    properties: { ticketId: { type: "string" }, q: { type: "string" }, limit: { type: "number" } },
    required: ["ticketId", "q"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.db) throw new Error("welink 工具需要 sqlite DB 句柄");
    const ticketId = requireStr(input, "ticketId");
    const q = requireStr(input, "q");
    const limit = clampInt(input.limit, 1, 50, 50);
    const rows = ctx.db
      .prepare(
        `SELECT id, message_id, sent_at, author, content
         FROM welink_messages
         WHERE ticket_id = ? AND deleted_at IS NULL AND content LIKE ?
         ORDER BY sent_at ASC LIMIT ?`
      )
      .all(ticketId, `%${q}%`, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      messageId: r.message_id,
      sentAt: r.sent_at,
      author: r.author,
      content: r.content,
    }));
  },
};

const welinkTimelineTool: ToolDefinition = {
  name: "welink_timeline",
  description: "列出某攻关单 welink 群消息时间线 (limit<=500)",
  inputSchema: {
    type: "object",
    properties: { ticketId: { type: "string" }, limit: { type: "number" } },
    required: ["ticketId"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.db) throw new Error("welink 工具需要 sqlite DB 句柄");
    const ticketId = requireStr(input, "ticketId");
    const limit = clampInt(input.limit, 1, 500, 200);
    const rows = ctx.db
      .prepare(
        `SELECT id, message_id, sent_at, author, content
         FROM welink_messages
         WHERE ticket_id = ? AND deleted_at IS NULL
         ORDER BY sent_at ASC LIMIT ?`
      )
      .all(ticketId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      messageId: r.message_id,
      sentAt: r.sent_at,
      author: r.author,
      content: r.content,
    }));
  },
};

const welinkGapAnalysisTool: ToolDefinition = {
  name: "welink_gap_analysis",
  description: "分析 welink 活跃发言人 vs 攻关单成员名单的缺口 (返回未加入的活跃人)",
  inputSchema: {
    type: "object",
    properties: { ticketId: { type: "string" } },
    required: ["ticketId"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.db) throw new Error("welink 工具需要 sqlite DB 句柄");
    const ticketId = requireStr(input, "ticketId");
    const node = await ctx.repo.getNode(ticketId);
    if (!node) throw new Error("not_found");
    const gated = await gateNode(ctx, node);
    if (!gated) throw new Error("forbidden");
    const rows = ctx.db
      .prepare(
        `SELECT author, COUNT(*) AS c
         FROM welink_messages
         WHERE ticket_id = ? AND deleted_at IS NULL
         GROUP BY author
         ORDER BY c DESC`
      )
      .all(ticketId) as Array<{ author: string; c: number }>;
    // 成员名单
    const memberRaw = node.properties["成员列表"];
    const memberNames = new Set<string>();
    if (typeof memberRaw === "string") {
      try {
        const arr = JSON.parse(memberRaw);
        if (Array.isArray(arr)) {
          for (const m of arr) {
            const n = String(m?.["姓名"] ?? "").trim();
            if (n) memberNames.add(n);
          }
        }
      } catch {
        /* ignore */
      }
    }
    const gap: { author: string; appearedCount: number }[] = [];
    for (const r of rows) {
      if (!memberNames.has(r.author)) gap.push({ author: r.author, appearedCount: r.c });
    }
    return {
      ticketId,
      activeSenders: rows.map((r) => ({ author: r.author, count: r.c })),
      members: Array.from(memberNames),
      gap,
    };
  },
};

// ---------------------------------------------------------------------------
// 工具注册表 (单一出口)
// ---------------------------------------------------------------------------

export const ALL_TOOLS: ToolDefinition[] = [
  listNodeTypes,
  describeNodeType,
  countNodes,
  queryNodesTool,
  getNodeTool,
  searchTextTool,
  traverseGraphTool,
  getProgressTool,
  getAuditTool,
  aggregateTool,
  dashboardMetricTool,
  recommendHelpersTool,
  ticketTabsTool,
  welinkSearchTool,
  welinkTimelineTool,
  welinkGapAnalysisTool,
];

const TOOL_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function listTools(): { name: string; description: string }[] {
  return ALL_TOOLS.map((t) => ({ name: t.name, description: t.description }));
}

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_BY_NAME.get(name);
}

// ---------------------------------------------------------------------------
// 统一调用入口 — 给 hermes-agent 与 HTTP 共用
// ---------------------------------------------------------------------------

export async function callTool(name: string, input: unknown, ctx: HermesToolCtx): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, error: "unknown_tool", detail: name };
  }
  const t0 = Date.now();
  try {
    const raw = await tool.execute((input ?? {}) as any, ctx);
    const { data, _truncated } = enforceSize(raw);
    const elapsed = Date.now() - t0;
    log.info("hermes.tool.invoke", {
      tool: name,
      user: ctx.user?.username || "(anon)",
      durationMs: elapsed,
      ok: true,
      truncated: !!_truncated,
    });
    return { ok: true, data, ...(_truncated ? { _truncated: true } : {}) };
  } catch (e) {
    const elapsed = Date.now() - t0;
    const msg = (e as Error).message;
    log.warn("hermes.tool.invoke", {
      tool: name,
      user: ctx.user?.username || "(anon)",
      durationMs: elapsed,
      ok: false,
      error: msg,
    });
    return { ok: false, error: "bad_input", detail: msg };
  }
}
