/**
 * Mock tool implementations for the Hermes tool-calling agent.
 *
 * 桶 B (r-agent) 与 桶 A (r-tools) 解耦的临时实现:本文件提供 4-5 个最常用工具的
 * **OpenAI-compatible JSON Schema** 与 mock 执行函数,让 agent 单测/本机调试不依赖
 * `hermes-tools.ts`。集成阶段(桶 D)只需把 import 改为 `./hermes-tools.js`。
 *
 * 协议:
 * - TOOL_SCHEMAS 是 OpenAI ChatCompletions `tools` 数组格式: `[{type:'function', function:{name, description, parameters(JSON Schema)}}]`
 * - callTool(name, input, ctx) 异步返回任意 JSON-serializable 数据;调用方负责 JSON.stringify
 *
 * ctx 形参为后续接 hermes-tools 的真实 repo / db / user 留出占位,mock 实现忽略它。
 */

import type { Repository, SchemaRegistry } from "@combat/shared";
import type { DB } from "./db.js";

export interface ToolCtx {
  repo?: Repository;
  registry?: SchemaRegistry;
  db?: DB;
  user?: { id?: string; username?: string; role?: string };
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "list_node_types",
      description: "列出系统所有 nodeType 与对应中文 label,用于先看有哪些数据。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_node_type",
      description: "返回指定 nodeType 的完整字段定义(名称/类型/必填/枚举)。",
      parameters: {
        type: "object",
        properties: { nodeType: { type: "string", description: "节点类型,如 attackTicket" } },
        required: ["nodeType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_nodes",
      description: "统计某 nodeType 当前总条数。",
      parameters: {
        type: "object",
        properties: { nodeType: { type: "string" } },
        required: ["nodeType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_nodes",
      description: "按 nodeType 查询节点列表(单次最多 50 条)。可选 filter 做等值过滤。",
      parameters: {
        type: "object",
        properties: {
          nodeType: { type: "string" },
          filter: { type: "object", description: "字段等值过滤,例如 {状态:'处理中'}", additionalProperties: true },
          limit: { type: "number", description: "默认 20,最大 50" },
        },
        required: ["nodeType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_node",
      description: "按节点 id 直取完整节点 + 近 5 条进展。",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

const MAX_LIMIT = 50;

/**
 * Mock 执行入口。集成阶段直接换成 `hermes-tools.ts` 的同名函数。
 * 返回任意 JSON-serializable 数据(不在内部 stringify,由调用方截断/打包)。
 */
export async function callTool(name: string, input: Record<string, unknown>, ctx: ToolCtx = {}): Promise<unknown> {
  switch (name) {
    case "list_node_types": {
      if (ctx.registry) {
        return ctx.registry.getConfig().nodeTypes.map((ns) => ({ nodeType: ns.nodeType, label: ns.label }));
      }
      // pure mock
      return [
        { nodeType: "attackTicket", label: "攻关单" },
        { nodeType: "person", label: "人员" },
      ];
    }
    case "describe_node_type": {
      const nt = String(input.nodeType ?? "");
      if (!nt) throw new Error("nodeType 必填");
      if (ctx.registry) {
        const ns = ctx.registry.getConfig().nodeTypes.find((s) => s.nodeType === nt);
        if (!ns) return { error: `unknown nodeType: ${nt}` };
        return {
          nodeType: ns.nodeType,
          label: ns.label,
          fields: ns.fields.map((f) => ({
            name: f.name,
            type: f.type,
            required: !!f.required,
            enumValues: f.enumValues,
          })),
        };
      }
      return { nodeType: nt, label: nt, fields: [] };
    }
    case "count_nodes": {
      const nt = String(input.nodeType ?? "");
      if (!nt) throw new Error("nodeType 必填");
      if (ctx.repo) {
        const all = await ctx.repo.queryNodes(nt);
        return { nodeType: nt, count: all.length };
      }
      return { nodeType: nt, count: 0 };
    }
    case "query_nodes": {
      const nt = String(input.nodeType ?? "");
      if (!nt) throw new Error("nodeType 必填");
      const filter = (input.filter as Record<string, unknown>) || {};
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(input.limit ?? 20)));
      if (ctx.repo) {
        let nodes = await ctx.repo.queryNodes(nt);
        for (const [k, v] of Object.entries(filter)) {
          nodes = nodes.filter((n) => String(n.properties[k] ?? "") === String(v));
        }
        return nodes.slice(0, limit).map((n) => ({
          id: n.id,
          nodeType: n.nodeType,
          properties: n.properties,
          updatedAt: n.updatedAt,
        }));
      }
      return [];
    }
    case "get_node": {
      const id = String(input.id ?? "");
      if (!id) throw new Error("id 必填");
      if (ctx.repo) {
        const node = await ctx.repo.getNode(id);
        if (!node) return { error: `node not found: ${id}` };
        const progress = await ctx.repo.listProgress(id);
        return { node, progress: progress.slice(-5) };
      }
      return { node: { id, nodeType: "mock", properties: {}, createdAt: "", updatedAt: "" }, progress: [] };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
