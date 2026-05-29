import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import type { MailSender } from "../src/mailer.js";

function makeApp(mailSender?: MailSender) {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-help-"));
  const cfgDir = join(dir, "schemas");
  mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "enum", label: "状态", required: true, enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
    ],
  }));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const repo = new SqliteRepository(db);
  const registry = new FileSchemaRegistry(cfgDir);
  const app = createApp({ repo, registry, db, dbPath, mailSender });
  return { app, repo };
}

async function makeTicket(app: any) {
  const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "求助测试单", 状态: "处理中" });
  return t.body.id;
}

describe("help-request e2e", () => {
  it("feedback link points at the frontend form route, not the JSON API", async () => {
    const { app } = makeApp();
    const ticketId = await makeTicket(app);
    const r = await request(app).post("/api/help-requests").send({
      ticketId, requesterName: "罗军", targetEmail: "expert@x.com", category: "领域专家", question: "请协助分析",
    });
    expect(r.status).toBe(201);
    expect(r.body.feedbackLink).toMatch(/\/help\/feedback\/[\w-]+$/);
    expect(r.body.feedbackLink).not.toContain("/api/help/feedback/");
  });

  it("reports emailSent=false with a note when SMTP is not configured", async () => {
    const { app } = makeApp();
    const ticketId = await makeTicket(app);
    const r = await request(app).post("/api/help-requests").send({
      ticketId, requesterName: "罗军", targetEmail: "expert@x.com", category: "领域专家", question: "请协助",
    });
    expect(r.status).toBe(201);
    expect(r.body.emailSent).toBe(false);
    expect(r.body.emailNote).toBeTruthy();
  });

  it("reports emailSent=true and emails the frontend link when SMTP is configured", async () => {
    const sent: { msg: { to: string[]; subject: string; body: string } }[] = [];
    const fakeMail: MailSender = { async send(_cfg, msg) { sent.push({ msg }); return { messageId: "test" }; } };
    const { app, repo } = makeApp(fakeMail);
    repo.setSetting("smtp", JSON.stringify({ host: "smtp.test", port: 587, secure: false, username: "u", password: "p", fromEmail: "a@b.com" }), "test");
    const ticketId = await makeTicket(app);
    const r = await request(app).post("/api/help-requests").send({
      ticketId, requesterName: "罗军", targetEmail: "expert@x.com", category: "领域专家", question: "请协助",
    });
    expect(r.status).toBe(201);
    expect(r.body.emailSent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.body).toContain("/help/feedback/");
    expect(sent[0].msg.body).not.toContain("/api/help/feedback/");
  });

  it("feedback form GET returns question info; POST appends reply and sets status 已回复", async () => {
    const { app } = makeApp();
    const ticketId = await makeTicket(app);
    const created = await request(app).post("/api/help-requests").send({
      ticketId, requesterName: "罗军", targetName: "专家A", targetEmail: "expert@x.com", category: "领域专家", question: "我是谁",
    });
    const token = created.body.feedbackToken;

    const info = await request(app).get(`/api/help/feedback/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.question).toBe("我是谁");
    expect(info.body.status).toBe("待回复");

    const fb = await request(app).post(`/api/help/feedback/${token}`).send({ feedback: "建议检查网络抓包", name: "专家A" });
    expect(fb.status).toBe(200);
    expect(fb.body.status).toBe("已回复");
    expect(fb.body.feedback).toBe("建议检查网络抓包");

    // second submit rejected
    const again = await request(app).post(`/api/help/feedback/${token}`).send({ feedback: "再次" });
    expect(again.status).toBe(400);
  });
});
