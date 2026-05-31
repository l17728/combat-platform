import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

async function createTicket(app: any, props: Record<string, unknown> = {}) {
  const t = await request(app)
    .post("/api/nodes/attackTicket")
    .send({ 标题: "Welink 抽取测试", 状态: "处理中", ...props });
  expect(t.status).toBe(201);
  return t.body.id as string;
}

async function uploadMessages(app: any, ticketId: string, list: any[]) {
  const r = await request(app).post(`/api/tickets/${ticketId}/welink-messages`).send({ messages: list });
  expect(r.status).toBe(200);
}

describe("welink extraction e2e", () => {
  it("heuristic: 落 5 类中的 entity + event + gap;成员已登记时不会被列为 gap", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app, {
      成员列表: JSON.stringify([{ 姓名: "陈某", 角色: "组长" }]),
      攻关组长: "陈某",
      攻关成员: "陈某",
    });
    await uploadMessages(app, tid, [
      { messageId: "m1", sentAt: "2026-05-29T10:00:00Z", author: "陈某", content: "开始" },
      { messageId: "m2", sentAt: "2026-05-29T10:01:00Z", author: "李某", content: "我看日志" },
      { messageId: "m3", sentAt: "2026-05-29T10:02:00Z", author: "王某", content: "复现下" },
    ]);
    const an = await request(app).post(`/api/tickets/${tid}/welink-messages/analyze`).send({});
    expect(an.status).toBe(200);
    expect(an.body.source).toBe("heuristic");
    const exts = an.body.extractions as any[];
    const gapNames = exts.filter((e) => e.kind === "gap").map((e) => e.payload?.name);
    expect(gapNames).toContain("李某");
    expect(gapNames).toContain("王某");
    expect(gapNames).not.toContain("陈某"); // 已登记
    const entityNames = exts.filter((e) => e.kind === "entity").map((e) => e.label);
    expect(entityNames).toEqual(expect.arrayContaining(["陈某", "李某", "王某"]));
    const eventLabels = exts.filter((e) => e.kind === "event").map((e) => e.label);
    expect(eventLabels).toEqual(expect.arrayContaining(["首次发言", "最后发言"]));
  });

  it("GET list/PATCH reviewed/DELETE 一条 — full CRUD over welink_extractions", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    await uploadMessages(app, tid, [{ messageId: "n1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "1" }]);
    const an = await request(app).post(`/api/tickets/${tid}/welink-messages/analyze`).send({});
    const id = (an.body.extractions as any[])[0].id;

    const list1 = await request(app).get(`/api/tickets/${tid}/welink-extractions`);
    expect(list1.status).toBe(200);
    expect(list1.body.items.length).toBeGreaterThan(0);

    const patch = await request(app).patch(`/api/tickets/${tid}/welink-extractions/${id}`).send({ reviewed: true });
    expect(patch.status).toBe(200);
    expect(patch.body.reviewed).toBe(true);

    const filtered = await request(app).get(`/api/tickets/${tid}/welink-extractions?reviewed=true`);
    expect(filtered.body.items.length).toBe(1);
    expect(filtered.body.items[0].id).toBe(id);

    const del = await request(app).delete(`/api/tickets/${tid}/welink-extractions/${id}`);
    expect(del.status).toBe(200);

    const list2 = await request(app).get(`/api/tickets/${tid}/welink-extractions?reviewed=true`);
    expect(list2.body.items.length).toBe(0);
  });

  it("analyze 无消息时返回 queued=0/extracted=0", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    const an = await request(app).post(`/api/tickets/${tid}/welink-messages/analyze`).send({});
    expect(an.status).toBe(200);
    expect(an.body.queued).toBe(0);
    expect(an.body.extracted).toBe(0);
    expect(an.body.extractions).toEqual([]);
  });

  it("PATCH 不存在 404 / DELETE 不存在 404", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    expect(
      (await request(app).patch(`/api/tickets/${tid}/welink-extractions/nope`).send({ reviewed: true })).status
    ).toBe(404);
    expect((await request(app).delete(`/api/tickets/${tid}/welink-extractions/nope`)).status).toBe(404);
  });

  it("过滤 kind=gap 只返回 gap 类", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    await uploadMessages(app, tid, [
      { messageId: "g1", sentAt: "2026-05-29T10:00:00Z", author: "新人A", content: "1" },
      { messageId: "g2", sentAt: "2026-05-29T10:01:00Z", author: "新人B", content: "2" },
    ]);
    await request(app).post(`/api/tickets/${tid}/welink-messages/analyze`).send({});
    const r = await request(app).get(`/api/tickets/${tid}/welink-extractions?kind=gap`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const it of r.body.items) expect(it.kind).toBe("gap");
  });
});
