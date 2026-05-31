import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { makeTestApp } from "./helpers.js";

function xlsxBuffer(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("import e2e", () => {
  it("BE-8 imports tickets and resolves same Person once", async () => {
    const { app, repo } = await makeTestApp();
    const buf = xlsxBuffer([
      { 标题: "断连A", 状态: "进行中", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
      { 标题: "断连B", 状态: "进行中", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
    ]);
    const r = await request(app).post("/api/import").attach("file", buf, "s.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(2);
    expect(await repo.queryNodes("attackTicket")).toHaveLength(2);
    expect(await repo.queryNodes("person")).toHaveLength(1); // entity resolution
    const edges = await repo.queryEdges({ edgeType: "ASSIGNED_TO" });
    expect(edges).toHaveLength(2);
    const personId = (await repo.queryNodes("person"))[0].id;
    expect(edges.every((e) => e.targetId === personId)).toBe(true);
  });
});
