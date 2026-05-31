import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { makeTestApp } from "./helpers.js";

function xlsxBuffer(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("灵活 Excel 导入(未知列自动建字段)", () => {
  it("dryRun 预览报告未匹配的新列", async () => {
    const { app } = await makeTestApp();
    const buf = xlsxBuffer([{ 标题: "灵活预览单", 状态: "待响应", 定位措施: "重启网关", 影响范围: "3租户" }]);
    const res = await request(app).post("/api/import?type=attackTicket&dryRun=1").attach("file", buf, "t.xlsx");
    expect(res.status).toBe(200);
    expect(res.body.newColumns).toEqual(expect.arrayContaining(["定位措施", "影响范围"]));
    // 已知列不应出现在 newColumns
    expect(res.body.newColumns).not.toContain("标题");
    expect(res.body.newColumns).not.toContain("状态");
  });

  it("createFields=1:未知列自动建为字段,数据落库", async () => {
    const { app } = await makeTestApp();
    const buf = xlsxBuffer([{ 标题: "灵活导入单", 状态: "待响应", 定位措施: "已重启网关" }]);
    const res = await request(app).post("/api/import?type=attackTicket&createFields=1").attach("file", buf, "t.xlsx");
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    // schema 新增了「定位措施」字段(string)
    const schema = await request(app).get("/api/schema/attackTicket");
    const f = schema.body.fields.find((x: any) => x.name === "定位措施");
    expect(f).toBeTruthy();
    expect(f.type).toBe("string");

    // 节点属性包含新列的值
    const search = await request(app).get("/api/query/search?q=灵活导入单");
    const id = search.body[0].id;
    const node = await request(app).get(`/api/nodes/${id}`);
    expect(node.body.properties["定位措施"]).toBe("已重启网关");
    expect(node.body.properties["标题"]).toBe("灵活导入单");
  });

  it("不带 createFields:未知列被忽略,schema 不变(仅导入匹配列)", async () => {
    const { app } = await makeTestApp();
    const before = await request(app).get("/api/schema/attackTicket");
    const beforeCount = before.body.fields.length;

    const buf = xlsxBuffer([{ 标题: "仅匹配单", 状态: "处理中", 神秘列: "应被忽略" }]);
    const res = await request(app).post("/api/import?type=attackTicket").attach("file", buf, "t.xlsx");
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const after = await request(app).get("/api/schema/attackTicket");
    expect(after.body.fields.length).toBe(beforeCount);
    expect(after.body.fields.some((x: any) => x.name === "神秘列")).toBe(false);

    const search = await request(app).get("/api/query/search?q=仅匹配单");
    const node = await request(app).get(`/api/nodes/${search.body[0].id}`);
    expect(node.body.properties["标题"]).toBe("仅匹配单");
    expect(node.body.properties["神秘列"]).toBeUndefined();
  });
});
