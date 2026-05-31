import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("/health endpoint", () => {
  it("returns 200 with status ok + db connected", async () => {
    const { app } = await makeTestApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db.kind).toBe("sqlite");
    expect(res.body.db.connected).toBe(true);
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.uptimeMs).toBe("number");
    expect(typeof res.body.ts).toBe("string");
  });

  it("does not require auth", async () => {
    const { app } = await makeTestApp();
    // even with no Authorization header (and disregard of COMBAT_NO_AUTH), /health
    // is publicly mounted before authMiddleware — verify it answers 200.
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });
});
