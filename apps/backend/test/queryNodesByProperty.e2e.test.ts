import { describe, it, expect } from "vitest";
import { makeTestApp } from "./helpers.js";

describe("Repository.queryNodesByProperty (v2.2 P1 §1 — SQL pushdown)", () => {
  it("returns same result as queryNodes(nt, {key: v}) for single equality", async () => {
    const { repo } = await makeTestApp();
    await repo.createNode("attackTicket", { 标题: "A", 状态: "进行中" }, "test");
    await repo.createNode("attackTicket", { 标题: "B", 状态: "已解决" }, "test");
    await repo.createNode("attackTicket", { 标题: "C", 状态: "进行中" }, "test");

    const viaPushdown = await repo.queryNodesByProperty("attackTicket", "状态", "进行中");
    const viaAppFilter = await repo.queryNodes("attackTicket", { 状态: "进行中" });

    expect(viaPushdown.length).toBe(2);
    expect(viaPushdown.length).toBe(viaAppFilter.length);
    const titlesA = viaPushdown.map((n) => n.properties["标题"]).sort();
    const titlesB = viaAppFilter.map((n) => n.properties["标题"]).sort();
    expect(titlesA).toEqual(titlesB);
  });

  it("returns empty list when no match", async () => {
    const { repo } = await makeTestApp();
    await repo.createNode("attackTicket", { 标题: "X", 状态: "进行中" }, "test");
    const out = await repo.queryNodesByProperty("attackTicket", "状态", "不存在");
    expect(out).toEqual([]);
  });

  it("filters by nodeType (does not leak across types)", async () => {
    const { repo } = await makeTestApp();
    await repo.createNode("attackTicket", { 标题: "A", 状态: "进行中" }, "test");
    await repo.createNode("person", { 姓名: "Alice", 状态: "进行中" }, "test");
    const out = await repo.queryNodesByProperty("attackTicket", "状态", "进行中");
    expect(out.length).toBe(1);
    expect(out[0].properties["标题"]).toBe("A");
  });

  it("rejects invalid key (防 path 注入)", async () => {
    const { repo } = await makeTestApp();
    await expect(repo.queryNodesByProperty("attackTicket", "'); DROP TABLE", "x")).rejects.toThrow(/invalid key/);
  });

  it("supports Chinese key names", async () => {
    const { repo } = await makeTestApp();
    await repo.createNode("person", { 姓名: "Alice", 邮箱: "a@x.com" }, "test");
    await repo.createNode("person", { 姓名: "Bob", 邮箱: "b@x.com" }, "test");
    const out = await repo.queryNodesByProperty("person", "邮箱", "a@x.com");
    expect(out.length).toBe(1);
    expect(out[0].properties["姓名"]).toBe("Alice");
  });
});
