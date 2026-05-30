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
  const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-fc-")), "t.sqlite")));
  return { app: createApp({ repo, registry: new FileSchemaRegistry(CFG) }), repo, registry: new FileSchemaRegistry(CFG) };
}
function xlsx(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("增量37 字段补全 + 人员 ref 化（§53）", () => {
  it("53.1 attackTicket 资源ID/租户ID 落库；导入 故障局点 命中 局点 alias", async () => {
    const { app, repo } = make();
    const t = (await request(app).post("/api/nodes/attackTicket")
      .send({ 标题: "断连单", 状态: "进行中", 资源ID: "RES-1", 租户ID: "TEN-9" })).body;
    const got = (await request(app).get(`/api/nodes/${t.id}`)).body;
    expect(got.properties["资源ID"]).toBe("RES-1");
    expect(got.properties["租户ID"]).toBe("TEN-9");
    // 导入用 alias 列名 故障局点 → 归一到 局点
    const r = await request(app).post("/api/import?type=attackTicket")
      .attach("file", xlsx([{ 标题: "导入单", 状态: "进行中", 故障局点: "华东二" }]), "x.xlsx");
    expect(r.status).toBe(200);
    const imported = (await repo.queryNodes("attackTicket")).find(n => n.properties["标题"] === "导入单")!;
    expect(imported.properties["局点"]).toBe("华东二");
  });

  it("53.1 issue400 邮件 + person 角色 落库", async () => {
    const { app, repo } = make();
    await request(app).post("/api/nodes/issue400").send({ 客户: "客A", 邮件: "a@x.com" });
    expect((await repo.queryNodes("issue400"))[0].properties["邮件"]).toBe("a@x.com");
    const p = (await request(app).post("/api/nodes/person").send({ 姓名: "组长甲", 角色: "攻关组长" })).body;
    expect((await request(app).get(`/api/nodes/${p.id}`)).body.properties["角色"]).toBe("攻关组长");
  });

  it("53.2 攻关组长/攻关申请人 ref→person：建单自动建 person + REF 边，related 可见，rebuild 后存活", async () => {
    const { app, repo, registry } = make();
    const t = (await request(app).post("/api/nodes/attackTicket")
      .send({ 标题: "ref单", 状态: "进行中", 攻关组长: "王组长", 攻关申请人: "李申请" })).body;
    // person 节点被自动创建
    const leader = (await repo.queryNodes("person")).find(n => n.properties["姓名"] === "王组长");
    const applicant = (await repo.queryNodes("person")).find(n => n.properties["姓名"] === "李申请");
    expect(leader).toBeTruthy();
    expect(applicant).toBeTruthy();
    // REF 边存在（field=攻关组长 / 攻关申请人）
    const refs = await repo.queryEdges({ sourceId: t.id, edgeType: "REF" });
    const fields = refs.map(e => String(e.properties["field"]));
    expect(fields).toContain("攻关组长");
    expect(fields).toContain("攻关申请人");
    // related 并集可见组长
    const rel = await request(app).get(`/api/related/attackTicket/${t.id}`);
    expect(JSON.stringify(rel.body)).toContain(leader!.id);
    // rebuild 后 REF 边从存量字符串回灌仍在
    await rebuildKG(repo, registry);
    const fields2 = (await repo.queryEdges({ sourceId: t.id, edgeType: "REF" })).map(e => String(e.properties["field"]));
    expect(fields2).toContain("攻关组长");
    expect(fields2).toContain("攻关申请人");
  });
});
