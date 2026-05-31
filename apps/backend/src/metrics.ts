import { Router, type RequestHandler } from "express";
import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from "prom-client";

/**
 * v2.2 P1 §7: Prometheus metrics 端点 /api/metrics
 *
 * 暴露:
 *   - combat_http_requests_total{method,route,status}  HTTP 请求计数(label cardinality 受 route 模板控制)
 *   - combat_http_request_duration_ms{method,route}    HTTP 请求耗时分布(histogram, ms)
 *   - combat_http_in_flight                            当前并发请求数
 *   - combat_db_queries_total{kind}                    DB 查询计数(SELECT/INSERT/UPDATE/DELETE/OTHER)
 *   - 默认 Node.js 进程指标(GC, event loop lag, heap, RSS, FDs, ...)
 *
 * /metrics 不挂 auth(Prometheus scraper 通常裸抓);prod 部署时由反代/防火墙做 IP 白名单。
 *
 * 路由模板归一:Express req.route?.path 取注册时模板(如 /nodes/:id),避免 :id UUID 把
 * label cardinality 炸成无穷多;无路由匹配(404)时退回 req.path 截短至 64 字符。
 */

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "combat_" });

const httpRequests = new Counter({
  name: "combat_http_requests_total",
  help: "HTTP 请求总数",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

const httpDuration = new Histogram({
  name: "combat_http_request_duration_ms",
  help: "HTTP 请求耗时(毫秒)",
  labelNames: ["method", "route"] as const,
  // 覆盖 1ms 到 30s,对内部工具足够分辨率
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  registers: [registry],
});

const httpInFlight = new Gauge({
  name: "combat_http_in_flight",
  help: "当前正在处理的 HTTP 请求数",
  registers: [registry],
});

const dbQueries = new Counter({
  name: "combat_db_queries_total",
  help: "DB 查询计数(按动词分类)",
  labelNames: ["kind"] as const,
  registers: [registry],
});

/** 给 Repository / Adapter 调用以累计 DB query 计数(可选,渐进接入)。 */
export function incDbQuery(sql: string): void {
  const s = sql.trim().slice(0, 10).toUpperCase();
  let kind = "OTHER";
  if (s.startsWith("SELECT")) kind = "SELECT";
  else if (s.startsWith("INSERT")) kind = "INSERT";
  else if (s.startsWith("UPDATE")) kind = "UPDATE";
  else if (s.startsWith("DELETE")) kind = "DELETE";
  dbQueries.labels(kind).inc();
}

/** Express 中间件:统计每个请求的 method/route/status/duration + 当前并发。 */
export function metricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    httpInFlight.inc();
    const start = Date.now();
    res.on("finish", () => {
      httpInFlight.dec();
      const route = (req.route?.path as string | undefined) ?? req.path.slice(0, 64) ?? "unknown";
      const method = req.method;
      const status = String(res.statusCode);
      const ms = Date.now() - start;
      httpRequests.labels(method, route, status).inc();
      httpDuration.labels(method, route).observe(ms);
    });
    next();
  };
}

/** Router exposing /metrics — no auth, Prometheus scraper friendly. */
export function makeMetricsRouter(): Router {
  const r = Router();
  r.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });
  return r;
}

/** Test helper: reset all metric values + default collectors. Used by metrics e2e. */
export function __resetMetricsForTest(): void {
  registry.resetMetrics();
}

/** Test helper: peek at registry for assertions. */
export function getMetricsRegistry(): Registry {
  return registry;
}
