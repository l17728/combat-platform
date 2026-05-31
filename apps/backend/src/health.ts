import { Router } from "express";
import type { DB } from "./db.js";
import type { DbAdapter } from "./db-adapter.js";

export function makeHealthRouter(db?: DB, adapter?: DbAdapter): Router {
  const r = Router();
  const bootAt = Date.now();
  const pkgVersion = process.env.npm_package_version || "0.0.0";

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
