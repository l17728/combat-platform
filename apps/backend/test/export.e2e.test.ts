import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-export-"));
  const cfg = join(dir, "schemas");
  mkdirSync(cfg);
  writeFileSync(
    join(cfg, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        { name: "状态", type: "enum", label: "状态", enumValues: ["进行中", "已解决"] },
        { name: "退休字段", type: "string", label: "退休字段", retired: true },
      ],
    })
  );
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo };
}

describe("export e2e", () => {
  it("GET /api/export/:nodeType returns an xlsx attachment of all rows, label headers, id values, no retired", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "单A", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "单B", 状态: "已解决" });
    const r = await request(app)
      .get("/api/export/attackTicket")
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="attackTicket-.*\.xlsx"/);
    const wb = XLSX.read(r.body, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x["标题"]).sort()).toEqual(["单A", "单B"]);
    expect(rows[0]).toHaveProperty("状态");
    expect(rows.some((x) => "退休字段" in x)).toBe(false);
  });
  it("unknown nodeType -> 404", async () => {
    const { app } = await makeApp();
    const r = await request(app).get("/api/export/nope");
    expect(r.status).toBe(404);
    expect(r.body.error).toBeTruthy();
  });
  it("empty table -> 200 with a valid header-only xlsx", async () => {
    const { app } = await makeApp();
    const r = await request(app)
      .get("/api/export/attackTicket")
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const wb = XLSX.read(r.body, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(XLSX.utils.sheet_to_json(ws)).toHaveLength(0);
    expect(ws["A1"]?.v).toBe("标题"); // header row present (active field labels), zero data rows
  });
});
