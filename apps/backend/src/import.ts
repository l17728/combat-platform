import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import type { Repository, SchemaRegistry, NodeSchema } from "@combat/shared";

const upload = multer({ storage: multer.memoryStorage() });

function mapColumns(row: Record<string, unknown>, schema: NodeSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    const hit = Object.keys(row).find(k => k.trim() === f.name || k.trim() === f.label);
    if (hit !== undefined) out[f.name] = row[hit];
  }
  return out;
}

function resolvePerson(repo: Repository, name?: string, employeeId?: string): string | null {
  if (!name && !employeeId) return null;
  if (employeeId) {
    const hit = repo.queryNodes("person", { employeeId }).at(0);
    if (hit) return hit.id;
  }
  return repo.createNode("person", { name: name ?? employeeId, employeeId }, "import").id;
}

export function makeImportRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.post("/import", upload.single("file"), (req, res) => {
    const schema = registry.getNodeSchema("attackTicket");
    if (!schema) return res.status(500).json({ error: "no attackTicket schema" });
    const wb = XLSX.read(req.file!.buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    let created = 0;
    for (const raw of rows) {
      const props = mapColumns(raw, schema);
      const v = registry.validateNode("attackTicket", props);
      if (!v.ok) continue;
      const node = repo.createNode("attackTicket", props, "import");
      created++;
      const personId = resolvePerson(repo,
        raw["攻关申请人"] as string, raw["攻关申请人工号"] as string);
      if (personId) repo.createEdge("ASSIGNED_TO", node.id, personId, { role: "攻关申请人" }, "import");
    }
    res.json({ created });
  });
  return r;
}
