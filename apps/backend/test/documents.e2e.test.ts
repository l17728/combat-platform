import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestApp } from "./helpers.js";

describe("documents e2e", () => {
  let app: ReturnType<typeof makeTestApp>["app"];
  beforeAll(async () => {
    process.env.COMBAT_UPLOAD_DIR = mkdtempSync(join(tmpdir(), "combat-uploads-"));
    app = makeTestApp().app;
  });

  it("uploads a file, lists it, downloads its content", async () => {
    const up = await request(app).post("/api/documents")
      .field("name", "测试文档")
      .attach("file", Buffer.from("HELLO-DOC-CONTENT"), "test.txt");
    expect(up.status).toBe(201);
    expect(up.body.type).toBe("file");
    expect(up.body.name).toBe("测试文档");
    expect(up.body.originalName).toBe("test.txt");
    expect(up.body.size).toBeGreaterThan(0);

    const list = await request(app).get("/api/documents");
    expect(list.status).toBe(200);
    expect(list.body.some((d: any) => d.id === up.body.id)).toBe(true);

    const dl = await request(app).get(`/api/documents/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain("HELLO-DOC-CONTENT");
  });

  it("rejects upload without a file", async () => {
    const r = await request(app).post("/api/documents").field("name", "无文件");
    expect(r.status).toBe(400);
  });

  it("adds an external-link document; download redirects to the url", async () => {
    const r = await request(app).post("/api/documents/link").send({ name: "百度", url: "https://baidu.com" });
    expect(r.status).toBe(201);
    expect(r.body.type).toBe("link");
    expect(r.body.url).toBe("https://baidu.com");

    const dl = await request(app).get(`/api/documents/${r.body.id}/download`).redirects(0);
    expect(dl.status).toBe(302);
    expect(dl.headers.location).toBe("https://baidu.com");
  });

  it("rejects link without name/url", async () => {
    expect((await request(app).post("/api/documents/link").send({ name: "缺url" })).status).toBe(400);
    expect((await request(app).post("/api/documents/link").send({ url: "https://x.com" })).status).toBe(400);
  });

  it("deletes a document", async () => {
    const up = await request(app).post("/api/documents").attach("file", Buffer.from("d"), "d.txt");
    expect((await request(app).delete(`/api/documents/${up.body.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/documents/${up.body.id}/download`)).status).toBe(404);
  });
});
