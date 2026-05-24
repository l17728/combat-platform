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
function sftpPut(c, local, remote) {
  return new Promise((res, rej) => {
    c.sftp((e, sftp) => {
      if (e) return rej(e);
      sftp.fastPut(local, remote, err => (err ? rej(err) : res()));
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
  // 1. Pack
  console.log("[1/5] packing git HEAD...");
  const tar = join(here, "combat-v2.tar.gz");
  execSync(`git archive --format=tar.gz -o "${tar}" HEAD`, { cwd: repoRoot, stdio: "pipe" });
  console.log("[1/5] packed", (statSync(tar).size / 1024).toFixed(0), "KB");

  // 2. Upload
  console.log("[2/5] uploading...");
  await sftpPut(c, tar, "/tmp/combat-v2.tar.gz");
  await sftpPut(c, join(here, "combat-v2.service"), "/tmp/combat-v2.service");
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`);
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.service root@${TARGET}:/tmp/combat-v2.service`);
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
    "node -e \"require('better-sqlite3');console.log('better-sqlite3 OK')\" 2>&1 && " +
    "cd apps/frontend-v2 && npm run build 2>&1 | tail -3 && " +
    "ls dist/index.html && echo BUILD_OK"
  );
  console.log(r4.out.trim());
  if (!r4.out.includes("BUILD_OK")) { console.error("ABORT build failed:", r4.err); process.exit(1); }
  console.log("[4/5] install + build OK");

  // 5. Install systemd service + start
  console.log("[5/5] installing systemd service...");
  const r5 = await onTarget(c,
    "cp /tmp/combat-v2.service /etc/systemd/system/combat-v2.service && " +
    "systemctl daemon-reload && " +
    "systemctl enable combat-v2 && " +
    "systemctl restart combat-v2 && " +
    "sleep 5 && " +
    "systemctl is-active combat-v2"
  );
  console.log("[5/5] service:", r5.out.trim());

  // Health check
  await sleep(5);
  const r6 = await onTarget(c,
    "echo 'service:' $(systemctl is-active combat-v2); " +
    "echo 'api:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/schema/attackTicket); " +
    "echo 'frontend:' $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/)"
  );
  console.log(r6.out.trim());

  const ok = r6.out.includes("active") && r6.out.includes("api: 200") && r6.out.includes("frontend: 200");
  console.log(ok ? "\n✅ DEPLOY SUCCESS — http://" + TARGET + ":3001" : "\n❌ DEPLOY UNHEALTHY");
  if (!ok) {
    const log = await onTarget(c, "journalctl -u combat-v2 --no-pager -n 20");
    console.log(log.out);
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
