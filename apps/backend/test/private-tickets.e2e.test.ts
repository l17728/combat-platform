import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";

function bearer(username: string, role: string = "normal", displayName?: string): string {
  return (
    "Bearer " +
    jwt.sign({ userId: "u-" + username, username, role, displayName: displayName ?? username }, SECRET, {
      expiresIn: "1h",
    })
  );
}

// 关闭 NO_AUTH,让 authMiddleware 真正读 JWT → req.user。
function makePrivateApp() {
  delete process.env.COMBAT_NO_AUTH;
  const dir = mkdtempSync(join(tmpdir(), "combat-private-"));
  const cfg = join(dir, "schemas");
  mkdirSync(cfg);
  writeFileSync(
    join(cfg, "attackTicket.json"),
    JSON.stringify({
      nodeType: "attackTicket",
      label: "攻关单",
      identityKeys: ["攻关单号"],
      derivedToKG: true,
      fields: [
        { name: "标题", type: "string", label: "标题", required: true },
        { name: "状态", type: "enum", label: "状态", enumValues: ["待响应", "处理中", "已解决"] },
        { name: "私密", type: "enum", label: "私密", enumValues: ["是", "否"] },
        { name: "创建人", type: "string", label: "创建人" },
      ],
    })
  );
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);
  const registry = new FileSchemaRegistry(cfg);
  const app = createApp({ repo, registry, adapter, db, dbPath });
  return { app, repo };
}

describe("私密 ticket 全集过滤 (P1)", () => {
  let app: ReturnType<typeof makePrivateApp>["app"];
  let repo: ReturnType<typeof makePrivateApp>["repo"];
  const savedNoAuth = process.env.COMBAT_NO_AUTH;
  afterAll(() => {
    if (savedNoAuth !== undefined) process.env.COMBAT_NO_AUTH = savedNoAuth;
  });

  beforeAll(async () => {
    const made = makePrivateApp();
    app = made.app;
    repo = made.repo;
    // alice 自己的私密单
    await repo.createNode("attackTicket", { 标题: "alice私密", 状态: "进行中", 私密: "是", 创建人: "alice" }, "seed");
    // bob 的私密单
    await repo.createNode("attackTicket", { 标题: "bob私密", 状态: "进行中", 私密: "是", 创建人: "bob" }, "seed");
    // 公开单
    await repo.createNode("attackTicket", { 标题: "公开单", 状态: "进行中", 私密: "否", 创建人: "bob" }, "seed");
  });

  it("list: alice 看不到 bob 的私密单,看得到自己的 + 公开单", async () => {
    const r = await request(app).get("/api/nodes/attackTicket").set("Authorization", bearer("alice"));
    expect(r.status).toBe(200);
    const titles = (r.body as Array<{ properties: { 标题: string } }>).map((t) => t.properties.标题).sort();
    expect(titles).toContain("alice私密");
    expect(titles).toContain("公开单");
    expect(titles).not.toContain("bob私密");
  });

  it("export: bob 的私密单不出现在 alice 的导出里", async () => {
    const r = await request(app)
      .get("/api/export/attackTicket")
      .set("Authorization", bearer("alice"))
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const body = (r.body as Buffer).toString("binary");
    // xlsx 是 zip,无法用 includes 直接验文本;改读回 sheet
    const XLSX = await import("xlsx");
    const wb = XLSX.read(r.body, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]]);
    const titles = rows.map((x) => x["标题"]);
    expect(titles).toContain("alice私密");
    expect(titles).toContain("公开单");
    expect(titles).not.toContain("bob私密");
    expect(body).toBeDefined(); // silence unused
  });

  it("dashboard: alice 统计的 total 不包含 bob 的私密单", async () => {
    const r = await request(app).get("/api/dashboard").set("Authorization", bearer("alice"));
    expect(r.status).toBe(200);
    // alice 看到 2 条 (自己的私密 + 公开),bob 私密被屏蔽
    expect(r.body.tickets.total).toBe(2);
  });

  it("bob 是创建人 → 自己看得到自己的私密单", async () => {
    const r = await request(app).get("/api/nodes/attackTicket").set("Authorization", bearer("bob"));
    expect(r.status).toBe(200);
    const titles = (r.body as Array<{ properties: { 标题: string } }>).map((t) => t.properties.标题).sort();
    expect(titles).toContain("bob私密");
    expect(titles).toContain("公开单");
    expect(titles).not.toContain("alice私密");
  });
});
