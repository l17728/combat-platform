#!/usr/bin/env node
/**
 * v2.3 一键升级 worker — detached 进程
 *
 * 调用方:apps/backend/src/upgrade.ts → spawn(node worker.mjs, args, { detached: true, stdio: 'ignore' }).unref()
 *
 * 必传参数(全部通过命令行):
 *   --staging-id <id>       staging tar.gz 标识(<dataDir>/upgrade-staging/<id>.tar.gz)
 *   --job-id <id>           本次 job 标识
 *   --data-dir <dir>        data 目录(写 upgrade-state.json / upgrade-history.json / backups/)
 *   --log-file <path>       worker stdout/stderr 都 append 到这里
 *   --sqlite <path>         当前 SQLite 文件(用于 backup tar)
 *   [--mock-systemd]        跳过实际 systemctl 重启,用于本机/e2e
 *   [--rollback --backup-id <id>]  回滚模式
 *
 * 阶段(success path):
 *   queued → backup → extract → schema-merge → secrets → code-swap → restart → health → done
 *
 * 每阶段 writeState() 更新 upgrade-state.json,失败 → state.phase='failed' + 触发回滚。
 * 回滚成功 → state.phase='rolled-back';回滚失败 → state.phase='failed' + state.error。
 *
 * 关键:worker 不依赖 backend 进程;backend 重启不影响 worker。
 */
import { spawn, execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  rmSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { runMerger } from "./schema-merger.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        out[k] = v;
        i++;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const dataDir = args["data-dir"];
const jobId = args["job-id"];
const logFile = args["log-file"];
const sqlitePath = args["sqlite"] || "";
const mockSystemd = !!args["mock-systemd"];

if (!dataDir || !jobId || !logFile) {
  console.error("缺少必传参数 --data-dir/--job-id/--log-file");
  process.exit(2);
}

function tee(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    appendFileSync(logFile, line + "\n");
  } catch {}
  console.log(line);
}

function readState() {
  const p = join(dataDir, "upgrade-state.json");
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch {}
  return null;
}

function writeState(patch) {
  const p = join(dataDir, "upgrade-state.json");
  const cur = readState() || { jobId, log: [], startedAt: new Date().toISOString(), percent: 0 };
  const next = { ...cur, ...patch };
  if (patch.log && Array.isArray(patch.log)) {
    next.log = [...(cur.log || []), ...patch.log];
  }
  writeFileSync(p, JSON.stringify(next, null, 2));
}

