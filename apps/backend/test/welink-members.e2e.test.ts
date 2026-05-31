import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

async function createTicket(app: any, props: Record<string, unknown> = {}) {
  const t = await request(app)
    .post("/api/nodes/attackTicket")
    .send({ 标题: "Welink 成员补齐测试", 状态: "处理中", ...props });
  expect(t.status).toBe(201);
  return t.body.id as string;
}

async function uploadMessages(app: any, ticketId: string, list: any[]) {
  const r = await request(app).post(`/api/tickets/${ticketId}/welink-messages`).send({ messages: list });
  expect(r.status).toBe(200);
}

async function createPerson(app: any, name: string, empNo?: string) {
  // test helper 的 person schema 用英文 name / employeeId
  const props: Record<string, unknown> = { name };
  if (empNo) props.employeeId = empNo;
  const r = await request(app).post("/api/nodes/person").send(props);
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe("welink agent-friendly endpoints (search/timeline/gap/add-members/set-role)", () => {
  it("GET welink/search 关键词搜索消息", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    await uploadMessages(app, tid, [
      { messageId: "s1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "OOM 现象明显" },
      { messageId: "s2", sentAt: "2026-05-29T10:01:00Z", author: "B", content: "我看 GC 日志" },
      { messageId: "s3", sentAt: "2026-05-29T10:02:00Z", author: "A", content: "复现成功" },
    ]);
    const r = await request(app).get(`/api/tickets/${tid}/welink/search?q=OOM`);
    expect(r.status).toBe(200);
    expect(r.body.matches.length).toBe(1);
    expect(r.body.matches[0].messageId).toBe("s1");
    const empty = await request(app).get(`/api/tickets/${tid}/welink/search?q=`);
    expect(empty.body.matches).toEqual([]);
  });

  it("GET welink/timeline 返回按时间升序的精简消息", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    await uploadMessages(app, tid, [
      { messageId: "t2", sentAt: "2026-05-29T10:01:00Z", author: "B", content: "二" },
      { messageId: "t1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "一" },
      { messageId: "t3", sentAt: "2026-05-29T10:02:00Z", author: "C", content: "三" },
    ]);
    const r = await request(app).get(`/api/tickets/${tid}/welink/timeline`);
    expect(r.status).toBe(200);
    expect(r.body.timeline.length).toBe(3);
    expect(r.body.timeline.map((m: any) => m.messageId)).toEqual(["t1", "t2", "t3"]);
  });

  it("GET welink/gap-analysis 区分已登记 vs 未登记发言人;通过 person 工号反查到姓名", async () => {
    const { app } = await makeTestApp();
    await createPerson(app, "陈某", "c00493147");
    await createPerson(app, "李某", "l00865342");
    const tid = await createTicket(app, {
      成员列表: JSON.stringify([{ 姓名: "陈某", 角色: "组长" }]),
      攻关组长: "陈某",
      攻关成员: "陈某",
    });
    await uploadMessages(app, tid, [
      { messageId: "g1", sentAt: "2026-05-29T10:00:00Z", author: "c00493147", content: "1" },
      { messageId: "g2", sentAt: "2026-05-29T10:01:00Z", author: "l00865342", content: "2" },
      { messageId: "g3", sentAt: "2026-05-29T10:02:00Z", author: "未知工号999", content: "3" },
    ]);
    const r = await request(app).get(`/api/tickets/${tid}/welink/gap-analysis`);
    expect(r.status).toBe(200);
    expect(r.body.ticketMembers.length).toBe(1);
    expect(r.body.ticketMembers[0].姓名).toBe("陈某");
    const gapNames = r.body.gap.map((g: any) => g.name);
    expect(gapNames).toContain("李某"); // 反查到姓名
    expect(gapNames).toContain("未知工号999"); // 反查不到 fallback
    expect(gapNames).not.toContain("陈某"); // 已登记
  });

  it("POST welink/add-members 批量加成员,默认组员;syncMemberFields 同步三方", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app, {
      成员列表: JSON.stringify([{ 姓名: "陈某", 角色: "组长" }]),
      攻关组长: "陈某",
      攻关成员: "陈某",
    });
    const r = await request(app)
      .post(`/api/tickets/${tid}/welink/add-members`)
      .send({ names: ["李某", "王某", "陈某"] });
    expect(r.status).toBe(200);
    expect(r.body.added).toBe(2); // 陈某去重
    expect(r.body.members.length).toBe(3);
    const get = await request(app).get(`/api/nodes/${tid}`);
    expect(get.body.properties["攻关成员"]).toBe("陈某,李某,王某");
    expect(get.body.properties["攻关组长"]).toBe("陈某");
    const parsed = JSON.parse(get.body.properties["成员列表"]);
    expect(parsed.length).toBe(3);
  });

  it("POST welink/add-members role=组长 加新组长", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    const r = await request(app)
      .post(`/api/tickets/${tid}/welink/add-members`)
      .send({ names: ["李某"], role: "组长" });
    expect(r.status).toBe(200);
    expect(r.body.members[0].角色).toBe("组长");
  });

  it("POST welink/set-member-role 改单人角色", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app, {
      成员列表: JSON.stringify([{ 姓名: "陈某", 角色: "组员" }]),
    });
    const r = await request(app)
      .post(`/api/tickets/${tid}/welink/set-member-role`)
      .send({ name: "陈某", role: "组长" });
    expect(r.status).toBe(200);
    expect(r.body.members[0].角色).toBe("组长");
    const get = await request(app).get(`/api/nodes/${tid}`);
    expect(get.body.properties["攻关组长"]).toBe("陈某");
  });

  it("invalid payloads → 400/404", async () => {
    const { app } = await makeTestApp();
    const tid = await createTicket(app);
    expect((await request(app).post(`/api/tickets/${tid}/welink/add-members`).send({ names: [] })).status).toBe(400);
    expect((await request(app).post(`/api/tickets/${tid}/welink/set-member-role`).send({ name: "x" })).status).toBe(
      400
    );
    expect(
      (await request(app).post(`/api/tickets/${tid}/welink/set-member-role`).send({ name: "无此人", role: "组员" }))
        .status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/tickets/nonexistent/welink/add-members`)
          .send({ names: ["a"] })
      ).status
    ).toBe(404);
  });
});
