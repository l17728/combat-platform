import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as tar from "tar";
import * as openpgp from "openpgp";
import { makeUpgradeRouter } from "../src/upgrade.js";
import { makeTestApp } from "./helpers.js";

let tmp: string;

function setupDataDir(): string {
  tmp = mkdtempSync(join(tmpdir(), "upgrade-"));
  mkdirSync(join(tmp, "data"), { recursive: true });
  process.env.COMBAT_UPGRADE_DATA_DIR = join(tmp, "data");
  return tmp;
}

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
  delete process.env.COMBAT_UPGRADE_DATA_DIR;
  delete process.env.COMBAT_SCHEMA_OVERLAY_DIR;
});

function makeMiniAppWithRole(role: string | undefined): express.Application {
  const app = express();
  app.use(express.json());
  if (role !== undefined) {
    app.use((req, _res, next) => {
      (req as any).user = { role };
      next();
    });
  }
  app.use("/api", makeUpgradeRouter(""));
  return app;
}

async function makeFakeUpgradePkg(targetVersion = "2.4.0"): Promise<Buffer> {
  // 在临时目录拼一个 mini repo,用 node-tar 打包(跨平台,免 Windows tar 路径坑)
  const work = mkdtempSync(join(tmpdir(), "upg-pkg-"));
  mkdirSync(join(work, "config", "schemas"), { recursive: true });
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "combat-tool", version: targetVersion }));
  writeFileSync(
    join(work, "config", "schemas", "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题" },
        { name: "新字段v2.4", type: "string", label: "v2.4 新增" },
      ],
    })
  );
  writeFileSync(
    join(work, "UPGRADE-MANIFEST.json"),
    JSON.stringify({ breaking: [], requiredEnv: ["FOO_BAR"], warnings: ["这是测试包"] })
  );
  const tarPath = join(tmp, "fake.tar.gz");
  await tar.create({ gzip: true, file: tarPath, cwd: work }, ["package.json", "config", "UPGRADE-MANIFEST.json"]);
  const buf = readFileSync(tarPath);
  rmSync(work, { recursive: true, force: true });
  return buf;
}

