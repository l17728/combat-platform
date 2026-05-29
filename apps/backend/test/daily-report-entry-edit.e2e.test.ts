import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";

describe("daily-report-entry edit (草稿可改/已发布锁定)", () => {
  it("edits a draft entry, then locks it after publish", async () => {
    const { app } = makeTestApp();
    const t = await request(app).post("/api/nodes/attackTicket").send({ 标题: "日报编辑测试", 状态: "处理中" });
    const tid = t.body.id;

    const created = await request(app).post(`/api/nodes/${tid}/daily-reports`)
      .send({ type: "进展通报", currentProgress: "初始进展", nextSteps: "下一步A" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("草稿");
    const eid = created.body.id;

    // edit draft
    const edit = await request(app).put(`/api/nodes/${tid}/daily-reports/${eid}`)
      .send({ currentProgress: "更新后的进展", nextSteps: "下一步B" });
    expect(edit.status).toBe(200);
    expect(edit.body.currentProgress).toBe("更新后的进展");
    expect(edit.body.nextSteps).toBe("下一步B");

    // empty currentProgress rejected
    expect((await request(app).put(`/api/nodes/${tid}/daily-reports/${eid}`).send({ currentProgress: "  " })).status).toBe(400);

    // publish → then edit rejected
    const pub = await request(app).post(`/api/nodes/${tid}/daily-reports/${eid}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe("已发布");

    const afterPublish = await request(app).put(`/api/nodes/${tid}/daily-reports/${eid}`)
      .send({ currentProgress: "试图修改已发布" });
    expect(afterPublish.status).toBe(400);

    // content unchanged after the rejected edit
    const list = await request(app).get(`/api/nodes/${tid}/daily-reports`);
    expect(list.body.find((e: any) => e.id === eid).currentProgress).toBe("更新后的进展");
  });
});
