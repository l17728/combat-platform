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
import { isEncrypted } from "../src/crypto.js";
import { migrateSmtpPasswordIfNeeded } from "../src/email.js";
import type { MailSender } from "../src/mailer.js";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-smtp-enc-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  const registry = new FileSchemaRegistry(CFG);
  const sent: { to: string[]; subject: string; body: string; cfgPassword: string }[] = [];
  const fake: MailSender = {
    send: async (cfg, msg) => {
      sent.push({ ...msg, cfgPassword: cfg.password });
      return { messageId: "fake" };
    },
  };
  return { app: createApp({ repo, registry, mailSender: fake }), repo, sent };
}

describe("SMTP 密码加密 (P1)", () => {
  it("PUT /email/config 落库的密码是密文 (enc:v1:)", async () => {
    const { app, repo } = await makeApp();
    await request(app)
      .put("/api/email/config")
      .send({ host: "h", port: 465, secure: true, username: "u", password: "topsecret", fromEmail: "f@x.com" });
    const raw = await repo.getSetting("smtp");
    expect(raw).toBeTruthy();
    const cfg = JSON.parse(raw!);
    expect(isEncrypted(cfg.password)).toBe(true);
    expect(cfg.password).not.toContain("topsecret");
  });

  it("test send 仍能拿到明文 password (透明解密)", async () => {
    const { app, sent } = await makeApp();
    await request(app)
      .put("/api/email/config")
      .send({ host: "h", port: 465, secure: true, username: "u", password: "topsecret", fromEmail: "f@x.com" });
    const r = await request(app).post("/api/email/test").send({ to: "x@x.com" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(sent[0].cfgPassword).toBe("topsecret");
  });

  it("migrateSmtpPasswordIfNeeded 把历史明文配置就地加密", async () => {
    const { repo } = await makeApp();
    // 模拟旧库:直接写入明文配置
    await repo.setSetting(
      "smtp",
      JSON.stringify({
        host: "h",
        port: 465,
        secure: true,
        username: "u",
        password: "legacy-plain",
        fromEmail: "f@x.com",
      }),
      "seed"
    );
    await migrateSmtpPasswordIfNeeded(repo);
    const raw = await repo.getSetting("smtp");
    const cfg = JSON.parse(raw!);
    expect(isEncrypted(cfg.password)).toBe(true);
    expect(cfg.password).not.toContain("legacy-plain");
  });

  it("迁移幂等:对已加密配置再调一次不出错也不重复加密", async () => {
    const { app, repo } = await makeApp();
    await request(app)
      .put("/api/email/config")
      .send({ host: "h", port: 465, secure: true, username: "u", password: "secret2", fromEmail: "f@x.com" });
    const before = await repo.getSetting("smtp");
    await migrateSmtpPasswordIfNeeded(repo);
    const after = await repo.getSetting("smtp");
    expect(after).toBe(before);
  });
});
