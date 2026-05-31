/**
 * 一键升级 router (v2.3 旗舰特性 / task #75)
 *
 * 8 个端点(全部 admin-only,COMBAT_NO_AUTH 模式放行以便 e2e):
 *   GET  /api/upgrade/current     当前 git commit / 版本 / uptime / DB 大小
 *   POST /api/upgrade/upload      multipart .tar.gz → staging,返回 stagingId
 *   POST /api/upgrade/analyze     { stagingId } → 解包到临时目录,跑 schema-merger,返回 diff 报告
 *   POST /api/upgrade/apply       { stagingId, confirm:true } → 启 detached worker,返回 jobId
 *   GET  /api/upgrade/status      读 data/upgrade-state.json,phase/percent/log
 *   POST /api/upgrade/rollback    触发回滚到最近 backup
 *   GET  /api/upgrade/history     读 data/upgrade-history.json
 *   GET  /api/upgrade/log/:jobId  纯文本流式日志(stream tail)
 *
 * 写作方式参照 db-migration.ts,所有重逻辑放 worker(scripts/upgrade/worker.mjs)。
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import * as tar from "tar";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  createReadStream,
  unlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

function adminOnly(req: Request, res: Response, next: NextFunction): void {
  const role = (req as any).user?.role;
  if (role !== undefined && role !== "admin") {
    res.status(403).json({ error: "仅管理员可执行系统升级" });
    return;
  }
  next();
}

function dataDir(): string {
  const d = process.env.COMBAT_UPGRADE_DATA_DIR || join(process.cwd(), "data");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function stagingDir(): string {
  const d = join(dataDir(), "upgrade-staging");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function logsDir(): string {
  const d = join(dataDir(), "upgrade-logs");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function stateFile(): string {
  return join(dataDir(), "upgrade-state.json");
}

function historyFile(): string {
  return join(dataDir(), "upgrade-history.json");
}

function readStateSafe(): UpgradeState | null {
  try {
    if (!existsSync(stateFile())) return null;
    return JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

function readHistorySafe(): UpgradeHistoryEntry[] {
  try {
    if (!existsSync(historyFile())) return [];
    const v = JSON.parse(readFileSync(historyFile(), "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function currentVersion(): { version: string; commit: string | null; readableVersion: string } {
  // version 从 root package.json 取(单源),commit 从 git 取(本地有.git 才有)
  const pkgPath = join(process.cwd(), "..", "..", "package.json");
  let version = "unknown";
  try {
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      version = pkg.version || "unknown";
    }
  } catch {}
  let commit: string | null = null;
  try {
    commit = execSync("git rev-parse HEAD", {
      cwd: join(process.cwd(), "..", ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
      .slice(0, 7);
  } catch {}
  return { version, commit, readableVersion: commit ? `${version} (${commit})` : version };
}

function dbSize(sqlitePath: string): number {
  try {
    if (sqlitePath && existsSync(sqlitePath)) return statSync(sqlitePath).size;
  } catch {}
  return 0;
}

export interface UpgradeState {
  jobId: string;
  stagingId: string;
  phase:
    | "queued"
    | "backup"
    | "extract"
    | "schema-merge"
    | "secrets"
    | "code-swap"
    | "restart"
    | "health"
    | "done"
    | "failed"
    | "rolled-back";
  percent: number;
  log: string[];
  error?: string;
  backupId?: string;
  startedAt: string;
  endedAt?: string;
  targetVersion?: string;
  fromVersion?: string;
}

export interface UpgradeHistoryEntry {
  jobId: string;
  stagingId: string;
  fromVersion: string;
  toVersion: string;
  startedAt: string;
  endedAt: string;
  phase: UpgradeState["phase"];
  error?: string;
  backupId?: string;
}

export interface AnalyzeReport {
  stagingId: string;
  targetVersion: string;
  schemaReport: {
    kept: { nodeType: string; fieldName: string }[];
    conflicts: {
      nodeType: string;
      fieldName: string;
      baselineType?: string;
      userType?: string;
      suggestion: string;
    }[];
    removed: any[];
    userTables: { nodeType: string; fieldCount: number }[];
  };
  breaking: string[];
  newSchemas: string[];
  requiredEnv: string[];
  warnings: string[];
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}
export interface ReleaseInfo {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  assets: ReleaseAsset[];
}

/** 拉取 GitHub Releases。fetchFn 可注入用于测试。 */
export async function fetchGithubReleases(
  fetchFn: typeof fetch = globalThis.fetch
): Promise<{ ok: true; releases: ReleaseInfo[] } | { ok: false; status: number; error: string }> {
  const repo = process.env.UPGRADE_GITHUB_REPO;
  if (!repo) {
    return { ok: false, status: 503, error: "未配置 UPGRADE_GITHUB_REPO (期望 owner/repo)" };
  }
  if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) {
    return { ok: false, status: 400, error: `UPGRADE_GITHUB_REPO 格式错误: ${repo} (期望 owner/repo)` };
  }
  const url = `https://api.github.com/repos/${repo}/releases?per_page=20`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "combat-upgrade",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    resp = await fetchFn(url, { method: "GET", headers });
  } catch (e) {
    return { ok: false, status: 502, error: `GitHub 网络异常: ${(e as Error).message}` };
  }
  if (!resp.ok) {
    return {
      ok: false,
      status: 502,
      error: `GitHub 返回 ${resp.status} ${resp.statusText}`,
    };
  }
  let raw: any;
  try {
    raw = await resp.json();
  } catch (e) {
    return { ok: false, status: 502, error: `GitHub 响应非 JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, status: 502, error: "GitHub 响应不是 release 数组" };
  }
  const releases: ReleaseInfo[] = raw.map((r: any) => ({
    tag: String(r.tag_name ?? ""),
    name: String(r.name ?? r.tag_name ?? ""),
    publishedAt: String(r.published_at ?? ""),
    body: String(r.body ?? ""),
    assets: Array.isArray(r.assets)
      ? r.assets.map((a: any) => ({
          name: String(a.name ?? ""),
          url: String(a.browser_download_url ?? ""),
          size: Number(a.size ?? 0),
        }))
      : [],
  }));
  return { ok: true, releases };
}

export function makeUpgradeRouter(sqlitePath: string): Router {
  const r = Router();
  r.use(adminOnly);

  r.get(
    "/upgrade/releases",
    asyncHandler(async (_req, res) => {
      const r2 = await fetchGithubReleases();
      if (!r2.ok) {
        res.status(r2.status).json({ error: r2.error });
        return;
      }
      res.json(r2.releases);
    })
  );

  r.get(
    "/upgrade/current",
    asyncHandler(async (_req, res) => {
      const v = currentVersion();
      const uptimeSec = Math.round(process.uptime());
      const dbBytes = dbSize(sqlitePath);
      const overlayDir = process.env.COMBAT_SCHEMA_OVERLAY_DIR || join(process.cwd(), "data", "schemas-overlay");
      let userFieldCount = 0;
      try {
        if (existsSync(overlayDir)) {
          for (const f of readdirSync(overlayDir).filter((x) => x.endsWith(".json"))) {
            try {
              const j = JSON.parse(readFileSync(join(overlayDir, f), "utf8"));
              if (Array.isArray(j?.fields)) userFieldCount += j.fields.length;
            } catch {}
          }
        }
      } catch {}
      res.json({
        version: v.version,
        commit: v.commit,
        readableVersion: v.readableVersion,
        uptimeSec,
        dbBytes,
        userFieldCount,
      });
    })
  );

  r.post(
    "/upgrade/upload",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file?.buffer) {
        res.status(400).json({ error: "file 必填(multipart 字段名 file)" });
        return;
      }
      const original = req.file.originalname || "upgrade.tar.gz";
      if (!/\.(tar\.gz|tgz)$/i.test(original)) {
        res.status(400).json({ error: "升级包必须是 .tar.gz 或 .tgz" });
        return;
      }
      const stagingId = randomUUID();
      const dst = join(stagingDir(), `${stagingId}.tar.gz`);
      writeFileSync(dst, req.file.buffer);
      log.info("upgrade.upload", { stagingId, size: req.file.size, name: original });
      res.json({ stagingId, size: req.file.size, name: original });
    })
  );

  r.post(
    "/upgrade/upload-from-url",
    asyncHandler(async (req, res) => {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== "string") {
        res.status(400).json({ error: "url 必填" });
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: "url 必须以 http:// 或 https:// 开头" });
        return;
      }
      const name = url.split("/").pop() || "upgrade.tar.gz";
      if (!/\.(tar\.gz|tgz)$/i.test(name)) {
        res.status(400).json({ error: "url 路径需以 .tar.gz / .tgz 结尾" });
        return;
      }
      let resp: Awaited<ReturnType<typeof fetch>>;
      try {
        const headers: Record<string, string> = { "User-Agent": "combat-upgrade" };
        if (process.env.GITHUB_TOKEN && /github/i.test(url)) {
          headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
        }
        resp = await fetch(url, { method: "GET", headers });
      } catch (e) {
        res.status(502).json({ error: `下载失败: ${(e as Error).message}` });
        return;
      }
      if (!resp.ok) {
        res.status(502).json({ error: `下载失败: HTTP ${resp.status}` });
        return;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > 100 * 1024 * 1024) {
        res.status(413).json({ error: "升级包不能超过 100MB" });
        return;
      }
      const stagingId = randomUUID();
      const dst = join(stagingDir(), `${stagingId}.tar.gz`);
      writeFileSync(dst, buf);
      log.info("upgrade.upload_from_url", { stagingId, size: buf.length, url });
      res.json({ stagingId, size: buf.length, name });
    })
  );

  r.post(
    "/upgrade/analyze",
    asyncHandler(async (req, res) => {
      const { stagingId } = req.body as { stagingId?: string };
      if (!stagingId) {
        res.status(400).json({ error: "stagingId 必填" });
        return;
      }
      const pkg = join(stagingDir(), `${stagingId}.tar.gz`);
      if (!existsSync(pkg)) {
        res.status(404).json({ error: "staging 包不存在,请重新上传" });
        return;
      }
      const report = await analyzePackage(stagingId, pkg);
      log.info("upgrade.analyze", {
        stagingId,
        targetVersion: report.targetVersion,
        conflicts: report.schemaReport.conflicts.length,
        breaking: report.breaking.length,
      });
      res.json(report);
    })
  );

  r.post(
    "/upgrade/apply",
    asyncHandler(async (req, res) => {
      const { stagingId, confirm } = req.body as { stagingId?: string; confirm?: boolean };
      if (!stagingId || !confirm) {
        res.status(400).json({ error: "需要 stagingId 且 confirm=true" });
        return;
      }
      const pkg = join(stagingDir(), `${stagingId}.tar.gz`);
      if (!existsSync(pkg)) {
        res.status(404).json({ error: "staging 包不存在" });
        return;
      }
      // 不允许并发升级:state 已存在且未结束
      const prev = readStateSafe();
      if (prev && !["done", "failed", "rolled-back"].includes(prev.phase)) {
        res.status(409).json({ error: `已有升级任务进行中: ${prev.jobId} (${prev.phase})` });
        return;
      }

      const jobId = randomUUID();
      const fromVersion = currentVersion().readableVersion;
      const initState: UpgradeState = {
        jobId,
        stagingId,
        phase: "queued",
        percent: 0,
        log: [`[${new Date().toISOString()}] queued upgrade jobId=${jobId} stagingId=${stagingId}`],
        startedAt: new Date().toISOString(),
        fromVersion,
      };
      writeFileSync(stateFile(), JSON.stringify(initState, null, 2));

      const workerScript = join(process.cwd(), "..", "..", "scripts", "upgrade", "worker.mjs");
      if (!existsSync(workerScript)) {
        res.status(500).json({ error: `worker 脚本不存在: ${workerScript}` });
        return;
      }

      const logPath = join(logsDir(), `${jobId}.log`);
      // 写空文件占位,前端 GET /log/:jobId 能立刻 tail
      writeFileSync(logPath, `[${new Date().toISOString()}] worker spawn pending\n`);

      // detach 出来,父进程死掉也不影响 worker(自我升级核心机制)
      const args = [
        workerScript,
        "--staging-id",
        stagingId,
        "--job-id",
        jobId,
        "--data-dir",
        dataDir(),
        "--log-file",
        logPath,
        "--sqlite",
        sqlitePath || "",
      ];
      if (process.env.COMBAT_UPGRADE_MOCK_SYSTEMD === "1") args.push("--mock-systemd");

      const proc = spawn(process.execPath, args, {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      proc.unref();

      log.info("upgrade.apply.spawn", { jobId, stagingId, pid: proc.pid });
      res.json({ jobId, pid: proc.pid });
    })
  );

  r.get(
    "/upgrade/status",
    asyncHandler(async (_req, res) => {
      const s = readStateSafe();
      if (!s) {
        res.json({ phase: "idle", percent: 0, log: [] });
        return;
      }
      res.json(s);
    })
  );

  r.post(
    "/upgrade/rollback",
    asyncHandler(async (_req, res) => {
      const state = readStateSafe();
      if (!state) {
        res.status(404).json({ error: "无升级任务可回滚" });
        return;
      }
      if (!state.backupId) {
        res.status(409).json({ error: "当前升级未生成 backup,无法回滚" });
        return;
      }
      const workerScript = join(process.cwd(), "..", "..", "scripts", "upgrade", "worker.mjs");
      const jobId = randomUUID();
      const logPath = join(logsDir(), `${jobId}.log`);
      writeFileSync(logPath, `[${new Date().toISOString()}] rollback spawn pending\n`);
      const args = [
        workerScript,
        "--rollback",
        "--backup-id",
        state.backupId,
        "--job-id",
        jobId,
        "--data-dir",
        dataDir(),
        "--log-file",
        logPath,
        "--sqlite",
        sqlitePath || "",
      ];
      if (process.env.COMBAT_UPGRADE_MOCK_SYSTEMD === "1") args.push("--mock-systemd");
      const proc = spawn(process.execPath, args, {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
      });
      proc.unref();
      log.info("upgrade.rollback.spawn", { jobId, backupId: state.backupId });
      res.json({ jobId, backupId: state.backupId });
    })
  );

  r.get(
    "/upgrade/history",
    asyncHandler(async (_req, res) => {
      const h = readHistorySafe();
      res.json(h);
    })
  );

  r.get(
    "/upgrade/log/:jobId",
    asyncHandler(async (req, res) => {
      const jobId = req.params.jobId;
      if (!/^[a-zA-Z0-9-]+$/.test(jobId)) {
        res.status(400).json({ error: "jobId 非法" });
        return;
      }
      const p = join(logsDir(), `${jobId}.log`);
      if (!existsSync(p)) {
        res.status(404).json({ error: "log 不存在" });
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      createReadStream(p).pipe(res);
    })
  );

  return r;
}

/**
 * 解包 staging tar.gz 到临时目录,跑 schema-merger,组装 diff 报告。
 * 仅本地分析,不写 /opt。
 */
async function analyzePackage(stagingId: string, tarPath: string): Promise<AnalyzeReport> {
  const tmpRoot = join(stagingDir(), `${stagingId}-extract`);
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });

  // 用 node-tar 解包(跨平台,避免 Windows 系统 tar 的 C:\ 路径问题)
  try {
    await tar.extract({ file: tarPath, cwd: tmpRoot });
  } catch (e) {
    throw new Error(`解包失败: ${(e as Error).message}`);
  }

  // 探测包结构:可能根目录就是 repo,也可能套了一层 combat-v2/
  const targetRoot = locatePackageRoot(tmpRoot);
  const targetBaselineDir = join(targetRoot, "config", "schemas");
  if (!existsSync(targetBaselineDir)) {
    throw new Error(`升级包缺少 config/schemas 目录(查找:${targetBaselineDir})`);
  }

  // 读包版本
  let targetVersion = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(targetRoot, "package.json"), "utf8"));
    targetVersion = pkg.version || "unknown";
  } catch {}

  // 当前 baseline / overlay
  const currentBaseline = resolve(process.cwd(), "..", "..", "config", "schemas");
  const currentOverlay = process.env.COMBAT_SCHEMA_OVERLAY_DIR || join(process.cwd(), "data", "schemas-overlay");

  // 跑 schema-merger (作为子进程,纯函数也可,但子进程模拟生产路径)
  const mergerScript = join(process.cwd(), "..", "..", "scripts", "upgrade", "schema-merger.mjs");
  let schemaReport: AnalyzeReport["schemaReport"];
  try {
    const out = execSync(
      `node "${mergerScript}" --current-baseline "${currentBaseline}" --current-overlay "${currentOverlay}" --target-baseline "${targetBaselineDir}"`,
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 }
    ).toString();
    schemaReport = JSON.parse(out);
  } catch (e) {
    throw new Error(`schema-merger 失败: ${(e as Error).message}`);
  }

  // 检测新增的 baseline schema 文件(当前没有但目标有)
  const currentBaselineSet = new Set(
    existsSync(currentBaseline)
      ? readdirSync(currentBaseline)
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.replace(/\.json$/, ""))
      : []
  );
  const newSchemas: string[] = [];
  for (const f of readdirSync(targetBaselineDir).filter((x) => x.endsWith(".json"))) {
    const nt = f.replace(/\.json$/, "");
    if (!currentBaselineSet.has(nt)) newSchemas.push(nt);
  }

  // breaking / required env / warnings:目前用简单的 heuristics + 包内 UPGRADE-MANIFEST.json(可选)
  const breaking: string[] = [];
  const requiredEnv: string[] = ["JWT_SECRET", "COMBAT_ENCRYPT_KEY"];
  const warnings: string[] = [];

  if (schemaReport.conflicts.length > 0) {
    warnings.push(`检测到 ${schemaReport.conflicts.length} 个 user 字段与新基线同名,需逐项确认`);
  }
  // 若包根有 UPGRADE-MANIFEST.json,读其中的 breaking/requiredEnv 注入
  const manifestPath = join(targetRoot, "UPGRADE-MANIFEST.json");
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (Array.isArray(m.breaking)) breaking.push(...m.breaking);
      if (Array.isArray(m.requiredEnv))
        for (const e of m.requiredEnv) if (!requiredEnv.includes(e)) requiredEnv.push(e);
      if (Array.isArray(m.warnings)) warnings.push(...m.warnings);
    } catch {}
  }

  return {
    stagingId,
    targetVersion,
    schemaReport,
    breaking,
    newSchemas,
    requiredEnv,
    warnings,
  };
}

function locatePackageRoot(extractDir: string): string {
  // 若 extractDir 直接含 package.json + config/,就是 root
  if (existsSync(join(extractDir, "package.json")) && existsSync(join(extractDir, "config"))) {
    return extractDir;
  }
  // 否则取第一个子目录(典型 tar 套层结构)
  const entries = readdirSync(extractDir);
  for (const e of entries) {
    const sub = join(extractDir, e);
    try {
      if (statSync(sub).isDirectory() && existsSync(join(sub, "package.json"))) return sub;
    } catch {}
  }
  return extractDir;
}

// 暴露给测试和 worker:写 state 文件(原子写入语义靠 fs sync;失败抛错)
export function writeUpgradeState(state: UpgradeState, dir?: string): void {
  const target = dir ? join(dir, "upgrade-state.json") : stateFile();
  writeFileSync(target, JSON.stringify(state, null, 2));
}
