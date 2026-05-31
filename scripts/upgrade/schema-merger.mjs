#!/usr/bin/env node
/**
 * Schema 三方合并 (v2.3 upgrade)
 *
 * 输入(命令行):
 *   --current-baseline <dir>   当前 repo 的 config/schemas/
 *   --current-overlay  <dir>   当前用户态 data/schemas-overlay/
 *   --target-baseline  <dir>   升级包带的新 config/schemas/
 *   --out-overlay      <dir>   合并后写入的新 overlay 目录
 *   --report           <file>  写出 JSON 报告路径(可选;默认 stdout)
 *
 * 算法:
 *   - 新 baseline = target_baseline(完全替换,worker 用 rsync 覆盖)
 *   - 新 overlay 由 current_overlay 演化而来:
 *     * 若 overlay 中某字段名已被 target_baseline 占用 → 列入 "conflict",需用户决策
 *       (默认策略:保留 user 版本,但报告里标记)
 *     * 若 overlay 整张表的 nodeType 已被 target_baseline 提供 → 字段继续走 user
 *     * 否则原样保留(user table 完全保留)
 *
 * 输出报告 shape:
 *   {
 *     kept: [{ nodeType, fieldName }],
 *     conflicts: [{ nodeType, fieldName, baselineType, userType, suggestion }],
 *     removed: [],   // 当前无自动剔除,保留字段供后续策略
 *     userTables: [{ nodeType, fieldCount }]
 *   }
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
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

function loadDir(dir) {
  if (!existsSync(dir)) return new Map();
  const map = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (raw && typeof raw.nodeType === "string" && Array.isArray(raw.fields)) {
        map.set(raw.nodeType, raw);
      }
    } catch {}
  }
  return map;
}

export function runMerger({ currentBaseline, currentOverlay, targetBaseline, outOverlay }) {
  const baseCur = loadDir(currentBaseline);
  const ov = loadDir(currentOverlay);
  const baseNew = loadDir(targetBaseline);

  const report = {
    kept: [],
    conflicts: [],
    removed: [],
    userTables: [],
  };

  if (outOverlay && !existsSync(outOverlay)) mkdirSync(outOverlay, { recursive: true });

  for (const [nodeType, ovSchema] of ov.entries()) {
    const newBase = baseNew.get(nodeType);
    if (!newBase) {
      // 用户自建表:整张表保留
      report.userTables.push({ nodeType, fieldCount: ovSchema.fields.length });
      if (outOverlay) {
        writeFileSync(join(outOverlay, `${nodeType}.json`), JSON.stringify(ovSchema, null, 2));
      }
      continue;
    }
    const baseFieldNames = new Set(newBase.fields.map((f) => f.name));
    const kept = [];
    for (const f of ovSchema.fields) {
      if (baseFieldNames.has(f.name)) {
        const baseField = newBase.fields.find((x) => x.name === f.name);
        report.conflicts.push({
          nodeType,
          fieldName: f.name,
          baselineType: baseField?.type,
          userType: f.type,
          suggestion:
            baseField?.type === f.type
              ? "新基线已提供同名同类型字段,可移除 overlay 项(无信息损失)"
              : "新基线字段类型不同;请确认数据兼容,默认保留 user 版本",
        });
        // 默认保留 user 字段(若类型相同其实可丢弃,但保守为先)
        kept.push(f);
        report.kept.push({ nodeType, fieldName: f.name });
      } else {
        kept.push(f);
        report.kept.push({ nodeType, fieldName: f.name });
      }
    }
    if (kept.length > 0 && outOverlay) {
      const newOv = {
        nodeType,
        label: ovSchema.label,
        identityKeys: ovSchema.identityKeys,
        derivedToKG: ovSchema.derivedToKG,
        fields: kept,
      };
      writeFileSync(join(outOverlay, `${nodeType}.json`), JSON.stringify(newOv, null, 2));
    }
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("schema-merger.mjs")) {
  const args = parseArgs(process.argv);
  const required = ["current-baseline", "current-overlay", "target-baseline"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`缺少参数: --${k}`);
      process.exit(2);
    }
  }
  const report = runMerger({
    currentBaseline: args["current-baseline"],
    currentOverlay: args["current-overlay"],
    targetBaseline: args["target-baseline"],
    outOverlay: args["out-overlay"],
  });
  const json = JSON.stringify(report, null, 2);
  if (args["report"]) {
    writeFileSync(args["report"], json);
    console.log(`report → ${args["report"]}`);
  } else {
    console.log(json);
  }
}
