import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const TARGET_HOST = process.argv[2] || "124.156.193.122";
const TARGET_USER = process.argv[3] || "root";
const TARGET_PASS = process.argv[4] || "";

if (!TARGET_PASS) {
  console.log("Usage: node setup-opencode.mjs [host] [user] <password>");
  process.exit(1);
}

function log(step, msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] [${step}] ${msg}`); }
function logErr(step, msg) { console.error(`[${new Date().toISOString().slice(11, 19)}] [${step}] ❌ ${msg}`); }

function conn() {
  return new Promise((res, rej) => {
    log("conn", `connecting to ${TARGET_HOST}...`);
    const c = new Client();
    c.on("ready", () => { log("conn", `connected to ${TARGET_HOST}`); res(c); })
      .on("error", e => { logErr("conn", `${e.message}`); rej(e); })
      .connect({ host: TARGET_HOST, port: 22, username: TARGET_USER, password: TARGET_PASS,
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
          if (lines.length <= 20) lines.forEach(l => log(label, `  ${l}`));
          else { lines.slice(0, 10).forEach(l => log(label, `  ${l}`)); log(label, `  ... (${lines.length - 10} more lines)`); }
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
      stream.on("close", () => { log("upload", `SFTP done: ${remotePath}`); sftp.end(); res(); });
      stream.on("error", e => { logErr("upload", `SFTP error: ${e.message}`); rej(e); });
      stream.end(data);
    });
  });
}

async function main() {
  const c = await conn();

  // 1. 检查并安装 Node.js 22 via nvm
  log("1/6", "Checking Node.js...");
  const nodeCheck = await run(c, "which node");
  
  if (nodeCheck.code !== 0) {
    log("1/6", "Node.js not found, installing via nvm...");
    
    // 安装 nvm
    await run(c, "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash 2>&1 | tail -3");
    
    // 安装 Node.js 22
    const installCmd = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install 22 && nvm alias default 22 && nvm use 22 && which node && npm --version`;
    const installR = await run(c, installCmd);
    log("1/6", `Node.js installed: ${installR.out.trim().split("\\n").pop()}`);
  } else {
    log("1/6", `Node.js already installed at: ${nodeCheck.out.trim()}`);
  }

  // 设置 PATH 前缀，确保使用 nvm 的 Node.js
  const pathPrefix = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && `;

  // 2. 安装 opencode
  log("2/6", "Installing opencode-ai globally...");
  await run(c, `${pathPrefix}npm install -g opencode-ai@latest`);

  // 3. 验证安装
  log("3/6", "Verifying opencode installation...");
  const opencodeCheck = await run(c, `${pathPrefix}opencode --version`);
  log("3/6", `opencode: ${opencodeCheck.out.trim()}`);

  // 4. 创建配置目录
  log("4/6", "Creating config directory...");
  await run(c, "mkdir -p ~/.config/opencode");

  // 5. 上传配置文件
  log("5/6", "Uploading opencode.json config...");
  const localConfig = join("C:", "Users", "HW", ".config", "opencode", "opencode.json");
  const remoteConfig = "/root/.config/opencode/opencode.json";
  await uploadFile(c, localConfig, remoteConfig);

  // 6. 验证配置
  log("6/6", "Verifying config file...");
  const configCheck = await run(c, "cat ~/.config/opencode/opencode.json | head -20");
  log("6/6", "Config uploaded successfully");

  // 7. 显示安装位置
  log("info", "Installation paths:");
  await run(c, `${pathPrefix}which node`);
  await run(c, `${pathPrefix}which npm`);
  await run(c, `${pathPrefix}which opencode`);

  c.end();
  log("done", "✅ opencode installed and configured!");
}

main().catch(e => {
  console.error("Failed:", e.message);
  process.exit(1);
});
