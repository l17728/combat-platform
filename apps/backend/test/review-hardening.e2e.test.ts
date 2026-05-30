import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { localToday } from "../src/date-util.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function make() {
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-hard-")), "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}
function xlsxBuf(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("增量40 review 加固（缺陷修复 + 边界）", () => {
  describe("import 守卫（崩溃→明确 400）", () => {
    it("缺 file 字段 → 400 而非崩溃", async () => {
      const { app } = make();
      const r = await request(app).post("/api/import?type=attackTicket");
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain("file");
    });
    it("空 sheet（无数据行）→ 正常返回 created:0，不崩溃", async () => {
      const { app } = make();
      const r = await request(app).post("/api/import?type=attackTicket")
        .attach("file", xlsxBuf([]), "empty.xlsx");
      // 空行表是合法的（0 行），应 200 且不创建
      expect(r.status).toBe(200);
      expect(r.body.created).toBe(0);
    });
  });

  describe("查询参数归一（多值参数取首值）", () => {
    it("?状态=进行中&状态=已解决 不再因数组而漏匹配", async () => {
      const { app } = make();
      await request(app).post("/api/nodes/attackTicket").send({ 标题: "A", 状态: "进行中" });
      const r = await request(app).get("/api/nodes/attackTicket?%E7%8A%B6%E6%80%81=%E8%BF%9B%E8%A1%8C%E4%B8%AD&%E7%8A%B6%E6%80%81=%E5%B7%B2%E8%A7%A3%E5%86%B3");
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBe(1); // 取首值"进行中" → 命中
    });
  });

  describe("自定义命令：参数值含空格不被拆散", () => {
    it("带空格的主题作为单个参数透传到 email:send body", async () => {
      const { app } = make();
      const c = (await request(app).post("/api/commands").send({
        name: "发周报", template: "email:send --persons {人} --subject {主题} --body {正文}" })).body;
      const r = await request(app).post(`/api/commands/${c.id}/run`).send({
        args: { 人: "张三", 主题: "本周 攻关 进展 周报", 正文: "正文内容" } });
      expect(r.status).toBe(200);
      expect(r.body.request.body.subject).toBe("本周 攻关 进展 周报");
      expect(r.body.request.body.personNames).toEqual(["张三"]);
    });
  });

  describe("oncall 当前值班（本地日历日）", () => {
    it("起=止=本地今天 → 命中；明天起 → 不命中", async () => {
      const { app } = make();
      const today = localToday();
      const tomorrow = new Date(Date.now() + 86400000);
      const tmr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
      await request(app).post("/api/nodes/oncall").send({ domain: "D1", 值班人: "今值", 起: today, 止: today });
      await request(app).post("/api/nodes/oncall").send({ domain: "D1", 值班人: "明值", 起: tmr, 止: tmr });
      const row = (await request(app).get("/api/oncall/current?domain=D1")).body.find((x: any) => x.domain === "D1");
      expect(row.值班人).toContain("今值");
      expect(row.值班人).not.toContain("明值");
    });
  });

  describe("daily-report publish 审计随次数累加", () => {
    it("两次发布 → 该单 2 条 DAILY_REPORT_PUBLISH 审计", async () => {
      const { app, repo } = make();
      const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "审计单", 状态: "进行中" })).body;
      await request(app).post(`/api/nodes/${t.id}/progress`).send({ content: "进展", statusSnapshot: "进行中" });
      await request(app).post(`/api/daily-report/publish`);
      await request(app).post(`/api/daily-report/publish`);
      expect((await repo.listAuditLog({ action: "DAILY_REPORT_PUBLISH", entityId: t.id })).length).toBe(2);
    });
  });

  describe("email 校验", () => {
    it("test 缺/非法 to → 400", async () => {
      const { app } = make();
      await request(app).put("/api/email/config").send({ host: "h", port: 1, username: "u", password: "p", fromEmail: "a@x.com" });
      expect((await request(app).post("/api/email/test").send({})).status).toBe(400);
      expect((await request(app).post("/api/email/test").send({ to: "not-an-email" })).status).toBe(400);
    });
  });
});

// 从「实际使用者使用场景」出发的端到端用例
describe("用户场景（end-to-end 视角）", () => {
  it("场景：管理员封装『查某状态攻关单』命令 → 运行 → 实际查到单", async () => {
    const { app } = make();
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "断连攻关", 状态: "进行中" });
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "已结束单", 状态: "已关闭" });
    // 1) 管理员保存命令
    const c = (await request(app).post("/api/commands").send({
      name: "查在办", template: "nodes:list attackTicket --状态 {状态}" })).body;
    // 2) 终端用户运行填参 → 得到底层 request
    const run = await request(app).post(`/api/commands/${c.id}/run`).send({ args: { 状态: "进行中" } });
    expect(run.status).toBe(200);
    // 3) 按 resolved request 实际执行（模拟前端 runRaw）
    const exec = await request(app).get(run.body.request.path);
    expect(exec.status).toBe(200);
    expect(exec.body.length).toBe(1);
    expect(exec.body[0].properties["标题"]).toBe("断连攻关");
  });

  it("场景：运维提交导入但忘了附文件 → 明确 400 提示，重新正确导入成功", async () => {
    const { app, repo } = make();
    const bad = await request(app).post("/api/import?type=attackTicket"); // 未 attach
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("file");
    // 重新带上文件正常导入
    const ok = await request(app).post("/api/import?type=attackTicket")
      .attach("file", xlsxBuf([{ 标题: "正常单", 状态: "进行中" }]), "good.xlsx");
    expect(ok.status).toBe(200);
    expect(ok.body.created).toBe(1);
    expect((await repo.queryNodes("attackTicket")).length).toBe(1);
  });
});
