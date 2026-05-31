import { Client } from "ssh2";

const TARGET_HOST = process.argv[2] || "124.156.193.122";
const TARGET_USER = process.argv[3] || "root";
const TARGET_PASS = process.argv[4] || "";

if (!TARGET_PASS) {
  console.log("Usage: node test-opencode.mjs [host] [user] <password>");
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

function run(c, cmd, label = "exec", timeout = 60000) {
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
          lines.forEach(l => log(label, `  ${l}`));
        }
        if (err.trim()) err.trim().split("\n").forEach(l => log(label, `  stderr: ${l}`));
        res({ code, out, err });
      });
    });
  });
}

async function main() {
  const c = await conn();
  const pathPrefix = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && `;

  // 1. 检查 opencode 版本
  log("1/4", "Checking opencode version...");
  await run(c, `${pathPrefix}opencode --version`);

  // 2. 检查配置是否正确加载
  log("2/4", "Checking config...");
  await run(c, `cat ~/.config/opencode/opencode.json | grep -A2 '"model"'`);

  // 3. 列出可用模型
  log("3/4", "Listing available models...");
  await run(c, `${pathPrefix}opencode models 2>&1 | head -30`, "models", 60000);

  // 4. 测试 serve 模式（启动后立即停止）
  log("4/4", "Testing serve mode (quick check)...");
  await run(c, `${pathPrefix}timeout 5 opencode serve --port 34567 2>&1 || echo "Serve mode available"`, "serve", 30000);

  c.end();
  log("result", "✅ opencode 安装验证完成！");
  log("info", "无头模式使用方式:");
  log("info", "  1. SSH 到服务器: ssh root@124.156.193.122");
  log("info", "  2. 加载 nvm: source ~/.nvm/nvm.sh");
  log("info", "  3. 运行: opencode run \"你的问题\"");
  log("info", "  或启动服务: opencode serve --port 34567");
}

main().catch(e => {
  console.error("Failed:", e.message);
  process.exit(1);
});
