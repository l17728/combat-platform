import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { Client } from "ssh2";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.deploy"), "utf8")
    .split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const HOST = env.DEPLOY_HOST, USER = env.DEPLOY_USER, PASS = env.DEPLOY_PASS;
const TARGET = "60.204.199.234";
const DEPLOY_PATH = "/opt/combat-v2";

function log(step, msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] [${step}] ${msg}`); }
function logErr(step, msg) { console.error(`[${new Date().toISOString().slice(11, 19)}] [${step}] ❌ ${msg}`); }

function conn(label = "relay") {
  return new Promise((res, rej) => {
    log("conn", `connecting to ${label} (${HOST})...`);
    const c = new Client();
    c.on("ready", () => { log("conn", `connected to ${label}`); res(c); }).on("error", e => { logErr("conn", `${label}: ${e.message}`); rej(e); })
      .connect({ host: HOST, port: 22, username: USER, password: PASS,
        readyTimeout: 30000, keepaliveInterval: 10000, keepaliveCountMax: 6 });
  });
}
function run(c, cmd, label = "exec") {
  return new Promise((res, rej) => {
    const short = cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd;
    log(label, short);
    const start = Date.now();
    c.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let out = "", err = "";
      s.on("data", d => (out += d)).stderr.on("data", d => (err += d));
      s.on("close", code => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(label, `done in ${elapsed}s, rc=${code}`);
        if (out.trim()) {
          const lines = out.trim().split("\n");
          if (lines.length <= 5) lines.forEach(l => log(label, `  stdout: ${l}`));
          else { lines.slice(0, 3).forEach(l => log(label, `  stdout: ${l}`)); log(label, `  ... (${lines.length - 3} more lines)`); }
        }
        if (err.trim()) err.trim().split("\n").forEach(l => log(label, `  stderr: ${l}`));
        res({ code, out, err });
      });
    });
  });
}
function uploadFile(c, localPath, remotePath) {
  const data = readFileSync(localPath);
  const sizeKB = (data.length / 1024).toFixed(1);
  log("upload", `SFTP ${localPath} → ${remotePath} (${sizeKB}KB)`);
  return new Promise((res, rej) => {
    c.sftp((err, sftp) => {
      if (err) return rej(err);
      const stream = sftp.createWriteStream(remotePath);
      stream.on("close", () => { log("upload", `SFTP done: ${remotePath} (${sizeKB}KB)`); sftp.end(); res(); });
      stream.on("error", e => { logErr("upload", `SFTP error: ${e.message}`); rej(e); });
      stream.end(data);
    });
  });
}
function onTarget(c, cmd) {
  const escaped = cmd.replace(/'/g, "'\\''");
  return run(c, `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@${TARGET} '${escaped}'`, "target");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkDiskSpace(c) {
  log("check", "checking disk space on target...");
  const r = await onTarget(c, "df -h / | tail -1");
  log("check", `disk: ${r.out.trim()}`);
  const match = r.out.match(/(\d+)%/);
  if (match && parseInt(match[1]) > 90) {
    logErr("check", `disk usage ${match[1]}% — deploy may fail!`);
  }
}

async function checkTargetService(c) {
  log("check", "checking combat-v2 service...");
  const r = await onTarget(c, "systemctl is-active combat-v2 2>/dev/null || echo inactive");
  log("check", `service: ${r.out.trim()}`);
}

// ── check ──
async function doCheck(c) {
  log("check", "=== health check ===");
  await checkDiskSpace(c);
  await checkTargetService(c);
  const r = await onTarget(c,
    "echo 'node:' $(export PATH=/opt/node22-v2/bin:$PATH && node -v 2>/dev/null); " +
    "echo 'port 3001:' $(ss -tlnp | grep ':3001 ' | head -1 || echo not-listening); " +
    "echo 'health:' $(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3001/api/auth/login 2>/dev/null || echo down); " +
    "echo 'frontend:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ 2>/dev/null || echo down)"
  );
  log("check", r.out.trim());
}

// ── deploy (full) ──
async function doDeploy(c) {
  // 1. Create tar.gz locally from git HEAD
  log("1/6", "=== creating local archive ===");
  const localArchive = join(here, "combat-v2.tar.gz");
  try {
    execSync(`git archive --format=tar.gz -o "${localArchive}" HEAD`, { cwd: repoRoot, stdio: "pipe" });
  } catch (e) {
    logErr("1/6", `git archive failed: ${e.message}`);
    process.exit(1);
  }
  const stats = statSync(localArchive);
  log("1/6", `local archive: ${(stats.size / 1024).toFixed(1)}KB`);

  // 2. Upload to relay
  log("2/6", "=== uploading to relay ===");
  await uploadFile(c, localArchive, "/tmp/combat-v2.tar.gz");

  // 3. SCP from relay to target
  log("3/6", "=== transferring relay → target ===");
  const scpStart = Date.now();
  try {
    await run(c, `scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`, "3/6-scp");
    log("3/6", `SCP completed in ${((Date.now() - scpStart) / 1000).toFixed(1)}s`);
  } catch (e) {
    logErr("3/6", `SCP failed: ${e.message}`);
    log("3/6", "retrying...");
    try {
      await run(c, `scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`, "3/6-retry");
      log("3/6", `SCP retry succeeded in ${((Date.now() - scpStart) / 1000).toFixed(1)}s`);
    } catch (e2) {
      logErr("3/6", `SCP retry also failed: ${e2.message}`);
      process.exit(1);
    }
  }

  // Also upload service file
  const svcFile = join(here, "combat-v2.service");
  if (existsSync(svcFile)) {
    log("3/6", "uploading service file...");
    await uploadFile(c, svcFile, "/tmp/combat-v2.service");
    await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.service root@${TARGET}:/tmp/combat-v2.service`, "3/6");
    log("3/6", "service file uploaded");
  }

  // Verify on target
  const verifyR = await onTarget(c, "ls -lh /tmp/combat-v2.tar.gz");
  log("3/6", `target: ${verifyR.out.trim()}`);

  // 4. Extract on target
  log("4/6", "=== extracting on target ===");
  await checkDiskSpace(c);
  const ex = await onTarget(c,
    `mkdir -p ${DEPLOY_PATH} && ` +
    `cd ${DEPLOY_PATH} && ` +
    "rm -rf config packages scripts apps node_modules 2>/dev/null; " +
    "tar xzf /tmp/combat-v2.tar.gz && " +
    "echo EXTRACT_OK"
  );
  if (!ex.out.includes("EXTRACT_OK")) { logErr("4/6", `extract failed: ${ex.out} ${ex.err}`); process.exit(1); }
  log("4/6", "extracted OK");

  // 5. Install + Build frontend on target
  log("5/6", "=== npm install + build ===");
  log("5/6", "running npm install...");
  const r5a = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    `cd ${DEPLOY_PATH} && ` +
    "npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 && " +
    "npm install --no-audit --no-fund 2>&1 | tail -5"
  );
  log("5/6", `npm install rc=${r5a.code}`);

  log("5/6", "building frontend-v2...");
  const r5b = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    `cd ${DEPLOY_PATH}/apps/frontend-v2 && ` +
    "npm run build 2>&1 | tail -5 && " +
    "ls dist/index.html && echo BUILD_OK"
  );
  log("5/6", r5b.out.trim());
  if (!r5b.out.includes("BUILD_OK")) { logErr("5/6", `build failed: ${r5b.err}`); process.exit(1); }
  log("5/6", "install + build OK");

  // 6. Install systemd service + start
  log("6/6", "=== restarting service ===");
  await onTarget(c,
    "cp /tmp/combat-v2.service /etc/systemd/system/combat-v2.service && " +
    "systemctl daemon-reload && " +
    "systemctl enable combat-v2 && " +
    "systemctl restart combat-v2"
  );
  log("6/6", "service restarted, polling health...");

  let healthy = false;
  for (let i = 0; i < 20 && !healthy; i++) {
    await sleep(3000);
    const rh = await onTarget(c,
      "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/auth/login 2>/dev/null"
    );
    const code = rh.out.trim();
    log("6/6", `  [${i}] api=${code}`);
    if (code === "200" || code === "400" || code === "404" || code === "405") healthy = true;
  }

  if (healthy) {
    const rf = await onTarget(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/");
    log("6/6", `frontend=${rf.out.trim()}`);
    console.log(`\n✅ DEPLOY SUCCESS — http://${TARGET}:3001`);
  } else {
    console.log("\n❌ DEPLOY UNHEALTHY");
    const logOut = await onTarget(c, "journalctl -u combat-v2 --no-pager -n 30");
    console.log(logOut.out);
    process.exit(1);
  }
}

// ── restart ──
async function doRestart(c) {
  log("restart", "restarting combat-v2...");
  const r = await onTarget(c, "systemctl restart combat-v2 && sleep 5 && systemctl is-active combat-v2");
  log("restart", `service: ${r.out.trim()}`);
  const r2 = await onTarget(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ && echo");
  log("restart", `health: ${r2.out.trim()}`);
  console.log(r2.out.includes("200") ? "✅ restart OK" : "❌ restart FAILED");
}

// ── logs ──
async function doLogs(c) {
  const r = await onTarget(c, "journalctl -u combat-v2 --no-pager -n 40");
  console.log(r.out);
}

// ── main ──
const mode = process.argv[2] || "check";
const c = await conn();

switch (mode) {
  case "check":   await doCheck(c); break;
  case "deploy":  await doDeploy(c); break;
  case "restart": await doRestart(c); break;
  case "logs":    await doLogs(c); break;
  default:
    console.log("Usage: node deploy.mjs <check|deploy|restart|logs>");
}
c.end();
