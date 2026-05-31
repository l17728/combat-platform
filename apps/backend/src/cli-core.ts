// §43: Command-line interface core — a thin, declarative HTTP client over the
// backend API so agents (e.g. Hermes) can drive every operation from a Linux
// shell. Pure logic with an injected `http` fn → fully unit-testable, zero net
// coupling. Adding a new API ⇒ add one entry to COMMANDS (definition-of-done).

export interface HttpRequest {
  method: string;
  path: string;
  body?: unknown;
  uploadFile?: string; // §44: local file path → multipart "file" field
  saveTo?: string; // §44: write binary response body to this local path
}
export type HttpFn = (req: HttpRequest) => Promise<unknown>;

export interface ParsedArgs {
  positional: string[];
  opts: Record<string, string | boolean>;
}

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
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else opts[key] = true;
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
/** Comma-separated option → trimmed non-empty string[]; undefined when not provided. */
function csv(v: string | boolean | undefined): string[] | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const arr = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return arr.length > 0 ? arr : undefined;
}
function jsonOpt(opts: Record<string, string | boolean>, key: string): unknown {
  const raw = str(opts[key]);
  if (raw === undefined) throw new Error(`缺少 --${key} <json>`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`--${key} 不是合法 JSON：${raw}`);
  }
}

export const COMMANDS: CliCommand[] = [
  // ---- reads ----
  {
    name: "dashboard",
    summary: "作战态势大盘汇总",
    usage: "dashboard",
    build: () => ({ method: "GET", path: "/api/dashboard" }),
  },
  {
    name: "nodes:list",
    summary: "列出某 nodeType 的全部节点（任意已注册 nodeType；--字段 值 等值过滤，可多个）",
    usage: "nodes:list <nodeType> [--<field> <value> ...]",
    build: (pos, opts) => {
      requirePos(pos, 1, "nodes:list <nodeType>");
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(opts)) if (typeof v === "string") f[k] = v;
      return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}${qs(f)}` };
    },
  },
  {
    name: "nodes:get",
    summary: "按 id 取单个节点（任意 nodeType）",
    usage: "nodes:get <id>",
    build: (pos) => {
      requirePos(pos, 1, "nodes:get <id>");
      return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "progress:list",
    summary: "列出某节点的进展序列",
    usage: "progress:list <id>",
    build: (pos) => {
      requirePos(pos, 1, "progress:list <id>");
      return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}/progress` };
    },
  },
  {
    name: "schema:get",
    summary: "取某类型的 schema 配置",
    usage: "schema:get <nodeType>",
    build: (pos) => {
      requirePos(pos, 1, "schema:get <nodeType>");
      return { method: "GET", path: `/api/schema/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "related",
    summary: "关联全景（1 跳，可 --depth N 多跳、--candidates 含候选）",
    usage: "related <nodeType> <id> [--depth N] [--candidates]",
    build: (pos, opts) => {
      requirePos(pos, 2, "related <nodeType> <id>");
      return {
        method: "GET",
        path: `/api/related/${encodeURIComponent(pos[0])}/${encodeURIComponent(pos[1])}${qs({ depth: str(opts.depth), includeCandidates: opts.candidates ? "1" : undefined })}`,
      };
    },
  },
  {
    name: "graph",
    summary: "KG 图形快照（--depth 1..3）",
    usage: "graph <nodeType> <id> [--depth N]",
    build: (pos, opts) => {
      requirePos(pos, 2, "graph <nodeType> <id>");
      return {
        method: "GET",
        path: `/api/graph/snapshot/${encodeURIComponent(pos[0])}/${encodeURIComponent(pos[1])}${qs({ depth: str(opts.depth) })}`,
      };
    },
  },
  {
    name: "conflicts:list",
    summary: "冲突/重叠对列表",
    usage: "conflicts:list",
    build: () => ({ method: "GET", path: "/api/conflicts" }),
  },
  {
    name: "audit:list",
    summary:
      "审计日志（按 action/entityType/entityId 过滤；常见 action: CREATE/UPDATE/DELETE/MERGE/SCHEMA_addField/DAILY_REPORT_PUBLISH 等）",
    usage: "audit:list [--action A] [--entityType T] [--entityId ID] [--limit N]",
    build: (_pos, opts) => ({
      method: "GET",
      path: `/api/audit${qs({ action: str(opts.action), entityType: str(opts.entityType), entityId: str(opts.entityId), limit: str(opts.limit) })}`,
    }),
  },
  {
    name: "merge:preview",
    summary: "人员合并预览（只读）",
    usage: "merge:preview --from <id> --to <id>",
    build: (_pos, opts) => ({
      method: "GET",
      path: `/api/merge/preview${qs({ fromId: str(opts.from), toId: str(opts.to) })}`,
    }),
  },
  {
    name: "daily-report",
    summary: "攻关日报（--date YYYY-MM-DD）",
    usage: "daily-report [--date YYYY-MM-DD]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/daily-report${qs({ date: str(opts.date) })}` }),
  },
  {
    name: "oncall:current",
    summary: "当前值班人（按日期派生，--domain 限定域）",
    usage: "oncall:current [--domain D]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/oncall/current${qs({ domain: str(opts.domain) })}` }),
  },
  {
    name: "honor:leaderboard",
    summary: "荣誉排行榜（--period，--groupBy team 按团队聚合）",
    usage: "honor:leaderboard [--period P] [--groupBy team]",
    build: (_pos, opts) => ({
      method: "GET",
      path: `/api/honor/leaderboard${qs({ period: str(opts.period), groupBy: str(opts.groupBy) })}`,
    }),
  },
  {
    name: "honor:person",
    summary: "个人荣誉档案",
    usage: "honor:person <name>",
    build: (pos) => {
      requirePos(pos, 1, "honor:person <name>");
      return { method: "GET", path: `/api/honor/person/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "proposals:list",
    summary: "关系提议队列（--status）",
    usage: "proposals:list [--status S]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/proposals${qs({ status: str(opts.status) })}` }),
  },
  {
    name: "reminders:list",
    summary: "跟催提醒队列（--status）",
    usage: "reminders:list [--status S]",
    build: (_pos, opts) => ({ method: "GET", path: `/api/reminders${qs({ status: str(opts.status) })}` }),
  },
  {
    name: "recommend:helpers",
    summary: "找帮手推荐（--limit N）",
    usage: "recommend:helpers <attackTicketId> [--limit N]",
    build: (pos, opts) => {
      requirePos(pos, 1, "recommend:helpers <id>");
      return {
        method: "GET",
        path: `/api/recommend/helpers/${encodeURIComponent(pos[0])}${qs({ limit: str(opts.limit) })}`,
      };
    },
  },
  {
    name: "search",
    summary: "全文检索（--type 限定 nodeType，--limit 最多返回 N 条，默认 50，上限 200）",
    usage: "search <query> [--type T] [--limit N]",
    build: (pos, opts) => {
      requirePos(pos, 1, "search <query>");
      return {
        method: "GET",
        path: `/api/query/search${qs({ q: pos.join(" "), type: str(opts.type), limit: str(opts.limit) })}`,
      };
    },
  },
  {
    name: "context",
    summary: "某节点的查询上下文（关联+进展）",
    usage: "context <id>",
    build: (pos) => {
      requirePos(pos, 1, "context <id>");
      return { method: "GET", path: `/api/query/context/${encodeURIComponent(pos[0])}` };
    },
  },

  // ---- writes ----
  {
    name: "nodes:create",
    summary: "创建任意 nodeType 的节点（--data 即 JSON 化 properties，字段名按 schema）",
    usage: "nodes:create <nodeType> --data '<json>'",
    build: (pos, opts) => {
      requirePos(pos, 1, "nodes:create <nodeType> --data <json>");
      return { method: "POST", path: `/api/nodes/${encodeURIComponent(pos[0])}`, body: jsonOpt(opts, "data") };
    },
  },
  {
    name: "nodes:update",
    summary: "局部更新节点（merge 语义；--data 只放要改的字段）",
    usage: "nodes:update <id> --data '<json>'",
    build: (pos, opts) => {
      requirePos(pos, 1, "nodes:update <id> --data <json>");
      return { method: "PUT", path: `/api/nodes/${encodeURIComponent(pos[0])}`, body: jsonOpt(opts, "data") };
    },
  },
  {
    name: "nodes:delete",
    summary: "按 id 删除节点（任意 nodeType；级联删除其进展/关联边）",
    usage: "nodes:delete <id>",
    build: (pos) => {
      requirePos(pos, 1, "nodes:delete <id>");
      return { method: "DELETE", path: `/api/nodes/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "nodes:transition",
    summary:
      "攻关单状态原子流转（同时追加一条状态快照 progress；--to 必须是 schema 中状态字段的合法枚举值，如 待响应/处理中/已解决/已关闭）",
    usage: "nodes:transition <id> --to <status> [--note <s>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "nodes:transition <id> --to <status>");
      return {
        method: "POST",
        path: `/api/nodes/${encodeURIComponent(pos[0])}/transition`,
        body: { toStatus: str(opts.to), note: str(opts.note) },
      };
    },
  },
  {
    name: "progress:add",
    summary: "为某节点追加一条进展（append-only 时间序）；--status 同时打一个状态快照（可选）",
    usage: "progress:add <id> --content <s> [--status <s>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "progress:add <id> --content <s>");
      return {
        method: "POST",
        path: `/api/nodes/${encodeURIComponent(pos[0])}/progress`,
        body: { content: str(opts.content), statusSnapshot: str(opts.status), actor: "cli" },
      };
    },
  },
  {
    name: "schema:patch",
    summary:
      'schema 字段操作（op 形如 {"op":"addField","field":{...}} / {"op":"retireField","id":"..."} / {"op":"setAlias","id":"...","aliases":[]}）',
    usage: "schema:patch <nodeType> --op '<json>'",
    build: (pos, opts) => {
      requirePos(pos, 1, "schema:patch <nodeType> --op <json>");
      return { method: "PATCH", path: `/api/schema/${encodeURIComponent(pos[0])}`, body: jsonOpt(opts, "op") };
    },
  },
  {
    name: "schema:scan",
    summary: "重新扫描 schema 配置目录",
    usage: "schema:scan",
    build: () => ({ method: "POST", path: "/api/schema/scan" }),
  },
  {
    name: "conflicts:scan",
    summary: "重建冲突/重叠派生边",
    usage: "conflicts:scan",
    build: () => ({ method: "POST", path: "/api/conflicts/scan" }),
  },
  {
    name: "kg:rebuild",
    summary: "全量重建派生 KG",
    usage: "kg:rebuild",
    build: () => ({ method: "POST", path: "/api/kg/rebuild" }),
  },
  {
    name: "daily-report:publish",
    summary: "发布当日日报：当日有进展的攻关单 日报发布数量+1",
    usage: "daily-report:publish [--date YYYY-MM-DD]",
    build: (_pos, opts) => ({ method: "POST", path: `/api/daily-report/publish${qs({ date: str(opts.date) })}` }),
  },

  // ---- per-ticket daily report entries (草稿/发布工作流) ----
  {
    name: "daily-report:entry-list",
    summary: "列出某攻关单下的所有日报条目（草稿+已发布，按创建时间倒序）",
    usage: "daily-report:entry-list <ticketId>",
    build: (pos) => {
      requirePos(pos, 1, "daily-report:entry-list <ticketId>");
      return { method: "GET", path: `/api/nodes/${encodeURIComponent(pos[0])}/daily-reports` };
    },
  },
  {
    name: "daily-report:entry-create",
    summary: '在某攻关单下新建一条日报条目（草稿）。type 默认 "进展通报"',
    usage: "daily-report:entry-create <ticketId> --currentProgress <s> [--nextSteps <s>] [--type <s>] [--by <人>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "daily-report:entry-create <ticketId> --currentProgress <s>");
      return {
        method: "POST",
        path: `/api/nodes/${encodeURIComponent(pos[0])}/daily-reports`,
        body: {
          type: str(opts.type),
          currentProgress: str(opts.currentProgress),
          nextSteps: str(opts.nextSteps),
          createdBy: str(opts.by),
        },
      };
    },
  },
  {
    name: "daily-report:entry-update",
    summary: "编辑草稿日报条目（已发布不可改）",
    usage: "daily-report:entry-update <ticketId> <entryId> [--currentProgress <s>] [--nextSteps <s>] [--type <s>]",
    build: (pos, opts) => {
      requirePos(pos, 2, "daily-report:entry-update <ticketId> <entryId>");
      return {
        method: "PUT",
        path: `/api/nodes/${encodeURIComponent(pos[0])}/daily-reports/${encodeURIComponent(pos[1])}`,
        body: {
          type: str(opts.type),
          currentProgress: str(opts.currentProgress),
          nextSteps: str(opts.nextSteps),
        },
      };
    },
  },
  {
    name: "daily-report:entry-publish",
    summary: "把某攻关单下的某条日报条目从「草稿」改为「已发布」",
    usage: "daily-report:entry-publish <ticketId> <entryId>",
    build: (pos) => {
      requirePos(pos, 2, "daily-report:entry-publish <ticketId> <entryId>");
      return {
        method: "POST",
        path: `/api/nodes/${encodeURIComponent(pos[0])}/daily-reports/${encodeURIComponent(pos[1])}/publish`,
      };
    },
  },
  {
    name: "daily-report:entry-delete",
    summary: "删除某攻关单下的某条日报条目",
    usage: "daily-report:entry-delete <ticketId> <entryId>",
    build: (pos) => {
      requirePos(pos, 2, "daily-report:entry-delete <ticketId> <entryId>");
      return {
        method: "DELETE",
        path: `/api/nodes/${encodeURIComponent(pos[0])}/daily-reports/${encodeURIComponent(pos[1])}`,
      };
    },
  },
  {
    name: "jobs:tick",
    summary: "手动触发后台定时任务（冲突/上升/跟催扫描汇总）",
    usage: "jobs:tick",
    build: () => ({ method: "POST", path: "/api/jobs/tick" }),
  },
  {
    name: "hermes:ask",
    summary: "Hermes 只读问答",
    usage: "hermes:ask <question>",
    build: (pos) => {
      requirePos(pos, 1, "hermes:ask <question>");
      return { method: "POST", path: "/api/hermes/ask", body: { question: pos.join(" ") } };
    },
  },
  {
    name: "merge:person",
    summary: "执行人员合并（不可逆）",
    usage: "merge:person --from <id> --to <id>",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/merge/person",
      body: { fromId: str(opts.from), toId: str(opts.to) },
    }),
  },
  {
    name: "proposals:scan",
    summary: "扫描生成候选关系提议",
    usage: "proposals:scan",
    build: () => ({ method: "POST", path: "/api/proposals/scan" }),
  },
  {
    name: "proposals:decide",
    summary: "审批一条提议",
    usage: "proposals:decide <id> --decision <通过|拒绝|修正> --by <人> [--target <id>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "proposals:decide <id> --decision <d> --by <人>");
      const patch = str(opts.target) ? { targetNodeId: str(opts.target) } : undefined;
      return {
        method: "POST",
        path: `/api/proposals/${encodeURIComponent(pos[0])}/decide`,
        body: { decision: str(opts.decision), decidedBy: str(opts.by), patch },
      };
    },
  },
  {
    name: "reminders:scan",
    summary: "扫描生成跟催提醒",
    usage: "reminders:scan",
    build: () => ({ method: "POST", path: "/api/reminders/scan" }),
  },
  {
    name: "reminders:send",
    summary: "发送一条提醒（stub 渠道）",
    usage: "reminders:send <id> --by <人>",
    build: (pos, opts) => {
      requirePos(pos, 1, "reminders:send <id> --by <人>");
      return {
        method: "POST",
        path: `/api/reminders/${encodeURIComponent(pos[0])}/send`,
        body: { decidedBy: str(opts.by) },
      };
    },
  },
  {
    name: "reminders:ignore",
    summary: "忽略一条提醒",
    usage: "reminders:ignore <id> --by <人>",
    build: (pos, opts) => {
      requirePos(pos, 1, "reminders:ignore <id> --by <人>");
      return {
        method: "POST",
        path: `/api/reminders/${encodeURIComponent(pos[0])}/ignore`,
        body: { decidedBy: str(opts.by) },
      };
    },
  },

  // ---- email (§45) ----
  {
    name: "email:config-get",
    summary: "查看 SMTP 配置（密码掩码）",
    usage: "email:config-get",
    build: () => ({ method: "GET", path: "/api/email/config" }),
  },
  {
    name: "email:config-set",
    summary: "设置 SMTP 配置（password 空则保留旧密码）",
    usage: "email:config-set --data '<json>'",
    build: (_pos, opts) => ({ method: "PUT", path: "/api/email/config", body: jsonOpt(opts, "data") }),
  },
  {
    name: "email:test",
    summary: "用当前配置发一封测试邮件",
    usage: "email:test --to <邮箱>",
    build: (_pos, opts) => ({ method: "POST", path: "/api/email/test", body: { to: str(opts.to) } }),
  },
  {
    name: "email:send",
    summary: "发送邮件（收件人 = to + 群组展开 + 人员邮箱，去重）",
    usage: "email:send [--to a,b] [--groups g1,g2] [--persons 张三,李四] --subject S --body B",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/email/send",
      body: {
        to: csv(opts.to),
        groupNames: csv(opts.groups),
        personNames: csv(opts.persons),
        subject: str(opts.subject),
        body: str(opts.body),
      },
    }),
  },

  // ---- file I/O (§44) ----
  {
    name: "import",
    summary: "从 Excel 导入（--dryRun 仅预览不写库）",
    usage: "import <nodeType> --file <path.xlsx> [--dryRun]",
    build: (pos, opts) => {
      requirePos(pos, 1, "import <nodeType> --file <path>");
      const file = str(opts.file);
      if (!file) throw new Error("缺少 --file <path.xlsx>");
      return {
        method: "POST",
        path: `/api/import${qs({ type: pos[0], dryRun: opts.dryRun ? "1" : undefined })}`,
        uploadFile: file,
      };
    },
  },
  {
    name: "export",
    summary: "导出某类型为 Excel 到本地文件",
    usage: "export <nodeType> --out <path.xlsx>",
    build: (pos, opts) => {
      requirePos(pos, 1, "export <nodeType> --out <path>");
      const out = str(opts.out);
      if (!out) throw new Error("缺少 --out <path.xlsx>");
      return { method: "GET", path: `/api/export/${encodeURIComponent(pos[0])}`, saveTo: out };
    },
  },

  // ---- 文档中心 (documents) ----
  {
    name: "documents:list",
    summary: "列出文档中心全部文档（文件/外链）",
    usage: "documents:list",
    build: () => ({ method: "GET", path: "/api/documents" }),
  },
  {
    name: "documents:upload",
    summary: "上传本地文件到文档中心",
    usage: "documents:upload --file <path> [--name <名称>]",
    build: (_pos, opts) => {
      const file = str(opts.file);
      if (!file) throw new Error("缺少 --file <path>");
      return { method: "POST", path: "/api/documents", uploadFile: file };
    },
  },
  {
    name: "documents:add-link",
    summary: "添加一个外链文档",
    usage: "documents:add-link --name <名称> --url <url>",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/documents/link",
      body: { name: str(opts.name), url: str(opts.url) },
    }),
  },
  {
    name: "documents:delete",
    summary: "按 id 删除文档（文件型同时删除磁盘文件）",
    usage: "documents:delete <id>",
    build: (pos) => {
      requirePos(pos, 1, "documents:delete <id>");
      return { method: "DELETE", path: `/api/documents/${encodeURIComponent(pos[0])}` };
    },
  },

  // ---- escalation / SLA (§48) ----
  {
    name: "escalation:config-get",
    summary: "查看 SLA 上升责任矩阵配置",
    usage: "escalation:config-get",
    build: () => ({ method: "GET", path: "/api/escalation/config" }),
  },
  {
    name: "escalation:config-set",
    summary: "设置 SLA 责任矩阵（rules 数组）",
    usage: "escalation:config-set --data '{\"rules\":[...]}'",
    build: (_pos, opts) => ({ method: "PUT", path: "/api/escalation/config", body: jsonOpt(opts, "data") }),
  },
  {
    name: "escalation:scan",
    summary: "扫描超期活跃攻关单并上升",
    usage: "escalation:scan",
    build: () => ({ method: "POST", path: "/api/escalation/scan" }),
  },

  // ---- manual ad-hoc annotated links (§52) ----
  {
    name: "relations:link",
    summary: "手工拉一条带备注的关联线（任意两记录，不依赖 schema）",
    usage: "relations:link --from <id> --to <id> [--field <字段>] --reason <备注>",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/relations/manual",
      body: {
        sourceId: str(opts.from),
        targetId: str(opts.to),
        sourceField: str(opts.field),
        reason: str(opts.reason),
      },
    }),
  },
  {
    name: "relations:list",
    summary: "列出某节点的手工关联线",
    usage: "relations:list --node <id>",
    build: (_pos, opts) => ({ method: "GET", path: `/api/relations/manual${qs({ nodeId: str(opts.node) })}` }),
  },
  {
    name: "relations:unlink",
    summary: "删除一条手工关联线",
    usage: "relations:unlink <edgeId>",
    build: (pos) => {
      requirePos(pos, 1, "relations:unlink <edgeId>");
      return { method: "DELETE", path: `/api/relations/manual/${encodeURIComponent(pos[0])}` };
    },
  },

  // ---- schema wizard (§56) ----
  {
    name: "schema:list",
    summary: "列出所有 nodeType 配置",
    usage: "schema:list",
    build: () => ({ method: "GET", path: "/api/schema/list" }),
  },
  {
    name: "schema:suggest",
    summary: "搜索现有字段/概念匹配（帮助建表时复用字段）",
    usage: "schema:suggest <keyword>",
    build: (pos) => {
      requirePos(pos, 1, "schema:suggest <keyword>");
      return { method: "GET", path: `/api/schema/suggest?q=${encodeURIComponent(pos.join(" "))}` };
    },
  },
  {
    name: "schema:create-nodeType",
    summary: "创建新表（nodeType JSON 配置）",
    usage: 'schema:create-nodeType --data \'{"nodeType":"x","label":"X","fields":[]}\'',
    build: (_pos, opts) => ({ method: "POST", path: "/api/schema/nodeType", body: jsonOpt(opts, "data") }),
  },
  {
    name: "schema:delete-nodeType",
    summary: "删除表（无数据时）",
    usage: "schema:delete-nodeType <nodeType>",
    build: (pos) => {
      requirePos(pos, 1, "schema:delete-nodeType <nodeType>");
      return { method: "DELETE", path: `/api/schema/nodeType/${encodeURIComponent(pos[0])}` };
    },
  },
  // ---- responsibility matrix (§57) ----
  {
    name: "responsibility:diagram",
    summary: "生成责任矩阵 Mermaid 图（升级规则+负责边+冲突边）",
    usage: "responsibility:diagram",
    build: () => ({ method: "GET", path: "/api/responsibility/diagram" }),
  },
  // ---- UI pin cache (§57) ----
  {
    name: "ui:pinned",
    summary: "列出已固定的动态 UI",
    usage: "ui:pinned",
    build: () => ({ method: "GET", path: "/api/ui-cache/pinned" }),
  },
  {
    name: "ui:pin",
    summary: "固定一个 Hermes 动态 UI（需提供完整 uiSpec JSON）",
    usage: "ui:pin --label <名称> --question <问题> --intent <意图> --uiSpec '<json>'",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/ui-cache/pin",
      body: {
        label: str(opts.label),
        question: str(opts.question),
        intent: str(opts.intent),
        uiSpec: jsonOpt(opts, "uiSpec"),
      },
    }),
  },
  {
    name: "ui:rename-pin",
    summary: "重命名已固定的 UI",
    usage: "ui:rename-pin <id> --label <新名称>",
    build: (pos, opts) => {
      requirePos(pos, 1, "ui:rename-pin <id> --label <新名称>");
      return {
        method: "PATCH",
        path: `/api/ui-cache/pinned/${encodeURIComponent(pos[0])}`,
        body: { label: str(opts.label) },
      };
    },
  },
  {
    name: "ui:unpin",
    summary: "取消固定某 UI",
    usage: "ui:unpin <id>",
    build: (pos) => {
      requirePos(pos, 1, "ui:unpin <id>");
      return { method: "DELETE", path: `/api/ui-cache/pinned/${encodeURIComponent(pos[0])}` };
    },
  },
  // ---- custom commands (§54): NL-authored parameterized CLI templates ----
  {
    name: "commands:list",
    summary: "列出自定义命令",
    usage: "commands:list",
    build: () => ({ method: "GET", path: "/api/commands" }),
  },
  {
    name: "commands:create",
    summary: "新建自定义命令（template 含 {参数} 占位，首 token 须为已知命令）",
    usage: "commands:create --name <名> --template '<cli模板>' [--description <说明>]",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/commands",
      body: { name: str(opts.name), template: str(opts.template), description: str(opts.description) },
    }),
  },
  {
    name: "commands:delete",
    summary: "删除自定义命令",
    usage: "commands:delete <id>",
    build: (pos) => {
      requirePos(pos, 1, "commands:delete <id>");
      return { method: "DELETE", path: `/api/commands/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "commands:run",
    summary: "运行自定义命令（解析为底层 request，--args JSON 提供参数值）",
    usage: "commands:run <id> --args '<json>'",
    build: (pos, opts) => {
      requirePos(pos, 1, "commands:run <id> --args <json>");
      return {
        method: "POST",
        path: `/api/commands/${encodeURIComponent(pos[0])}/run`,
        body: { args: jsonOpt(opts, "args") },
      };
    },
  },

  // ---- support network (求助网络) ----
  {
    name: "settings:list",
    summary: "列出所有配置中心项",
    usage: "settings:list",
    build: () => ({ method: "GET", path: "/api/settings" }),
  },
  {
    name: "settings:get",
    summary: "获取单个配置项",
    usage: "settings:get <key>",
    build: (pos) => {
      requirePos(pos, 1, "settings:get <key>");
      return { method: "GET", path: `/api/settings/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "settings:resolve",
    summary: "解析配置项（支持 --scope 页面级覆盖回退）",
    usage: "settings:resolve <key> [--scope <page.field>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "settings:resolve <key>");
      return {
        method: "GET",
        path: `/api/settings/${encodeURIComponent(pos[0])}/resolve${qs({ scope: str(opts.scope) })}`,
      };
    },
  },
  {
    name: "settings:set",
    summary: "设置配置项（--values 值1,值2,值3）",
    usage: "settings:set <key> --values <v1,v2,v3> [--label <显示名>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "settings:set <key> --values <v1,v2,v3>");
      const values = csv(opts.values);
      if (!values) throw new Error("缺少 --values <v1,v2,v3>");
      return {
        method: "PUT",
        path: `/api/settings/${encodeURIComponent(pos[0])}`,
        body: { values, label: str(opts.label) },
      };
    },
  },
  {
    name: "settings:delete",
    summary: "删除配置项",
    usage: "settings:delete <key>",
    build: (pos) => {
      requirePos(pos, 1, "settings:delete <key>");
      return { method: "DELETE", path: `/api/settings/${encodeURIComponent(pos[0])}` };
    },
  },

  // ---- support network (求助网络) ----
  {
    name: "support-node:list",
    summary: "列出攻关单的求助网络节点",
    usage: "support-node:list <ticketId>",
    build: (pos) => {
      requirePos(pos, 1, "support-node:list <ticketId>");
      return { method: "GET", path: `/api/support-nodes/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "support-node:add",
    summary: "添加求助节点",
    usage:
      "support-node:add <ticketId> --category=<> --domain=<> [--parentId=<>] [--personId=<>] [--personName=<>] [--status=<>] [--note=<>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "support-node:add <ticketId> --category=<> --domain=<>");
      return {
        method: "POST",
        path: `/api/support-nodes/${encodeURIComponent(pos[0])}`,
        body: {
          parentId: str(opts.parentId),
          category: str(opts.category),
          domain: str(opts.domain),
          personId: str(opts.personId),
          personName: str(opts.personName),
          status: str(opts.status),
          note: str(opts.note),
        },
      };
    },
  },
  {
    name: "support-node:update",
    summary: "更新求助节点",
    usage:
      "support-node:update <nodeId> [--category=<>] [--domain=<>] [--personId=<>] [--personName=<>] [--status=<>] [--note=<>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "support-node:update <nodeId>");
      const body: Record<string, string | undefined> = {};
      if (opts.category !== undefined) body.category = str(opts.category);
      if (opts.domain !== undefined) body.domain = str(opts.domain);
      if (opts.personId !== undefined) body.personId = str(opts.personId);
      if (opts.personName !== undefined) body.personName = str(opts.personName);
      if (opts.status !== undefined) body.status = str(opts.status);
      if (opts.note !== undefined) body.note = str(opts.note);
      return { method: "PUT", path: `/api/support-nodes/node/${encodeURIComponent(pos[0])}`, body };
    },
  },
  {
    name: "support-node:delete",
    summary: "删除求助节点（含子节点）",
    usage: "support-node:delete <nodeId>",
    build: (pos) => {
      requirePos(pos, 1, "support-node:delete <nodeId>");
      return { method: "DELETE", path: `/api/support-nodes/node/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "support-template:list",
    summary: "列出所有支援模板",
    usage: "support-template:list",
    build: () => ({ method: "GET", path: "/api/support-templates" }),
  },
  {
    name: "support-template:create",
    summary: "创建支援模板",
    usage: "support-template:create --name=<> [--description=<>]",
    build: (_pos, opts) => ({
      method: "POST",
      path: "/api/support-templates",
      body: { name: str(opts.name), description: str(opts.description) },
    }),
  },
  {
    name: "support-template:apply",
    summary: "将模板应用到攻关单",
    usage: "support-template:apply <templateId> --ticketId=<>",
    build: (pos, opts) => {
      requirePos(pos, 1, "support-template:apply <templateId> --ticketId=<>");
      const ticketId = str(opts.ticketId);
      if (!ticketId) throw new Error("缺少 --ticketId");
      return {
        method: "POST",
        path: `/api/support-templates/${encodeURIComponent(pos[0])}/apply/${encodeURIComponent(ticketId)}`,
      };
    },
  },

  // ---- bug reports (问题反馈) ----
  {
    name: "bugs:list",
    summary: "列出问题反馈（默认仅待处理）",
    usage: "bugs:list [--status=<>] [--severity=<>] [--all]",
    build: (_pos, opts) => {
      const params: string[] = [];
      if (opts.status) params.push(`status=${encodeURIComponent(str(opts.status)!)}`);
      if (opts.severity) params.push(`severity=${encodeURIComponent(str(opts.severity)!)}`);
      if (opts.all) params.push("status=");
      return { method: "GET", path: `/api/bug-reports${params.length ? "?" + params.join("&") : "?status=待处理"}` };
    },
  },
  {
    name: "bugs:get",
    summary: "查看问题详情",
    usage: "bugs:get <id>",
    build: (pos) => {
      requirePos(pos, 1, "bugs:get <id>");
      return { method: "GET", path: `/api/bug-reports/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "bugs:create",
    summary: "提交问题反馈",
    usage:
      "bugs:create --title=<> [--description=<>] [--severity=<>] [--pageUrl=<>] [--reporter=<>] [--consoleLogs=<>]",
    build: (_pos, opts) => {
      const title = str(opts.title);
      if (!title) throw new Error("缺少 --title");
      return {
        method: "POST",
        path: "/api/bug-reports",
        body: {
          title,
          description: str(opts.description) ?? "",
          severity: str(opts.severity) ?? "一般",
          pageUrl: str(opts.pageUrl) ?? "",
          reporter: str(opts.reporter) ?? "",
          consoleLogs: str(opts.consoleLogs) ?? "",
        },
      };
    },
  },
  {
    name: "bugs:update",
    summary: "更新问题状态/备注",
    usage: "bugs:update <id> [--status=<>] [--resolution=<>] [--resolvedBy=<>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "bugs:update <id>");
      const body: Record<string, string> = {};
      if (opts.status !== undefined) body.status = str(opts.status)!;
      if (opts.resolution !== undefined) body.resolution = str(opts.resolution)!;
      if (opts.resolvedBy !== undefined) body.resolvedBy = str(opts.resolvedBy)!;
      return { method: "PATCH", path: `/api/bug-reports/${encodeURIComponent(pos[0])}`, body };
    },
  },
  {
    name: "bugs:close",
    summary: "关闭问题（标记已关闭）",
    usage: "bugs:close <id> [--resolution=<>] [--resolvedBy=<>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "bugs:close <id>");
      const body: Record<string, string> = { status: "已关闭" };
      if (opts.resolution !== undefined) body.resolution = str(opts.resolution)!;
      if (opts.resolvedBy !== undefined) body.resolvedBy = str(opts.resolvedBy)!;
      return { method: "PATCH", path: `/api/bug-reports/${encodeURIComponent(pos[0])}`, body };
    },
  },
  {
    name: "bugs:delete",
    summary: "删除问题反馈",
    usage: "bugs:delete <id>",
    build: (pos) => {
      requirePos(pos, 1, "bugs:delete <id>");
      return { method: "DELETE", path: `/api/bug-reports/${encodeURIComponent(pos[0])}` };
    },
  },

  {
    name: "auth:login",
    summary: "用户登录（返回 JWT token）",
    usage: "auth:login --username <u> --password <p>",
    build: (_pos, opts) => {
      const u = str(opts.username),
        p = str(opts.password);
      if (!u || !p) throw new Error("缺少 --username 和 --password");
      return { method: "POST", path: "/api/auth/login", body: { username: u, password: p } };
    },
  },
  {
    name: "auth:register",
    summary: "注册新用户（返回 JWT token）",
    usage: "auth:register --username <u> --password <p> [--displayName <n>] [--role <admin|leader|normal>]",
    build: (_pos, opts) => {
      const u = str(opts.username),
        p = str(opts.password);
      if (!u || !p) throw new Error("缺少 --username 和 --password");
      return {
        method: "POST",
        path: "/api/auth/register",
        body: { username: u, password: p, displayName: str(opts.displayName), role: str(opts.role) },
      };
    },
  },
  {
    name: "auth:me",
    summary: "获取当前用户信息（需 token）",
    usage: "auth:me",
    build: () => ({ method: "GET", path: "/api/auth/me" }),
  },
  {
    name: "auth:change-password",
    summary: "修改密码",
    usage: "auth:change-password --old <旧密码> --new <新密码>",
    build: (_pos, opts) => {
      const o = str(opts.old),
        n = str(opts.new);
      if (!o || !n) throw new Error("缺少 --old 和 --new");
      return { method: "PUT", path: "/api/auth/change-password", body: { oldPassword: o, newPassword: n } };
    },
  },
  {
    name: "users:list",
    summary: "列出所有用户（需 admin 角色）",
    usage: "users:list",
    build: () => ({ method: "GET", path: "/api/users" }),
  },
  {
    name: "users:create",
    summary: "创建用户（需 admin 角色）",
    usage: "users:create --username <u> --password <p> [--displayName <n>] [--role <admin|leader|normal>]",
    build: (_pos, opts) => {
      const u = str(opts.username),
        p = str(opts.password);
      if (!u || !p) throw new Error("缺少 --username 和 --password");
      return {
        method: "POST",
        path: "/api/users",
        body: { username: u, password: p, displayName: str(opts.displayName), role: str(opts.role) },
      };
    },
  },
  {
    name: "users:update",
    summary: "更新用户信息（需 admin 角色）",
    usage: "users:update <id> [--role <r>] [--displayName <n>] [--password <p>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "users:update <id>");
      const body: Record<string, string> = {};
      if (opts.role !== undefined) body.role = str(opts.role)!;
      if (opts.displayName !== undefined) body.displayName = str(opts.displayName)!;
      if (opts.password !== undefined) body.password = str(opts.password)!;
      return { method: "PATCH", path: `/api/users/${encodeURIComponent(pos[0])}`, body };
    },
  },
  {
    name: "users:delete",
    summary: "删除用户（需 admin 角色）",
    usage: "users:delete <id>",
    build: (pos) => {
      requirePos(pos, 1, "users:delete <id>");
      return { method: "DELETE", path: `/api/users/${encodeURIComponent(pos[0])}` };
    },
  },

  // ---- op-logs (操作追踪) ----
  {
    name: "op-logs:list",
    summary: "查询操作追踪日志（--category api|navigate|error|action）",
    usage:
      "op-logs:list [--sessionId S] [--userName U] [--category C] [--from ISO] [--to ISO] [--limit N] [--offset N]",
    build: (_pos, opts) => ({
      method: "GET",
      path: `/api/op-logs${qs({ sessionId: str(opts.sessionId), userName: str(opts.userName), category: str(opts.category), from: str(opts.from), to: str(opts.to), limit: str(opts.limit), offset: str(opts.offset) })}`,
    }),
  },
  {
    name: "op-logs:settings",
    summary: "查看操作追踪开关状态",
    usage: "op-logs:settings",
    build: () => ({ method: "GET", path: "/api/op-logs/settings" }),
  },
  {
    name: "op-logs:enable",
    summary: "开启操作追踪",
    usage: "op-logs:enable",
    build: () => ({ method: "PUT", path: "/api/op-logs/settings", body: { enabled: true } }),
  },
  {
    name: "op-logs:disable",
    summary: "关闭操作追踪",
    usage: "op-logs:disable",
    build: () => ({ method: "PUT", path: "/api/op-logs/settings", body: { enabled: false } }),
  },
  {
    name: "op-logs:cleanup",
    summary: "清理旧记录（--before ISO 时间戳 或 --sessionId 指定会话）",
    usage: "op-logs:cleanup --before <ISO> 或 --sessionId <id>",
    build: (_pos, opts) => {
      const before = str(opts.before),
        sid = str(opts.sessionId);
      if (!before && !sid) throw new Error("必须指定 --before 或 --sessionId");
      return { method: "DELETE", path: `/api/op-logs${qs({ before, sessionId: sid })}` };
    },
  },

  {
    name: "backup:create",
    summary: "立即创建数据库备份",
    usage: "backup:create",
    build: () => ({ method: "POST", path: "/api/backup" }),
  },
  {
    name: "backup:list",
    summary: "列出所有备份文件",
    usage: "backup:list",
    build: () => ({ method: "GET", path: "/api/backup" }),
  },
  {
    name: "backup:download",
    summary: "下载备份文件（--filename）",
    usage: "backup:download --filename <name>",
    build: (_pos, opts) => {
      const fn = str(opts.filename);
      if (!fn) throw new Error("--filename 必填");
      return { method: "GET", path: `/api/backup/${fn}` };
    },
  },
  {
    name: "backup:delete",
    summary: "删除备份文件（--filename）",
    usage: "backup:delete --filename <name>",
    build: (_pos, opts) => {
      const fn = str(opts.filename);
      if (!fn) throw new Error("--filename 必填");
      return { method: "DELETE", path: `/api/backup/${fn}` };
    },
  },
  {
    name: "backup:schedule",
    summary: "查看定时备份设置",
    usage: "backup:schedule",
    build: () => ({ method: "GET", path: "/api/backup/schedule" }),
  },
  {
    name: "backup:schedule:set",
    summary: "更新定时备份（--enabled true/false --intervalHours 168 --keepCount 4）",
    usage: "backup:schedule:set --enabled <bool> --intervalHours <n> --keepCount <n>",
    build: (_pos, opts) => {
      const body: Record<string, unknown> = {};
      if (opts.enabled !== undefined) body.enabled = opts.enabled === "true" || opts.enabled === true;
      if (opts.intervalHours) body.intervalHours = Number(opts.intervalHours);
      if (opts.keepCount) body.keepCount = Number(opts.keepCount);
      return { method: "PUT", path: "/api/backup/schedule", body };
    },
  },

  // ---- ticket tabs (动态标签) ----
  {
    name: "tabs:list",
    summary: "列出某攻关单的动态标签",
    usage: "tabs:list <ticketId>",
    build: (pos) => {
      requirePos(pos, 1, "tabs:list <ticketId>");
      return { method: "GET", path: `/api/tickets/${encodeURIComponent(pos[0])}/tabs` };
    },
  },
  {
    name: "tabs:create",
    summary: "创建动态标签（--type link|custom --title 标签名 [--config JSON] [--content 内容])",
    usage: "tabs:create <ticketId> --type <link|custom> --title <名> [--config <json>] [--content <内容>]",
    build: (pos, opts) => {
      requirePos(pos, 1, "tabs:create <ticketId> --type <link|custom> --title <名>");
      const tabType = str(opts.type);
      if (!tabType || !["link", "custom"].includes(tabType)) throw new Error("--type 必须为 link 或 custom");
      const title = str(opts.title);
      if (!title) throw new Error("缺少 --title");
      const body: Record<string, unknown> = { tabType, title };
      if (opts.config !== undefined) {
        try {
          body.config = JSON.parse(str(opts.config)!);
        } catch {
          throw new Error("--config 不是合法 JSON");
        }
      }
      if (opts.content !== undefined) body.content = str(opts.content);
      return { method: "POST", path: `/api/tickets/${encodeURIComponent(pos[0])}/tabs`, body };
    },
  },
  {
    name: "tabs:update",
    summary: "更新动态标签（--title / --config / --content）",
    usage: "tabs:update <ticketId> <tabId> [--title <名>] [--config <json>] [--content <内容>]",
    build: (pos, opts) => {
      requirePos(pos, 2, "tabs:update <ticketId> <tabId>");
      const body: Record<string, unknown> = {};
      if (opts.title !== undefined) {
        const t = str(opts.title);
        if (t) body.title = t;
      }
      if (opts.config !== undefined) {
        try {
          body.config = JSON.parse(str(opts.config)!);
        } catch {
          throw new Error("--config 不是合法 JSON");
        }
      }
      if (opts.content !== undefined) body.content = str(opts.content);
      if (Object.keys(body).length === 0) throw new Error("至少指定 --title / --config / --content 之一");
      return {
        method: "PATCH",
        path: `/api/tickets/${encodeURIComponent(pos[0])}/tabs/${encodeURIComponent(pos[1])}`,
        body,
      };
    },
  },
  {
    name: "tabs:delete",
    summary: "删除动态标签",
    usage: "tabs:delete <ticketId> <tabId>",
    build: (pos) => {
      requirePos(pos, 2, "tabs:delete <ticketId> <tabId>");
      return {
        method: "DELETE",
        path: `/api/tickets/${encodeURIComponent(pos[0])}/tabs/${encodeURIComponent(pos[1])}`,
      };
    },
  },
  {
    name: "tabs:reorder",
    summary: "重排标签顺序（--order id1,id2,id3）",
    usage: "tabs:reorder <ticketId> --order <id1,id2,id3>",
    build: (pos, opts) => {
      requirePos(pos, 1, "tabs:reorder <ticketId> --order <id1,id2,id3>");
      const order = csv(opts.order);
      if (!order || order.length === 0) throw new Error("缺少 --order <id1,id2,id3>");
      return { method: "PUT", path: `/api/tickets/${encodeURIComponent(pos[0])}/tabs/order`, body: { order } };
    },
  },

  // ---- upgrade (v2.3 一键升级) ----
  {
    name: "upgrade:current",
    summary: "当前版本/uptime/DB 大小/用户字段数",
    usage: "upgrade:current",
    build: () => ({ method: "GET", path: "/api/upgrade/current" }),
  },
  {
    name: "upgrade:releases",
    summary: "列出 GitHub Releases（依赖后端 env UPGRADE_GITHUB_REPO）",
    usage: "upgrade:releases",
    build: () => ({ method: "GET", path: "/api/upgrade/releases" }),
  },
  {
    name: "upgrade:status",
    summary: "查看当前升级任务状态",
    usage: "upgrade:status",
    build: () => ({ method: "GET", path: "/api/upgrade/status" }),
  },
  {
    name: "upgrade:history",
    summary: "升级历史",
    usage: "upgrade:history",
    build: () => ({ method: "GET", path: "/api/upgrade/history" }),
  },
  {
    name: "upgrade:upload",
    summary: "上传升级包（multipart）",
    usage: "upgrade:upload --file <path>",
    build: (_pos, opts) => {
      const f = str(opts.file);
      if (!f) throw new Error("--file <path> 必填");
      return { method: "POST", path: "/api/upgrade/upload", uploadFile: f };
    },
  },
  {
    name: "upgrade:analyze",
    summary: "分析已上传 staging 包，输出 diff 报告",
    usage: "upgrade:analyze --staging-id <id>",
    build: (_pos, opts) => {
      const sid = str(opts["staging-id"]);
      if (!sid) throw new Error("--staging-id 必填");
      return { method: "POST", path: "/api/upgrade/analyze", body: { stagingId: sid } };
    },
  },
  {
    name: "upgrade:apply",
    summary: "执行升级（detached worker；不可逆，谨慎）",
    usage: "upgrade:apply --staging-id <id> --confirm",
    build: (_pos, opts) => {
      const sid = str(opts["staging-id"]);
      if (!sid) throw new Error("--staging-id 必填");
      if (!opts.confirm) throw new Error("缺少 --confirm（必须显式确认）");
      return { method: "POST", path: "/api/upgrade/apply", body: { stagingId: sid, confirm: true } };
    },
  },
  {
    name: "upgrade:rollback",
    summary: "回滚到最近一次备份",
    usage: "upgrade:rollback",
    build: () => ({ method: "POST", path: "/api/upgrade/rollback" }),
  },
  {
    name: "upgrade:log",
    summary: "拉取 worker 日志（文本）",
    usage: "upgrade:log <jobId>",
    build: (pos) => {
      requirePos(pos, 1, "upgrade:log <jobId>");
      return { method: "GET", path: `/api/upgrade/log/${encodeURIComponent(pos[0])}` };
    },
  },
  {
    name: "upgrade:verify-signature",
    summary: "本地校验升级包 PGP 签名（不依赖后端）",
    usage: "upgrade:verify-signature <pkg.tar.gz> <pubkey.asc> [--sig <pkg.tar.gz.asc>]",
    build: (pos) => {
      requirePos(pos, 2, "upgrade:verify-signature <pkg.tar.gz> <pubkey.asc>");
      throw new Error(
        "此命令仅本地工具,请运行: node scripts/upgrade/verify-signature.mjs <pkg> <pubkey> [--sig <sig>]"
      );
    },
  },
];

export function renderHelp(commandName?: string): unknown {
  if (commandName && commandName !== "help") {
    const c = COMMANDS.find((x) => x.name === commandName);
    if (!c) throw new Error(`未知命令：${commandName}`);
    return { name: c.name, summary: c.summary, usage: c.usage };
  }
  return {
    description:
      "作战管理工具 CLI — 每个后台 API 一条命令，供 agent 自查自调。用法：npm run cli -- <command> [args] [--opts]",
    commands: COMMANDS.map((c) => ({ name: c.name, summary: c.summary, usage: c.usage })).concat([
      { name: "help", summary: "列出所有命令或某命令详情", usage: "help [command]" },
    ]),
  };
}

export async function runCli(argv: string[], http: HttpFn): Promise<unknown> {
  const [name, ...rest] = argv;
  if (!name || name === "help") {
    const { positional } = parseArgs(rest);
    return renderHelp(positional[0]);
  }
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) {
    const names = COMMANDS.map((c) => c.name).join(", ");
    throw new Error(`未知命令：${name}。可用命令：${names}, help`);
  }
  const { positional, opts } = parseArgs(rest);
  const req = cmd.build(positional, opts);
  return http(req);
}
