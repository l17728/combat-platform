#!/usr/bin/env node
/**
 * 现网升级演练脚本 (v2.4 / Stage E)
 *
 * 用途:Stage E 集成阶段做一次真实演练,验证 detached worker 在生产环境真跑成功。
 *
 * 默认 --dry-run:只做"无破坏"的可达性 + 版本快照 + 打包验证。
 * 加 --apply  才真的执行 upload → analyze → apply → poll → 健康检查。
 *
 * 凭据从 repo 根目录 .env.deploy 读取:
 *   PROD_HOST=124.156.193.122
 *   PROD_USER=root
 *   PROD_PASS=...
 *
 * 用法:
 *   node scripts/upgrade/prod-rehearsal.mjs --dry-run            # 默认安全模式
 *   node scripts/upgrade/prod-rehearsal.mjs --apply               # 真跑(危险)
 *   node scripts/upgrade/prod-rehearsal.mjs --apply --rollback   # 真跑 + 演练完后回滚
 *
 * 关键设计:
 *   1. 任何时候用 --apply 前都会再打印一段二次确认提示,要求 5s 内 Ctrl+C 才能中断
 *   2. 失败自动尝试 rollback;rollback 也失败 → 退出码 3 + 提示 SSH 手动恢复步骤
 *   3. 演练日志全部 append 到 data/prod-rehearsal-<ts>.log,并在 stdout 同步
 *
 * 退出码:
 *   0  成功(dry-run 通过 / apply 升级到达 done)
 *   1  apply 失败但 rollback 成功
 *   2  参数/IO/凭据错误
 *   3  apply 失败且 rollback 失败 → 必须人工介入
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function parseArgs(argv) {
  const out = { positional: [], opts: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        out.opts[k] = v;
        i++;
      } else out.opts[k] = true;
    } else out.positional.push(a);
  }
  return out;
}

const { opts } = parseArgs(process.argv);
const APPLY = !!opts.apply;
const DRY_RUN = !APPLY; // 默认 dry-run
const POST_ROLLBACK = !!opts.rollback;
const PORT = Number(opts.port || 3001);

const logDir = join(repoRoot, "data");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = join(logDir, `prod-rehearsal-${ts}.log`);

function log(label, msg) {
  const line = `[${new Date().toISOString()}] [${label}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(logFile, line + "\n");
  } catch {}
}

function loadEnv() {
  const envPath = join(repoRoot, ".env.deploy");
  if (!existsSync(envPath)) {
    log("env", `未找到 ${envPath};请创建 .env.deploy 并填入 PROD_HOST/PROD_USER/PROD_PASS`);
    process.exit(2);
  }
  const env = {};
  for (const ln of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function makeSshClient(env) {
  // 延迟引入 ssh2,避免 dry-run 不需要时强制依赖
  let Client;
  try {
    ({ Client } = await import("ssh2"));
  } catch (e) {
    log("ssh", `ssh2 未安装: ${e.message};请运行 npm install 后重试`);
    process.exit(2);
  }
  return new Promise((res, rej) => {
    const c = new Client();
    c.on("ready", () => res(c))
      .on("error", rej)
      .connect({
        host: env.PROD_HOST,
        port: 22,
        username: env.PROD_USER,
        password: env.PROD_PASS,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 6,
      });
  });
}

function sshRun(c, cmd, label = "ssh") {
  return new Promise((res, rej) => {
    const short = cmd.length > 200 ? cmd.slice(0, 200) + "..." : cmd;
    log(label, short);
    c.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let out = "",
        err = "";
      s.on("data", (d) => (out += d)).stderr.on("data", (d) => (err += d));
      s.on("close", (code) => {
        if (out.trim())
          out
            .trim()
            .split("\n")
            .slice(0, 8)
            .forEach((ln) => log(label, `  ${ln}`));
        if (err.trim())
          err
            .trim()
            .split("\n")
            .slice(0, 5)
            .forEach((ln) => log(label, `  stderr: ${ln}`));
        res({ code, out, err });
      });
    });
  });
}

function sshUpload(c, localPath, remotePath) {
  return new Promise((res, rej) => {
    c.sftp((err, sftp) => {
      if (err) return rej(err);
      const data = readFileSync(localPath);
      const sizeKB = (data.length / 1024).toFixed(1);
      log("upload", `${localPath} → ${remotePath} (${sizeKB}KB)`);
      const stream = sftp.createWriteStream(remotePath);
      stream.on("close", () => {
        sftp.end();
        res();
      });
      stream.on("error", rej);
      stream.end(data);
    });
  });
}

async function curlVersion(c) {
  const r = await sshRun(c, `curl -s http://127.0.0.1:${PORT}/api/upgrade/current`, "curl-ver");
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

async function curlHealth(c) {
  const r = await sshRun(c, `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/api/health`, "curl-h");
  return r.out.trim() === "200";
}

async function pollStatus(c, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    const r = await sshRun(c, `curl -s http://127.0.0.1:${PORT}/api/upgrade/status`, "poll");
    let s = null;
    try {
      s = JSON.parse(r.out);
    } catch {}
    if (s) {
      log("poll", `phase=${s.phase} percent=${s.percent}`);
      if (["done", "failed", "rolled-back"].includes(s.phase)) return s;
    }
    await sleep(2000);
  }
  log("poll", `超时(${deadlineMs}ms)`);
  return null;
}

async function main() {
  log("start", `mode=${DRY_RUN ? "DRY-RUN" : "APPLY"} postRollback=${POST_ROLLBACK} log=${logFile}`);
  const env = loadEnv();
  if (!env.PROD_HOST || !env.PROD_USER || !env.PROD_PASS) {
    log("env", "PROD_HOST/PROD_USER/PROD_PASS 必填");
    process.exit(2);
  }

  // 二次确认(只在 --apply 时)
  if (APPLY) {
    log("warn", "!! 你正在执行真实的现网升级演练 — 5 秒后开始,Ctrl+C 中止 !!");
    await sleep(5000);
  }

  log("step", "1/10 SSH 连接");
  const c = await makeSshClient(env);

  log("step", "2/10 检查当前生产版本");
  const before = await curlVersion(c);
  if (!before) {
    log("step", "无法访问 /api/upgrade/current — 检查后端是否在线");
    c.end();
    process.exit(2);
  }
  log("step", `生产版本 = ${before.readableVersion}`);

  log("step", "3/10 健康检查");
  const healthy = await curlHealth(c);
  log("step", `health=${healthy ? "OK" : "FAIL"}`);
  if (!healthy) {
    log("step", "生产健康检查失败,演练中止");
    c.end();
    process.exit(2);
  }

  log("step", "4/10 本地打包 git HEAD 为 tar.gz");
  const localPkg = join(repoRoot, "data", `upgrade-rehearsal-${ts}.tar.gz`);
  try {
    execSync(`git archive --format=tar.gz -o "${localPkg}" HEAD`, { cwd: repoRoot, stdio: "pipe" });
  } catch (e) {
    log("step", `git archive 失败: ${e.message}`);
    c.end();
    process.exit(2);
  }
  const sz = statSync(localPkg).size;
  log("step", `升级包大小: ${(sz / 1024).toFixed(1)}KB`);

  if (DRY_RUN) {
    log("dry-run", "5-10/10 (跳过) — 不执行 upload/analyze/apply");
    log("dry-run", "演练 dry-run 完成 ✓");
    log("dry-run", `演练日志: ${logFile}`);
    log("dry-run", `本地升级包(可手动 scp): ${localPkg}`);
    c.end();
    process.exit(0);
  }

  log("step", "5/10 上传升级包到生产 /tmp/combat-upgrade.tar.gz");
  await sshUpload(c, localPkg, "/tmp/combat-upgrade.tar.gz");

  log("step", "6/10 调用 upload API → stagingId");
  const upRes = await sshRun(
    c,
    `curl -s -F "file=@/tmp/combat-upgrade.tar.gz;filename=upgrade.tar.gz" http://127.0.0.1:${PORT}/api/upgrade/upload`
  );
  let stagingId;
  try {
    stagingId = JSON.parse(upRes.out).stagingId;
  } catch (e) {
    log("step", `upload 响应解析失败: ${upRes.out}`);
    c.end();
    process.exit(2);
  }
  log("step", `stagingId=${stagingId}`);

  log("step", "7/10 调用 analyze");
  const aRes = await sshRun(
    c,
    `curl -s -X POST -H "content-type: application/json" -d '{"stagingId":"${stagingId}"}' http://127.0.0.1:${PORT}/api/upgrade/analyze`
  );
  let report;
  try {
    report = JSON.parse(aRes.out);
  } catch {
    log("step", `analyze 响应非 JSON: ${aRes.out.slice(0, 200)}`);
    c.end();
    process.exit(2);
  }
  log(
    "step",
    `targetVersion=${report.targetVersion} conflicts=${report.schemaReport?.conflicts?.length ?? 0} breaking=${report.breaking?.length ?? 0}`
  );

  log("step", `8/10 调用 apply (危险!)`);
  const applyRes = await sshRun(
    c,
    `curl -s -X POST -H "content-type: application/json" -d '{"stagingId":"${stagingId}","confirm":true}' http://127.0.0.1:${PORT}/api/upgrade/apply`
  );
  let job;
  try {
    job = JSON.parse(applyRes.out);
  } catch {
    log("step", `apply 响应非 JSON: ${applyRes.out}`);
    c.end();
    process.exit(2);
  }
  log("step", `jobId=${job.jobId} pid=${job.pid}`);

  log("step", "9/10 轮询升级状态 (最多 5 分钟)");
  const finalState = await pollStatus(c, 5 * 60 * 1000);
  if (!finalState) {
    log("fail", "状态轮询超时 — 升级 worker 可能卡住或被杀,人工 SSH 介入");
    c.end();
    process.exit(3);
  }
  log("step", `final phase=${finalState.phase}`);

  log("step", "10/10 验证版本切换");
  await sleep(3000);
  const after = await curlVersion(c);
  if (after) log("step", `新版本 = ${after.readableVersion}`);

  if (finalState.phase === "done") {
    log("success", `演练成功 ✓ ${before.readableVersion} → ${after?.readableVersion ?? "?"}`);
    if (POST_ROLLBACK) {
      log("step", "演练完成后触发 rollback...");
      const rb = await sshRun(c, `curl -s -X POST http://127.0.0.1:${PORT}/api/upgrade/rollback`);
      log("rollback", rb.out);
      await pollStatus(c, 3 * 60 * 1000);
    }
    c.end();
    process.exit(0);
  }

  // failed / rolled-back
  if (finalState.phase === "rolled-back") {
    log("fail", `升级失败,自动回滚成功;error=${finalState.error}`);
    c.end();
    process.exit(1);
  }

  log("fail", `升级失败 phase=${finalState.phase} error=${finalState.error}`);
  log("fail", "尝试手动触发 rollback...");
  const rb = await sshRun(c, `curl -s -X POST http://127.0.0.1:${PORT}/api/upgrade/rollback`);
  log("rollback", rb.out);
  const rbState = await pollStatus(c, 3 * 60 * 1000);
  if (rbState?.phase === "rolled-back") {
    log("fail", "回滚成功;请人工排查 worker 日志");
    c.end();
    process.exit(1);
  }
  log("emergency", "回滚也失败 — 手动恢复:");
  log("emergency", "  ssh root@<host>");
  log("emergency", "  cd /opt/combat-v2/apps/backend/data/backups");
  log("emergency", "  tar -xzf pre-*.tar.gz -C /opt/combat-v2");
  log("emergency", "  systemctl restart combat-v2");
  c.end();
  process.exit(3);
}

main().catch((e) => {
  log("fatal", e.stack || e.message);
  process.exit(3);
});
