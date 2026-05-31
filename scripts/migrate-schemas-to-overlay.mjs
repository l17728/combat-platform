#!/usr/bin/env node
/**
 * 一次性迁移:把现网 config/schemas/*.json 里"非 baseline 字段"挪到
 * data/schemas-overlay/。
 *
 * "非 baseline" 由 --baseline-ref 参数指定的目录定义(通常是 git stash / 一个
 * 上游 baseline 副本)。本机执行示例:
 *
 *   node scripts/migrate-schemas-to-overlay.mjs \
 *     --current  config/schemas \
 *     --baseline /tmp/baseline-snapshot/schemas \
 *     --overlay  data/schemas-overlay
 *
 * 行为:
 *   1) 遍历 --current 下的每个 *.json
 *   2) 若文件不在 --baseline:整张表写到 overlay(用户自建表)
 *   3) 否则按 name 比较 fields:
 *      - 名字在 baseline → 保留在 baseline
 *      - 名字不在 baseline → 挪到 overlay
 *   4) 把 current 的 schema 文件改写为仅含 baseline 字段(数据契约不变)
 *      ※ 默认 dry-run,加 --apply 才真写入
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        out[k] = v;
        i++;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

function loadOne(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv);
const required = ["current", "baseline", "overlay"];
for (const k of required) {
  if (!args[k]) {
    console.error(`缺少参数: --${k}`);
    process.exit(2);
  }
}
const apply = !!args["apply"];

const currentDir = args["current"];
const baselineDir = args["baseline"];
const overlayDir = args["overlay"];

if (!existsSync(currentDir)) {
  console.error(`current 不存在: ${currentDir}`);
  process.exit(2);
}
if (apply && !existsSync(overlayDir)) mkdirSync(overlayDir, { recursive: true });

const files = readdirSync(currentDir).filter((f) => f.endsWith(".json"));
let extracted = 0;
let baselineKept = 0;
let userTables = 0;

for (const f of files) {
  const cur = loadOne(currentDir, f);
  if (!cur || !Array.isArray(cur.fields)) continue;
  const base = loadOne(baselineDir, f);
  if (!base) {
    // 用户自建表
    userTables++;
    if (apply) writeFileSync(join(overlayDir, f), JSON.stringify(cur, null, 2));
    console.log(`  [user-table] ${f}`);
    continue;
  }
  const baseNames = new Set(base.fields.map((x) => x.name));
  const overlayFields = [];
  const keptFields = [];
  for (const fd of cur.fields) {
    if (baseNames.has(fd.name)) {
      keptFields.push(fd);
      baselineKept++;
    } else {
      overlayFields.push(fd);
      extracted++;
    }
  }
  if (overlayFields.length > 0) {
    const ov = {
      nodeType: cur.nodeType,
      label: cur.label,
      identityKeys: cur.identityKeys,
      derivedToKG: cur.derivedToKG,
      fields: overlayFields,
    };
    if (apply) writeFileSync(join(overlayDir, f), JSON.stringify(ov, null, 2));
    console.log(`  [overlay] ${f} -> ${overlayFields.length} user field(s)`);
  }
  if (apply && overlayFields.length > 0) {
    // 同时把 current 文件改写为只含 baseline 字段
    const newCur = { ...cur, fields: keptFields };
    writeFileSync(join(currentDir, f), JSON.stringify(newCur, null, 2));
  }
}

console.log(`\n汇总: extracted=${extracted} baselineKept=${baselineKept} userTables=${userTables} apply=${apply}`);
if (!apply) console.log("dry-run 模式;加 --apply 真写入");
