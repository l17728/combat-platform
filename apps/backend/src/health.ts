import { Router } from "express";
import type { DB } from "./db.js";

// systemd 进程级 watchdog 只看 PID 在不在,它无法识别"进程在但卡死"。/health 给反代/负载均衡/
// 监控脚本一个轻量探活点:DB 能 SELECT 1 + 返回当前 uptime 即视为健康。
// 系统级端点 — 在 authMiddleware 之前 mount,无需鉴权。
export function makeHealthRouter(db?: DB): Router {
  const r = Router();
  const bootAt = Date.now();
  const pkgVersion = process.env.npm_package_version || "0.0.0";

  r.get("/health", (_req, res) => {
    let dbConnected = false;
    let dbKind: string | null = null;
    if (db) {
      try {
        const row = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
        dbConnected = row?.ok === 1;
        dbKind = "sqlite";
      } catch {
        dbConnected = false;
        dbKind = "sqlite";
      }
    }
    const uptimeMs = Date.now() - bootAt;
    res.json({
      status: dbConnected ? "ok" : "degraded",
      uptime: Math.floor(uptimeMs / 1000),
      uptimeMs,
      version: pkgVersion,
      db: { kind: dbKind, connected: dbConnected },
      ts: new Date().toISOString(),
    });
  });

  return r;
}
