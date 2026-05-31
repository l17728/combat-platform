// CSRF 同源 Referer/Origin 校验 (P1)。
// 现状:鉴权用 JWT bearer token (放 Authorization header,不存 cookie),理论上 CSRF 风险低
// (浏览器同源策略 + Authorization 不在跨站请求里自动发送)。本中间件作为深度防御加一层:
//   - 写请求 (POST/PUT/PATCH/DELETE) 必须带 Origin 或 Referer,且 host 与服务端 Host 一致
//   - 读请求 (GET/HEAD/OPTIONS) 放行
//   - 缺失 Origin+Referer 的"原生客户端"(curl/postman/CLI) 在生产期 → 403
//     但仅当带 Authorization 时才生效,公开匿名提交 (bug-report POST) 保持放行
//   - test / COMBAT_NO_AUTH=1 全放行
import type { Request, Response, NextFunction } from "express";
import { log } from "./logger.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isSameOrigin(headerValue: string | undefined, host: string | undefined): boolean {
  if (!headerValue || !host) return false;
  try {
    const url = new URL(headerValue);
    const hostNoPort = host.split(":")[0];
    return url.host === host || url.hostname === hostNoPort;
  } catch {
    return false;
  }
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // bypass:test 环境 / 显式 NO_AUTH / 健康检查 / 反馈链接(token in URL)
  if (process.env.NODE_ENV === "test" || process.env.COMBAT_NO_AUTH === "1") return next();
  if (SAFE_METHODS.has(req.method)) return next();
  const path = req.path;
  // 公开匿名写接口 (反馈/bug 上报) 不强制 — 它们没有 Authorization,CSRF 无 token 可偷
  if (path.startsWith("/help/feedback/") || path === "/bug-reports") return next();
  // 已登录写请求强制同源;无 Authorization 的写(CLI / 内部测试) 走原路放行
  const hasAuth = !!req.headers["authorization"];
  if (!hasAuth) return next();
  const host = req.headers["host"] as string | undefined;
  const origin = req.headers["origin"] as string | undefined;
  const referer = req.headers["referer"] as string | undefined;
  if (isSameOrigin(origin, host)) return next();
  if (isSameOrigin(referer, host)) return next();
  log.warn("csrf.blocked", { method: req.method, path, origin, referer, host });
  res.status(403).json({ error: "CSRF 同源校验失败" });
  return;
}
