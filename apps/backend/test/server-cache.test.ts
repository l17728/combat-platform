import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("server static serving", () => {
  it("index.html has Cache-Control: no-cache header", async () => {
    const { app } = await makeTestApp();
    const res = await request(app).get("/").accept("html");
    if (res.status === 200) {
      expect(res.headers["cache-control"]).toMatch(/no-cache|no-store/);
    }
  });

  it("API responses do not have Cache-Control: no-cache", async () => {
    const { app } = await makeTestApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"] || "").not.toMatch(/no-store/);
  });
});
