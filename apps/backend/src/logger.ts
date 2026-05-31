// Lightweight structured logger (no external deps). Emits one line per event:
//   [ISO] LEVEL event key=value key2=value2
// Goal: every notable backend operation leaves a greppable trace for production
// 定位 (diagnosis) — request lifecycle, scans/jobs, merges, imports, email, errors.
import type { RequestHandler } from "express";
import { captureException } from "./sentry.js";

type Level = "INFO" | "WARN" | "ERROR";
type Fields = Record<string, unknown>;

function fmt(fields?: Fields): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${s}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function emit(level: Level, event: string, fields?: Fields) {
  const line = `[${new Date().toISOString()}] ${level} ${event}${fmt(fields)}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("INFO", event, fields),
  warn: (event: string, fields?: Fields) => emit("WARN", event, fields),
  error: (event: string, fields?: Fields) => emit("ERROR", event, fields),
};

/** Express middleware: log method, path, status, duration for every request. */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const fields: Fields = { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start };
      const role = req.headers["x-role"];
      if (role !== undefined) fields.role = String(role);
      if (res.statusCode >= 500) log.error("http.request", fields);
      else if (res.statusCode >= 400) log.warn("http.request", fields);
      else log.info("http.request", fields);
    });
    next();
  };
}

/** Wrap an async Express handler so a rejected promise becomes a 500 (Express 4 does
 *  not forward async throws to the error middleware on its own). */
export function asyncHandler<T extends (...a: any[]) => Promise<unknown>>(fn: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((e) => {
      log.error("http.unhandled", { path: req.path, error: (e as Error).message });
      captureException(e, { path: req.path, method: req.method });
      next(e);
    });
  };
}
