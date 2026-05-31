import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { makeRealSchemaTestApp } from "./helpers.js";

function make() {
  const { app } = makeRealSchemaTestApp();
  return { app };
}

// P0-3 修复后:role 取自 JWT payload(不再信任 X-Role 头)。
// 测试用本地签发的 JWT(无 db 注入 → 不走 authMiddleware,但 gradeGate 仍会读 Authorization)。
const SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";
function bearer(role: string): string {
  return "Bearer " + jwt.sign({ userId: "test-" + role, username: "test-" + role, role }, SECRET, { expiresIn: "1h" });
}

describe("§50 轻量角色门禁 RBAC (JWT-based)", () => {
  it("JWT normal + 贡献等级 → 403", async () => {
    const { app } = make();
    const r = await request(app)
      .post("/api/nodes/contribution")
      .set("Authorization", bearer("normal"))
      .send({ 贡献人: "甲", 贡献类型: "发现", 贡献等级: "核心", 贡献描述: "x" });
    expect(r.status).toBe(403);
    expect(r.body.error).toContain("Leader");
  });

  it("JWT leader + 贡献等级 → 201", async () => {
    const { app } = make();
    const r = await request(app)
      .post("/api/nodes/contribution")
      .set("Authorization", bearer("leader"))
      .send({ 贡献人: "甲", 贡献类型: "发现", 贡献等级: "核心", 贡献描述: "x" });
    expect(r.status).toBe(201);
  });

  it("JWT normal 但不含贡献等级 → 201（仅等级受限）", async () => {
    const { app } = make();
    const r = await request(app)
      .post("/api/nodes/contribution")
      .set("Authorization", bearer("normal"))
      .send({ 贡献人: "乙", 贡献类型: "设计", 贡献描述: "无等级" });
    expect(r.status).toBe(201);
  });

  it("无 Authorization 头 + 贡献等级 → 201（系统可信,不破坏 CLI/导入/既有测试）", async () => {
    const { app } = make();
    const r = await request(app)
      .post("/api/nodes/contribution")
      .send({ 贡献人: "丙", 贡献类型: "实施", 贡献等级: "关键", 贡献描述: "系统写入" });
    expect(r.status).toBe(201);
  });

  it("PUT contribution JWT normal 改贡献等级 → 403", async () => {
    const { app } = make();
    const c = (
      await request(app).post("/api/nodes/contribution").send({ 贡献人: "丁", 贡献类型: "协调", 贡献描述: "d" })
    ).body;
    const r = await request(app)
      .put(`/api/nodes/${c.id}`)
      .set("Authorization", bearer("normal"))
      .send({ 贡献等级: "核心" });
    expect(r.status).toBe(403);
  });

  it("伪造 X-Role 头无效 — role 取自 JWT,X-Role 被忽略", async () => {
    const { app } = make();
    const r = await request(app)
      .post("/api/nodes/contribution")
      .set("Authorization", bearer("normal"))
      .set("X-Role", "admin") // 攻击者伪造的头
      .send({ 贡献人: "戊", 贡献类型: "发现", 贡献等级: "核心", 贡献描述: "x" });
    expect(r.status).toBe(403);
    expect(r.body.error).toContain("Leader");
  });
});
