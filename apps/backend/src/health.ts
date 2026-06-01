import { Router } from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "./db.js";
import type { DbAdapter } from "./db-adapter.js";

function resolvePkgVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function makeHealthRouter(db?: DB, adapter?: DbAdapter): Router {
  const r = Router();
  const bootAt = Date.now();
  const pkgVersion = resolvePkgVersion();

  r.get("/health", async (_req, res) => {
    let dbConnected = false;
    let dbKind: string | null = null;

    if (adapter) {
      try {
        const row = await adapter.queryOne<{ ok: number }>("SELECT 1 as ok");
        dbConnected = row?.ok === 1;
        dbKind = adapter.kind;
      } catch {
        dbConnected = false;
        dbKind = adapter.kind;
      }
    } else if (db) {
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
