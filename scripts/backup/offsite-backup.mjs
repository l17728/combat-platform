#!/usr/bin/env node
// offsite-backup.mjs — Roll up the combat data tree into a single timestamped
// tar.gz and SFTP it to a remote host. Designed to run standalone (cron / CI)
// or via the `backup:offsite` CLI / `POST /api/backup/offsite` endpoint.
//
// What gets archived (every path is optional — missing ones are skipped with a
// warning):
//   - combat.db               (default: $COMBAT_DB_PATH or /opt/combat-v2/data/combat.sqlite)
//   - config/schemas/         (default: repoRoot/config/schemas)
//   - data/schemas-overlay/   (default: dirname(combat.db)/schemas-overlay or $COMBAT_SCHEMA_OVERLAY_DIR)
//
// Usage (CLI args take precedence over env):
//   node scripts/backup/offsite-backup.mjs \
//     --host backup.example.com \
//     --user combat \
//     --remote-dir /backups/combat-v2 \
//     [--key /etc/combat-v2/backup_id_ed25519] \
//     [--port 22] \
//     [--db /opt/combat-v2/data/combat.sqlite] \
//     [--schemas ./config/schemas] \
//     [--overlay /opt/combat-v2/data/schemas-overlay] \
//     [--dry-run]
//
// Exit code: 0 success, non-zero failure (logged to stderr).

import { Client } from "ssh2";
import { create as tarCreate } from "tar";
import { existsSync, mkdirSync, statSync, readFileSync, rmSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

export function resolveConfig(opts = {}, env = process.env) {
  const dbPath = opts.db || env.COMBAT_DB_PATH || "/opt/combat-v2/data/combat.sqlite";
  const schemasDir = opts.schemas || join(repoRoot, "config", "schemas");
  const overlayDir = opts.overlay || env.COMBAT_SCHEMA_OVERLAY_DIR || join(dirname(dbPath), "schemas-overlay");
  const host = opts.host || env.COMBAT_BACKUP_HOST;
  const user = opts.user || env.COMBAT_BACKUP_USER || "root";
  const port = Number(opts.port || env.COMBAT_BACKUP_PORT || 22);
  const remoteDir = opts["remote-dir"] || env.COMBAT_BACKUP_REMOTE_DIR;
  const keyPath = opts.key || env.COMBAT_BACKUP_SSH_KEY;
  const password = env.COMBAT_BACKUP_SSH_PASSWORD; // env only — no CLI flag, avoid ps leak
  const dryRun = opts["dry-run"] === true || opts["dry-run"] === "true";
  return { dbPath, schemasDir, overlayDir, host, user, port, remoteDir, keyPath, password, dryRun };
}

export function planArchive(cfg) {
  const entries = [];
  const skipped = [];
  for (const [label, path] of [
    ["combat.db", cfg.dbPath],
    ["config/schemas", cfg.schemasDir],
    ["data/schemas-overlay", cfg.overlayDir],
  ]) {
    if (path && existsSync(path)) entries.push({ label, path });
    else skipped.push({ label, path });
  }
  return { entries, skipped };
}

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function buildArchive(plan, outPath) {
  const filesByCwd = new Map();
  for (const e of plan.entries) {
    const parent = dirname(e.path);
    const arr = filesByCwd.get(parent) || [];
    arr.push(basename(e.path));
    filesByCwd.set(parent, arr);
  }
  // tar.create supports a single cwd; for multi-cwd we stream each then merge —
  // simpler: stage everything under a tmpdir using symlink-or-copy, then tar -czf.
  const stageDir = join(tmpdir(), `combat-offsite-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });
  try {
    for (const e of plan.entries) {
      const dest = join(stageDir, e.label.replace(/\//g, "_"));
      // copy (avoids symlink portability issues on Windows)
      await copyRecursive(e.path, dest);
    }
    await tarCreate({ gzip: true, file: outPath, cwd: stageDir }, ["."]);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

async function copyRecursive(src, dst) {
  const { cp } = await import("node:fs/promises");
  await cp(src, dst, { recursive: true });
}

function uploadOverSftp(cfg, localPath) {
  return new Promise((resolveP, reject) => {
    const c = new Client();
    const remoteName = `combat-offsite_${ts()}.tar.gz`;
    const remotePath = `${cfg.remoteDir.replace(/\/$/, "")}/${remoteName}`;
    c.on("ready", () => {
      c.sftp((err, sftp) => {
        if (err) return reject(err);
        const ws = sftp.createWriteStream(remotePath);
        ws.on("close", () => {
          c.end();
          resolveP({ remotePath, size: statSync(localPath).size });
        });
        ws.on("error", reject);
        ws.end(readFileSync(localPath));
      });
    });
    c.on("error", reject);
    const connectOpts = { host: cfg.host, port: cfg.port, username: cfg.user, readyTimeout: 30_000 };
    if (cfg.keyPath) connectOpts.privateKey = readFileSync(cfg.keyPath);
    else if (cfg.password) connectOpts.password = cfg.password;
    else return reject(new Error("must set --key, $COMBAT_BACKUP_SSH_KEY, or $COMBAT_BACKUP_SSH_PASSWORD"));
    c.connect(connectOpts);
  });
}

export async function runOffsiteBackup(cfg, logger = console) {
  const plan = planArchive(cfg);
  if (plan.entries.length === 0) {
    throw new Error("nothing to back up: all source paths missing");
  }
  for (const s of plan.skipped) logger.warn?.(`[skip] ${s.label} (${s.path}) not found`);
  logger.log?.(`[plan] entries=${plan.entries.map((e) => e.label).join(", ")}`);

  const archiveName = `combat-offsite_${ts()}.tar.gz`;
  const archivePath = join(tmpdir(), archiveName);
  await buildArchive(plan, archivePath);
  const sizeBytes = statSync(archivePath).size;
  logger.log?.(`[archive] ${archivePath} (${(sizeBytes / 1024).toFixed(1)} KB)`);

  if (cfg.dryRun) {
    logger.log?.(`[dry-run] would upload to ${cfg.user}@${cfg.host}:${cfg.remoteDir}/${archiveName}`);
    rmSync(archivePath, { force: true });
    return { dryRun: true, plannedSize: sizeBytes, archiveName, entries: plan.entries, skipped: plan.skipped };
  }

  if (!cfg.host || !cfg.remoteDir) throw new Error("missing --host or --remote-dir");
  const up = await uploadOverSftp(cfg, archivePath);
  rmSync(archivePath, { force: true });
  logger.log?.(`[uploaded] ${up.remotePath} (${(up.size / 1024).toFixed(1)} KB)`);
  return {
    dryRun: false,
    remotePath: up.remotePath,
    size: up.size,
    archiveName,
    entries: plan.entries,
    skipped: plan.skipped,
  };
}

// CLI entrypoint — only run when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = resolveConfig(opts);
  try {
    const result = await runOffsiteBackup(cfg);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(`[offsite-backup] FAILED: ${e.message}`);
    process.exit(1);
  }
}
