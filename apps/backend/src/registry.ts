import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaRegistry, EntitySchemaConfig, NodeSchema, ValidationResult } from "@combat/shared";
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
}
