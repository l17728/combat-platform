import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { rebuildKG } from "../src/kg-rebuild.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");
function make() {
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-fix-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, registry: new FileSchemaRegistry(CFG) };
}
function xlsx(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("增量36 正确性修复", () => {
  it("M2: 可选 enum 字段空串不被误判非法（导入不丢有效行）", async () => {
    const { app, repo } = make();
    // 现网问题 风险等级 是可选 enum；空串应通过
    const r = await request(app).post("/api/import?type=incidentTracking")
      .attach("file", xlsx([{ 问题说明: "断连A", 风险等级: "" }]), "x.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
    expect(repo.queryNodes("incidentTracking")).toHaveLength(1);
  });

  it("M3: 导入无工号人员按姓名查重，不产生重复 person", async () => {
    const { app, repo } = make();
    const buf = xlsx([{ 标题: "A单", 状态: "进行中", 攻关申请人: "张三" }]);
    await request(app).post("/api/import").attach("file", buf, "x.xlsx");
    await request(app).post("/api/import").attach("file", xlsx([{ 标题: "B单", 状态: "进行中", 攻关申请人: "张三" }]), "x.xlsx");
    expect(repo.queryNodes("person").filter(p => p.properties["姓名"] === "张三")).toHaveLength(1);
  });

  it("H1: proposals:decide 接受 通过/已通过 两种动词", async () => {
    const { app, repo } = make();
    // 造两个近似 person（编辑距离 1）→ SAME_AS 提议（完全同名会被启发式跳过）
    await request(app).post("/api/nodes/person").send({ 姓名: "李雷", 工号: "E1" });
    await request(app).post("/api/nodes/person").send({ 姓名: "李蕾", 工号: "E2" });
    await request(app).post("/api/proposals/scan");
    const props = (await request(app).get("/api/proposals?status=待审批")).body;
    expect(props.length).toBeGreaterThanOrEqual(1);
    // 用"已通过"（旧 CLI 用法）应被接受
    const r = await request(app).post(`/api/proposals/${props[0].id}/decide`).send({ decision: "已通过", decidedBy: "leader" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("已通过");
    void repo;
  });

  it("H2: 合并去重不产生重复边，并重算冲突", async () => {
    const { app, repo } = make();
    // 两个同名 person，各被一个攻关单引用 → 合并后只剩去重边
    const a = (await request(app).post("/api/nodes/person").send({ 姓名: "王五", 工号: "W1" })).body;
    const b = (await request(app).post("/api/nodes/person").send({ 姓名: "王五B", 工号: "W2" })).body;
    await request(app).post("/api/nodes/attackTicket").send({ 标题: "单1", 状态: "进行中", 当前处理人: "王五" });
    await request(app).post("/api/merge/person").send({ fromId: a.id, toId: b.id });
    expect((await request(app).get(`/api/nodes/${a.id}`)).status).toBe(404);
    // b 收到迁移来的 REF 入边，且不重复
    const inRefs = repo.queryEdges({ targetId: b.id, edgeType: "REF" });
    const keys = inRefs.map(e => `${e.sourceId}|${e.properties["field"]}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("M5 护栏: 手工 RELATES_TO 关联线在 kg:rebuild 后存活", async () => {
    const { app, repo, registry } = make();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "保留单", 状态: "进行中" })).body;
    const e = (await request(app).post("/api/nodes/experience").send({ 经验: "保留经验" })).body;
    await request(app).post("/api/relations/manual").send({ sourceId: t.id, targetId: e.id, reason: "相关" });
    rebuildKG(repo, registry);
    expect(repo.queryEdges({ sourceId: t.id, edgeType: "RELATES_TO" })).toHaveLength(1);
  });

  it("M1: kg:rebuild 回收孤儿锚点节点", async () => {
    const { app, repo, registry } = make();
    const t = (await request(app).post("/api/nodes/attackTicket").send({ 标题: "锚点单", 状态: "进行中", 问题单号: "PB-ORPHAN" })).body;
    expect(repo.queryNodes("问题单号").length).toBe(1);
    // 删掉攻关单 → 锚点入边没了 → rebuild 应回收孤儿锚点
    await request(app).delete(`/api/nodes/${t.id}`);
    rebuildKG(repo, registry);
    expect(repo.queryNodes("问题单号").length).toBe(0);
  });
});
