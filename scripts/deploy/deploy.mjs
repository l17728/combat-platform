// Reusable deployer for the 作战管理工具 test server (standing deploy principle).
// Reads credentials from repo-root .env.deploy (gitignored — never hardcode here).
// Usage: node deploy.mjs inventory | node deploy.mjs deploy
import { readFileSync } from "node:fs";
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

function conn() {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on("ready", () => res(c)).on("error", rej)
      .connect({ host: HOST, port: 22, username: USER, password: PASS,
        readyTimeout: 25000, keepaliveInterval: 10000, keepaliveCountMax: 6 });
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
async function once(cmd) { // fresh connection per call (robust to drops)
  const c = await conn();
  try { return await run(c, cmd); } finally { c.end(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mode = process.argv[2] || "inventory";

if (mode === "inventory") {
  const c = await conn();
  const probe = [
    "uname -a", "(. /etc/os-release 2>/dev/null && echo $PRETTY_NAME)",
    "node -v||echo NO_NODE", "npm -v||echo NO_NPM", "git --version||echo NO_GIT",
    "gcc --version|head -1||echo NO_GCC", "python3 --version||echo NO_PY3",
    "df -h / | tail -1", "ss -ltn 2>/dev/null | grep -E ':3001|:5173|:80 ' || echo 'ports free'",
  ].join(" ; echo --- ; ");
  console.log((await run(c, probe)).out);
  c.end(); process.exit(0);
}

if (mode === "deploy") {
  // Build frontend locally to avoid OOM on server (server has limited RAM with other processes)
  console.log("[building frontend locally (avoids server OOM)...]");
  execSync(`npm run build --workspace=@combat/frontend`, { cwd: repoRoot, stdio: "inherit" });
  console.log("[frontend build complete]");

  const tar = join(here, "app.tar.gz");
  execSync(`git archive --format=tar.gz -o "${tar}" HEAD`, { cwd: repoRoot });
  // Create separate dist archive using bash (handles paths correctly on Windows)
  execSync(`tar -czf scripts/deploy/app-dist.tar.gz apps/frontend/dist`, { cwd: repoRoot, shell: "bash" });
  console.log("[built app.tar.gz from git HEAD + app-dist.tar.gz from pre-built dist]");

  let c = await conn();
  console.log(`[connected ${USER}@${HOST}]`);
  await run(c, "pkill -f 'tsx src/server.ts' 2>/dev/null; pkill -f 'vite' 2>/dev/null; true");
  const mk = await run(c, "mkdir -p /opt/combat && rm -rf /opt/combat/* /opt/combat/.[!.]* 2>/dev/null; test -d /opt/combat && echo READY");
  if (!/READY/.test(mk.out)) { console.error("ABORT: /opt/combat not ready", mk); process.exit(1); }
  await sftpPut(c, tar, "/tmp/combat-app.tar.gz");
  await sftpPut(c, join(here, "app-dist.tar.gz"), "/tmp/combat-dist.tar.gz");
  await sftpPut(c, join(here, "run-deploy.sh"), "/opt/combat/run-deploy.sh");
  const ex = await run(c, "tar xzf /tmp/combat-app.tar.gz -C /opt/combat && tar xzf /tmp/combat-dist.tar.gz -C /opt/combat && test -f /opt/combat/package.json && echo EXTRACT_OK");
  if (!/EXTRACT_OK/.test(ex.out)) { console.error("ABORT: extract failed", ex); process.exit(1); }
  console.log("[uploaded + extracted]");
  // kick off detached runner (returns immediately; survives SSH drop)
  await run(c, "rm -f /opt/combat/deploy.log; chmod +x /opt/combat/run-deploy.sh; setsid bash -c 'bash /opt/combat/run-deploy.sh > /opt/combat/deploy.log 2>&1' < /dev/null & echo KICKED");
  console.log("[runner kicked off — polling deploy.log]");
  c.end();

  let done = false;
  for (let i = 0; i < 40 && !done; i++) {       // up to ~6.5 min
    await sleep(10000);
    try {
      const r = await once("tail -n 2 /opt/combat/deploy.log 2>/dev/null; grep -q 'DEPLOY_DONE' /opt/combat/deploy.log && echo __FINISHED__");
      const last = (r.out || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "";
      console.log(`[poll ${i}] ${last}`);
      if (/__FINISHED__/.test(r.out)) done = true;
    } catch (e) { console.log(`[poll ${i}] (reconnect) ${e.message}`); }
  }
  const full = await once("echo '===== deploy.log ====='; cat /opt/combat/deploy.log 2>/dev/null | tail -40");
  console.log(full.out);
  console.log(done
    ? `\n[DEPLOY DONE] open  http://${HOST}:5173/attack   (Aliyun security group must allow inbound TCP 5173)`
    : `\n[DEPLOY TIMED OUT] inspect /opt/combat/deploy.log on the server`);
  process.exit(done ? 0 : 1);
}
