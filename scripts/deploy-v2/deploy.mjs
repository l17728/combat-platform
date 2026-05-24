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
const TARGET = "60.204.199.234";

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
async function onTarget(c, cmd) {
  return run(c, `ssh -o StrictHostKeyChecking=no root@${TARGET} '${cmd.replace(/'/g, "'\\''")}'`);
}
async function putToTarget(c, local, remote) {
  const tmpLocal = `/tmp/${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  const tmpRemote = `/tmp/${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  execSync(`scp -o StrictHostKeyChecking=no "${local}" root@${HOST}:${tmpLocal}`, { cwd: here, stdio: "pipe" });
  await run(c, `scp -o StrictHostKeyChecking=no ${tmpLocal} root@${TARGET}:${tmpRemote}`);
  await onTarget(c, `mv ${tmpRemote} ${remote}`);
  await run(c, `rm -f ${tmpLocal}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mode = process.argv[2] || "check";

if (mode === "check") {
  const c = await conn();
  console.log("[checking target server]");
  const r = await onTarget(c, "uname -a; echo ---; node -v; echo ---; df -h / | tail -1; echo ---; free -h | head -2; echo ---; ss -ltn | grep 3001 || echo port3001-free");
  console.log(r.out);
  if (r.err) console.log("[stderr]", r.err);
  c.end();
  process.exit(0);
}

if (mode === "deploy") {
  console.log("[packing repo from git HEAD...]");
  const tar = join(here, "combat-v2.tar.gz");
  execSync(`git archive --format=tar.gz -o "${tar}" HEAD`, { cwd: repoRoot });
  console.log("[packed combat-v2.tar.gz]");

  const c = await conn();
  console.log(`[connected ${USER}@${HOST} → ${TARGET}]`);

  console.log("[uploading archive to jump server...]");
  await sftpPut(c, tar, "/tmp/combat-v2.tar.gz");
  await sftpPut(c, join(here, "run-backend.sh"), "/tmp/run-backend-v2.sh");

  console.log("[transfer to target...]");
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/combat-v2.tar.gz root@${TARGET}:/tmp/combat-v2.tar.gz`);
  await run(c, `scp -o StrictHostKeyChecking=no /tmp/run-backend-v2.sh root@${TARGET}:/tmp/run-backend-v2.sh`);

  console.log("[extracting on target...]");
  const mk = await onTarget(c, "mkdir -p /opt/combat-v2 && rm -rf /opt/combat-v2/* /opt/combat-v2/.[!.]* 2>/dev/null; echo READY");
  if (!/READY/.test(mk.out)) { console.error("ABORT: mkdir failed", mk); process.exit(1); }
  const ex = await onTarget(c, "tar xzf /tmp/combat-v2.tar.gz -C /opt/combat-v2 && cp /tmp/run-backend-v2.sh /opt/combat-v2/run-backend.sh && chmod +x /opt/combat-v2/run-backend.sh && echo EXTRACT_OK");
  if (!/EXTRACT_OK/.test(ex.out)) { console.error("ABORT: extract failed", ex); process.exit(1); }
  console.log("[extracted OK]");

  console.log("[kicking off backend runner on target...]");
  await onTarget(c, "rm -f /opt/combat-v2/deploy.log; cd /opt/combat-v2 && setsid bash -c 'bash /opt/combat-v2/run-backend.sh > /opt/combat-v2/deploy.log 2>&1' < /dev/null & echo KICKED");
  console.log("[runner kicked — polling deploy.log]");

  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    await sleep(10000);
    try {
      const r = await onTarget(c, "tail -n 3 /opt/combat-v2/deploy.log 2>/dev/null; grep -q 'DEPLOY_DONE' /opt/combat-v2/deploy.log && echo __FINISHED__");
      const last = (r.out || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "";
      console.log(`[poll ${i}] ${last}`);
      if (/__FINISHED__/.test(r.out)) done = true;
    } catch (e) { console.log(`[poll ${i}] (reconnect) ${e.message}`); }
  }

  const full = await onTarget(c, "echo '===== deploy.log ====='; cat /opt/combat-v2/deploy.log 2>/dev/null | tail -40");
  console.log(full.out);
  console.log(done
    ? `\n[DEPLOY DONE] backend: http://${TARGET}:3001  frontend: http://${TARGET}`
    : `\n[DEPLOY TIMED OUT] check /opt/combat-v2/deploy.log on target`);
  c.end();
  process.exit(done ? 0 : 1);
}