function appendHistory(entry) {
  const p = join(dataDir, "upgrade-history.json");
  let arr = [];
  try {
    if (existsSync(p)) arr = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  arr.push(entry);
  writeFileSync(p, JSON.stringify(arr.slice(-50), null, 2));
}

function setPhase(phase, percent, extra = {}) {
  const log = [`[${new Date().toISOString()}] ${phase} (${percent}%)`];
  writeState({ phase, percent, log, ...extra });
  tee(`phase=${phase} percent=${percent}`);
}

function fail(error) {
  tee(`FAIL: ${error}`);
  writeState({ phase: "failed", error, endedAt: new Date().toISOString(), log: [`FAIL ${error}`] });
}

async function rollbackMode() {
  const backupId = args["backup-id"];
  setPhase("queued", 0);
  if (!backupId) {
    fail("rollback 缺少 --backup-id");
    return;
  }
  setPhase("backup", 20);
  const backupPath = join(dataDir, "backups", `${backupId}.tar.gz`);
  if (!existsSync(backupPath)) {
    fail(`backup 不存在: ${backupPath}`);
    return;
  }
  setPhase("code-swap", 40);
  // 解 backup 到 /opt/combat-v2 (生产)或 dev 的 ../..(本机)
  const targetRoot = process.env.COMBAT_INSTALL_ROOT || resolve(process.cwd(), "..", "..");
  try {
    execSync(`tar -xzf "${backupPath}" -C "${targetRoot}"`, { stdio: "pipe" });
  } catch (e) {
    fail(`回滚解包失败: ${e.message}`);
    return;
  }
  setPhase("restart", 70);
  if (!mockSystemd) {
    try {
      execSync("sudo systemctl restart combat-v2", { stdio: "pipe" });
    } catch (e) {
      tee(`systemctl restart 失败,可手动 sudo systemctl restart combat-v2: ${e.message}`);
    }
  } else {
    tee("mock-systemd: 跳过 systemctl restart");
  }
  setPhase("rolled-back", 100, { endedAt: new Date().toISOString() });
  tee("回滚完成");
}

async function upgradeMode() {
  const stagingId = args["staging-id"];
  if (!stagingId) {
    fail("缺少 --staging-id");
    return;
  }
  const stagingTar = join(dataDir, "upgrade-staging", `${stagingId}.tar.gz`);
  if (!existsSync(stagingTar)) {
    fail(`staging 包不存在: ${stagingTar}`);
    return;
  }
  const initial = readState() || {};

  // ---- 1) backup ----
  setPhase("backup", 5);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `pre-${ts}-${jobId.slice(0, 8)}`;
  const backupsDir = join(dataDir, "backups");
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });
  const backupPath = join(backupsDir, `${backupId}.tar.gz`);
  try {
    const targetRoot = process.env.COMBAT_INSTALL_ROOT || resolve(process.cwd(), "..", "..");
    // 只备份 config/ + sqlite 文件,不动 apps/(代码不属于"用户态")
    const includes = ["config"];
    if (sqlitePath && existsSync(sqlitePath)) {
      // 相对路径放进 tar
      const rel = sqlitePath.startsWith(targetRoot) ? sqlitePath.slice(targetRoot.length + 1) : sqlitePath;
      includes.push(rel);
    }
    // 把 schemas-overlay 也备份
    const overlayRel = "apps/backend/data/schemas-overlay";
    if (existsSync(join(targetRoot, overlayRel))) includes.push(overlayRel);
    execSync(`tar -czf "${backupPath}" -C "${targetRoot}" ${includes.map((x) => `"${x}"`).join(" ")}`, {
      stdio: "pipe",
    });
    writeState({ backupId });
    tee(`backup ok: ${backupPath}`);
  } catch (e) {
    fail(`backup 失败: ${e.message}`);
    return;
  }

  // ---- 2) extract ----
  setPhase("extract", 15);
  const extractDir = join(dataDir, "upgrade-staging", `${stagingId}-extract`);
  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  try {
    execSync(`tar -xzf "${stagingTar}" -C "${extractDir}"`, { stdio: "pipe" });
    tee(`extract ok → ${extractDir}`);
  } catch (e) {
    fail(`extract 失败: ${e.message}`);
    return;
  }

  // 探测包根
  const pkgRoot = locatePackageRoot(extractDir);
  if (!pkgRoot) {
    fail("升级包结构无效(缺 package.json + config/)");
    return;
  }

  // ---- 3) schema-merge ----
  setPhase("schema-merge", 30);
  try {
    const overlayDir =
      process.env.COMBAT_SCHEMA_OVERLAY_DIR ||
      join(process.env.COMBAT_INSTALL_ROOT || resolve(process.cwd(), "..", ".."), "apps/backend/data/schemas-overlay");
    const currentBaseline = join(
      process.env.COMBAT_INSTALL_ROOT || resolve(process.cwd(), "..", ".."),
      "config",
      "schemas"
    );
    const targetBaseline = join(pkgRoot, "config", "schemas");
    const newOverlay = join(extractDir, "new-overlay");
    if (!existsSync(newOverlay)) mkdirSync(newOverlay, { recursive: true });
    const report = runMerger({
      currentBaseline,
      currentOverlay: overlayDir,
      targetBaseline,
      outOverlay: newOverlay,
    });
    tee(`schema-merge ok: conflicts=${report.conflicts.length} kept=${report.kept.length}`);
  } catch (e) {
    fail(`schema-merge 失败: ${e.message}`);
    await tryRollback(backupId);
    return;
  }

  // ---- 4) secrets ----
  setPhase("secrets", 45);
  try {
    const envFile = process.env.COMBAT_ENV_FILE || "/etc/combat-v2.env";
    if (mockSystemd) {
      tee(`mock-systemd: 跳过写 ${envFile}`);
    } else {
      // 仅当不存在时生成(已有就不动)
      if (!existsSync(envFile)) {
        const jwt = randomBytes(48).toString("hex");
        const enc = randomBytes(32).toString("hex");
        writeFileSync(envFile, `JWT_SECRET=${jwt}\nCOMBAT_ENCRYPT_KEY=${enc}\n`, { mode: 0o600 });
        tee(`生成 ${envFile}`);
      } else {
        tee(`${envFile} 已存在,跳过生成`);
      }
    }
  } catch (e) {
    tee(`secrets 警告(继续): ${e.message}`);
  }

  // ---- 5) code-swap ----
  setPhase("code-swap", 60);
  try {
    const targetRoot = process.env.COMBAT_INSTALL_ROOT || resolve(process.cwd(), "..", "..");
    // 复制 pkgRoot/apps + pkgRoot/packages + pkgRoot/config + pkgRoot/scripts → targetRoot
    // 排除 data/ uploads/ node_modules/(用户态/构建产物)
    const include = ["apps", "packages", "config", "scripts", "package.json"];
    for (const item of include) {
      const src = join(pkgRoot, item);
      if (!existsSync(src)) continue;
      const dst = join(targetRoot, item);
      // 简单 rsync 模拟:rm + cp -r
      if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
      tee(`copied ${item}`);
    }
    // 写新 overlay
    const overlayDir = process.env.COMBAT_SCHEMA_OVERLAY_DIR || join(targetRoot, "apps/backend/data/schemas-overlay");
    if (existsSync(overlayDir)) rmSync(overlayDir, { recursive: true, force: true });
    const newOverlay = join(extractDir, "new-overlay");
    if (existsSync(newOverlay)) {
      mkdirSync(dirname(overlayDir), { recursive: true });
      cpSync(newOverlay, overlayDir, { recursive: true });
      tee(`new overlay → ${overlayDir}`);
    }
  } catch (e) {
    fail(`code-swap 失败: ${e.message}`);
    await tryRollback(backupId);
    return;
  }

  // ---- 6) restart ----
  setPhase("restart", 80);
  if (!mockSystemd) {
    try {
      execSync("sudo systemctl restart combat-v2", { stdio: "pipe", timeout: 30000 });
      tee("systemctl restart ok");
    } catch (e) {
      fail(`systemctl restart 失败: ${e.message}`);
      await tryRollback(backupId);
      return;
    }
  } else {
    tee("mock-systemd: 跳过 systemctl restart");
  }

  // ---- 7) health ----
  setPhase("health", 90);
  const healthUrl = process.env.COMBAT_HEALTH_URL || "http://127.0.0.1:3001/api/health";
  let healthy = false;
  if (mockSystemd) {
    tee("mock-systemd: 跳过 health 探活");
    healthy = true;
  } else {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(healthUrl);
        if (r.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await sleep(1000);
    }
  }
  if (!healthy) {
    fail("health 探活 30s 未通过");
    await tryRollback(backupId);
    return;
  }
  tee("health ok");

  // ---- done ----
  setPhase("done", 100, { endedAt: new Date().toISOString() });
  const cur = readState();
  appendHistory({
    jobId,
    stagingId,
    fromVersion: cur?.fromVersion || "unknown",
    toVersion: readTargetVersion(pkgRoot),
    startedAt: cur?.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    phase: "done",
    backupId,
  });
  tee("升级完成");
}

