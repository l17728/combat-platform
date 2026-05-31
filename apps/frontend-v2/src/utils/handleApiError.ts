import { message } from "antd";
import { ApiError } from "../api.js";

/**
 * 集中处理 api.* 抛出的错误。约定:
 *  - 401:已被 api.ts 内的 onUnauthorized 钩子全局接管(跳登录),
 *    这里直接静默不弹 toast,避免重复噪音。
 *  - 403:展示后端返回的 detail(权限文案精确),defaultMsg 兜底。
 *  - 其它:展示 e.message,defaultMsg 兜底。
 *  - 非 ApiError(网络/Type/Syntax 等):展示 defaultMsg。
 *
 * 用法:
 *   try { await api.updateNode(...) }
 *   catch (e) { handleApiError(e, '保存失败') }
 *
 * 渐进迁移:
 *  - 旧的 catch (e: any) { message.error(e.message) } 仍兼容,不强制改;
 *  - 新代码 / 高频路径推荐用本 helper(401 自动静默 + 文案精确)。
 */
export function handleApiError(e: unknown, defaultMsg?: string): ApiError | null {
  if (e instanceof ApiError) {
    // 401 已被全局 unauthorizedHandler 接管 → 跳 /login,此处不再 toast。
    if (e.status === 401) return e;
    const text = e.detail || e.message || defaultMsg || "请求失败";
    message.error(text);
    return e;
  }
  // 非 ApiError(网络/Type/Syntax 等):展示 defaultMsg + 原始 message。
  const fallback = e instanceof Error ? e.message : typeof e === "string" ? e : "未知错误";
  message.error(defaultMsg ? `${defaultMsg}: ${fallback}` : fallback);
  return null;
}
