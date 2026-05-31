import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SchemaRegistry, EntitySchemaConfig, NodeSchema, ValidationResult, FieldOp } from "@combat/shared";
import { validateNode } from "./validation.js";
import { log } from "./logger.js";
import { loadSchemaDir, mergeSchemas, ensureOverlayDir } from "./schema-overlay.js";

export class FileSchemaRegistry implements SchemaRegistry {
  private config!: EntitySchemaConfig;
  /**
   * @param dir   baseline 目录 (repo config/schemas/)
   * @param overlayDir 可选 user overlay 目录 (data/schemas-overlay/);设置后字段会标 source
   */
  constructor(
    readonly dir: string,
    readonly overlayDir?: string
  ) {
    this.reload();
  }

  reload(): void {
    // Tolerant reload (§13#9 fix, §30): per-file try/catch — a broken sibling
    // logs a warning and is skipped, leaving the rest of the registry usable.
    // Only throw if NO files parsed (preserves the "no schemas at all" signal).
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    const baseline: NodeSchema[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as { nodeType?: unknown; fields?: unknown };
        if (typeof raw.nodeType !== "string" || !Array.isArray(raw.fields))
          throw new Error(`缺少必需的 nodeType 或 fields`);
        const ns = raw as NodeSchema;
        ns.fields = ns.fields.map((fd) => ({ ...fd, id: fd.id ?? fd.name }));
        baseline.push(ns);
      } catch (e) {
        log.warn("registry.reload.skip", { file: f, error: (e as Error).message });
      }
    }
    if (files.length > 0 && baseline.length === 0)
      throw new Error(`config/schemas 下无可解析的 schema 文件（共 ${files.length} 个，全部损坏）`);

