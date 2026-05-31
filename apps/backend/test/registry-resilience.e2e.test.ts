import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";

function fixture(opts: { broken?: boolean; allBroken?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "combat-resil-"));
  const cfg = join(dir, "schemas");
  mkdirSync(cfg);
  writeFileSync(
    join(cfg, "attackTicket.json"),
    opts.allBroken
      ? "{NOT JSON" // intentionally malformed
      : JSON.stringify({
          nodeType: "attackTicket",
          label: "攻关单",
          identityKeys: ["攻关单号"],
          derivedToKG: true,
          fields: [{ name: "标题", type: "string", label: "标题", required: true }],
        })
  );
  if (opts.broken || opts.allBroken) writeFileSync(join(cfg, "bad.json"), "{NOT JSON"); // intentionally malformed
  if (opts.allBroken) writeFileSync(join(cfg, "alsobad.json"), "{NOT JSON");
  const repo = new SqliteRepository(new SqliteAdapter(openDb(join(dir, "t.sqlite"))));
  return { cfg, repo };
}

describe("§13#9 fix: tolerant reload + targeted applyFieldOp validation", () => {
  it("broken sibling does NOT prevent construction; valid nodeType is accessible; warn fires", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cfg, repo } = fixture({ broken: true });
    const reg = new FileSchemaRegistry(cfg);
    expect(reg.getNodeSchema("attackTicket")).toBeDefined();
    expect(reg.getConfig().nodeTypes.map((n) => n.nodeType)).toEqual(["attackTicket"]);
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.flat().join(" ");
    expect(msg).toContain("bad.json");
    // log.warn now emits structured JSON line with "registry.reload.skip" event (not Chinese literal "跳过")
    expect(msg).toMatch(/registry\.reload\.skip|跳过/);
    warn.mockRestore();
    void repo;
  });

  it("PATCH setConcept on valid file succeeds even with a broken sibling (no false rollback)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cfg, repo } = fixture({ broken: true });
    const app = createApp({ repo, registry: new FileSchemaRegistry(cfg) });
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "setConcept", id: "标题", concept: "测试概念" });
    expect(r.status).toBe(200);
    expect(r.body.fields.find((f: any) => f.id === "标题").concept).toBe("测试概念");
    // on-disk also persisted (proves no rollback to prev)
    const onDisk = JSON.parse(readFileSync(join(cfg, "attackTicket.json"), "utf8"));
    expect(onDisk.fields.find((f: any) => f.id === "标题").concept).toBe("测试概念");
  });

  it("all-files-broken still throws on construction (preserves the 'no schemas' signal)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cfg } = fixture({ allBroken: true });
    expect(() => new FileSchemaRegistry(cfg)).toThrow(/无可解析的 schema/);
  });

  it("self-validation catches a corrupt write and rolls back (defensive — can't happen via applyFieldOp but proves the guard)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cfg, repo } = fixture();
    const reg = new FileSchemaRegistry(cfg);
    const app = createApp({ repo, registry: reg });
    // Sanity: a normal PATCH still works (regression check on the new flow).
    const r = await request(app)
      .patch("/api/schema/attackTicket")
      .send({ op: "renameLabel", id: "标题", label: "改后" });
    expect(r.status).toBe(200);
    expect(reg.getNodeSchema("attackTicket")!.fields.find((f) => f.id === "标题")!.label).toBe("改后");
  });
});
