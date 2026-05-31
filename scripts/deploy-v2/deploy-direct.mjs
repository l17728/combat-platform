import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { Client } from "ssh2";
import { planDropInCleanup } from "./dropin-cleanup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

// §v2.7: 可选 flag — `--keep-old-drop-ins` 关闭自动清理(谨慎模式)
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const TARGET_HOST = POSITIONAL[0] || "";
const TARGET_USER = POSITIONAL[1] || "root";
const TARGET_PASS = POSITIONAL[2] || "";
const KEEP_OLD_DROP_INS = FLAGS.has("--keep-old-drop-ins");
const DEPLOY_PATH = "/opt/combat-v2";

if (!TARGET_HOST || !TARGET_PASS) {
  console.log("Usage: node deploy-direct.mjs <host> <user> <password> [--keep-old-drop-ins]");
  console.log("Example: node deploy-direct.mjs 1.2.3.4 root MyPass123");
  console.log("");
  console.log("Flags:");
  console.log("  --keep-old-drop-ins   Disable automatic systemd drop-in conflict cleanup");
  process.exit(1);
}

function log(step, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [${step}] ${msg}`);
}
function logErr(step, msg) {
  console.error(`[${new Date().toISOString().slice(11, 19)}] [${step}] ❌ ${msg}`);
}

function conn() {
  return new Promise((res, rej) => {
    log("conn", `connecting to ${TARGET_HOST}...`);
    const c = new Client();
    c.on("ready", () => {
      log("conn", `connected to ${TARGET_HOST}`);
      res(c);
    })
      .on("error", (e) => {
        logErr("conn", `${e.message}`);
        rej(e);
      })
      .connect({
        host: TARGET_HOST,
        port: 22,
        username: TARGET_USER,
        password: TARGET_PASS,
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 6,
      });
  });
}
function run(c, cmd, label = "exec") {
  return new Promise((res, rej) => {
    const short = cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd;
    log(label, short);
    const start = Date.now();
    c.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let out = "",
        err = "";
      s.on("data", (d) => (out += d)).stderr.on("data", (d) => (err += d));
      s.on("close", (code) => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(label, `done in ${elapsed}s, rc=${code}`);
        if (out.trim()) {
          const lines = out.trim().split("\n");
          if (lines.length <= 8) lines.forEach((l) => log(label, `  ${l}`));
          else {
            lines.slice(0, 4).forEach((l) => log(label, `  ${l}`));
            log(label, `  ... (${lines.length - 4} more lines)`);
          }
        }
        if (err.trim())
          err
            .trim()
            .split("\n")
            .forEach((l) => log(label, `  stderr: ${l}`));
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
      stream.on("close", () => {
        log("upload", `SFTP done: ${remotePath} (${sizeKB}KB)`);
        sftp.end();
        res();
      });
      stream.on("error", (e) => {
        logErr("upload", `SFTP error: ${e.message}`);
        rej(e);
      });
      stream.end(data);
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// §v2.7: 在目标机扫描 /etc/systemd/system/combat-v2.service.d/*.conf,
// 解析每个文件 Environment= 行,检测多文件覆盖同 env key 的冲突,
// 备份(改 .bak)旧 drop-in 保留权威 hermes-llm.conf。
// --keep-old-drop-ins flag 可关闭。
async function runDropInCleanup(c) {
  if (KEEP_OLD_DROP_INS) {
    log("drop-in", "--keep-old-drop-ins 已传,跳过 drop-in 清理检查");
    return;
  }
  const dropInDir = "/etc/systemd/system/combat-v2.service.d";
  // 列文件 + 一次性 cat,把内容打包成 `=== name === content` 格式便于解析
  const listR = await run(
    c,
    `if [ -d ${dropInDir} ]; then ` +
      `for f in ${dropInDir}/*.conf; do ` +
      `[ -f "$f" ] || continue; echo "=== $(basename $f) ==="; cat "$f"; echo "=== END ==="; ` +
      `done; ` +
      `else echo "NO_DROPIN_DIR"; fi`,
    "drop-in"
  );
  if (listR.out.includes("NO_DROPIN_DIR")) {
    log("drop-in", "目标机无 drop-in 目录,跳过清理");
    return;
  }
  // 解析为 [{name, content}]
  const files = [];
  const blocks = listR.out.split(/=== END ===/);
  for (const block of blocks) {
    const m = block.match(/=== (.+?) ===\n([\s\S]*)/);
    if (!m) continue;
    files.push({ name: m[1].trim(), content: m[2] });
  }
  if (files.length === 0) {
    log("drop-in", "未找到任何 *.conf,跳过清理");
    return;
  }
  log("drop-in", `发现 ${files.length} 个 drop-in 文件: ${files.map((f) => f.name).join(", ")}`);
  const plan = planDropInCleanup(files, { authoritative: ["hermes-llm.conf"] });
  log("drop-in", plan.log);
  if (plan.toBackup.length === 0) {
    log("drop-in", "✓ 无冲突,无需清理");
    return;
  }
  // 执行 backup:把冲突文件改名 .bak.<timestamp>
  const ts = Date.now();
  const cmds = plan.toBackup.map((n) => `mv ${dropInDir}/${n} ${dropInDir}/${n}.bak.${ts}`);
  await run(c, cmds.join(" && "), "drop-in");
  log("drop-in", `✓ 已备份 ${plan.toBackup.length} 个冲突文件(.bak.${ts}),保留 ${plan.toKeep.join(", ")}`);
}

async function ensureNode22(c) {
  log("node", "installing Node.js v22 via nvm...");
  await run(c, "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash 2>&1 | tail -3");
  const installCmd = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 22 && nvm alias default 22 && nvm use 22 && which node`;
  const installR = await run(c, installCmd);
  const nodePath = installR.out.trim().split("\n").pop();
  log("node", `installed node at: ${nodePath}`);

  if (nodePath && nodePath.includes("nvm")) {
    return dirname(nodePath);
  }
  return null;
}

async function doDeploy(c, nodeBinPath) {
  const pathPrefix = nodeBinPath ? `export PATH=${nodeBinPath}:$PATH && ` : "";

  log("1/5", "=== creating local archive ===");
  const localArchive = join(here, "combat-v2.tar.gz");
  try {
    execSync(`git archive --format=tar.gz -o "${localArchive}" HEAD`, { cwd: repoRoot, stdio: "pipe" });
  } catch (e) {
    logErr("1/5", `git archive failed: ${e.message}`);
    process.exit(1);
  }
  const stats = statSync(localArchive);
  log("1/5", `local archive: ${(stats.size / 1024).toFixed(1)}KB`);

  log("2/5", "=== uploading to target ===");
  await uploadFile(c, localArchive, "/tmp/combat-v2.tar.gz");

  log("3/5", "=== extracting on target ===");
  await run(c, "df -h / | tail -1", "disk");
  const ex = await run(
    c,
    `mkdir -p ${DEPLOY_PATH}/data && ` +
      `cd ${DEPLOY_PATH} && ` +
      // Preserve the SQLite DB across deploys: move any legacy DB (old cwd location)
      // into the persistent data/ dir BEFORE rm -rf deletes apps/. data/ is never removed.
      "if [ -f apps/backend/combat.sqlite ] && [ ! -f data/combat.sqlite ]; then mv apps/backend/combat.sqlite* data/ 2>/dev/null || true; fi; " +
      "rm -rf config packages scripts apps node_modules 2>/dev/null; " +
      "tar xzf /tmp/combat-v2.tar.gz && " +
      "echo EXTRACT_OK"
  );
  if (!ex.out.includes("EXTRACT_OK")) {
    logErr("3/5", `extract failed: ${ex.out} ${ex.err}`);
    process.exit(1);
  }
  log("3/5", "extracted OK");

  log("4/5", "=== npm install + build ===");
  log("4/5", "running npm install...");
  const r4a = await run(
    c,
    `${pathPrefix}cd ${DEPLOY_PATH} && ` +
      "npm config set registry https://registry.npmmirror.com >/dev/null 2>&1; " +
      "npm install --no-audit --no-fund 2>&1 | tail -5"
  );
  log("4/5", `npm install rc=${r4a.code}`);

  log("4/5", "building frontend-v2...");
  const r4b = await run(
    c,
    `${pathPrefix}cd ${DEPLOY_PATH}/apps/frontend-v2 && ` +
      "npm run build 2>&1 | tail -8 && " +
      "ls dist/index.html && echo BUILD_OK"
  );
  if (!r4b.out.includes("BUILD_OK")) {
    logErr("4/5", `build failed: ${r4b.out} ${r4b.err}`);
    process.exit(1);
  }

  // harden v2.4: compile shared + backend to dist so prod runs `node dist/server.js`
  // (faster cold start, lower memory, no tsx runtime dependency).
  log("4/5", "building shared package...");
  const r4c = await run(
    c,
    `${pathPrefix}cd ${DEPLOY_PATH}/packages/shared && ` +
      "npm run build 2>&1 | tail -5 && ls dist/index.js && echo SHARED_BUILD_OK"
  );
  if (!r4c.out.includes("SHARED_BUILD_OK")) {
    logErr("4/5", `shared build failed: ${r4c.out} ${r4c.err}`);
    process.exit(1);
  }

  log("4/5", "building backend...");
  const r4d = await run(
    c,
    `${pathPrefix}cd ${DEPLOY_PATH}/apps/backend && ` +
      "npm run build 2>&1 | tail -5 && ls dist/server.js && echo BACKEND_BUILD_OK"
  );
  if (!r4d.out.includes("BACKEND_BUILD_OK")) {
    logErr("4/5", `backend build failed: ${r4d.out} ${r4d.err}`);
    process.exit(1);
  }
  log("4/5", "install + build OK");

  log("5/5", "=== configuring service ===");
  const resolvedPath = nodeBinPath || "/usr/bin";
  const serviceContent = `[Unit]
Description=Combat-v2 Backend + Frontend (:3001)
After=network.target

[Service]
Type=simple
WorkingDirectory=${DEPLOY_PATH}/apps/backend
Environment=PATH=${resolvedPath}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=COMBAT_API=http://localhost:3001
Environment=COMBAT_DB_PATH=${DEPLOY_PATH}/data/combat.sqlite
Environment=COMBAT_UPLOAD_DIR=${DEPLOY_PATH}/data/uploads
Environment=NODE_ENV=production
ExecStart=${resolvedPath}/node dist/server.js
Restart=always
RestartSec=5
StandardOutput=append:${DEPLOY_PATH}/backend.log
StandardError=append:${DEPLOY_PATH}/backend.log

[Install]
WantedBy=multi-user.target`;

  const tmpSvc = join(here, "combat-v2-direct.service");
  writeFileSync(tmpSvc, serviceContent);
  await uploadFile(c, tmpSvc, "/tmp/combat-v2.service");

  // 安装 logrotate 规则:backend.log 每日轮转 + 50MB 上限 + 保留 7 份(< 350MB),防止
  // append-only 写入长期撑爆磁盘。copytruncate 让 systemd append 句柄不中断。
  const logrotateConf = join(here, "logrotate-combat-v2");
  if (existsSync(logrotateConf)) {
    await uploadFile(c, logrotateConf, "/tmp/logrotate-combat-v2");
    await run(
      c,
      "cp /tmp/logrotate-combat-v2 /etc/logrotate.d/combat-v2 && " +
        "chmod 644 /etc/logrotate.d/combat-v2 && " +
        "logrotate -d /etc/logrotate.d/combat-v2 2>&1 | tail -5",
      "logrotate"
    );
  }

  // §v2.7: systemd drop-in 健康检查 + 自动清理冲突文件
  // v2.6 教训:多个 *.conf 覆盖同一 env key(如 HERMES_MODEL),改值后老 drop-in 偷偷复活
  await runDropInCleanup(c);

  await run(
    c,
    `mkdir -p ${DEPLOY_PATH}/data && ` +
      "cp /tmp/combat-v2.service /etc/systemd/system/combat-v2.service && " +
      "systemctl daemon-reload && " +
      "systemctl enable combat-v2 && " +
      "systemctl restart combat-v2"
  );
  log("5/5", "service restarted, polling health...");

  let healthy = false;
  for (let i = 0; i < 20 && !healthy; i++) {
    await sleep(3000);
    const rh = await run(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/auth/login 2>/dev/null");
    const code = rh.out.trim();
    log("5/5", `  [${i}] api=${code}`);
    if (["200", "400", "401", "404", "405"].includes(code)) healthy = true;
  }

  if (healthy) {
    const rf = await run(c, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/");
    log("5/5", `frontend=${rf.out.trim()}`);

    await run(
      c,
      "ufw allow 3001/tcp 2>/dev/null || iptables -I INPUT -p tcp --dport 3001 -j ACCEPT 2>/dev/null || true"
    );

    console.log(`\n✅ DEPLOY SUCCESS — http://${TARGET_HOST}:3001`);
  } else {
    console.log("\n❌ DEPLOY UNHEALTHY");
    const logOut = await run(c, "journalctl -u combat-v2 --no-pager -n 30");
    console.log(logOut.out);
    process.exit(1);
  }
}

const c = await conn();

const nodeCheck = await run(c, "node -v 2>/dev/null || echo NONE");
log("preflight", `Node.js: ${nodeCheck.out.trim()}`);

const osCheck = await run(c, "cat /etc/os-release 2>/dev/null | head -2 || uname -a");
log("preflight", `OS: ${osCheck.out.trim()}`);

let nodeBinPath = null;
if (!nodeCheck.out.trim().startsWith("v22")) {
  log("setup", "Node.js v22 not found, installing...");
  nodeBinPath = await ensureNode22(c);
  if (!nodeBinPath) {
    logErr("setup", "failed to determine Node.js bin path");
    process.exit(1);
  }
  log("setup", `Node bin path: ${nodeBinPath}`);
} else {
  const whichR = await run(c, "which node");
  nodeBinPath = dirname(whichR.out.trim());
  log("preflight", `Node bin path: ${nodeBinPath}`);
}

await doDeploy(c, nodeBinPath);
c.end();
