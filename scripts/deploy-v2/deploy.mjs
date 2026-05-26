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
const SCP_TIMEOUT = 120000;

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
    log(label, cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd);
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
function stdinPut(c, local, remote) {
  const data = readFileSync(local);
  log("upload", `stdinPut ${local} → ${remote} (${(data.length / 1024).toFixed(1)}KB)`);
  return new Promise((res, rej) => {
    c.exec(`cat > ${remote}`, (e, stream) => {
      if (e) return rej(e);
      let err = "";
      stream.stderr.on("data", d => (err += d));
      stream.on("close", code => {
        log("upload", `stdinPut done, rc=${code}`);
        code === 0 ? res() : rej(new Error(`stdinPut rc=${code}: ${err}`));
      });
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
    "echo 'health:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/schema/attackTicket 2>/dev/null || echo down); " +
    "echo 'frontend:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ 2>/dev/null || echo down)"
  );
  log("check", r.out.trim());
}

// ── deploy (full) ──
async function doDeploy(c) {
  // 1. Clone/pull on relay, then archive
  log("1/5", "=== preparing package on relay ===");
  let r = await run(c, "rm -rf /tmp/combat-deploy && git clone --depth 1 https://github.com/l17728/combat-platform.git /tmp/combat-deploy 2>&1", "1/5");
  if (r.code !== 0) {
    logErr("1/5", `git clone failed: ${r.err || r.out}`);
    log("1/5", "trying pull instead...");
    r = await run(c, "cd /tmp/combat-deploy && git fetch origin && git reset --hard origin/master 2>&1", "1/5");
  }
  r = await run(c, "cd /tmp/combat-deploy && git log --oneline -1", "1/5");
  log("1/5", `HEAD: ${r.out.trim()}`);

  r = await run(c, "cd /tmp/combat-deploy && git archive --format=tar.gz -o /tmp/combat-v2.tar.gz HEAD && ls -lh /tmp/combat-v2.tar.gz", "1/5");
  const sizeMatch = r.out.match(/[\d.]+[KMGT]/);
  log("1/5", `archive created: ${sizeMatch ? sizeMatch[0] : 'unknown size'}`);

  // 2. SCP to target
  log("2/5", "=== transferring to target ===");
  log("2/5", `SCP /tmp/combat-v2.tar.gz → root@${TARGET}:/tmp/ (timeout: ${SCP_TIMEOUT / 1000}s)`);

  const scpStart = Date.now();
  try {
    r = await run(c, `scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`, "2/5-scp");
    log("2/5", `SCP completed in ${((Date.now() - scpStart) / 1000).toFixed(1)}s`);
  } catch (e) {
    logErr("2/5", `SCP failed after ${((Date.now() - scpStart) / 1000).toFixed(1)}s: ${e.message}`);
    log("2/5", "retrying SCP once...");
    try {
      r = await run(c, `scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`, "2/5-scp-retry");
      log("2/5", `SCP retry succeeded in ${((Date.now() - scpStart) / 1000).toFixed(1)}s`);
    } catch (e2) {
      logErr("2/5", `SCP retry also failed: ${e2.message}`);
      log("2/5", "trying rsync over ssh as fallback...");
      try {
        r = await run(c, `rsync -avz -e 'ssh -o StrictHostKeyChecking=no' /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`, "2/5-rsync");
        log("2/5", `rsync succeeded in ${((Date.now() - scpStart) / 1000).toFixed(1)}s`);
      } catch (e3) {
        logErr("2/5", `rsync also failed: ${e3.message}`);
        process.exit(1);
      }
    }
  }

  // Also transfer service file
  const svcFile = join(here, "combat-v2.service");
  if (existsSync(svcFile)) {
    log("2/5", "uploading service file...");
    await stdinPut(c, svcFile, "/tmp/combat-v2.service");
    await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.service root@${TARGET}:/tmp/combat-v2.service`, "2/5");
    log("2/5", "service file uploaded");
  }

  // Verify archive on target
  const verifyR = await onTarget(c, "ls -lh /tmp/combat-v2.tar.gz && md5sum /tmp/combat-v2.tar.gz");
  log("2/5", `target file: ${verifyR.out.trim()}`);

  // 3. Extract
  log("3/5", "=== extracting on target ===");
  await checkDiskSpace(c);

  const ex = await onTarget(c,
    `mkdir -p ${DEPLOY_PATH} && ` +
    `cd ${DEPLOY_PATH} && ` +
    "rm -rf config packages scripts apps node_modules 2>/dev/null; " +
    "tar xzf /tmp/combat-v2.tar.gz && " +
    "echo EXTRACT_OK"
  );
  if (!ex.out.includes("EXTRACT_OK")) { logErr("3/5", `extract failed: ${ex.out} ${ex.err}`); process.exit(1); }
  log("3/5", "extracted OK");

  // 4. Install + Build frontend on target
  log("4/5", "=== npm install + build ===");
  log("4/5", "running npm install...");
  const r4a = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    `cd ${DEPLOY_PATH} && ` +
    "npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 && " +
    "npm install --no-audit --no-fund 2>&1 | tail -5"
  );
  log("4/5", `npm install rc=${r4a.code}`);

  log("4/5", "building frontend-v2...");
  const r4b = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    `cd ${DEPLOY_PATH}/apps/frontend-v2 && ` +
    "npm run build 2>&1 | tail -5 && " +
    "ls dist/index.html && echo BUILD_OK"
  );
  log("4/5", r4b.out.trim());
  if (!r4b.out.includes("BUILD_OK")) { logErr("4/5", `build failed: ${r4b.err}`); process.exit(1); }
  log("4/5", "install + build OK");

  // 5. Install systemd service + start
  log("5/5", "=== restarting service ===");
  await onTarget(c,
    "cp /tmp/combat-v2.service /etc/systemd/system/combat-v2.service && " +
    "systemctl daemon-reload && " +
    "systemctl enable combat-v2 && " +
    "systemctl restart combat-v2"
  );
  log("5/5", "service restarted, polling health...");

  let healthy = false;
  for (let i = 0; i < 20 && !healthy; i++) {
    await sleep(3000);
    const rh = await onTarget(c,
      "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/schema/attackTicket 2>/dev/null"
    );
    const code = rh.out.trim();
    log("5/5", `  [${i}] api=${code}`);
    if (code === "200") healthy = true;
  }

  if (healthy) {
    const rf = await onTarget(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/");
    log("5/5", `frontend=${rf.out.trim()}`);
    console.log(`\n✅ DEPLOY SUCCESS — http://${TARGET}:3001`);
  } else {
    console.log("\n❌ DEPLOY UNHEALTHY");
    const log = await onTarget(c, "journalctl -u combat-v2 --no-pager -n 30");
    console.log(log.out);
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
