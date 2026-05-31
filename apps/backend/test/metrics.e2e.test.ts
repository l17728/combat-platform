import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("/api/metrics endpoint (v2.2 P1 §7 — Prometheus)", () => {
  it("returns 200 + Prometheus text/plain format", async () => {
    const { app } = await makeTestApp();
    const r = await request(app).get("/api/metrics");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
    expect(r.text).toContain("combat_http_requests_total");
  });

  it("does not require auth", async () => {
    const { app } = await makeTestApp();
    const r = await request(app).get("/api/metrics");
    expect(r.status).toBe(200);
  });

  it("emits histogram + counter after a request goes through", async () => {
    const { app } = await makeTestApp();
    // 触发一次请求
    await request(app).get("/api/health");
    const r = await request(app).get("/api/metrics");
    expect(r.text).toMatch(/combat_http_request_duration_ms_count/);
    expect(r.text).toMatch(/combat_http_requests_total/);
  });

  it("includes default Node.js process metrics", async () => {
    const { app } = await makeTestApp();
    const r = await request(app).get("/api/metrics");
    // prom-client 默认指标 — process_cpu_user_seconds_total, nodejs_eventloop_lag
    expect(r.text).toMatch(/combat_process_cpu/);
    expect(r.text).toMatch(/combat_nodejs/);
  });
});
