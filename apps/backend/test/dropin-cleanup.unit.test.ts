// §v2.3.5: drop-in cleanup planner 单测
//
// 验证 scripts/deploy-v2/dropin-cleanup.mjs 的纯函数对 systemd drop-in
// Environment= 行的解析 + 冲突检测 + cleanup plan 生成。
import { describe, it, expect } from "vitest";
// 直接相对路径 import 工具(它是 .mjs 但 ESM 兼容)
// @ts-ignore — 不带 .d.ts 的 mjs 模块
import {
  parseEnvironmentKeys,
  buildKeyOwnership,
  planDropInCleanup,
  // eslint-disable-next-line @typescript-eslint/no-restricted-imports
} from "../../../scripts/deploy-v2/dropin-cleanup.mjs";

describe("parseEnvironmentKeys", () => {
  it("解析单 Environment 行", () => {
    const keys = parseEnvironmentKeys("[Service]\nEnvironment=HERMES_MODEL=glm-4-flash\n");
    expect([...keys]).toEqual(["HERMES_MODEL"]);
  });

  it("解析多 KEY=VAL 带引号", () => {
    const keys = parseEnvironmentKeys('Environment="HERMES_MODEL=glm-4.6" "HERMES_LLM_API_KEY=sk-xxx"');
    expect([...keys].sort()).toEqual(["HERMES_LLM_API_KEY", "HERMES_MODEL"]);
  });

  it("忽略注释行 / 空行 / 非 Environment 行", () => {
    const keys = parseEnvironmentKeys(
      ["[Service]", "# Environment=COMMENTED=skip", "ExecStart=/usr/bin/node app.js", "", "Environment=A=1"].join("\n")
    );
    expect([...keys]).toEqual(["A"]);
  });

  it("大小写不敏感识别 environment=", () => {
    const keys = parseEnvironmentKeys("environment=FOO=bar");
    expect([...keys]).toEqual(["FOO"]);
  });

  it("空内容/非 string → 空 Set", () => {
    expect(parseEnvironmentKeys("").size).toBe(0);
    // @ts-expect-error 故意传 null
    expect(parseEnvironmentKeys(null).size).toBe(0);
  });
});

describe("buildKeyOwnership", () => {
  it("两个文件覆盖同一 key", () => {
    const map = buildKeyOwnership([
      { name: "old.conf", content: "Environment=HERMES_MODEL=glm-4.6" },
      { name: "new.conf", content: "Environment=HERMES_MODEL=glm-4-flash" },
    ]);
    expect(map.get("HERMES_MODEL")).toEqual(["old.conf", "new.conf"]);
  });
});

describe("planDropInCleanup", () => {
  it("无冲突 → 全保留,log 标 no_conflicts", () => {
    const plan = planDropInCleanup([
      { name: "a.conf", content: "Environment=ALPHA=1" },
      { name: "b.conf", content: "Environment=BETA=2" },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.toBackup).toEqual([]);
    expect(plan.toKeep.sort()).toEqual(["a.conf", "b.conf"]);
    expect(plan.log).toContain("no_conflicts");
  });

  it("hermes.conf 与 hermes-llm.conf 都设 HERMES_MODEL → hermes-llm.conf 为权威保留,hermes.conf 备份", () => {
    const plan = planDropInCleanup(
      [
        { name: "hermes.conf", content: "Environment=HERMES_MODEL=glm-4.6\nEnvironment=HERMES_AGENT=1" },
        {
          name: "hermes-llm.conf",
          content: "Environment=HERMES_MODEL=glm-4-flash\nEnvironment=HERMES_LLM_API_KEY=sk-x",
        },
      ],
      { authoritative: ["hermes-llm.conf"] }
    );
    expect(plan.conflicts.length).toBe(1);
    expect(plan.conflicts[0].key).toBe("HERMES_MODEL");
    expect(plan.toBackup).toEqual(["hermes.conf"]);
    expect(plan.toKeep).toContain("hermes-llm.conf");
    expect(plan.log).toContain("removed=[hermes.conf]");
    expect(plan.log).toContain("kept=[hermes-llm.conf]");
  });

  it("无权威文件 → 字典序最后一个胜出", () => {
    const plan = planDropInCleanup([
      { name: "a.conf", content: "Environment=X=1" },
      { name: "z.conf", content: "Environment=X=2" },
    ]);
    expect(plan.toBackup).toEqual(["a.conf"]);
    expect(plan.toKeep).toContain("z.conf");
  });

  it("多个冲突 key 一次性处理", () => {
    const plan = planDropInCleanup(
      [
        {
          name: "old.conf",
          content: "Environment=HERMES_MODEL=glm-4.6\nEnvironment=HERMES_LLM_BASE_URL=https://old\n",
        },
        {
          name: "hermes-llm.conf",
          content: "Environment=HERMES_MODEL=glm-4-flash\nEnvironment=HERMES_LLM_BASE_URL=https://new\n",
        },
      ],
      { authoritative: ["hermes-llm.conf"] }
    );
    expect(plan.conflicts.length).toBe(2);
    expect(plan.toBackup).toEqual(["old.conf"]);
    expect(plan.toKeep).toEqual(["hermes-llm.conf"]);
  });

  it("非冲突文件保留,冲突文件按规则处理(混合场景)", () => {
    const plan = planDropInCleanup(
      [
        { name: "extra.conf", content: "Environment=UNRELATED=true" },
        { name: "old.conf", content: "Environment=HERMES_MODEL=glm-4.6" },
        { name: "hermes-llm.conf", content: "Environment=HERMES_MODEL=glm-4-flash" },
      ],
      { authoritative: ["hermes-llm.conf"] }
    );
    expect(plan.toBackup).toEqual(["old.conf"]);
    expect(plan.toKeep.sort()).toEqual(["extra.conf", "hermes-llm.conf"]);
  });
});
