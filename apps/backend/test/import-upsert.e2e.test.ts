import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function makeApp() {
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-imp-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}
function xlsxBuf(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("incremental import (upsert) e2e", () => {
  it("first import creates; same identityKey re-import updates (no duplicates); 攻关单号 idem", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([
      { 标题: "T1", 攻关单号: "HK-1", 状态: "进行中" },
      { 标题: "T2", 攻关单号: "HK-2", 状态: "进行中" },
    ]);
    const r1 = await request(app).post("/api/import").attach("file", buf, "x.xlsx");
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ created: 2, updated: 0 });
    expect(await repo.queryNodes("attackTicket")).toHaveLength(2);
    const buf2 = xlsxBuf([
      { 标题: "T1-改", 攻关单号: "HK-1", 状态: "已解决" },
      { 标题: "T2", 攻关单号: "HK-2", 状态: "进行中" },
    ]);
    const r2 = await request(app).post("/api/import").attach("file", buf2, "x.xlsx");
    expect(r2.body).toMatchObject({ created: 0, updated: 2 });
    expect(await repo.queryNodes("attackTicket")).toHaveLength(2);
    const t1 = (await repo.queryNodes("attackTicket", { 攻关单号: "HK-1" }))[0];
    expect(t1.properties["标题"]).toBe("T1-改");
    expect(t1.properties["状态"]).toBe("已解决");
  });

  it("mixed: some rows new, some matching → created+updated counted separately", async () => {
    const { app } = makeApp();
    await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "A", 攻关单号: "MX-1", 状态: "进行中" }]), "x.xlsx");
    const r = await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "A2", 攻关单号: "MX-1", 状态: "进行中" }, { 标题: "B", 攻关单号: "MX-2", 状态: "进行中" }]), "x.xlsx");
    expect(r.body).toMatchObject({ created: 1, updated: 1 });
  });

  it("?type=releasePackage upserts by 版本号; ?type=weightFile by 名称 (config-driven, new nodeTypes)", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([{ 版本号: "v9", 产品: "A" }, { 版本号: "v10", 产品: "B" }]);
    const r1 = await request(app).post("/api/import?type=releasePackage").attach("file", buf, "r.xlsx");
    expect(r1.body).toMatchObject({ created: 2, updated: 0 });
    const r2 = await request(app).post("/api/import?type=releasePackage").attach("file",
      xlsxBuf([{ 版本号: "v9", 产品: "A改" }]), "r.xlsx");
    expect(r2.body).toMatchObject({ created: 0, updated: 1 });
    expect((await repo.queryNodes("releasePackage", { 版本号: "v9" }))[0].properties["产品"]).toBe("A改");
    const wf = await request(app).post("/api/import?type=weightFile").attach("file",
      xlsxBuf([{ 名称: "W1", 模型: "BERT" }]), "w.xlsx");
    expect(wf.body).toMatchObject({ created: 1, updated: 0 });
  });

  it("unknown ?type= → 400", async () => {
    const { app } = makeApp();
    const r = await request(app).post("/api/import?type=__none__").attach("file",
      xlsxBuf([{ x: 1 }]), "x.xlsx");
    expect(r.status).toBe(400);
  });

  it("validateNode-failing rows are skipped (no count, no node)", async () => {
    const { app, repo } = makeApp();
    const buf = xlsxBuf([
      { 标题: "ok", 攻关单号: "VL-1", 状态: "进行中" }, // valid
      { 攻关单号: "VL-2" }, // missing required 标题 AND 状态 → skipped
    ]);
    const r = await request(app).post("/api/import").attach("file", buf, "x.xlsx");
    expect(r.body).toMatchObject({ created: 1, updated: 0 });
    expect(await repo.queryNodes("attackTicket")).toHaveLength(1);
  });

  it("UPDATE re-fires syncRefEdges (changing 当前处理人 re-creates REF) + syncAnchorEdges (问题单号 changing reassigns anchor)", async () => {
    const { app, repo } = makeApp();
    await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "T", 攻关单号: "RA-1", 状态: "进行中", 当前处理人: "甲", 问题单号: "PB-A" }]), "x.xlsx");
    const t = (await repo.queryNodes("attackTicket", { 攻关单号: "RA-1" }))[0];
    expect((await repo.queryEdges({ sourceId: t.id, edgeType: "REF" })).find(e => String(e.properties["field"]) === "当前处理人")).toBeTruthy();
    expect((await repo.queryEdges({ sourceId: t.id, edgeType: "ANCHORED_TO" }))[0].targetId).toBeTruthy();
    await request(app).post("/api/import").attach("file",
      xlsxBuf([{ 标题: "T", 攻关单号: "RA-1", 状态: "已解决", 当前处理人: "乙", 问题单号: "PB-B" }]), "x.xlsx");
    const refs = (await repo.queryEdges({ sourceId: t.id, edgeType: "REF" })).filter(e => String(e.properties["field"]) === "当前处理人");
    expect(refs).toHaveLength(1);
    const newPerson = await repo.getNode(refs[0].targetId)!;
    expect(newPerson.properties["姓名"]).toBe("乙");
    const anchors = await repo.queryEdges({ sourceId: t.id, edgeType: "ANCHORED_TO" });
    expect(anchors).toHaveLength(1);
    expect((await repo.getNode(anchors[0].targetId))!.properties["key"]).toBe("PB-B");
  });

  it("attackTicket ASSIGNED_TO 攻关申请人 edge is idempotent across re-imports (exactly 1 per node)", async () => {
    const { app, repo } = makeApp();
    const row = { 标题: "AT", 攻关单号: "AS-1", 状态: "进行中", 攻关申请人: "申请甲", 攻关申请人工号: "E001" };
    await request(app).post("/api/import").attach("file", xlsxBuf([row]), "x.xlsx");
    await request(app).post("/api/import").attach("file", xlsxBuf([row]), "x.xlsx");
    const t = (await repo.queryNodes("attackTicket", { 攻关单号: "AS-1" }))[0];
    expect(await repo.queryEdges({ sourceId: t.id, edgeType: "ASSIGNED_TO" })).toHaveLength(1);
  });
});
