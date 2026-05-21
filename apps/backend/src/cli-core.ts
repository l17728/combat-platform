// §43: Command-line interface core — a thin, declarative HTTP client over the
// backend API so agents (e.g. Hermes) can drive every operation from a Linux
// shell. Pure logic with an injected `http` fn → fully unit-testable, zero net
// coupling. Adding a new API ⇒ add one entry to COMMANDS (definition-of-done).

export interface HttpRequest { method: string; path: string; body?: unknown; }
export type HttpFn = (req: HttpRequest) => Promise<unknown>;

export interface ParsedArgs { positional: string[]; opts: Record<string, string | boolean>; }

export interface CliCommand {
  name: string;
  summary: string;
  usage: string;
  build: (pos: string[], opts: Record<string, string | boolean>) => HttpRequest;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { opts[key] = next; i++; }
      else opts[key] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? "?" + s : "";
}
function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function requirePos(pos: string[], n: number, usage: string): void {
  if (pos.length < n) throw new Error(`参数不足，用法：${usage}`);
}
function jsonOpt(opts: Record<string, string | boolean>, key: string): unknown {
  const raw = str(opts[key]);
  if (raw === undefined) throw new Error(`缺少 --${key} <json>`);
  try { return JSON.parse(raw); } catch { throw new Error(`--${key} 不是合法 JSON：${raw}`); }
}

