import { Router } from "express";
import * as XLSX from "xlsx";
import type { Repository, SchemaRegistry } from "@combat/shared";

export function makeExportRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  r.get("/export/:nodeType", async (req, res) => {
    const { nodeType } = req.params;
    const schema = registry.getNodeSchema(nodeType);
    if (!schema) return res.status(404).json({ error: `unknown nodeType: ${nodeType}` });
    const fields = schema.fields.filter((f) => !f.retired);
    const rows = (await repo.queryNodes(nodeType)).map((n) => {
      const row: Record<string, unknown> = {};
      for (const f of fields) row[f.label] = n.properties[f.id] ?? "";
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: fields.map((f) => f.label) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nodeType}-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx"`
    );
    res.send(buf);
  });
  return r;
}
