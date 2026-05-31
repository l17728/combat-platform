import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-alias-"));
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
        { name: "当前处理人", type: "string", label: "当前处理人", aliases: ["研发责任人", "owner"] },
      ],
    })
  );
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(cfg) }), repo, cfg };
}
function xlsxBuf(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("alias e2e", () => {
  it("import: a divergent column name matched via alias lands in the canonical field", async () => {
    const { app, repo } = await makeApp();
    const buf = xlsxBuf([{ 标题: "断连", 研发责任人: "张三" }]);
    const r = await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
    const t = (await repo.queryNodes("attackTicket"))[0];
    expect(t.properties["当前处理人"]).toBe("张三");
  });
  it("setAliases persists to config json + reload; then import uses the new alias", async () => {
    const { app, repo, cfg } = await makeApp();
    const p = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "setAliases", id: "当前处理人", aliases: ["处理人", "PIC"] });
    expect(p.status).toBe(200);
    expect(p.body.fields.find((f: any) => f.id === "当前处理人").aliases).toEqual(["处理人", "PIC"]);
    const onDisk = JSON.parse(readFileSync(join(cfg, "attackTicket.json"), "utf8"));
    expect(onDisk.fields.find((f: any) => f.id === "当前处理人").aliases).toEqual(["处理人", "PIC"]);
    const buf = xlsxBuf([{ 标题: "T2", PIC: "李四" }]);
    await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    const t = (await repo.queryNodes("attackTicket")).find((n) => n.properties["标题"] === "T2");
    expect(t!.properties["当前处理人"]).toBe("李四");
  });
  it("setAliases on unknown field id -> 400 and config unchanged", async () => {
    const { app, cfg } = await makeApp();
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "setAliases", id: "不存在", aliases: ["x"] });
    expect(r.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);
  });
  it("setAliases with empty array clears aliases; missing aliases -> 400 + config unchanged", async () => {
    const { app, cfg } = await makeApp();
    const clr = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "setAliases", id: "当前处理人", aliases: [] });
    expect(clr.status).toBe(200);
    expect(clr.body.fields.find((f: any) => f.id === "当前处理人").aliases).toEqual([]);
    const onDisk = JSON.parse(readFileSync(join(cfg, "attackTicket.json"), "utf8"));
    expect(onDisk.fields.find((f: any) => f.id === "当前处理人").aliases).toEqual([]);
    const before = readFileSync(join(cfg, "attackTicket.json"), "utf8");
    const bad = await request(app).patch("/api/schema/attackTicket").send({ op: "setAliases", id: "标题" });
    expect(bad.status).toBe(400);
    expect(readFileSync(join(cfg, "attackTicket.json"), "utf8")).toBe(before);
  });
});
