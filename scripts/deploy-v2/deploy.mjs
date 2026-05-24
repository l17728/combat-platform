import { readFileSync, existsSync } from "node:fs";
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
const log = (...args) => console.log(...args);

// ── check ────────────────────────────────────────────────────────────────
async function doCheck(c) {
  log("[checking target server]");
  const r = await onTarget(c,
    "uname -r; echo ---;" +
    "export PATH=/opt/node22-v2/bin:$PATH && node -v 2>/dev/null; echo ---;" +
    "df -h / | tail -1; echo ---;" +
    "free -h | grep Mem; echo ---;" +
    "ss -tlnp | grep -E ':3001 |:80 '; echo ---;" +
    "curl -s -o /dev/null -w 'backend_3001=%{http_code}' http://localhost:3001/api/schema/attackTicket; echo;" +
    "curl -s -o /dev/null -w 'frontend_3001=%{http_code}' http://localhost:3001/; echo;" +
    "curl -s -o /dev/null -w 'frontend_80=%{http_code}' http://localhost:80/; echo"
  );
  log(r.out);
  if (r.err) log("[stderr]", r.err);
}

// ── build (local) ────────────────────────────────────────────────────────
function doBuild() {
  log("[step 1/5] building frontend-v2 locally...");
  const distDir = join(repoRoot, "apps", "frontend-v2", "dist");
  execSync("npm run build --workspace=@combat/frontend-v2", { cwd: repoRoot, stdio: "inherit" });
  if (!existsSync(join(distDir, "index.html"))) {
    console.error("ABORT: apps/frontend-v2/dist/index.html not found after build");
    process.exit(1);
  }
  log("[step 1/5] build OK");
}

// ── pack ──────────────────────────────────────────────────────────────────
function doPack() {
  log("[step 2/5] packing repo from git HEAD...");
  const tar = join(here, "combat-v2.tar.gz");
  execSync(`git archive --format=tar.gz -o "${tar}" HEAD`, { cwd: repoRoot, stdio: "pipe" });
  log("[step 2/5] packed", (require("fs").statSync(tar).size / 1024).toFixed(0), "KB");
  return tar;
}

// ── upload + extract ──────────────────────────────────────────────────────
async function doUpload(c, tar) {
  log("[step 3/5] uploading to jump server...");
  await sftpPut(c, tar, "/tmp/combat-v2.tar.gz");
  await sftpPut(c, join(here, "start-services.sh"), "/tmp/start-services-v2.sh");

  log("[step 3/5] transferring to target...");
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`);
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/start-services-v2.sh root@${TARGET}:/tmp/start-services-v2.sh`);

  log("[step 3/5] extracting on target...");
  const mk = await onTarget(c, "mkdir -p /opt/combat-v2 && echo READY");
  if (!/READY/.test(mk.out)) { console.error("ABORT: mkdir failed", mk); process.exit(1); }
  const ex = await onTarget(c,
    "cd /opt/combat-v2 && " +
    "rm -rf config packages scripts apps/backend apps/frontend apps/shared apps/frontend-v2/src apps/frontend-v2/index.html apps/frontend-v2/package.json apps/frontend-v2/tsconfig.json apps/frontend-v2/vite.config.ts AGENTS.md CLAUDE.md README.md 2>/dev/null; " +
    "tar xzf /tmp/combat-v2.tar.gz && " +
    "cp /tmp/start-services-v2.sh /opt/combat-v2/start-services.sh && " +
    "chmod +x /opt/combat-v2/start-services.sh && " +
    "echo EXTRACT_OK"
  );
  if (!/EXTRACT_OK/.test(ex.out)) { console.error("ABORT: extract failed", ex); process.exit(1); }
  log("[step 3/5] extracted OK");
}

