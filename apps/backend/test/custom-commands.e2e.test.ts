import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function make() {
  const repo = new SqliteRepository(
    new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-cc-")), "t.sqlite")))
  );
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("增量39 自定义命令（§54）", () => {
  it("创建抽取参数 + 列表", async () => {
    const { app } = make();
    const c = await request(app).post("/api/commands").send({
      name: "查进行中攻关单",
      description: "按状态过滤",
      template: "nodes:list attackTicket --状态 {状态}",
    });
    expect(c.status).toBe(201);
    expect(c.body.params).toEqual(["状态"]);
    expect(c.body.id).toBeTruthy();
    const list = (await request(app).get("/api/commands")).body;
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("查进行中攻关单");
  });

  it("参数去重保序；多参数模板", async () => {
    const { app } = make();
    const c = (
      await request(app).post("/api/commands").send({
        name: "发邮件",
        template: "email:send --persons {收件人} --subject {主题} --body {内容}",
      })
    ).body;
    expect(c.params).toEqual(["收件人", "主题", "内容"]);
  });

  it("校验：缺 name/template → 400；首 token 非已知命令 → 400", async () => {
    const { app } = make();
    expect((await request(app).post("/api/commands").send({ template: "nodes:list x" })).status).toBe(400);
    expect((await request(app).post("/api/commands").send({ name: "n" })).status).toBe(400);
    expect((await request(app).post("/api/commands").send({ name: "n", template: "bogus:cmd --x 1" })).status).toBe(
      400
    );
  });

  it("run 解析为正确的 request；缺参 → 400", async () => {
    const { app } = make();
    const c = (
      await request(app).post("/api/commands").send({
        name: "查单",
        template: "nodes:list attackTicket --状态 {状态}",
      })
    ).body;
    const miss = await request(app).post(`/api/commands/${c.id}/run`).send({ args: {} });
    expect(miss.status).toBe(400);
    const r = await request(app)
      .post(`/api/commands/${c.id}/run`)
      .send({ args: { 状态: "进行中" } });
    expect(r.status).toBe(200);
    expect(r.body.resolved).toBe("nodes:list attackTicket --状态 进行中");
    expect(r.body.request.method).toBe("GET");
    expect(r.body.request.path).toBe("/api/nodes/attackTicket?%E7%8A%B6%E6%80%81=%E8%BF%9B%E8%A1%8C%E4%B8%AD");
  });

  it("run 解析 POST body 类命令（email:send）", async () => {
    const { app } = make();
    const c = (
      await request(app).post("/api/commands").send({
        name: "发邮件",
        template: "email:send --persons {人} --subject {标题} --body {正文}",
      })
    ).body;
    const r = await request(app)
      .post(`/api/commands/${c.id}/run`)
      .send({ args: { 人: "张三", 标题: "S", 正文: "B" } });
    expect(r.status).toBe(200);
    expect(r.body.request.method).toBe("POST");
    expect(r.body.request.path).toBe("/api/email/send");
    expect(r.body.request.body).toMatchObject({ personNames: ["张三"], subject: "S", body: "B" });
  });

  it("删除 200/404", async () => {
    const { app } = make();
    const c = (await request(app).post("/api/commands").send({ name: "x", template: "dashboard" })).body;
    expect((await request(app).delete(`/api/commands/${c.id}`)).status).toBe(200);
    expect((await request(app).get("/api/commands")).body.length).toBe(0);
    expect((await request(app).delete(`/api/commands/nope`)).status).toBe(404);
  });
});
