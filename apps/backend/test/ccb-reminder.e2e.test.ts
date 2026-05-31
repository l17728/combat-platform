import { describe, it, expect } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "combat-ccb-"));
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo };
}

describe("CCB reminder e2e (李嘉②)", () => {
  it("是否需CCB=是 + status open + handler → emits 'CCB 提醒'", async () => {
    const { app } = await makeApp();
    const t = (
      await request(app).post("/api/nodes/attackTicket").send({
        标题: "CCB攻关单",
        状态: "进行中",
        当前处理人: "甲",
        是否需CCB: "是",
      })
    ).body;
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders?status=待发送")).body;
    const ccb = list.find((r: any) => r.kind === "CCB 提醒" && r.ticketId === t.id);
    expect(ccb).toBeTruthy();
    expect(ccb.recipientName).toBe("甲");
    expect(ccb.body).toContain("CCB 评审");
  });

  it("是否需CCB=否 → NOT emitted", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "非CCB单",
      状态: "进行中",
      当前处理人: "乙",
      是否需CCB: "否",
    });
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders")).body;
    expect(list.filter((r: any) => r.kind === "CCB 提醒")).toHaveLength(0);
  });

  it("是否需CCB unset → NOT emitted", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "未设CCB单",
      状态: "进行中",
      当前处理人: "丙",
    });
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders")).body;
    expect(list.filter((r: any) => r.kind === "CCB 提醒")).toHaveLength(0);
  });

  it("是否需CCB=是 but status 已解决 → NOT emitted", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "已闭CCB单",
      状态: "已解决",
      当前处理人: "丁",
      是否需CCB: "是",
    });
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders")).body;
    expect(list.filter((r: any) => r.kind === "CCB 提醒")).toHaveLength(0);
  });

  it("是否需CCB=是 without handler → NOT emitted (rule needs recipient)", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "无人CCB单",
      状态: "进行中",
      是否需CCB: "是",
    });
    await request(app).post("/api/reminders/scan").send({});
    const list = (await request(app).get("/api/reminders")).body;
    expect(list.filter((r: any) => r.kind === "CCB 提醒")).toHaveLength(0);
  });

  it("scan is idempotent: re-scan within 7d does not duplicate the CCB reminder", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/nodes/attackTicket").send({
      标题: "幂等CCB单",
      状态: "进行中",
      当前处理人: "戊",
      是否需CCB: "是",
    });
    const s1 = await request(app).post("/api/reminders/scan").send({});
    expect(s1.body.created).toBeGreaterThanOrEqual(1);
    const s2 = await request(app).post("/api/reminders/scan").send({});
    expect(s2.body.created).toBe(0);
    const list = (await request(app).get("/api/reminders?status=待发送")).body.filter(
      (r: any) => r.kind === "CCB 提醒"
    );
    expect(list).toHaveLength(1);
  });
});
