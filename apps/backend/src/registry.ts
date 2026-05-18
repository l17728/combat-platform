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
      .map(f => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as NodeSchema);
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
