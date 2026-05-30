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

// 按节点 id 一步直取详情(node 全字段 + 进展 + 关联)。当上下文已提供 id 时,这是最快路径——
// 不要再用 lookup 做关键词检索(关键词常命中不到目标),直接调本工具。
export const getContext = tool({
  description:
    "按节点 id 一步直取完整上下文(node 全字段、近期进展、关联关系)。当用户问题指代的实体 id" +
    "已在'当前上下文'里给出时,**优先用此工具**而非 lookup 关键词检索——单次调用即拿到所有信息。",
  args: { id: tool.schema.string().describe("节点 id(通常来自当前上下文)") },
  async execute(args) {
    return JSON.stringify(await getJson(`/query/context/${encodeURIComponent(args.id)}`));
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

// ============ Welink 场景 2 & 4 工具集 ============

async function postJson(path: string, body: any): Promise<any> {
  const res = await fetch(`${API}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let err: any = `HTTP ${res.status}`;
    try { err = await res.json(); } catch { /* ignore */ }
    return { error: err, path };
  }
  return res.json();
}

// 搜该攻关单的群消息(只读)
export const welinkSearch = tool({
  description:
    "在某攻关单的 Welink 群消息里按关键词全文搜索;返回最多 50 条命中消息(含发言人、时间、原文)。" +
    "当用户问到群里谁说过什么、某关键字何时出现时使用。",
  args: {
    ticketId: tool.schema.string().describe("攻关单节点 id"),
    q: tool.schema.string().describe("关键词"),
  },
  async execute(args) {
    return JSON.stringify(await getJson(`/tickets/${encodeURIComponent(args.ticketId)}/welink/search?q=${encodeURIComponent(args.q)}`));
  },
});

// 取该攻关单的群消息时间线(只读)
export const welinkTimeline = tool({
  description:
    "按时间升序读取某攻关单的 Welink 群消息精简时间线;最多 500 条。" +
    "当用户问到时间脉络、谁先谁后、第一个谁认领等顺序问题时使用。",
  args: {
    ticketId: tool.schema.string().describe("攻关单节点 id"),
    limit: tool.schema.number().optional().describe("最多返回条数,默认 200"),
  },
  async execute(args) {
    const limit = Math.min(500, Math.max(1, Math.round(args.limit ?? 200)));
    return JSON.stringify(await getJson(`/tickets/${encodeURIComponent(args.ticketId)}/welink/timeline?limit=${limit}`));
  },
});

// gap-analysis:活跃发言人 vs 攻关单成员的差集 — 场景 4 的入口
export const gapAnalysis = tool({
  description:
    "对某攻关单跑 Welink 群「活跃发言人 vs 攻关单已登记成员」差集分析,返回未登记的人员清单及其在群里的发言次数。" +
    "**当用户进入 Welink 场景、提到群、聊天、成员、补齐等关键字时,主动调用本工具看是否有缺口需要提醒用户。**",
  args: { ticketId: tool.schema.string().describe("攻关单节点 id") },
  async execute(args) {
    return JSON.stringify(await getJson(`/tickets/${encodeURIComponent(args.ticketId)}/welink/gap-analysis`));
  },
});

// 批量加成员 — 解析用户对话指令"把 X、Y 加进来"
export const welinkAddMembers = tool({
  description:
    "把一批姓名加入某攻关单的成员列表(默认角色组员);自动去重、自动同步「成员列表 / 攻关组长 / 攻关成员」三字段。" +
    "**仅在用户明确表达想要加成员(如「把张三李四加进来」、「除王五外都加进来」)时调用。**",
  args: {
    ticketId: tool.schema.string().describe("攻关单节点 id"),
    names: tool.schema.string().describe("要加入的姓名,逗号或顿号分隔(也可单个),例 '张三,李四'"),
    role: tool.schema.string().optional().describe("角色:组员(默认)|组长"),
  },
  async execute(args) {
    const names = String(args.names || "").split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean);
    return JSON.stringify(await postJson(`/tickets/${encodeURIComponent(args.ticketId)}/welink/add-members`, {
      names,
      role: args.role || "组员",
    }));
  },
});

// 改单人角色
export const welinkSetMemberRole = tool({
  description:
    "把某攻关单里已登记的某成员角色改成「组长」或「组员」;若不在成员列表会返回 404。" +
    "用于"把张三设为组长"这类对话指令。",
  args: {
    ticketId: tool.schema.string().describe("攻关单节点 id"),
    name: tool.schema.string().describe("已在成员列表中的姓名"),
    role: tool.schema.string().describe("目标角色:组长 或 组员"),
  },
  async execute(args) {
    return JSON.stringify(await postJson(`/tickets/${encodeURIComponent(args.ticketId)}/welink/set-member-role`, {
      name: args.name,
      role: args.role,
    }));
  },
});

// 创建邮件群组节点(走通用 nodes API)
export const createEmailGroup = tool({
  description:
    "创建一个「邮件群组」节点,字段:组名(必填)/成员邮箱(逗号分隔)/描述。" +
    "用于用户在对话里要求「建一个 xxx 邮件群」、「把这几个人的邮箱拉个组」时调用。",
  args: {
    groupName: tool.schema.string().describe("组名(必填)"),
    emails: tool.schema.string().describe("成员邮箱,逗号分隔"),
    description: tool.schema.string().optional().describe("可选描述"),
  },
  async execute(args) {
    const body: any = { 组名: args.groupName, 成员邮箱: String(args.emails || "") };
    if (args.description) body.描述 = args.description;
    return JSON.stringify(await postJson(`/nodes/emailGroup`, body));
  },
});
