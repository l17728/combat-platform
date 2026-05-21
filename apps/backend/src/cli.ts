#!/usr/bin/env node
// §43: CLI entry point. Thin wrapper over cli-core's runCli — builds a real
// fetch-based http client against COMBAT_API (default localhost:3001) and prints
// JSON. Run on Linux via: npm run cli -- <command> [args] [--opts]
import { runCli, type HttpFn } from "./cli-core.js";

const BASE = process.env.COMBAT_API ?? "http://localhost:3001";

const httpFetch: HttpFn = async ({ method, path, body }) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = typeof parsed === "object" && parsed && "error" in parsed
      ? (parsed as { error: unknown }).error : parsed;
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(detail)}`);
  }
  return parsed;
};

runCli(process.argv.slice(2), httpFetch)
  .then((out) => { process.stdout.write(JSON.stringify(out, null, 2) + "\n"); })
  .catch((e: Error) => { process.stderr.write(`错误：${e.message}\n`); process.exit(1); });
