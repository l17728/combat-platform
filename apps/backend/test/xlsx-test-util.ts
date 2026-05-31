// Test-side wrapper around the production xlsx-util — keeps the migration off
// xlsx → exceljs invisible to most tests. Tests historically used a tiny
// `xlsxBuffer(rows)` helper that round-tripped through XLSX.utils; this file
// preserves that ergonomic surface using exceljs underneath.

import { readSheetRows, writeSheetBuffer } from "../src/xlsx-util.js";

/**
 * Serialize an array of row objects to an xlsx Buffer using all keys present
 * in the union of rows as headers (in first-seen order). Drop-in replacement
 * for the historical `XLSX.utils.json_to_sheet → XLSX.write({ type:"buffer" })`
 * idiom used across e2e fixtures.
 */
export async function xlsxBuffer(rows: Record<string, unknown>[], sheetName = "Sheet1"): Promise<Buffer> {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  return writeSheetBuffer(rows, headers, sheetName);
}

/** Parse an xlsx Buffer back into objects keyed by the header row. */
export async function readXlsxRows(buf: Buffer): Promise<Record<string, unknown>[]> {
  return readSheetRows(buf);
}