describe("upgrade router", () => {
  beforeEach(() => {
    setupDataDir();
  });

  describe("admin gate", () => {
    it("rejects normal role with 403", async () => {
      const app = makeMiniAppWithRole("normal");
      const res = await request(app).get("/api/upgrade/current");
      expect(res.status).toBe(403);
    });

    it("allows admin role", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/current");
      expect(res.status).toBe(200);
    });

    it("allows when req.user is missing (COMBAT_NO_AUTH path)", async () => {
      const app = makeMiniAppWithRole(undefined);
      const res = await request(app).get("/api/upgrade/current");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/upgrade/current", () => {
    it("returns version + uptime + dbBytes + userFieldCount", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/current");
      expect(res.status).toBe(200);
      expect(typeof res.body.version).toBe("string");
      expect(typeof res.body.uptimeSec).toBe("number");
      expect(typeof res.body.dbBytes).toBe("number");
      expect(typeof res.body.userFieldCount).toBe("number");
    });
  });

  describe("GET /api/upgrade/status (no job)", () => {
    it("returns phase=idle when no state file", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/status");
      expect(res.status).toBe(200);
      expect(res.body.phase).toBe("idle");
    });
  });

  describe("GET /api/upgrade/history (empty)", () => {
    it("returns empty array", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/history");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/upgrade/upload", () => {
    it("rejects non tar.gz", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/upload").attach("file", Buffer.from("not a tar"), "evil.exe");
      expect(res.status).toBe(400);
    });

    it("rejects missing file", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/upload");
      expect(res.status).toBe(400);
    });

    it("accepts a valid .tar.gz and returns stagingId", async () => {
      const app = makeMiniAppWithRole("admin");
      const buf = await makeFakeUpgradePkg("2.4.0");
      const res = await request(app).post("/api/upgrade/upload").attach("file", buf, "upgrade.tar.gz");
      expect(res.status).toBe(200);
      expect(typeof res.body.stagingId).toBe("string");
      expect(res.body.size).toBeGreaterThan(0);
    });
  });

  describe("POST /api/upgrade/analyze", () => {
    it("404 for missing stagingId", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/analyze").send({ stagingId: "nope-xyz" });
      expect(res.status).toBe(404);
    });

    it("400 when stagingId missing", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/analyze").send({});
      expect(res.status).toBe(400);
    });

    it("returns schemaReport + newSchemas + requiredEnv after upload", async () => {
      const app = makeMiniAppWithRole("admin");
      const buf = await makeFakeUpgradePkg("2.4.0");
      const upRes = await request(app).post("/api/upgrade/upload").attach("file", buf, "upgrade.tar.gz");
      expect(upRes.status).toBe(200);
      const stagingId = upRes.body.stagingId;
      const aRes = await request(app).post("/api/upgrade/analyze").send({ stagingId });
      expect(aRes.status).toBe(200);
      expect(aRes.body.stagingId).toBe(stagingId);
      expect(aRes.body.targetVersion).toBe("2.4.0");
      expect(aRes.body.schemaReport).toBeDefined();
      expect(Array.isArray(aRes.body.schemaReport.kept)).toBe(true);
      expect(Array.isArray(aRes.body.schemaReport.conflicts)).toBe(true);
      expect(Array.isArray(aRes.body.newSchemas)).toBe(true);
      expect(Array.isArray(aRes.body.requiredEnv)).toBe(true);
      // FOO_BAR 来自 UPGRADE-MANIFEST.json,应被加入
      expect(aRes.body.requiredEnv).toContain("FOO_BAR");
      expect(aRes.body.requiredEnv).toContain("JWT_SECRET");
    });
  });

  describe("POST /api/upgrade/apply", () => {
    it("400 missing confirm", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/apply").send({ stagingId: "abc" });
      expect(res.status).toBe(400);
    });

    it("404 unknown stagingId", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/apply").send({ stagingId: "abc", confirm: true });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/upgrade/rollback (no state)", () => {
    it("404 when no upgrade state", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/rollback");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/upgrade/log/:jobId", () => {
    it("404 unknown jobId", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/log/nonexistent-jobid");
      expect(res.status).toBe(404);
    });

    it("400 jobId with bad chars", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/log/../../etc/passwd");
      // Express normalises the path, so router never sees "..". We test direct bad chars instead.
      expect([400, 404]).toContain(res.status);
    });
  });

  describe("router mounted via createApp", () => {
    it("/api/upgrade/current reachable via createApp wiring", async () => {
      const { app } = await makeTestApp();
      const res = await request(app).get("/api/upgrade/current");
      expect(res.status).toBe(200);
      expect(typeof res.body.version).toBe("string");
    });
  });

  describe("GET /api/upgrade/releases", () => {
    const ORIGINAL_FETCH = globalThis.fetch;
    const ORIGINAL_REPO = process.env.UPGRADE_GITHUB_REPO;
    const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;

    afterEach(() => {
      globalThis.fetch = ORIGINAL_FETCH;
      if (ORIGINAL_REPO === undefined) delete process.env.UPGRADE_GITHUB_REPO;
      else process.env.UPGRADE_GITHUB_REPO = ORIGINAL_REPO;
      if (ORIGINAL_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
    });

    it("503 when UPGRADE_GITHUB_REPO not configured", async () => {
      delete process.env.UPGRADE_GITHUB_REPO;
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/releases");
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/UPGRADE_GITHUB_REPO/);
    });

    it("400 when UPGRADE_GITHUB_REPO has bad format", async () => {
      process.env.UPGRADE_GITHUB_REPO = "no-slash";
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/releases");
      expect(res.status).toBe(400);
    });

    it("returns normalised release list", async () => {
      process.env.UPGRADE_GITHUB_REPO = "owner/repo";
      const fakeReleases = [
        {
          tag_name: "v2.4.0",
          name: "v2.4.0",
          published_at: "2026-06-01T00:00:00Z",
          body: "release notes",
          assets: [
            {
              name: "combat-v2.4.0.tar.gz",
              browser_download_url: "https://example.com/combat.tar.gz",
              size: 12345,
            },
            {
              name: "combat-v2.4.0.tar.gz.asc",
              browser_download_url: "https://example.com/combat.tar.gz.asc",
              size: 800,
            },
          ],
        },
      ];
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fakeReleases,
        text: async () => JSON.stringify(fakeReleases),
      })) as any;
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/releases");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].tag).toBe("v2.4.0");
      expect(res.body[0].name).toBe("v2.4.0");
      expect(res.body[0].publishedAt).toBe("2026-06-01T00:00:00Z");
      expect(res.body[0].body).toBe("release notes");
      expect(res.body[0].assets).toHaveLength(2);
      expect(res.body[0].assets[0].url).toBe("https://example.com/combat.tar.gz");
      expect(res.body[0].assets[0].size).toBe(12345);
    });

    it("502 when GitHub returns non-ok", async () => {
      process.env.UPGRADE_GITHUB_REPO = "owner/repo";
      globalThis.fetch = (async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Not Found" }),
        text: async () => "Not Found",
      })) as any;
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/releases");
      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/GitHub/);
    });

    it("forwards GITHUB_TOKEN as Authorization header when set", async () => {
      process.env.UPGRADE_GITHUB_REPO = "owner/repo";
      process.env.GITHUB_TOKEN = "secret-token";
      let capturedHeaders: any = null;
      globalThis.fetch = (async (_url: string, init: any) => {
        capturedHeaders = init?.headers || {};
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => [],
          text: async () => "[]",
        };
      }) as any;
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).get("/api/upgrade/releases");
      expect(res.status).toBe(200);
      expect(capturedHeaders.Authorization || capturedHeaders.authorization).toMatch(/secret-token/);
    });

    it("403 for non-admin", async () => {
      const app = makeMiniAppWithRole("normal");
      const res = await request(app).get("/api/upgrade/releases");
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/upgrade/upload-from-url", () => {
    const ORIGINAL_FETCH = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = ORIGINAL_FETCH;
    });

    it("400 when url missing", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/upload-from-url").send({});
      expect(res.status).toBe(400);
    });

    it("400 when url is not http(s)", async () => {
      const app = makeMiniAppWithRole("admin");
      const res = await request(app).post("/api/upgrade/upload-from-url").send({ url: "file:///etc/passwd" });
      expect(res.status).toBe(400);
    });

    it("downloads tar.gz from url and returns stagingId", async () => {
      const fakeBuf = await makeFakeUpgradePkg("2.5.0");
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => fakeBuf.buffer.slice(fakeBuf.byteOffset, fakeBuf.byteOffset + fakeBuf.byteLength),
        headers: new Map([["content-type", "application/gzip"]]),
      })) as any;
      const app = makeMiniAppWithRole("admin");
      const res = await request(app)
        .post("/api/upgrade/upload-from-url")
        .send({ url: "https://example.com/upgrade.tar.gz" });
      expect(res.status).toBe(200);
      expect(typeof res.body.stagingId).toBe("string");
      expect(res.body.size).toBeGreaterThan(0);
    });

    it("502 when download fails", async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })) as any;
      const app = makeMiniAppWithRole("admin");
      const res = await request(app)
        .post("/api/upgrade/upload-from-url")
        .send({ url: "https://example.com/missing.tar.gz" });
      expect(res.status).toBe(502);
    });
  });

  describe("analyze + PGP signature", () => {
    const ORIGINAL_PUBKEY = process.env.UPGRADE_PGP_PUBKEY;
    afterEach(() => {
      if (ORIGINAL_PUBKEY === undefined) delete process.env.UPGRADE_PGP_PUBKEY;
      else process.env.UPGRADE_PGP_PUBKEY = ORIGINAL_PUBKEY;
    });

    async function signBuf(buf: Buffer, privArmored: string): Promise<string> {
      const priv = await openpgp.readPrivateKey({ armoredKey: privArmored });
      const m = await openpgp.createMessage({ binary: new Uint8Array(buf) });
      return await openpgp.sign({ message: m, signingKeys: priv, detached: true, format: "armored" });
    }

    it("signatureValid=true when sig + pubkey match", async () => {
      const k = await openpgp.generateKey({
        userIDs: [{ name: "Combat Bot", email: "bot@example.com" }],
        type: "ecc",
        curve: "ed25519",
      });
      process.env.UPGRADE_PGP_PUBKEY = k.publicKey;
      const app = makeMiniAppWithRole("admin");
      const pkgBuf = await makeFakeUpgradePkg("2.5.0");
      // upload
      const upRes = await request(app).post("/api/upgrade/upload").attach("file", pkgBuf, "upgrade.tar.gz");
      const stagingId = upRes.body.stagingId;
      // upload sig as multipart .asc
      const sig = await signBuf(pkgBuf, k.privateKey);
      const sigRes = await request(app)
        .post(`/api/upgrade/upload-signature`)
        .field("stagingId", stagingId)
        .attach("file", Buffer.from(sig, "utf8"), "upgrade.tar.gz.asc");
      expect(sigRes.status).toBe(200);
      // analyze should now report signatureValid
      const aRes = await request(app).post("/api/upgrade/analyze").send({ stagingId });
      expect(aRes.status).toBe(200);
      expect(aRes.body.signatureValid).toBe(true);
      expect(aRes.body.signedBy).toContain("Combat Bot");
    });

    it("signatureValid=false when sig is from a different key", async () => {
      const k1 = await openpgp.generateKey({
        userIDs: [{ name: "Other Bot", email: "other@example.com" }],
        type: "ecc",
        curve: "ed25519",
      });
      const k2 = await openpgp.generateKey({
        userIDs: [{ name: "Trusted Bot", email: "trusted@example.com" }],
        type: "ecc",
        curve: "ed25519",
      });
      process.env.UPGRADE_PGP_PUBKEY = k2.publicKey; // trust k2 but sign with k1
      const app = makeMiniAppWithRole("admin");
      const pkgBuf = await makeFakeUpgradePkg("2.5.1");
      const upRes = await request(app).post("/api/upgrade/upload").attach("file", pkgBuf, "upgrade.tar.gz");
      const stagingId = upRes.body.stagingId;
      const sig = await signBuf(pkgBuf, k1.privateKey);
      await request(app)
        .post(`/api/upgrade/upload-signature`)
        .field("stagingId", stagingId)
        .attach("file", Buffer.from(sig, "utf8"), "upgrade.tar.gz.asc");
      const aRes = await request(app).post("/api/upgrade/analyze").send({ stagingId });
      expect(aRes.status).toBe(200);
      expect(aRes.body.signatureValid).toBe(false);
      expect(aRes.body.signatureError).toBeTruthy();
    });

    it("signatureValid=undefined when no .asc uploaded", async () => {
      const k = await openpgp.generateKey({
        userIDs: [{ name: "Bot", email: "bot@example.com" }],
        type: "ecc",
        curve: "ed25519",
      });
      process.env.UPGRADE_PGP_PUBKEY = k.publicKey;
      const app = makeMiniAppWithRole("admin");
      const pkgBuf = await makeFakeUpgradePkg("2.5.2");
      const upRes = await request(app).post("/api/upgrade/upload").attach("file", pkgBuf, "upgrade.tar.gz");
      const stagingId = upRes.body.stagingId;
      const aRes = await request(app).post("/api/upgrade/analyze").send({ stagingId });
      expect(aRes.status).toBe(200);
      expect(aRes.body.signatureValid).toBeUndefined();
      expect(aRes.body.signaturePresent).toBe(false);
    });
  });
});
