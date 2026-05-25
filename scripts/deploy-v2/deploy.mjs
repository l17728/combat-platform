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

function conn() {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on("ready", () => res(c)).on("error", rej)
      .connect({ host: HOST, port: 22, username: USER, password: PASS,
        readyTimeout: 30000, keepaliveInterval: 10000, keepaliveCountMax: 6 });
  });
}
function run(c, cmd) {
  return new Promise((res, rej) => {
    c.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let out = "", err = "";
      s.on("data", d => (out += d)).stderr.on("data", d => (err += d));
      s.on("close", code => res({ code, out, err }));
    });
  });
}
/** Upload a local file to a remote path via SSH exec stdin (more stable than SFTP on flaky networks). */
function stdinPut(c, local, remote) {
  const data = readFileSync(local);
  return new Promise((res, rej) => {
    c.exec(`cat > ${remote}`, (e, stream) => {
      if (e) return rej(e);
      let err = "";
      stream.stderr.on("data", d => (err += d));
      stream.on("close", code => (code === 0 ? res() : rej(new Error(`stdinPut rc=${code}: ${err}`))));
      stream.end(data);
    });
  });
}
function onTarget(c, cmd) {
  const escaped = cmd.replace(/'/g, "'\\''");
  return run(c, `ssh -o StrictHostKeyChecking=no root@${TARGET} '${escaped}'`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── check ──
async function doCheck(c) {
  console.log("[checking target]");
  const r = await onTarget(c,
    "echo 'node:' $(export PATH=/opt/node22-v2/bin:$PATH && node -v 2>/dev/null); " +
    "echo 'systemd:' $(systemctl is-active combat-v2 2>/dev/null || echo inactive); " +
    "echo 'port 3001:' $(ss -tlnp | grep ':3001 ' | head -1 || echo not-listening); " +
    "echo 'health:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/schema/attackTicket 2>/dev/null || echo down); " +
    "echo 'frontend:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ 2>/dev/null || echo down)"
  );
  console.log(r.out);
  if (r.err) console.log("[stderr]", r.err);
}

// ── deploy (full) ──
async function doDeploy(c) {
  // 1. Clone/pull on relay, then archive
  console.log("[1/5] preparing package on relay...");
  let r = await run(c, "git clone https://github.com/l17728/combat-platform.git /tmp/combat-deploy 2>&1 || (cd /tmp/combat-deploy && git fetch origin && git reset --hard origin/master)");
  console.log("[1/5]", r.out.trim().split("\n").pop());
  r = await run(c, "cd /tmp/combat-deploy && git archive --format=tar.gz -o /tmp/combat-v2.tar.gz HEAD && ls -la /tmp/combat-v2.tar.gz");
  console.log("[1/5]", r.out.trim().split("\n").pop());

  // 2. SCP to target
  console.log("[2/5] transferring to target...");
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`);
  const svcFile = join(here, "combat-v2.service");
  if (existsSync(svcFile)) {
    await stdinPut(c, svcFile, "/tmp/combat-v2.service");
    await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.service root@${TARGET}:/tmp/combat-v2.service`);
  }
  console.log("[2/5] uploaded");

  // 3. Extract
  console.log("[3/5] extracting...");
  const ex = await onTarget(c,
    "mkdir -p /opt/combat-v2 && " +
    "cd /opt/combat-v2 && " +
    "rm -rf config packages scripts apps node_modules 2>/dev/null; " +
    "tar xzf /tmp/combat-v2.tar.gz && " +
    "echo EXTRACT_OK"
  );
  if (!ex.out.includes("EXTRACT_OK")) { console.error("ABORT extract:", ex.out, ex.err); process.exit(1); }
  console.log("[3/5] extracted OK");

  // 4. Install + Build frontend on target
  console.log("[4/5] npm install + build...");
  const r4 = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    "cd /opt/combat-v2 && " +
    "npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 && " +
    "npm install --no-audit --no-fund 2>&1 | tail -3 && " +
    "cd apps/frontend-v2 && npm run build 2>&1 | tail -3 && " +
    "ls dist/index.html && echo BUILD_OK"
  );
  console.log(r4.out.trim());
  if (!r4.out.includes("BUILD_OK")) { console.error("ABORT build failed:", r4.err); process.exit(1); }
  console.log("[4/5] install + build OK");

  // 5. Install systemd service + start
  console.log("[5/5] installing systemd service...");
  await onTarget(c,
    "cp /tmp/combat-v2.service /etc/systemd/system/combat-v2.service && " +
    "systemctl daemon-reload && " +
    "systemctl enable combat-v2 && " +
    "systemctl restart combat-v2"
  );
  console.log("[5/5] service started, waiting...");

  // Health check — poll until port 3001 responds
  let healthy = false;
  for (let i = 0; i < 15 && !healthy; i++) {
    await sleep(3000);
    const rh = await onTarget(c,
      "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/schema/attackTicket 2>/dev/null"
    );
    const code = rh.out.trim();
    console.log(`  [${i}] api=${code}`);
    if (code === "200") healthy = true;
  }

  if (healthy) {
    const rf = await onTarget(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/");
    console.log(`  frontend=${rf.out.trim()}`);
    console.log(`\n✅ DEPLOY SUCCESS — http://${TARGET}:3001`);
  } else {
    console.log("\n❌ DEPLOY UNHEALTHY");
    const log = await onTarget(c, "journalctl -u combat-v2 --no-pager -n 20");
    console.log(log.out);
    process.exit(1);
  }
}

// ── restart ──
async function doRestart(c) {
  console.log("[restarting combat-v2 service...]");
  const r = await onTarget(c, "systemctl restart combat-v2 && sleep 5 && systemctl is-active combat-v2");
  console.log("service:", r.out.trim());
  const r2 = await onTarget(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ && echo");
  console.log("health:", r2.out.trim());
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
