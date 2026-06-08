/**
 * 系统管理路径 — 单一来源（Single Source of Truth）
 *
 * 所有需要区分"系统管理页面"与"业务页面"的代码必须引用本文件，
 * 不得在各自模块中硬编码路径列表。
 *
 * 判断标准：出现在侧边栏"系统管理"菜单下的路径 = 系统路径。
 * /proposals 和 /reminders 属于"审核管理"子菜单 = 业务功能，不在列表中。
 *
 * 消费者：
 *   - AppLayout.tsx        SYSTEM_PATH_PREFIXES  → isSystemPath()
 *   - useGuestGuard.ts     SYSTEM_PATHS          → isSystemPage()
 *   - api.ts               GUEST_SYSTEM_PREFIXES → isGuestSystemPath()
 *
 * 后端对应列表：
 *   - tenant-middleware.ts GUEST_BLOCKED_PREFIXES
 *   - app.ts               adminMiddleware 挂载列表
 *
 * 修改此列表时，必须同步修改后端 tenant-middleware.ts 的 GUEST_BLOCKED_PREFIXES。
 */

export const SYSTEM_PATH_PREFIXES: readonly string[] = [
  "/import",
  "/schema",
  "/config",
  "/email",
  "/digest",
  "/llm-settings",
  "/audit",
  "/backup",
  "/merge",
  "/system-upgrade",
  "/db-migration",
  "/op-log",
  "/webhooks",
  "/invitations",
  "/users",
  "/platform",
  "/notifications",
];

export function isSystemPath(pathname: string): boolean {
  return SYSTEM_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export const API_SYSTEM_PREFIXES: readonly string[] = [
  "/api/import",
  "/api/schema",
  "/api/config",
  "/api/settings",
  "/api/email",
  "/api/digest",
  "/api/llm-settings",
  "/api/audit",
  "/api/backup",
  "/api/merge",
  "/api/upgrade",
  "/api/db-migration",
  "/api/op-logs",
  "/api/webhook",
  "/api/invitation",
  "/api/users",
  "/api/platform",
  "/api/notifications",
  "/api/kg-outbox",
  "/api/metrics",
];

export function isApiSystemPath(apiPath: string): boolean {
  return API_SYSTEM_PREFIXES.some((prefix) => apiPath.startsWith(prefix));
}

/**
 * 系统核心节点类型 — 不允许删除（前后端共享定义）
 *
 * 前端消费者: SchemaWizard.tsx
 * 后端消费者: schema-api.ts
 *
 * 修改此列表时，必须同步修改后端 schema-api.ts 的 PROTECTED_NODE_TYPES。
 */
export const PROTECTED_NODE_TYPES: readonly string[] = ["attackTicket", "person", "contribution"];

/**
 * localStorage 键名 — 单一来源
 *
 * 消费者: api.ts, op-logger.ts, AppLayout.tsx
 */
export const STORAGE_KEYS = {
  TOKEN: "combat-token",
  USER: "combat-user",
  ROLE: "combat-role",
  THEME: "combat-theme",
} as const;

/**
 * sessionStorage 键名 — guest 专用（每个标签页独立，互不干扰）
 *
 * guest token 存 sessionStorage → 关标签即退出、不影响同浏览器其他标签页
 * 普通用户继续用 localStorage → 跨标签页共享、刷新保持登录
 */
export const SESSION_KEYS = {
  TOKEN: "combat-session-token",
  USER: "combat-session-user",
  ROLE: "combat-session-role",
  TENANT: "combat-session-tenant",
} as const;

/**
 * 判断当前 sessionStorage 中是否有 guest token（快速检测当前 tab 是否为 guest 会话）
 */
export function isGuestSession(): boolean {
  try {
    return !!sessionStorage.getItem(SESSION_KEYS.TOKEN);
  } catch {
    return false;
  }
}