    let nodeTypes: NodeSchema[];
    if (this.overlayDir) {
      ensureOverlayDir(this.overlayDir);
      const overlaySet = loadSchemaDir(this.overlayDir);
      const overlay = Array.from(overlaySet.byFile.values());
      nodeTypes = mergeSchemas(baseline, overlay);
    } else {
      // No overlay: baseline-only, no source tagging (back-compat with tests)
      nodeTypes = baseline;
    }
    this.config = { version: Date.now(), nodeTypes, edgeTypes: [] };
  }
  getConfig(): EntitySchemaConfig {
    return this.config;
  }
  getNodeSchema(nodeType: string): NodeSchema | undefined {
    return this.config.nodeTypes.find((n) => n.nodeType === nodeType);
  }
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult {
    const s = this.getNodeSchema(nodeType);
    if (!s) return { ok: false, errors: [`未知节点类型: ${nodeType}`] };
    return validateNode(s, properties);
  }

  /**
   * 字段操作的写入策略(v2.3 overlay 模式):
   * - 若 overlayDir 已配置:
   *   - addField 永远写 overlay(用户新增字段属用户态)
   *   - 其它操作(rename/editEnum/retire/aliases/...):若目标字段已存在于 baseline,
   *     原地改 baseline 文件(保持 v2.2 行为,因为这些通常是改 baseline 字段);
   *     若目标字段已在 overlay,则改 overlay。
   * - 若 overlayDir 未配置(单测/向后兼容):全部直接改 baseline 文件。
   */
  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema {
    if (this.overlayDir) {
      return this.applyFieldOpWithOverlay(nodeType, op);
    }
    return this.applyFieldOpBaseline(nodeType, op);
  }

  private applyFieldOpBaseline(nodeType: string, op: FieldOp): NodeSchema {
    const file = join(this.dir, `${nodeType}.json`);
    const prev = readFileSync(file, "utf8");
    const schema = JSON.parse(prev) as NodeSchema;
    schema.fields = schema.fields.map((f) => ({ ...f, id: f.id ?? f.name }));
    this.mutateInMemory(schema, op);
    writeFileSync(file, JSON.stringify(schema, null, 2));
    try {
      const verify = JSON.parse(readFileSync(file, "utf8")) as { nodeType?: unknown; fields?: unknown };
      if (typeof verify.nodeType !== "string" || !Array.isArray(verify.fields))
        throw new Error("写后自校验：缺少 nodeType 或 fields");
    } catch (e) {
      log.error("registry.fieldOp.rollback", { file, error: (e as Error).message });
      writeFileSync(file, prev);
      this.reload();
      throw new Error(`Schema 变更写盘后自校验失败，已回滚: ${(e as Error).message}`);
    }
    this.reload();
    const updated = this.getNodeSchema(nodeType);
    if (!updated) throw new Error(`Schema 重载后未找到 nodeType: ${nodeType}（配置文件 nodeType 字段需与文件名一致）`);
    return updated;
  }

  private applyFieldOpWithOverlay(nodeType: string, op: FieldOp): NodeSchema {
    if (!this.overlayDir) throw new Error("overlayDir 未配置");
    ensureOverlayDir(this.overlayDir);
    const overlayFile = join(this.overlayDir, `${nodeType}.json`);
    const baselineFile = join(this.dir, `${nodeType}.json`);

    // 读 overlay,若不存在用空骨架
    let overlay: NodeSchema;
    if (existsSync(overlayFile)) {
      overlay = JSON.parse(readFileSync(overlayFile, "utf8")) as NodeSchema;
      overlay.fields = overlay.fields.map((f) => ({ ...f, id: f.id ?? f.name }));
    } else {
      const baseRaw = existsSync(baselineFile)
        ? (JSON.parse(readFileSync(baselineFile, "utf8")) as NodeSchema)
        : undefined;
      overlay = {
        nodeType,
        label: baseRaw?.label ?? nodeType,
        identityKeys: baseRaw?.identityKeys ?? [],
        derivedToKG: baseRaw?.derivedToKG ?? false,
        fields: [],
      };
    }

    if (op.op === "addField") {
      // 走 overlay
      const merged = this.getNodeSchema(nodeType);
      if (merged && merged.fields.some((f) => f.name === op.field.name))
        throw new Error(`字段名「${op.field.name}」已存在`);
      const ids = new Set(overlay.fields.map((f) => f.id));
      let id = op.field.name,
        n = 2;
      while (ids.has(id)) id = `${op.field.name}#${n++}`;
      overlay.fields.push({
        id,
        name: op.field.name,
        type: op.field.type,
        label: op.field.label,
        required: op.field.required,
        enumValues: op.field.enumValues,
      });
      this.writeOverlay(overlayFile, overlay);
    } else {
      // 其它操作:先看字段是否在 overlay,优先改 overlay;否则回退到 baseline
      const inOverlay = overlay.fields.some((f) => f.id === (op as { id?: string }).id);
      if (inOverlay) {
        this.mutateInMemory(overlay, op);
        this.writeOverlay(overlayFile, overlay);
      } else {
        // 改 baseline(向后兼容旧 UI 行为)
        return this.applyFieldOpBaseline(nodeType, op);
      }
    }

    this.reload();
    const updated = this.getNodeSchema(nodeType);
    if (!updated) throw new Error(`Schema 重载后未找到 nodeType: ${nodeType}`);
    return updated;
  }

  private writeOverlay(file: string, schema: NodeSchema): void {
    if (this.overlayDir && !existsSync(this.overlayDir)) mkdirSync(this.overlayDir, { recursive: true });
    writeFileSync(file, JSON.stringify(schema, null, 2), "utf8");
  }

  private mutateInMemory(schema: NodeSchema, op: FieldOp): void {
    const find = (id: string) => {
      const f = schema.fields.find((x) => x.id === id);
      if (!f) throw new Error(`字段 id 不存在: ${id}`);
      return f;
    };
    if (op.op === "addField") {
      const { name, type, label } = op.field;
      if (!name || !type || !label) throw new Error("addField 需要 name/type/label");
      if (schema.fields.some((f) => f.name === name)) throw new Error(`字段名「${name}」已存在`);
      const ids = new Set(schema.fields.map((f) => f.id));
      let id = name,
        n = 2;
      while (ids.has(id)) id = `${name}#${n++}`;
      schema.fields.push({
        id,
        name,
        type,
        label,
        required: op.field.required,
        enumValues: op.field.enumValues,
      });
    } else if (op.op === "renameLabel") {
      if (!op.label) throw new Error("renameLabel 需要非空 label");
      find(op.id).label = op.label;
    } else if (op.op === "editEnum") {
      find(op.id).enumValues = op.enumValues;
    } else if (op.op === "retire") {
      find(op.id).retired = true;
    } else if (op.op === "unretire") {
      find(op.id).retired = false;
    } else if (op.op === "setAliases") {
      if (!Array.isArray(op.aliases)) throw new Error("setAliases 需要 aliases 数组");
      find(op.id).aliases = op.aliases;
    } else if (op.op === "setConcept") {
      if (typeof op.concept !== "string") throw new Error("setConcept 需要 concept 字符串");
      find(op.id).concept = op.concept;
    } else if (op.op === "setAnchor") {
      if (typeof op.anchor !== "string") throw new Error("setAnchor 需要 anchor 字符串");
      find(op.id).anchor = op.anchor;
    } else if (op.op === "setOptionsKey") {
      if (op.optionsKey !== null && typeof op.optionsKey !== "string")
        throw new Error("setOptionsKey 需要 optionsKey 字符串或 null");
      find(op.id).optionsKey = op.optionsKey ?? undefined;
    } else {
      throw new Error(`未知操作: ${(op as { op: string }).op}`);
    }
  }
}
