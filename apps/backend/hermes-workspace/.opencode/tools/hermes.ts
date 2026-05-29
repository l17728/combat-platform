import { tool } from "@opencode-ai/plugin";

// Read-only data tools for the Hermes agent. They call the combat backend's
// existing read endpoints on localhost. Auth: optional Bearer from HERMES_TOKEN
// (set by the backend when it spawns opencode on prod); omitted locally under
// COMBAT_NO_AUTH. Read-only is guaranteed here — only GET wrappers exist.
const API = process.env.HERMES_API || "http://localhost:3001";
const TOKEN = process.env.HERMES_TOKEN || "";

async function get(path: string): Promise<string> {
  try {
    const res = await fetch(`${API}/api${path}`, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    if (!res.ok) return JSON.stringify({ error: `HTTP ${res.status}`, path });
    return JSON.stringify(await res.json());
  } catch (e) {
    return JSON.stringify({ error: String((e as Error).message), path });
  }
}

export const search = tool({
  description:
    "全文检索作战管理系统的记录(攻关单/人员/贡献/版本等)。返回命中节点的 id、nodeType、summary、score。" +
    "用关键词(问题单号、攻关单标题片段、人名等)定位记录;拿到 id 后用 getContext 取详情。",
  args: {
    q: tool.schema.string().describe("检索关键词"),
    limit: tool.schema.number().optional().describe("返回条数上限,默认 20"),
  },
  async execute(args) {
    return get(`/query/search?q=${encodeURIComponent(args.q)}&limit=${args.limit ?? 20}`);
  },
});

export const getContext = tool({
  description:
    "按节点 id 取完整上下文:该节点全部字段(node)、关联关系(related)、进展时间线(progress)。" +
    "用于回答某条记录的负责人/状态/进展/关联等细节。",
  args: { id: tool.schema.string().describe("节点 id(来自 search 结果)") },
  async execute(args) {
    return get(`/query/context/${encodeURIComponent(args.id)}`);
  },
});

export const recommendHelpers = tool({
  description: "对某个攻关单 id 推荐合适的帮手(基于贡献记录、共享问题单等),返回候选人员与推荐理由。",
  args: { ticketId: tool.schema.string().describe("攻关单节点 id") },
  async execute(args) {
    return get(`/recommend/helpers/${encodeURIComponent(args.ticketId)}`);
  },
});