// ── install + start services on target ────────────────────────────────────
async function doInstallAndStart(c) {
  log("[step 4/5] running npm install on target...");
  const r1 = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    "cd /opt/combat-v2 && " +
    "npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 && " +
    "npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5 && " +
    "node -e \"require('better-sqlite3');console.log('better-sqlite3 OK')\" 2>&1"
  );
  log(r1.out.replace(/\n$/, ""));
  if (r1.err && !/npm warn/i.test(r1.err)) log("[npm stderr]", r1.err);

  log("[step 4/5] building frontend-v2 on target...");
  const r1b = await onTarget(c,
    "export PATH=/opt/node22-v2/bin:$PATH && " +
    "cd /opt/combat-v2/apps/frontend-v2 && " +
    "npm install --no-audit --no-fund 2>&1 | tail -3 && " +
    "npm run build 2>&1 | tail -3"
  );
  log(r1b.out.replace(/\n$/, ""));

  log("[step 5/5] starting services...");
  const r2 = await onTarget(c,
    "pkill -f 'tsx src/server.ts' 2>/dev/null; " +
    "pkill -f 'serve.*frontend-v2' 2>/dev/null; " +
    "sleep 1; " +
    "cp /tmp/start-services-v2.sh /opt/combat-v2/start-services.sh && " +
    "chmod +x /opt/combat-v2/start-services.sh && " +
    "cd /opt/combat-v2 && " +
    "setsid bash -c 'bash /opt/combat-v2/start-services.sh > /opt/combat-v2/start.log 2>&1' < /dev/null & " +
    "echo KICKED"
  );
  log("[step 5/5] services starting...");

  let done = false;
  for (let i = 0; i < 30 && !done; i++) {
    await sleep(5000);
    try {
      const r = await onTarget(c, "grep -q 'SERVICES_READY' /opt/combat-v2/start.log 2>/dev/null && echo __DONE__ || tail -1 /opt/combat-v2/start.log 2>/dev/null");
      const last = (r.out || "").trim();
      if (/__DONE__/.test(r.out)) { done = true; log(`[poll ${i}] SERVICES_READY`); }
      else log(`[poll ${i}] ${last}`);
    } catch (e) { log(`[poll ${i}] (reconnect) ${e.message}`); }
  }

  if (!done) { console.error("TIMED OUT waiting for services. Check /opt/combat-v2/start.log"); process.exit(1); }

  const r3 = await onTarget(c,
    "echo '--- start.log ---'; cat /opt/combat-v2/start.log 2>/dev/null | tail -15; " +
    "echo '--- health ---'; " +
    "curl -s -o /dev/null -w 'backend_3001=%{http_code}\\n' http://localhost:3001/api/schema/attackTicket; " +
    "curl -s -o /dev/null -w 'frontend_3001=%{http_code}\\n' http://localhost:3001/; " +
    "curl -s -o /dev/null -w 'frontend_80=%{http_code}\\n' http://localhost:80/"
  );
  log(r3.out);

  const healthy = r3.out.includes("backend_3001=200") && r3.out.includes("frontend_3001=200");
  if (healthy) {
    log(`\n✅ DEPLOY SUCCESS`);
    log(`   Backend+Frontend: http://${TARGET}:3001`);
    log(`   Frontend only:    http://${TARGET}:80`);
  } else {
    log(`\n❌ DEPLOY UNHEALTHY — check logs above`);
    process.exit(1);
  }
}

// ── restart (no re-upload) ────────────────────────────────────────────────
async function doRestart(c) {
  log("[restarting services on target...]");
  const r = await onTarget(c,
    "pkill -f 'tsx src/server.ts' 2>/dev/null; " +
    "pkill -f 'serve.*frontend-v2' 2>/dev/null; " +
    "sleep 1; " +
    "cd /opt/combat-v2 && " +
    "setsid bash -c 'bash /opt/combat-v2/start-services.sh > /opt/combat-v2/start.log 2>&1' < /dev/null & " +
    "echo KICKED"
  );
  log("[waiting for services...]");

  let done = false;
  for (let i = 0; i < 20 && !done; i++) {
    await sleep(3000);
    const rr = await onTarget(c, "grep -q 'SERVICES_READY' /opt/combat-v2/start.log 2>/dev/null && echo __DONE__ || echo waiting");
    if (/__DONE__/.test(rr.out)) { done = true; }
  }

  if (!done) { console.error("TIMED OUT"); process.exit(1); }

  const r2 = await onTarget(c,
    "curl -s -o /dev/null -w 'backend=%{http_code}\\n' http://localhost:3001/api/schema/attackTicket; " +
    "curl -s -o /dev/null -w 'frontend=%{http_code}\\n' http://localhost:3001/"
  );
  log(r2.out);
  log(done ? "✅ restart OK" : "❌ restart FAILED");
}

// ── main ──────────────────────────────────────────────────────────────────
const mode = process.argv[2] || "check";
const c = await conn();
log(`[connected ${USER}@${HOST} → ${TARGET}]`);

switch (mode) {
  case "check":
    await doCheck(c);
    break;
  case "deploy":
    doBuild();
    const tar = doPack();
    await doUpload(c, tar);
    await doInstallAndStart(c);
    break;
  case "restart":
    await doRestart(c);
    break;
  default:
    console.log("Usage: node deploy.mjs <check|deploy|restart>");
    console.log("  check   — check target server health");
    console.log("  deploy  — full build + pack + upload + install + start");
    console.log("  restart — restart services (no rebuild/re-upload)");
}

c.end();