async function tryRollback(backupId) {
  tee(`尝试自动回滚 backup=${backupId}`);
  try {
    const backupPath = join(dataDir, "backups", `${backupId}.tar.gz`);
    if (!existsSync(backupPath)) {
      tee(`backup 文件丢失: ${backupPath}`);
      return;
    }
    const targetRoot = process.env.COMBAT_INSTALL_ROOT || resolve(process.cwd(), "..", "..");
    execSync(`tar -xzf "${backupPath}" -C "${targetRoot}"`, { stdio: "pipe" });
    if (!mockSystemd) {
      try {
        execSync("sudo systemctl restart combat-v2", { stdio: "pipe" });
      } catch {}
    }
    writeState({ phase: "rolled-back", endedAt: new Date().toISOString() });
    appendHistory({
      jobId,
      stagingId: args["staging-id"] || "",
      fromVersion: "rolled-back",
      toVersion: "rolled-back",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      phase: "rolled-back",
      backupId,
    });
    tee("自动回滚完成");
  } catch (e) {
    tee(`自动回滚失败,需人工介入: ${e.message}`);
  }
}

function locatePackageRoot(extractDir) {
  if (existsSync(join(extractDir, "package.json")) && existsSync(join(extractDir, "config"))) return extractDir;
  for (const e of readdirSync(extractDir)) {
    const sub = join(extractDir, e);
    try {
      if (statSync(sub).isDirectory() && existsSync(join(sub, "package.json")) && existsSync(join(sub, "config")))
        return sub;
    } catch {}
  }
  return null;
}

function readTargetVersion(pkgRoot) {
  try {
    const p = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
    return p.version || "unknown";
  } catch {
    return "unknown";
  }
}

// 入口
(async () => {
  if (args["rollback"]) {
    await rollbackMode();
  } else {
    await upgradeMode();
  }
})().catch((e) => {
  fail(e.message || String(e));
});
