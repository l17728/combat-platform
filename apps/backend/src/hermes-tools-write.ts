// v2.5 Hermes 写工具 (默认禁用)
//
// 占位文件 —— 写动作 (create_node / update_node / delete_node) 在 v2.5 默认不暴露,
// 因为 tool-using agent 的写权限策略 / 二次确认协议 / 审计链路尚未冻结。
//
// 启用方式: 设置环境变量 HERMES_ENABLE_WRITE=1,然后在此处补 ToolDefinition 实现,
// 通过 ALL_WRITE_TOOLS 暴露到 hermes-tools.ts 的注册表里(开关在 callTool 上层做)。
//
// 设计要求 (来自 docs/V2.5_DESIGN.md §4):
//   - 默认 OFF
//   - 启用后 LLM 必须输出 `WRITE_CONFIRM: yes` 才放行
//   - 全部写动作打 audit_log (action='HERMES_INVOKE')
//   - 单用户 60 req/min 上限

import type { ToolDefinition } from "./hermes-tools.js";

export const ALL_WRITE_TOOLS: ToolDefinition[] = [];

export function writeToolsEnabled(): boolean {
  return process.env.HERMES_ENABLE_WRITE === "1";
}
