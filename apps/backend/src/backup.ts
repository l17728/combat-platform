import { Router } from "express";
import { readdir, unlink, stat, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import multer from "multer";
import Database from "better-sqlite3";
import { log, asyncHandler } from "./logger.js";
import type { DB } from "./db.js";

const upload = multer({ storage: multer.memoryStorage() });

const SCHEDULE_KEY = "backup_schedule";
const DEFAULT_SCHEDULE = { enabled: true, intervalHours: 168, keepCount: 4, lastBackupAt: null as string | null };

function backupsDir(dbPath: string) { return join(dirname(dbPath), "backups"); }

export function getSchedule(db: DB) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(SCHEDULE_KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_SCHEDULE };
  try { return { ...DEFAULT_SCHEDULE, ...JSON.parse(row.value) }; }
  catch { return { ...DEFAULT_SCHEDULE }; }
}

function setSchedule(db: DB, patch: Record<string, unknown>) {
  const cur = getSchedule(db);
  const merged = { ...cur, ...patch };
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)")
    .run(SCHEDULE_KEY, JSON.stringify(merged));
  return merged;
}

const pad = (n: number) => String(n).padStart(2, '0');

function backupFilename() {
  const d = new Date();
  return `combat_backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`;
}

function parseTimestamp(fn: string): string | null {
  const m = fn.match(/combat_backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.db$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

export function makeBackupRouter(db: DB, dbPath: string): Router {
  const r = Router();

  r.get("/backup/schedule", asyncHandler(async (_req, res) => {
    res.json(getSchedule(db));
  }));

  r.put("/backup/schedule", asyncHandler(async (req, res) => {
    const { enabled, intervalHours, keepCount } = req.body as {
      enabled?: boolean; intervalHours?: number; keepCount?: number;
    };
    const cfg = setSchedule(db, { enabled, intervalHours, keepCount });
    log.info("backup.schedule_updated", cfg);
    res.json(cfg);
  }));

  r.post("/backup", asyncHandler(async (_req, res) => {
    const dir = backupsDir(dbPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const fn = backupFilename();
    const fp = join(dir, fn);
    await db.backup(fp);
    const info = await stat(fp);
    setSchedule(db, { lastBackupAt: new Date().toISOString() });
    log.info("backup.created", { filename: fn, size: info.size });
    res.json({ filename: fn, size: info.size });
  }));

  r.get("/backup", asyncHandler(async (_req, res) => {
    const dir = backupsDir(dbPath);
    if (!existsSync(dir)) return res.json([]);
    const files = await readdir(dir);
    const list: { filename: string; size: number; createdAt: string }[] = [];
    for (const f of files) {
      if (!/combat_backup_\d{8}_\d{6}\.db$/.test(f)) continue;
      const info = await stat(join(dir, f));
      list.push({ filename: f, size: info.size, createdAt: parseTimestamp(f) || info.mtime.toISOString() });
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(list);
  }));

  r.get("/backup/:filename", asyncHandler(async (req, res) => {
    const fn = req.params.filename;
    if (!/combat_backup_\d{8}_\d{6}\.db$/.test(fn)) return res.status(400).json({ error: "无效文件名" });
    const fp = join(backupsDir(dbPath), fn);
    if (!existsSync(fp)) return res.status(404).json({ error: "文件不存在" });
    res.download(fp, fn);
  }));

  r.delete("/backup/:filename", asyncHandler(async (req, res) => {
    const fn = req.params.filename;
    if (!/combat_backup_\d{8}_\d{6}\.db$/.test(fn)) return res.status(400).json({ error: "无效文件名" });
    const fp = join(backupsDir(dbPath), fn);
    if (!existsSync(fp)) return res.status(404).json({ error: "文件不存在" });
    await unlink(fp);
    log.info("backup.deleted", { filename: fn });
    res.json({ deleted: fn });
  }));

  r.post("/backup/restore", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ error: "请上传 .db 文件" });
    const dir = backupsDir(dbPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `restore_pending_${Date.now()}.db`);
    await writeFile(tmpPath, req.file.buffer);
    try {
      const tdb = new Database(tmpPath, { readonly: true });
      const tbl = tdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      tdb.close();
      if (!tbl.length) throw new Error("无有效表");
    } catch (e) {
      await unlink(tmpPath).catch(() => {});
      return res.status(400).json({ error: `数据库验证失败: ${(e as Error).message}` });
    }
    const restorePending = dbPath + ".restore_pending";
    if (existsSync(restorePending)) await unlink(restorePending);
    await rename(tmpPath, restorePending);
    log.info("backup.restore_pending", { file: req.file.originalname });
    res.json({ restored: true, message: "数据库将在重启后恢复" });
    setTimeout(() => process.exit(0), 500);
  }));

  return r;
}

export async function cleanupOldBackups(dbPath: string, keepCount: number): Promise<number> {
  const dir = backupsDir(dbPath);
  if (!existsSync(dir)) return 0;
  const files = (await readdir(dir))
    .filter(f => /combat_backup_\d{8}_\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  if (files.length <= keepCount) return 0;
  const toDelete = files.slice(keepCount);
  for (const f of toDelete) await unlink(join(dir, f));
  return toDelete.length;
}

export async function runScheduledBackup(db: DB, dbPath: string): Promise<void> {
  const cfg = getSchedule(db);
  if (!cfg.enabled) return;
  const now = Date.now();
  const last = cfg.lastBackupAt ? new Date(cfg.lastBackupAt).getTime() : 0;
  if (now - last < (cfg.intervalHours || 168) * 3600_000) return;
  const dir = backupsDir(dbPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const fn = backupFilename();
  await db.backup(join(dir, fn));
  const info = await stat(join(dir, fn));
  setSchedule(db, { lastBackupAt: new Date().toISOString() });
  log.info("backup.scheduled", { filename: fn, size: info.size });
  const deleted = await cleanupOldBackups(dbPath, cfg.keepCount || 4);
  if (deleted) log.info("backup.cleanup", { deleted });
}

export function applyRestorePending(dbPath: string): void {
  const pending = dbPath + ".restore_pending";
  if (!existsSync(pending)) return;
  const preRestore = dbPath + ".pre_restore";
  if (existsSync(preRestore)) unlink(preRestore).catch(() => {});
  rename(dbPath, preRestore).catch(() => {});
  rename(pending, dbPath).then(() => {
    console.log(`[backup] Restored from pending, previous DB → ${preRestore}`);
  }).catch((e) => {
    console.error(`[backup] Restore failed:`, e);
  });
}
