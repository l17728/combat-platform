import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

async function createTicket(app: any) {
  const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "Welink 测试", 状态: "处理中" });
  expect(t.status).toBe(201);
  return t.body.id as string;
}

describe("welink messages e2e", () => {
  it("uploads (insert) + re-uploads (update) + lists with default exclude deleted", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);

    const r1 = await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "m1", sentAt: "2026-05-29T10:00:00Z", author: "张三", content: "你好" },
        { messageId: "m2", sentAt: "2026-05-29T10:01:00Z", author: "李四", content: "在吗" },
        { messageId: "m3", sentAt: "2026-05-29T10:02:00Z", author: "王五", content: "OOM 现象" },
      ],
    });
    expect(r1.status).toBe(200);
    expect(r1.body.inserted).toBe(3);
    expect(r1.body.updated).toBe(0);

    // 再上传:覆盖式 — m1 内容变化、m4 新增
    const r2 = await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "m1", sentAt: "2026-05-29T10:00:00Z", author: "张三", content: "你好(已修改)" },
        { messageId: "m4", sentAt: "2026-05-29T10:03:00Z", author: "赵六", content: "我来看" },
      ],
    });
    expect(r2.body.inserted).toBe(1);
    expect(r2.body.updated).toBe(1);

    const list = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    expect(list.status).toBe(200);
    expect(list.body.messages.length).toBe(4);
    expect(list.body.stats.total).toBe(4);
    expect(list.body.stats.selected).toBe(4);
    expect(list.body.stats.deleted).toBe(0);
    const m1 = list.body.messages.find((m: any) => m.messageId === "m1");
    expect(m1.content).toBe("你好(已修改)");
  });

  it("supports author / since / until / keyword filters", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "a1", sentAt: "2026-05-29T08:00:00Z", author: "张三", content: "早上好" },
        { messageId: "a2", sentAt: "2026-05-29T15:00:00Z", author: "张三", content: "OOM 问题排查" },
        { messageId: "a3", sentAt: "2026-05-29T15:30:00Z", author: "李四", content: "吃饭了吗" },
      ],
    });

    const byAuthor = await request(app).get(`/api/tickets/${tid}/welink-messages?author=张三`);
    expect(byAuthor.body.messages.length).toBe(2);

    const byTime = await request(app).get(`/api/tickets/${tid}/welink-messages?since=2026-05-29T12:00:00Z`);
    expect(byTime.body.messages.length).toBe(2);

    const byKeyword = await request(app).get(`/api/tickets/${tid}/welink-messages?keyword=OOM`);
    expect(byKeyword.body.messages.length).toBe(1);
    expect(byKeyword.body.messages[0].messageId).toBe("a2");
  });

  it("soft-deletes single + batch + excludes from default list but visible with includeDeleted", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    const up = await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "x1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "1" },
        { messageId: "x2", sentAt: "2026-05-29T10:01:00Z", author: "B", content: "2" },
        { messageId: "x3", sentAt: "2026-05-29T10:02:00Z", author: "C", content: "3" },
      ],
    });
    expect(up.status).toBe(200);

    const list1 = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    const ids = list1.body.messages.map((m: any) => m.id);
    expect(ids.length).toBe(3);

    // 单条软删(by messageId)
    const del1 = await request(app).delete(`/api/tickets/${tid}/welink-messages/x1`);
    expect(del1.status).toBe(200);
    expect(del1.body.deleted).toBe(1);

    const list2 = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    expect(list2.body.messages.length).toBe(2);
    expect(list2.body.stats.deleted).toBe(1);

    const listAll = await request(app).get(`/api/tickets/${tid}/welink-messages?includeDeleted=true`);
    expect(listAll.body.messages.length).toBe(3);

    // 批量软删(by id)
    const remainIds = list2.body.messages.map((m: any) => m.id);
    const delBatch = await request(app).post(`/api/tickets/${tid}/welink-messages/batch-delete`).send({ ids: remainIds });
    expect(delBatch.status).toBe(200);
    expect(delBatch.body.deleted).toBe(2);

    const list3 = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    expect(list3.body.messages.length).toBe(0);
    expect(list3.body.stats.total).toBe(0);
    expect(list3.body.stats.deleted).toBe(3);
  });

  it("clears ALL physically for a ticket", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "c1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "1" },
        { messageId: "c2", sentAt: "2026-05-29T10:01:00Z", author: "B", content: "2" },
      ],
    });
    const clear = await request(app).delete(`/api/tickets/${tid}/welink-messages`);
    expect(clear.status).toBe(200);
    expect(clear.body.deleted).toBe(2);

    const list = await request(app).get(`/api/tickets/${tid}/welink-messages?includeDeleted=true`);
    expect(list.body.messages.length).toBe(0);
  });

  it("toggles selection in batch", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "s1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "1" },
        { messageId: "s2", sentAt: "2026-05-29T10:01:00Z", author: "B", content: "2" },
        { messageId: "s3", sentAt: "2026-05-29T10:02:00Z", author: "C", content: "3" },
      ],
    });
    const list = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    const ids = list.body.messages.map((m: any) => m.id);

    const off = await request(app).patch(`/api/tickets/${tid}/welink-messages/selection`).send({ ids: [ids[0], ids[1]], selected: false });
    expect(off.status).toBe(200);
    expect(off.body.updated).toBe(2);
    expect(off.body.selected).toBe(false);

    const after = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    expect(after.body.stats.selected).toBe(1);
    const s1 = after.body.messages.find((m: any) => m.messageId === "s1");
    expect(s1.selected).toBe(false);

    const back = await request(app).patch(`/api/tickets/${tid}/welink-messages/selection`).send({ ids: [ids[0]], selected: true });
    expect(back.body.updated).toBe(1);
    const after2 = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    expect(after2.body.stats.selected).toBe(2);
  });

  it("analyze endpoint is a stub returning queued count = currently selected & not-deleted", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "z1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "1" },
        { messageId: "z2", sentAt: "2026-05-29T10:01:00Z", author: "B", content: "2" },
        { messageId: "z3", sentAt: "2026-05-29T10:02:00Z", author: "C", content: "3" },
      ],
    });
    const list = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    const ids = list.body.messages.map((m: any) => m.id);

    // 取消选中一条
    await request(app).patch(`/api/tickets/${tid}/welink-messages/selection`).send({ ids: [ids[0]], selected: false });

    const an = await request(app).post(`/api/tickets/${tid}/welink-messages/analyze`).send({});
    expect(an.status).toBe(200);
    expect(an.body.ok).toBe(true);
    expect(an.body.queued).toBe(2);
    expect(an.body.message).toMatch(/下一阶段/);
  });

  it("rejects invalid payloads", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    expect((await request(app).post(`/api/tickets/${tid}/welink-messages`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/tickets/${tid}/welink-messages/batch-delete`).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/tickets/${tid}/welink-messages/selection`).send({ ids: [] })).status).toBe(400);
    expect((await request(app).patch(`/api/tickets/${tid}/welink-messages/selection`).send({ ids: ["x"] })).status).toBe(400);
  });

  it("parses raw Welink format: msgId/sender/serverSendTime + TEXT_MSG/CARD_MSG/PICTURE_MSG", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    const r = await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        {
          msgId: "88984567318609400",
          contentType: "TEXT_MSG",
          sender: "l00865342",
          serverSendTime: 1779691346372,
          content: "陈挺,本周末之前能刷新完不",
        },
        {
          msgId: "88997913706762960",
          contentType: "CARD_MSG",
          sender: "p30007122",
          serverSendTime: 1779958274135,
          content: {
            cardType: 65,
            cardContext: {
              preMsg: { messageID: "abc", nameZH: "陈挺", sender: "c00493147", type: 0, content: "@蒲星武 黄色底纹的,先上" },
              replyMsg: { type: 0, content: "@所有人 已刷新,https://example.com/" },
            },
          },
        },
        {
          msgId: "89006566466688050",
          contentType: "PICTURE_MSG",
          sender: "c00493147",
          serverSendTime: 1780131329333,
          content: "[图片]",
          images: [{ filename: "x.png", url: "https://cdn/x.png", width: 1745, height: 615, size: 190839, md5: "abc" }],
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.inserted).toBe(3);

    const list = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    expect(list.status).toBe(200);
    const msgs = list.body.messages;
    expect(msgs.length).toBe(3);

    const text = msgs.find((m: any) => m.messageId === "88984567318609400");
    expect(text.contentType).toBe("TEXT_MSG");
    expect(text.content).toBe("陈挺,本周末之前能刷新完不");
    expect(text.author).toBe("l00865342");
    // epoch ms → ISO
    expect(text.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(text.contentJson).toBeNull();
    expect(text.images).toEqual([]);

    const card = msgs.find((m: any) => m.messageId === "88997913706762960");
    expect(card.contentType).toBe("CARD_MSG");
    expect(card.content).toBe("@所有人 已刷新,https://example.com/");
    expect(card.contentJson).toBeTruthy();
    expect(card.contentJson.cardContext.preMsg.content).toBe("@蒲星武 黄色底纹的,先上");

    const pic = msgs.find((m: any) => m.messageId === "89006566466688050");
    expect(pic.contentType).toBe("PICTURE_MSG");
    expect(pic.content).toBe("[图片]");
    expect(pic.images.length).toBe(1);
    expect(pic.images[0].url).toBe("https://cdn/x.png");
  });

  it("normalizes epoch seconds + string timestamps to ISO", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    const r = await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { msgId: "ts-ms", sender: "u1", serverSendTime: 1779691346372, content: "ms" },
        { msgId: "ts-sec", sender: "u2", serverSendTime: 1779691346, content: "sec" },
        { msgId: "ts-iso", sender: "u3", sentAt: "2026-05-29T10:00:00Z", content: "iso" },
      ],
    });
    expect(r.body.inserted).toBe(3);
    const list = await request(app).get(`/api/tickets/${tid}/welink-messages`);
    for (const m of list.body.messages) {
      expect(m.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  it("skips messages missing required fields silently (does not fail whole batch)", async () => {
    const { app } = makeTestApp();
    const tid = await createTicket(app);
    const r = await request(app).post(`/api/tickets/${tid}/welink-messages`).send({
      messages: [
        { messageId: "ok1", sentAt: "2026-05-29T10:00:00Z", author: "A", content: "1" },
        { sentAt: "2026-05-29T10:01:00Z", author: "B", content: "no id" },
        { messageId: "ok2", sentAt: "2026-05-29T10:02:00Z", author: "C" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.inserted).toBe(2);
    expect(r.body.total).toBe(3);
  });
});
