import { Router } from "express";
import { log, asyncHandler } from "./logger.js";
import type { DbAdapter } from "./db-adapter.js";

export function makeSettingsRouter(adapter: DbAdapter): Router {
  // SQLite-only DDL — Postgres path already provisioned by POSTGRES_SCHEMA_DDL.
  if (adapter.kind === "sqlite") {
    adapter.rawSqlite().exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);
  }

  const r = Router();

  const PREFIX = "config:";
  function cfgKey(key: string) {
    return `${PREFIX}${key}`;
  }

  r.get(
    "/settings",
    asyncHandler(async (_req, res) => {
      const rows = await adapter.query<{ key: string; value: string }>(
        `SELECT key, value FROM app_settings WHERE key LIKE ?`,
        [`${PREFIX}%`]
      );

      const configs: Record<string, { values: string[]; label?: string }> = {};
      for (const row of rows) {
        const bareKey = row.key.slice(PREFIX.length);
        try {
          configs[bareKey] = JSON.parse(row.value);
        } catch {
          /* skip corrupt */
        }
      }
      res.json(configs);
    })
  );

  r.get(
    "/settings/:key",
    asyncHandler(async (req, res) => {
      const row = await adapter.queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [
        cfgKey(req.params.key),
      ]);
      if (!row) return res.status(404).json({ error: "配置项不存在" });
      try {
        res.json(JSON.parse(row.value));
      } catch {
        res.status(500).json({ error: "配置值格式错误" });
      }
    })
  );

  r.get(
    "/settings/:key/resolve",
    asyncHandler(async (req, res) => {
      const scope = req.query.scope as string | undefined;
      let row: { value: string } | undefined;

      if (scope) {
        row = await adapter.queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [
          cfgKey(`${scope}.${req.params.key}`),
        ]);
      }
      if (!row) {
        row = await adapter.queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [
          cfgKey(req.params.key),
        ]);
      }
      if (!row) return res.status(404).json({ error: "配置项不存在" });
      try {
        res.json(JSON.parse(row.value));
      } catch {
        res.status(500).json({ error: "配置值格式错误" });
      }
    })
  );

  r.put(
    "/settings/:key",
    asyncHandler(async (req, res) => {
      const { values, label } = req.body as { values?: string[]; label?: string };
      if (!Array.isArray(values)) return res.status(400).json({ error: "values 必须是数组" });
      const payload = JSON.stringify({ values, label });
      await adapter.run(
        `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
        [cfgKey(req.params.key), payload, payload]
      );
      log.info("settings.upsert", { key: req.params.key, count: values.length });
      res.json({ key: req.params.key, values, label });
    })
  );

  r.delete(
    "/settings/:key",
    asyncHandler(async (req, res) => {
      const info = await adapter.run(`DELETE FROM app_settings WHERE key = ?`, [cfgKey(req.params.key)]);
      if (info.changes === 0) return res.status(404).json({ error: "配置项不存在" });
      log.info("settings.delete", { key: req.params.key });
      res.json({ deleted: req.params.key });
    })
  );

  return r;
}
