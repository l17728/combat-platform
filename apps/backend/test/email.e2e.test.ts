import { describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import type { MailSender } from "../src/mailer.js";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-email-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  const registry = new FileSchemaRegistry(CFG);
  const sent: { to: string[]; subject: string; body: string }[] = [];
  const fake: MailSender = {
    send: async (_cfg, msg) => { sent.push(msg); return { messageId: "fake-1" }; },
  };
  return { app: createApp({ repo, registry, mailSender: fake }), repo, sent };
}

const SMTP = { host: "smtp.x.com", port: 465, secure: true, username: "u", password: "secret", fromEmail: "ops@x.com", fromName: "作战" };

describe("§45 email e2e", () => {
  it("config PUT→GET masks password (passwordSet) and empty password preserves old", async () => {
    const { app } = await makeApp();
    const put = await request(app).put("/api/email/config").send(SMTP);
    expect(put.status).toBe(200);
    expect(put.body.passwordSet).toBe(true);
    expect(put.body.password).toBeUndefined();

    const get = await request(app).get("/api/email/config");
    expect(get.status).toBe(200);
    expect(get.body.password).toBeUndefined();
    expect(get.body.passwordSet).toBe(true);
    expect(get.body.host).toBe("smtp.x.com");
    expect(get.body.fromName).toBe("作战");

    // PUT without password keeps old → test send still works (config present)
    const put2 = await request(app).put("/api/email/config").send({ ...SMTP, password: "", fromName: "战" });
    expect(put2.body.passwordSet).toBe(true);
    expect(put2.body.fromName).toBe("战");
    const t = await request(app).post("/api/email/test").send({ to: "x@x.com" });
    expect(t.status).toBe(200);
    expect(t.body.ok).toBe(true);
    expect(t.body.recipients).toEqual(["x@x.com"]);
  });

  it("empty config GET returns empty shell with sane defaults", async () => {
    const { app } = await makeApp();
    const get = await request(app).get("/api/email/config");
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ host: "", port: 465, secure: true, username: "", fromEmail: "", passwordSet: false });
  });

  it("send resolves to[] + group expansion + person email, dedups, fake sender receives", async () => {
    const { app, sent } = await makeApp();
    await request(app).put("/api/email/config").send(SMTP);
    // emailGroup via generic nodes API (config-driven, §45.6 #5)
    const g = await request(app).post("/api/nodes/emailGroup").send({ 组名: "G", 成员邮箱: "a@x.com, b@x.com" });
    expect(g.status).toBe(201);
    const gl = await request(app).get("/api/nodes/emailGroup");
    expect(gl.body.some((n: any) => n.properties["组名"] === "G")).toBe(true);
    await request(app).post("/api/nodes/person").send({ 姓名: "张三", 工号: "E1", 邮箱: "c@x.com" });

    const send = await request(app).post("/api/email/send").send({
      to: ["d@x.com", "a@x.com"], groupNames: ["G"], personNames: ["张三"], subject: "S", body: "B",
    });
    expect(send.status).toBe(200);
    expect(send.body.ok).toBe(true);
    // a@x.com appears in both to and group → deduped
    expect([...send.body.recipients].sort()).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
    expect(sent).toHaveLength(1);
    expect([...sent[0].to].sort()).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
    expect(sent[0].subject).toBe("S");
  });

  it("person resolved by employeeId too, invalid emails filtered out", async () => {
    const { app } = await makeApp();
    await request(app).put("/api/email/config").send(SMTP);
    await request(app).post("/api/nodes/person").send({ 姓名: "李四", 工号: "E2", 邮箱: "li@x.com" });
    const send = await request(app).post("/api/email/send").send({
      to: ["bad-email", " ", "ok@x.com"], personNames: ["E2"], subject: "S", body: "B",
    });
    expect(send.status).toBe(200);
    expect([...send.body.recipients].sort()).toEqual(["li@x.com", "ok@x.com"]);
  });

  it("no SMTP configured → /send 400", async () => {
    const { app } = await makeApp();
    const send = await request(app).post("/api/email/send").send({ to: ["a@x.com"], subject: "S", body: "B" });
    expect(send.status).toBe(400);
  });

  it("no SMTP configured → /test 400", async () => {
    const { app } = await makeApp();
    const t = await request(app).post("/api/email/test").send({ to: "a@x.com" });
    expect(t.status).toBe(400);
  });

  it("configured but no valid recipients → /send 400", async () => {
    const { app, sent } = await makeApp();
    await request(app).put("/api/email/config").send(SMTP);
    const send = await request(app).post("/api/email/send").send({ to: ["nope", " "], subject: "S", body: "B" });
    expect(send.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("test send failure surfaces as ok:false in body with HTTP 200", async () => {
    const dir = mkdtempSync(join(tmpdir(), "combat-email-fail-"));
    const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
    const failing: MailSender = { send: async () => { throw new Error("connreset"); } };
    const app = createApp({ repo, registry: new FileSchemaRegistry(CFG), mailSender: failing });
    await request(app).put("/api/email/config").send(SMTP);
    const t = await request(app).post("/api/email/test").send({ to: "x@x.com" });
    expect(t.status).toBe(200);
    expect(t.body.ok).toBe(false);
    expect(t.body.error).toContain("connreset");
    expect(t.body.recipients).toEqual(["x@x.com"]);
  });
});
