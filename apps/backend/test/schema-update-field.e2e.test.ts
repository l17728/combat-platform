import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("PATCH /api/schema updateField (v2.6 schema-as-UI)", () => {
  it("sets group and order on an existing field", async () => {
    const { app } = await makeTestApp();
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "updateField", id: "标题", group: "基础信息", order: 1 });
    expect(r.status).toBe(200);
    const f = r.body.fields.find((x: any) => x.id === "标题");
    expect(f.group).toBe("基础信息");
    expect(f.order).toBe(1);
  });

  it("sets visible expression + validation + defaultValue", async () => {
    const { app } = await makeTestApp();
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({
        op: "updateField",
        id: "标题",
        visible: '状态 != "已关闭"',
        defaultValue: "默认标题",
        validation: { minLength: 2, maxLength: 100 },
      });
    expect(r.status).toBe(200);
    const f = r.body.fields.find((x: any) => x.id === "标题");
    expect(f.visible).toBe('状态 != "已关闭"');
    expect(f.defaultValue).toBe("默认标题");
    expect(f.validation).toEqual({ minLength: 2, maxLength: 100 });
  });

  it("null clears the attribute (group/order/visible)", async () => {
    const { app } = await makeTestApp();
    // first set
    await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "updateField", id: "标题", group: "A", order: 5, visible: "x" });
    // then clear
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "updateField", id: "标题", group: null, order: null, visible: null });
    expect(r.status).toBe(200);
    const f = r.body.fields.find((x: any) => x.id === "标题");
    expect(f.group).toBeUndefined();
    expect(f.order).toBeUndefined();
    expect(f.visible).toBeUndefined();
  });

  it("rejects unknown field id", async () => {
    const { app } = await makeTestApp();
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "updateField", id: "不存在的字段", group: "G" });
    expect(r.status).toBe(400);
  });

  it("rejects non-string group / non-number order", async () => {
    const { app } = await makeTestApp();
    const r1 = await request(app).patch("/api/schema/attackTicket").send({ op: "updateField", id: "标题", group: 123 });
    expect(r1.status).toBe(400);
    const r2 = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "updateField", id: "标题", order: "abc" });
    expect(r2.status).toBe(400);
  });

  it("addField accepts group and order", async () => {
    const { app } = await makeTestApp();
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({
        op: "addField",
        field: { name: "客户邮箱", type: "string", label: "客户邮箱", group: "联系方式", order: 2 },
      });
    expect(r.status).toBe(200);
    const f = r.body.fields.find((x: any) => x.id === "客户邮箱");
    expect(f.group).toBe("联系方式");
    expect(f.order).toBe(2);
  });

  it("audit log records SCHEMA_updateField action", async () => {
    const { app } = await makeTestApp();
    await request(app).patch("/api/schema/attackTicket").send({ op: "updateField", id: "标题", group: "审计组" });
    const audits = await request(app).get("/api/audit");
    const hit = (audits.body as any[]).find(
      (a) => a.action === "SCHEMA_updateField" && a.entityType === "schema" && a.entityId === "attackTicket"
    );
    expect(hit).toBeTruthy();
  });
});
