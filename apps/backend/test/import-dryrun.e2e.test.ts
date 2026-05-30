import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Use the real config (has 攻关单号 identity field) so update-detection is exercisable.
const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
async function makeTestApp() {
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-imp-dry-")), "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}
function xlsxBuffer(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("§42 import dry-run + skipped visibility e2e", () => {
  it("dryRun=1 plans create/skip without writing to db", async () => {
    const { app, repo } = await makeTestApp();
    const buf = xlsxBuffer([
      { 标题: "有效新单", 状态: "进行中" },
      { 状态: "进行中" }, // 缺必填 标题 → skip
    ]);
    const r = await request(app).post("/api/import?dryRun=1").attach("file", buf, "s.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.willCreate).toBe(1);
    expect(r.body.skipped).toBe(1);
    const skipRow = r.body.rows.find((x: any) => x.action === "skip");
    expect(skipRow.reason).toContain("标题");
    // NOT written
    expect(await repo.queryNodes("attackTicket")).toHaveLength(0);
  });

  it("dryRun detects update on identity hit", async () => {
    const { app } = await makeTestApp();
    // seed one with identity 攻关单号
    await request(app).post("/api/import").attach("file",
      xlsxBuffer([{ 攻关单号: "GK-1", 标题: "原单", 状态: "进行中" }]), "s.xlsx");
    const r = await request(app).post("/api/import?dryRun=1").attach("file",
      xlsxBuffer([{ 攻关单号: "GK-1", 标题: "改单", 状态: "已解决" }]), "s.xlsx");
    expect(r.body.willUpdate).toBe(1);
    expect(r.body.willCreate).toBe(0);
  });

  it("commit returns skipped + skippedRows; created rows are persisted", async () => {
    const { app, repo } = await makeTestApp();
    const buf = xlsxBuffer([
      { 标题: "提交有效单", 状态: "进行中" },
      { 状态: "进行中" }, // skip
    ]);
    const r = await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
    expect(r.body.skipped).toBe(1);
    expect(Array.isArray(r.body.skippedRows)).toBe(true);
    expect(r.body.skippedRows[0].reason).toContain("标题");
    expect(await repo.queryNodes("attackTicket")).toHaveLength(1);
  });
});
