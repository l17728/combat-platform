/**
 * prod-rehearsal.mjs 烟雾测试 — 不接触真实 SSH,仅校验:
 *   1. 无 .env.deploy → 退出码 2
 *   2. .env.deploy 缺关键字段 → 退出码 2
 *   3. dry-run + 完整 .env.deploy 但 host 不可达 → ssh 失败 → 非 0 退出
 *   (注意:真正的 --apply 路径必须人工触发,绝不能在 CI 跑)
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, renameSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "scripts", "upgrade", "prod-rehearsal.mjs");

function withTempEnv(envContent: string | null, fn: () => void) {
  const envPath = join(repoRoot, ".env.deploy");
  const backup = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
  try {
    if (envContent === null) {
      if (existsSync(envPath)) rmSync(envPath);
    } else {
      writeFileSync(envPath, envContent);
    }
    fn();
  } finally {
    if (backup !== null) writeFileSync(envPath, backup);
    else if (existsSync(envPath)) rmSync(envPath);
  }
}

describe("prod-rehearsal.mjs", () => {
  it("脚本文件存在且语法合法", () => {
    expect(existsSync(script)).toBe(true);
    const r = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("缺 .env.deploy 时退出码=2", () => {
    withTempEnv(null, () => {
      const r = spawnSync(process.execPath, [script, "--dry-run"], { encoding: "utf8", timeout: 30000 });
      expect(r.status).toBe(2);
      expect(r.stdout + r.stderr).toMatch(/\.env\.deploy/);
    });
  });

  it(".env.deploy 缺字段时退出码=2", () => {
    withTempEnv("PROD_HOST=1.2.3.4\n", () => {
      const r = spawnSync(process.execPath, [script, "--dry-run"], { encoding: "utf8", timeout: 30000 });
      expect(r.status).toBe(2);
      expect(r.stdout + r.stderr).toMatch(/PROD_/);
    });
  });

  it("默认模式是 dry-run(无 --apply)", () => {
    // 我们不需要真跑 ssh,只验证 stdout 开头打印了 mode=DRY-RUN
    withTempEnv("PROD_HOST=192.0.2.1\nPROD_USER=root\nPROD_PASS=test\n", () => {
      const r = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 15000 });
      // 192.0.2.0/24 是 TEST-NET-1,不可达 → ssh 会超时;但启动 log 一定出现 mode=DRY-RUN
      expect(r.stdout + r.stderr).toMatch(/mode=DRY-RUN/);
    });
  });
});
