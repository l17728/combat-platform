import { Router } from "express";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SchemaRegistry, Repository, NodeSchema, FieldSchema, FieldType } from "@combat/shared";
import { log, asyncHandler } from "./logger.js";

export interface SchemaSuggestion {
  nodeType: string;
  fieldId: string;
  fieldName: string;
  label: string;
  type: FieldType;
  concept?: string;
  anchor?: string;
  matchReason: string; // "名称匹配" | "别名匹配" | "概念匹配" | "标签匹配"
}

const NODE_TYPE_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

export function makeSchemaApiRouter(
  registry: SchemaRegistry,
  schemaDir: string,
  repo: Repository,
): Router {
  const r = Router();

  // GET /api/schema/list — returns all NodeSchema[]
  r.get("/schema/list", (_req, res) => {
    const schemas = registry.getConfig().nodeTypes;
    res.json(schemas);
  });

  // GET /api/schema/suggest?q=<keyword>
  r.get("/schema/suggest", (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (!q) return res.json([]);

    const results: SchemaSuggestion[] = [];
    for (const ns of registry.getConfig().nodeTypes) {
      for (const f of ns.fields) {
        let matchReason: string | null = null;

        if (f.name.toLowerCase().includes(q)) {
          matchReason = "名称匹配";
        } else if (f.label.toLowerCase().includes(q)) {
          matchReason = "标签匹配";
        } else if (f.aliases?.some(a => a.toLowerCase().includes(q))) {
          matchReason = "别名匹配";
        } else if (f.concept?.toLowerCase().includes(q)) {
          matchReason = "概念匹配";
        }

        if (matchReason) {
          results.push({
            nodeType: ns.nodeType,
            fieldId: f.id,
            fieldName: f.name,
            label: f.label,
            type: f.type,
            concept: f.concept,
            anchor: f.anchor,
            matchReason,
          });
        }
      }
    }

    res.json(results);
  });

  // POST /api/schema/nodeType — create a new schema
  r.post(
    "/schema/nodeType",
    asyncHandler(async (req, res) => {
      const { nodeType, label, fields, identityKeys } = req.body as {
        nodeType?: string;
        label?: string;
        fields?: FieldSchema[];
        identityKeys?: string[];
      };

      // Validate nodeType format
      if (!nodeType || !NODE_TYPE_RE.test(nodeType)) {
        return res
          .status(400)
          .json({ error: "nodeType 必须以字母开头，只能包含字母和数字（camelCase）" });
      }

      // Validate label
      if (!label || !label.trim()) {
        return res.status(400).json({ error: "label 不能为空" });
      }

      // Validate fields
      if (!Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({ error: "fields 至少需要一个字段" });
      }
      for (const f of fields) {
        if (!f.name || !f.type || !f.label) {
          return res
            .status(400)
            .json({ error: "每个字段必须包含 name、type 和 label" });
        }
      }

      // Check for duplicate nodeType
      const existing = registry.getNodeSchema(nodeType);
      if (existing) {
        return res
          .status(409)
          .json({ error: `nodeType "${nodeType}" 已存在` });
      }

      // Assign id = name if not set
      const normalizedFields: FieldSchema[] = fields.map(f => ({
        ...f,
        id: f.id ?? f.name,
      }));

      const schema: NodeSchema = {
        nodeType,
        label: label.trim(),
        fields: normalizedFields,
        identityKeys: identityKeys ?? [],
        derivedToKG: false,
      };

      const filePath = join(schemaDir, `${nodeType}.json`);
      writeFileSync(filePath, JSON.stringify(schema, null, 2), "utf8");
      registry.reload();

      log.info("schema.create", { nodeType, fieldCount: normalizedFields.length });

      const created = registry.getNodeSchema(nodeType);
      return res.status(201).json(created);
    }),
  );

  // DELETE /api/schema/nodeType/:nodeType
  r.delete(
    "/schema/nodeType/:nodeType",
    asyncHandler(async (req, res) => {
      const { nodeType } = req.params;

      // Check schema exists
      const existing = registry.getNodeSchema(nodeType);
      if (!existing) {
        return res.status(404).json({ error: `nodeType "${nodeType}" 不存在` });
      }

      // Guard: check if any nodes of this type exist
      const nodes = repo.queryNodes(nodeType);
      if (nodes.length > 0) {
        return res
          .status(409)
          .json({ error: "该类型下有数据，无法删除" });
      }

      const filePath = join(schemaDir, `${nodeType}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      registry.reload();

      log.info("schema.delete", { nodeType });
      return res.json({ ok: true, nodeType });
    }),
  );

  return r;
}