export const COMMANDS: CliCommand[] = [
  // ---- reads ----
  { name: "dashboard", summary: "作战态势大盘汇总", usage: "dashboard",
    build: () => ({ method: "GET", path: "/api/dashboard" }) },
  { name: "nodes:list", summary: "列出某类型的节点（可加 --字段 值 过滤）", usage: "nodes:list <nodeType> [--<field> <value> ...]",
    build: (pos, opts) => { requirePos(pos, 1, "nodes:list <nodeType>");
      const f: Record<string, string> = {}; for (const [k, v] of Object.entries(opts)) if (typeof v === "string") f[k] = v;
      return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}${qs(f)}` }; } },
  { name: "nodes:get", summary: "按 id 取单个节点", usage: "nodes:get <id>",
    build: (pos) => { requirePos(pos, 1, "nodes:get <id>"); return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}` }; } },
  { name: "progress:list", summary: "列出某节点的进展序列", usage: "progress:list <id>",
    build: (pos) => { requirePos(pos, 1, "progress:list <id>"); return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}/progress` }; } },
  { name: "schema:get", summary: "取某类型的 schema 配置", usage: "schema:get <nodeType>",
    build: (pos) => { requirePos(pos, 1, "schema:get <nodeType>"); return { method: "GET", path: `/api/schema/${encodeURIComponent(pos[0])}` }; } },
  { name: "related", summary: "关联全景（1 跳，可 --depth N 多跳、--candidates 含候选）", usage: "related <nodeType> <id> [--depth N] [--candidates]",
    build: (pos, opts) => { requirePos(pos, 2, "related <nodeType> <id>");
      return { method: "GET", path: `/api/related/${encodeURIComponent(pos[0])}/${encodeURIComponent(pos[1])}${qs({ depth: str(opts.depth), includeCandidates: opts.candidates ? "1" : undefined })}` }; } },
  { name: "graph", summary: "KG 图形快照（--depth 1..3）", usage: "graph <nodeType> <id> [--depth N]",
    build: (pos, opts) => { requirePos(pos, 2, "graph <nodeType> <id>");
      return { method: "GET", path: `/api/graph/snapshot/${encodeURIComponent(pos[0])}/${encodeURIComponent(pos[1])}${qs({ depth: str(opts.depth) })}` }; } },
  { name: "conflicts:list", summary: "冲突/重叠对列表", usage: "conflicts:list",
    build: () => ({ method: "GET", path: "/api/conflicts" }) },
  { name: "audit:list", summary: "审计日志（--action --entityType --entityId --limit）", usage: "audit:list [--action A] [--entityType T] [--entityId ID] [--limit N]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/audit${qs({ action: str(opts.action), entityType: str(opts.entityType), entityId: str(opts.entityId), limit: str(opts.limit) })}` }) },
  { name: "merge:preview", summary: "人员合并预览（只读）", usage: "merge:preview --from <id> --to <id>",
    build: (_pos, opts) => ({ method: "GET", path: `/api/merge/preview${qs({ fromId: str(opts.from), toId: str(opts.to) })}` }) },
  { name: "daily-report", summary: "攻关日报（--date YYYY-MM-DD）", usage: "daily-report [--date YYYY-MM-DD]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/daily-report${qs({ date: str(opts.date) })}` }) },
  { name: "honor:leaderboard", summary: "荣誉排行榜（--period）", usage: "honor:leaderboard [--period P]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/honor/leaderboard${qs({ period: str(opts.period) })}` }) },
  { name: "honor:person", summary: "个人荣誉档案", usage: "honor:person <name>",
    build: (pos) => { requirePos(pos, 1, "honor:person <name>"); return { method: "GET", path: `/api/honor/person/${encodeURIComponent(pos[0])}` }; } },
  { name: "proposals:list", summary: "关系提议队列（--status）", usage: "proposals:list [--status S]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/proposals${qs({ status: str(opts.status) })}` }) },
  { name: "reminders:list", summary: "跟催提醒队列（--status）", usage: "reminders:list [--status S]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/reminders${qs({ status: str(opts.status) })}` }) },
  { name: "recommend:helpers", summary: "找帮手推荐（--limit N）", usage: "recommend:helpers <attackTicketId> [--limit N]",
    build: (pos, opts) => { requirePos(pos, 1, "recommend:helpers <id>"); return { method: "GET", path: `/api/recommend/helpers/${encodeURIComponent(pos[0])}${qs({ limit: str(opts.limit) })}` }; } },
  { name: "search", summary: "全文检索（--type 限定类型）", usage: "search <query> [--type T]",
    build: (pos, opts) => { requirePos(pos, 1, "search <query>"); return { method: "GET", path: `/api/query/search${qs({ q: pos.join(" "), type: str(opts.type) })}` }; } },
  { name: "context", summary: "某节点的查询上下文（关联+进展）", usage: "context <id>",
    build: (pos) => { requirePos(pos, 1, "context <id>"); return { method: "GET", path: `/api/query/context/${encodeURIComponent(pos[0])}` }; } },

  // ---- writes ----
  { name: "nodes:create", summary: "创建节点", usage: "nodes:create <nodeType> --data '<json>'",
    build: (pos, opts) => { requirePos(pos, 1, "nodes:create <nodeType> --data <json>"); return { method: "POST", path: `/api/nodes/${encodeURIComponent(pos[0])}`, body: jsonOpt(opts, "data") }; } },
  { name: "nodes:update", summary: "局部更新节点", usage: "nodes:update <id> --data '<json>'",
    build: (pos, opts) => { requirePos(pos, 1, "nodes:update <id> --data <json>"); return { method: "PUT", path: `/api/nodes/${encodeURIComponent(pos[0])}`, body: jsonOpt(opts, "data") }; } },
  { name: "nodes:delete", summary: "删除节点", usage: "nodes:delete <id>",
    build: (pos) => { requirePos(pos, 1, "nodes:delete <id>"); return { method: "DELETE", path: `/api/nodes/${encodeURIComponent(pos[0])}` }; } },
  { name: "nodes:transition", summary: "攻关单状态流转（原子追加 progress）", usage: "nodes:transition <id> --to <status> [--note <s>]",
    build: (pos, opts) => { requirePos(pos, 1, "nodes:transition <id> --to <status>"); return { method: "POST", path: `/api/nodes/${encodeURIComponent(pos[0])}/transition`, body: { toStatus: str(opts.to), note: str(opts.note) } }; } },
  { name: "progress:add", summary: "追加一条进展", usage: "progress:add <id> --content <s> [--status <s>]",
    build: (pos, opts) => { requirePos(pos, 1, "progress:add <id> --content <s>"); return { method: "POST", path: `/api/nodes/${encodeURIComponent(pos[0])}/progress`, body: { content: str(opts.content), statusSnapshot: str(opts.status), actor: "cli" } }; } },
  { name: "schema:patch", summary: "schema 字段操作（addField/retire/setAlias...）", usage: "schema:patch <nodeType> --op '<json>'",
    build: (pos, opts) => { requirePos(pos, 1, "schema:patch <nodeType> --op <json>"); return { method: "PATCH", path: `/api/schema/${encodeURIComponent(pos[0])}`, body: jsonOpt(opts, "op") }; } },
  { name: "schema:scan", summary: "重新扫描 schema 配置目录", usage: "schema:scan",
    build: () => ({ method: "POST", path: "/api/schema/scan" }) },
  { name: "conflicts:scan", summary: "重建冲突/重叠派生边", usage: "conflicts:scan",
    build: () => ({ method: "POST", path: "/api/conflicts/scan" }) },
  { name: "kg:rebuild", summary: "全量重建派生 KG", usage: "kg:rebuild",
    build: () => ({ method: "POST", path: "/api/kg/rebuild" }) },
  { name: "hermes:ask", summary: "Hermes 只读问答", usage: "hermes:ask <question>",
    build: (pos) => { requirePos(pos, 1, "hermes:ask <question>"); return { method: "POST", path: "/api/hermes/ask", body: { question: pos.join(" ") } }; } },
  { name: "merge:person", summary: "执行人员合并（不可逆）", usage: "merge:person --from <id> --to <id>",
    build: (_pos, opts) => ({ method: "POST", path: "/api/merge/person", body: { fromId: str(opts.from), toId: str(opts.to) } }) },
  { name: "proposals:scan", summary: "扫描生成候选关系提议", usage: "proposals:scan",
    build: () => ({ method: "POST", path: "/api/proposals/scan" }) },
  { name: "proposals:decide", summary: "审批一条提议", usage: "proposals:decide <id> --decision <已通过|已拒绝|已忽略> --by <人> [--target <id>]",
    build: (pos, opts) => { requirePos(pos, 1, "proposals:decide <id> --decision <d> --by <人>");
      const patch = str(opts.target) ? { targetNodeId: str(opts.target) } : undefined;
      return { method: "POST", path: `/api/proposals/${encodeURIComponent(pos[0])}/decide`, body: { decision: str(opts.decision), decidedBy: str(opts.by), patch } }; } },
  { name: "reminders:scan", summary: "扫描生成跟催提醒", usage: "reminders:scan",
    build: () => ({ method: "POST", path: "/api/reminders/scan" }) },
  { name: "reminders:send", summary: "发送一条提醒（stub 渠道）", usage: "reminders:send <id> --by <人>",
    build: (pos, opts) => { requirePos(pos, 1, "reminders:send <id> --by <人>"); return { method: "POST", path: `/api/reminders/${encodeURIComponent(pos[0])}/send`, body: { decidedBy: str(opts.by) } }; } },
  { name: "reminders:ignore", summary: "忽略一条提醒", usage: "reminders:ignore <id> --by <人>",
    build: (pos, opts) => { requirePos(pos, 1, "reminders:ignore <id> --by <人>"); return { method: "POST", path: `/api/reminders/${encodeURIComponent(pos[0])}/ignore`, body: { decidedBy: str(opts.by) } }; } },
];

export function renderHelp(commandName?: string): unknown {
  if (commandName && commandName !== "help") {
    const c = COMMANDS.find(x => x.name === commandName);
    if (!c) throw new Error(`未知命令：${commandName}`);
    return { name: c.name, summary: c.summary, usage: c.usage };
  }
  return {
    description: "作战管理工具 CLI — 每个后台 API 一条命令，供 agent 自查自调。用法：npm run cli -- <command> [args] [--opts]",
    commands: COMMANDS.map(c => ({ name: c.name, summary: c.summary, usage: c.usage }))
      .concat([{ name: "help", summary: "列出所有命令或某命令详情", usage: "help [command]" }]),
  };
}

export async function runCli(argv: string[], http: HttpFn): Promise<unknown> {
  const [name, ...rest] = argv;
  if (!name || name === "help") {
    const { positional } = parseArgs(rest);
    return renderHelp(positional[0]);
  }
  const cmd = COMMANDS.find(c => c.name === name);
  if (!cmd) {
    const names = COMMANDS.map(c => c.name).join(", ");
    throw new Error(`未知命令：${name}。可用命令：${names}, help`);
  }
  const { positional, opts } = parseArgs(rest);
  const req = cmd.build(positional, opts);
  return http(req);
}
