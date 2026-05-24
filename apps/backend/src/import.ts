import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import type { Repository, SchemaRegistry, NodeSchema, ImportPreview, ImportRowResult } from "@combat/shared";
import { syncRefEdges } from "./refs.js";
import { syncAnchorEdges } from "./anchors.js";
import { log } from "./logger.js";

const upload = multer({ storage: multer.memoryStorage() });

function mapColumns(row: Record<string, unknown>, schema: NodeSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    const aliases = (f.aliases ?? []).map(a => a.trim());
    const hit = Object.keys(row).find(k => {
      const kt = k.trim();
      return kt === f.name || kt === f.label || aliases.includes(kt);
    });
    if (hit !== undefined) out[f.id] = row[hit];
  }
  return out;
}

function resolvePerson(repo: Repository, registry: SchemaRegistry, name?: string, employeeId?: string): string | null {
  const nameField = registry.getNodeSchema("person")?.fields.find(pf => pf.required && pf.type === "string");
  const nameKey = nameField?.id ?? "name";
  const empField = registry.getNodeSchema("person")?.fields.find(pf => pf.label === "工号");
  const empKey = empField?.id ?? "employeeId";
  if (!name && !employeeId) return null;
  if (employeeId) {
    const hit = repo.queryNodes("person").find(n => String(n.properties[empKey] ?? n.properties["employeeId"] ?? "") === employeeId);
    if (hit) return hit.id;
  }
  if (name) {
    const byName = repo.queryNodes("person").find(n => String(n.properties[nameKey] ?? n.properties["姓名"] ?? n.properties["name"] ?? "") === name);
    if (byName) return byName.id;
  }
  return repo.createNode("person", { [nameKey]: name ?? employeeId, [empKey]: employeeId }, "import").id;
}

function findByIdentity(repo: Repository, schema: NodeSchema, props: Record<string, unknown>) {
  for (const k of schema.identityKeys) {
    const v = props[k];
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    if (!s) continue;
    const hit = repo.queryNodes(schema.nodeType, { [k]: s }).at(0);
    if (hit) return hit;
  }
  return undefined;
}

function rowSummary(props: Record<string, unknown>, raw: Record<string, unknown>): string {
  return String(props["标题"] ?? props["攻关单号"] ?? props["版本号"] ?? props["名称"]
    ?? props["姓名"] ?? props["贡献人"] ?? raw["标题"] ?? "(空)");
}

// §42: read-only per-row plan (create/update/skip) — no DB writes. Shared by the
// dry-run preview and the commit path so the two never diverge.
export function analyzeImport(
  repo: Repository, registry: SchemaRegistry, nodeType: string, rows: Record<string, unknown>[],
): ImportPreview {
  const schema = registry.getNodeSchema(nodeType)!;
  const out: ImportRowResult[] = [];
  let willCreate = 0, willUpdate = 0, skipped = 0;
  rows.forEach((raw, rowIndex) => {
    const props = mapColumns(raw, schema);
    const v = registry.validateNode(nodeType, props);
    const summary = rowSummary(props, raw);
    if (!v.ok) {
      out.push({ rowIndex, action: "skip", reason: v.errors.join("; "), summary });
      skipped++;
      return;
    }
    const existing = findByIdentity(repo, schema, props);
    if (existing) { out.push({ rowIndex, action: "update", summary }); willUpdate++; }
    else { out.push({ rowIndex, action: "create", summary }); willCreate++; }
  });
  return { nodeType, willCreate, willUpdate, skipped, rows: out };
}

export function makeImportRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/import", upload.single("file"), (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const nodeType = String(first(req.query.type) ?? "attackTicket");
    const dryRun = first(req.query.dryRun) === "1" || first(req.query.dryRun) === "true";
    const schema = registry.getNodeSchema(nodeType);
    if (!schema) return res.status(400).json({ error: `unknown nodeType: ${nodeType}` });
    if (!req.file?.buffer) return res.status(400).json({ error: "file 必填（multipart 字段名应为 file）" });
    let rows: Record<string, unknown>[];
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = wb.SheetNames.length ? wb.Sheets[wb.SheetNames[0]] : undefined;
      if (!sheet) return res.status(400).json({ error: "Excel 无有效 Sheet" });
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    } catch (e) {
      log.warn("import.parse_fail", { nodeType, error: (e as Error).message });
      return res.status(400).json({ error: `无法解析 Excel 文件：${(e as Error).message}` });
    }

    const plan = analyzeImport(repo, registry, nodeType, rows);
    if (dryRun) return res.json(plan);

    let created = 0, updated = 0;
    plan.rows.forEach((rr) => {
      if (rr.action === "skip") return;
      const raw = rows[rr.rowIndex];
      const props = mapColumns(raw, schema);
      const existing = findByIdentity(repo, schema, props);
      const node = existing
        ? repo.updateNode(existing.id, props, "import")
        : repo.createNode(nodeType, props, "import");
      if (existing) updated++; else created++;
      syncRefEdges(repo, registry, node, props, "import");
      syncAnchorEdges(repo, registry, node, props, "import");
      if (nodeType === "attackTicket") {
        repo.deleteEdges({ sourceId: node.id, edgeType: "ASSIGNED_TO" }, "import");
        const personId = resolvePerson(repo, registry,
          raw["攻关申请人"] as string, raw["攻关申请人工号"] as string);
        if (personId) repo.createEdge("ASSIGNED_TO", node.id, personId, { role: "攻关申请人" }, "import");
      }
    });
    const skippedRows = plan.rows.filter(r => r.action === "skip");
    for (const sr of skippedRows) log.warn("import.skip", { nodeType, rowIndex: sr.rowIndex, reason: sr.reason });
    log.info("import.done", { nodeType, created, updated, skipped: plan.skipped, total: rows.length });
    res.json({ created, updated, skipped: plan.skipped, skippedRows });
  });
  return r;
}
