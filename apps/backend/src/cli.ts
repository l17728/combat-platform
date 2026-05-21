#!/usr/bin/env node
// §43/§44: CLI entry point. Thin wrapper over cli-core's runCli — builds a real
// fetch-based http client against COMBAT_API (default localhost:3001) and prints
// JSON. Run on Linux via: npm run cli -- <command> [args] [--opts]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { runCli, type HttpFn } from "./cli-core.js";

const BASE = process.env.COMBAT_API ?? "http://localhost:3001";
const ROLE = process.env.COMBAT_ROLE; // §50: optional; absent → trusted system access
const roleHeader = (): Record<string, string> => (ROLE ? { "X-Role": ROLE } : {});

const httpFetch: HttpFn = async ({ method, path, body, uploadFile, saveTo }) => {
  // §44: multipart upload (import)
  if (uploadFile) {
    const buf = readFileSync(uploadFile);
    const fd = new FormData();
    fd.append("file", new Blob([buf]), basename(uploadFile));
    const res = await fetch(`${BASE}${path}`, { method, body: fd, headers: roleHeader() });
    const text = await res.text();
    let parsed: unknown = text; try { parsed = text ? JSON.parse(text) : null; } catch { /* raw */ }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(parsed)}`);
    return parsed;
  }
  // §44: binary download to file (export)
  if (saveTo) {
    const res = await fetch(`${BASE}${path}`, { method, headers: roleHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const ab = await res.arrayBuffer();
    writeFileSync(saveTo, Buffer.from(ab));
    return { saved: saveTo, bytes: ab.byteLength };
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...roleHeader() },
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
