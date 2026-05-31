/**
 * Schema Overlay 系统 (v2.3 一键升级基础设施)
 *
 * 设计目标:把"用户在 UI 加的字段"与"代码包自带的 baseline schema"分离,
 * 这样升级时 baseline 可整盘替换,而用户数据/字段无损保留。
 *
 * 文件布局:
 *   config/schemas/<nodeType>.json         # baseline (repo, 随代码升级)
 *   data/schemas-overlay/<nodeType>.json   # overlay (用户态,跨升级保留)
 *
 * Overlay 文件 shape 与 baseline 相同(NodeSchema),但 fields 数组里**只**记录
 *   用户新增/修改的字段。合并时 overlay 字段标 source="user"。
 *
 * 合并规则:
 *   1) overlay 不存在 / 文件不可解析 → 仅返回 baseline(每个字段标 source="baseline")
 *   2) overlay 存在 → 按 name 合并,overlay 覆盖 baseline 同名字段;
 *      baseline 字段标 source="baseline",overlay 字段标 source="user"
 *   3) overlay 里的 identityKeys / derivedToKG 不覆盖 baseline(避免破坏数据契约)
 *   4) overlay nodeType 不在 baseline → 作为"用户自建表",整张表标 source="user"
 *
 * mergeSchemas(baseline[], overlay[]) → 合并后的 NodeSchema[]
 */

import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { NodeSchema, FieldSchema } from "@combat/shared";
import { log } from "./logger.js";

export interface SchemaSet {
  /** path → NodeSchema, 文件名作 key 便于回写 */
  byFile: Map<string, NodeSchema>;
}

/** 从目录读所有 *.json,容错(解析失败的文件 warn 跳过) */
export function loadSchemaDir(dir: string): SchemaSet {
  const byFile = new Map<string, NodeSchema>();
  if (!existsSync(dir)) return { byFile };
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Partial<NodeSchema>;
      if (typeof raw.nodeType !== "string" || !Array.isArray(raw.fields)) {
        log.warn("schema_overlay.skip_invalid", { dir, file: f });
        continue;
      }
      const ns = raw as NodeSchema;
      // normalize: ensure each field has id
      ns.fields = ns.fields.map((fd) => ({ ...fd, id: fd.id ?? fd.name }));
      byFile.set(f, ns);
    } catch (e) {
      log.warn("schema_overlay.parse_fail", { dir, file: f, error: (e as Error).message });
    }
  }
  return { byFile };
}

/** 创建空 overlay 目录(若不存在) */
export function ensureOverlayDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * 合并 baseline 与 overlay。返回新的 NodeSchema[](不修改入参)。
 * 每个 field 会带 source: "baseline" | "user"。
 */
export function mergeSchemas(baseline: NodeSchema[], overlay: NodeSchema[]): NodeSchema[] {
  const byType = new Map<string, NodeSchema>();
  // 1) baseline 先入,字段标 baseline
  for (const ns of baseline) {
    byType.set(ns.nodeType, {
      ...ns,
      fields: ns.fields.map((f) => ({ ...f, source: f.source ?? "baseline" })),
    });
  }
  // 2) overlay 合并
  for (const ov of overlay) {
    const base = byType.get(ov.nodeType);
    if (!base) {
      // 用户自建表:整张表标 user
      byType.set(ov.nodeType, {
        ...ov,
        fields: ov.fields.map((f) => ({ ...f, source: "user" as const })),
      });
      continue;
    }
    // 同 nodeType:按 name 合并字段(overlay 覆盖)
    const merged = mergeFields(base.fields, ov.fields);
    byType.set(ov.nodeType, {
      ...base,
      fields: merged,
      // overlay 不改 identityKeys / derivedToKG(数据契约由 baseline 定)
    });
  }
  return Array.from(byType.values());
}

function mergeFields(baseline: FieldSchema[], overlay: FieldSchema[]): FieldSchema[] {
  const byName = new Map<string, FieldSchema>();
  for (const f of baseline) byName.set(f.name, { ...f, source: f.source ?? "baseline" });
  for (const f of overlay) {
    const existing = byName.get(f.name);
    if (existing) {
      // 覆盖语义:overlay 整体替换 baseline 同名字段,标 user
      byName.set(f.name, { ...existing, ...f, source: "user" });
    } else {
      byName.set(f.name, { ...f, id: f.id ?? f.name, source: "user" });
    }
  }
  return Array.from(byName.values());
}

/**
 * 把一个"已合并的 schema"拆回 overlay 视图(只含 source=user 的字段)。
 * 用于 PATCH 后回写 overlay 文件。
 *
 * 若 schema 本身整张表 source=user(用户自建表)→ 整张表回写为 overlay。
 * 否则:仅返回 user 字段,fields 数组只含 user 字段。
 */
export function extractOverlay(merged: NodeSchema): NodeSchema | null {
  const userFields = merged.fields.filter((f) => f.source === "user");
  if (userFields.length === 0) return null;
  return {
    nodeType: merged.nodeType,
    label: merged.label,
    identityKeys: merged.identityKeys,
    derivedToKG: merged.derivedToKG,
    fields: userFields.map((f) => {
      // 去掉 source 标志,文件里不写(运行时算)
      const { source: _s, ...rest } = f;
      return rest as FieldSchema;
    }),
  };
}

/** 用于 schema-merger 检测冲突:返回 overlay 字段名集合 */
export function overlayFieldNames(overlay: NodeSchema[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const ns of overlay) {
    const s = new Set<string>();
    for (const f of ns.fields) s.add(f.name);
    m.set(ns.nodeType, s);
  }
  return m;
}
