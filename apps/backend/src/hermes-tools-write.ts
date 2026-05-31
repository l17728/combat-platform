// v2.8 Hermes 写工具 (需 HERMES_ENABLE_WRITE=1 开启)
//
// 3 个写工具: create_node / update_node / add_progress
// 安全: admin/leader 角色门控 + _confirm:'yes' 二次确认 + audit 全量记录

import type { ToolDefinition, HermesToolCtx } from "./hermes-tools.js";
import { isPrivateTicket } from "./private-tickets.js";
import { log } from "./logger.js";

const ALLOWED_ROLES = new Set(["admin", "leader"]);

function checkRole(ctx: HermesToolCtx): string | null {
  const role = ctx.user?.role;
  if (!role || !ALLOWED_ROLES.has(role)) return "permission_denied";
  return null;
}

function checkConfirm(input: Record<string, unknown>): string | null {
  if (input._confirm !== "yes") return "confirm_required";
  return null;
}

const createNodeTool: ToolDefinition<Record<string, unknown>> = {
  name: "create_node",
  description: "创建新节点(人员/攻关单/贡献等)。仅 admin/leader。必须带 _confirm:'yes'。",
  inputSchema: {
    type: "object",
    properties: {
      nodeType: { type: "string", description: "节点类型(如 person/attackTicket/contribution)" },
      properties: { type: "object", description: "节点属性键值对" },
      _confirm: { type: "string", description: "必须为 'yes' 才执行写操作" },
    },
    required: ["nodeType", "properties", "_confirm"],
    additionalProperties: false,
  },
  execute: async (input, ctx) => {
    const roleErr = checkRole(ctx);
    if (roleErr) throw new Error(`${roleErr}: 需要 admin 或 leader 角色`);

    const confirmErr = checkConfirm(input);
    if (confirmErr) throw new Error(`${confirmErr}: 写操作必须在参数中包含 _confirm:'yes'`);

    const nodeType = String(input.nodeType);
    const properties = (input.properties ?? {}) as Record<string, unknown>;

    const config = ctx.registry.getConfig();
    const found = config.nodeTypes.find((nt) => nt.nodeType === nodeType);
    if (!found) throw new Error(`unknown_node_type: nodeType "${nodeType}" 未注册`);

    const node = await ctx.repo.createNode(nodeType, properties, ctx.user?.username || "hermes");
    log.info("hermes.tool.write", { tool: "create_node", nodeType, id: node.id, user: ctx.user?.username });
    return { id: node.id, nodeType: node.nodeType, properties: node.properties };
  },
};

const updateNodeTool: ToolDefinition<Record<string, unknown>> = {
  name: "update_node",
  description: "更新节点属性。仅 admin/leader。必须带 _confirm:'yes'。私密单需为成员才可操作。",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "节点 ID" },
      properties: { type: "object", description: "要更新的属性键值对(merge 模式)" },
      _confirm: { type: "string", description: "必须为 'yes' 才执行写操作" },
    },
    required: ["id", "properties", "_confirm"],
    additionalProperties: false,
  },
  execute: async (input, ctx) => {
    const roleErr = checkRole(ctx);
    if (roleErr) throw new Error(`${roleErr}: 需要 admin 或 leader 角色`);

    const confirmErr = checkConfirm(input);
    if (confirmErr) throw new Error(`${confirmErr}: 写操作必须在参数中包含 _confirm:'yes'`);

    const id = String(input.id);
    const patch = (input.properties ?? {}) as Record<string, unknown>;

    const existing = await ctx.repo.getNode(id);
    if (!existing) throw new Error(`node_not_found: 节点 ${id} 不存在`);

    if (existing.nodeType === "attackTicket" && isPrivateTicket(existing)) {
      throw new Error("private_ticket: 私密攻关单仅创建人/成员可操作");
    }

    const changedKeys = Object.keys(patch);
    const updated = await ctx.repo.updateNode(id, patch, ctx.user?.username || "hermes");
    log.info("hermes.tool.write", {
      tool: "update_node",
      id,
      nodeType: existing.nodeType,
      changedKeys,
      user: ctx.user?.username,
    });
    return { id: updated.id, updatedFields: changedKeys };
  },
};

const addProgressTool: ToolDefinition<Record<string, unknown>> = {
  name: "add_progress",
  description: "给攻关单追加进展记录。仅 admin/leader。必须带 _confirm:'yes'。",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: { type: "string", description: "攻关单 ID" },
      content: { type: "string", description: "进展内容" },
      _confirm: { type: "string", description: "必须为 'yes' 才执行写操作" },
    },
    required: ["nodeId", "content", "_confirm"],
    additionalProperties: false,
  },
  execute: async (input, ctx) => {
    const roleErr = checkRole(ctx);
    if (roleErr) throw new Error(`${roleErr}: 需要 admin 或 leader 角色`);

    const confirmErr = checkConfirm(input);
    if (confirmErr) throw new Error(`${confirmErr}: 写操作必须在参数中包含 _confirm:'yes'`);

    const nodeId = String(input.nodeId);
    const content = String(input.content);

    const node = await ctx.repo.getNode(nodeId);
    if (!node) throw new Error(`node_not_found: 节点 ${nodeId} 不存在`);
    if (node.nodeType !== "attackTicket") {
      throw new Error("wrong_type: add_progress 仅支持 attackTicket 类型");
    }

    const statusSnapshot = String(node.properties["状态"] ?? "");
    const prog = await ctx.repo.appendProgress(nodeId, content, statusSnapshot, ctx.user?.username || "hermes");
    log.info("hermes.tool.write", {
      tool: "add_progress",
      nodeId,
      seqNo: prog.seqNo,
      contentPreview: content.slice(0, 80),
      user: ctx.user?.username,
    });
    return { id: prog.id, ownerId: nodeId, seqNo: prog.seqNo };
  },
};

export const ALL_WRITE_TOOLS: ToolDefinition[] = [createNodeTool, updateNodeTool, addProgressTool];

export function writeToolsEnabled(): boolean {
  return process.env.HERMES_ENABLE_WRITE === "1";
}
