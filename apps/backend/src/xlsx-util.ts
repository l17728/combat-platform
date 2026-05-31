// Excel I/O wrapper around exceljs.
//
// Rationale (harden v2.4): xlsx@0.18.5 has unpatched advisories
// (GHSA-4r6h-8v6p-xvw6 prototype pollution, GHSA-5pgg-2g8v-p4x9 ReDoS) — the
// npm registry has no patched release. exceljs is the actively maintained
// alternative with a clean audit and feature parity for our flat-tabular
// read/write needs (no formulas, no charts, no merged cells).
//
// This module exposes the minimum surface used by `export.ts`, `import.ts`,
// and the backend test suite, so a single import switch carries the migration.

import ExcelJS from "exceljs";

/**
 * Read the first worksheet of an xlsx buffer into an array of row objects keyed
 * by the header row labels. Mirrors `XLSX.utils.sheet_to_json(sheet)` semantics:
 *   - First non-empty row is the header
 *   - Each subsequent row produces one object; empty cells are omitted
 *   - Cell values are coerced to primitives (string/number/Date) — formulas
 *     return their cached result, hyperlinks return their text.
 */
export async function readSheetRows(buf: Buffer): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headerRow = ws.getRow(1);
  const headers: (string | null)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellToPrimitive(cell.value) as string | null;
  });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      if (key == null || key === "") return;
      const v = cellToPrimitive(cell.value);
      if (v === null || v === undefined || v === "") return;
      obj[String(key)] = v;
      hasAny = true;
    });
    if (hasAny) rows.push(obj);
  });
  return rows;
}

/**
 * Serialize an array of row objects to an xlsx buffer.
 *   - `headers` controls column order (and is always emitted as row 1)
 *   - Missing keys in a row → empty cell
 *   - Pass `sheetName` to override the default "Sheet1"
 */
export async function writeSheetBuffer(
  rows: Record<string, unknown>[],
  headers: string[],
  sheetName = "Sheet1"
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h] ?? ""));
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

// exceljs returns rich cell values (CellHyperlinkValue, CellRichTextValue,
// CellFormulaValue, …). Reduce to a primitive that matches the prior
// XLSX.utils.sheet_to_json output.
function cellToPrimitive(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  const o = v as Record<string, unknown>;
  if (typeof o.text === "string") return o.text; // hyperlink
  if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join("");
  if (o.formula !== undefined && "result" in o) return o.result;
  if (typeof o.toString === "function") return String(v);
  return v;
}
