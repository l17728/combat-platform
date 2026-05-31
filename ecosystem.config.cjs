// PM2 cluster config for the Combat backend.
//
// Usage:
//   pm2 start ecosystem.config.cjs            # start in detached daemon
//   pm2 start ecosystem.config.cjs --no-daemon  # foreground (CI / systemd)
//   pm2 reload combat-v2                      # zero-downtime reload
//
// Pre-req: backend is compiled (`npm run build --workspace=@combat/backend`).
//
// WARNING — DO NOT use cluster mode with the SQLite adapter.
// better-sqlite3 is a single-process, embedded engine; multi-process clusters
// will race the file lock and corrupt the WAL. See docs/PERFORMANCE_TUNING.md
// (section "PM2 Cluster 使用说明") for the SQLite vs Postgres deployment matrix.
//
// Default `instances: 1` is safe for the current SQLite production. Override
// at run-time once the Postgres adapter is the primary driver:
//   COMBAT_PM2_INSTANCES=max pm2 start ecosystem.config.cjs
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("node:path");

const instances = process.env.COMBAT_PM2_INSTANCES || "1";
const execMode = instances === "1" ? "fork" : "cluster";

module.exports = {
  apps: [
    {
      name: "combat-v2",
      cwd: path.join(__dirname, "apps", "backend"),
      script: "dist/server.js",
      instances,
      exec_mode: execMode,
      // Treat SIGTERM as graceful shutdown; allow up to 10 s for in-flight
      // requests + DB writes to drain before SIGKILL.
      kill_timeout: 10_000,
      // Restart on uncaught errors; pm2 backs off automatically (10s, 20s, …).
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      // Persist logs alongside the systemd backend.log convention so logrotate
      // (scripts/deploy-v2/logrotate-combat-v2) keeps coverage when pm2 is the
      // process supervisor instead of systemd. Override on non-Linux dev:
      //   COMBAT_PM2_LOG_DIR=./logs pm2 start ecosystem.config.cjs --no-daemon
      out_file: process.env.COMBAT_PM2_LOG_DIR
        ? path.join(process.env.COMBAT_PM2_LOG_DIR, "backend.log")
        : "/opt/combat-v2/backend.log",
      error_file: process.env.COMBAT_PM2_LOG_DIR
        ? path.join(process.env.COMBAT_PM2_LOG_DIR, "backend.log")
        : "/opt/combat-v2/backend.log",
      merge_logs: true,
      time: true,
    },
  ],
};
