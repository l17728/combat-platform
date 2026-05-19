import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaRegistry, EntitySchemaConfig, NodeSchema, ValidationResult, FieldOp } from "@combat/shared";
import { validateNode } from "./validation.js";

export class FileSchemaRegistry implements SchemaRegistry {
  private config!: EntitySchemaConfig;
  constructor(private dir: string) { this.reload(); }

  reload(): void {
    const nodeTypes: NodeSchema[] = readdirSync(this.dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(join(this.dir, f), "utf8"));
        } catch (e) {
          throw new Error(`Schema 配置文件 ${f} 不是合法 JSON: ${(e as Error).message}`);
        }
        const r = raw as { nodeType?: unknown; fields?: unknown };
        if (typeof r.nodeType !== "string" || !Array.isArray(r.fields)) {
          throw new Error(`Schema 配置文件 ${f} 缺少必需的 nodeType 或 fields`);
        }
        const ns = raw as NodeSchema;
        ns.fields = ns.fields.map(fd => ({ ...fd, id: fd.id ?? fd.name }));
        return ns;
      });
    this.config = { version: Date.now(), nodeTypes, edgeTypes: [] };
  }
  getConfig(): EntitySchemaConfig { return this.config; }
  getNodeSchema(nodeType: string): NodeSchema | undefined {
    return this.config.nodeTypes.find(n => n.nodeType === nodeType);
  }
  validateNode(nodeType: string, properties: Record<string, unknown>): ValidationResult {
    const s = this.getNodeSchema(nodeType);
    if (!s) return { ok: false, errors: [`未知节点类型: ${nodeType}`] };
    return validateNode(s, properties);
  }

  applyFieldOp(nodeType: string, op: FieldOp): NodeSchema {
    const file = join(this.dir, `${nodeType}.json`);
    // Phase-1 assumption: single-process, synchronous fs + better-sqlite3 — this
    // read-modify-write runs to completion without interleaving (no await). Not safe
    // under async fs / multi-process; revisit then.
    const prev = readFileSync(file, "utf8");
    const schema = JSON.parse(prev) as NodeSchema;
    schema.fields = schema.fields.map(f => ({ ...f, id: f.id ?? f.name }));

    const find = (id: string) => {
      const f = schema.fields.find(x => x.id === id);
      if (!f) throw new Error(`字段 id 不存在: ${id}`);
      return f;
    };
    if (op.op === "addField") {
      const { name, type, label } = op.field;
      if (!name || !type || !label) throw new Error("addField 需要 name/type/label");
      const ids = new Set(schema.fields.map(f => f.id));
      let id = name, n = 2;
      while (ids.has(id)) id = `${name}#${n++}`;
      schema.fields.push({ id, name, type, label,
        required: op.field.required, enumValues: op.field.enumValues });
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
    } else {
      throw new Error(`未知操作: ${(op as { op: string }).op}`);
    }

    writeFileSync(file, JSON.stringify(schema, null, 2));
    // Tracked PRD §13: reload() re-parses ALL *.json in the dir, so an unrelated
    // broken sibling config can trigger a false rollback of THIS valid change.
    // Acceptable at current few-schema scope; revisit (per-file validate) before growth.
    try {
      this.reload();
    } catch (e) {
      writeFileSync(file, prev);
      this.reload();
      throw new Error(`Schema 变更后重载失败，已回滚: ${(e as Error).message}`);
    }
    const updated = this.getNodeSchema(nodeType);
    if (!updated) throw new Error(`Schema 重载后未找到 nodeType: ${nodeType}（配置文件 nodeType 字段需与文件名一致）`);
    return updated;
  }
}
