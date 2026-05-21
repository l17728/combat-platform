import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { writeFileSync, mkdtempSync as mkdtemp } from "node:fs";
import { runCli, renderHelp, parseArgs, COMMANDS, type HttpFn, type HttpRequest } from "../src/cli-core.js";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CFG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "schemas");

// Records the built HttpRequest instead of performing it.
function recorder() {
  const calls: HttpRequest[] = [];
  const http: HttpFn = async (req) => { calls.push(req); return { ok: true }; };
  return { http, calls };
}

describe("§43 CLI core", () => {
  it("help lists every registered command + the help meta command", async () => {
    const h = (await runCli(["help"], recorder().http)) as { commands: { name: string; usage: string; summary: string }[] };
    const names = h.commands.map(c => c.name);
    for (const c of COMMANDS) {
      expect(names).toContain(c.name);
      const entry = h.commands.find(x => x.name === c.name)!;
      expect(entry.usage).toBeTruthy();
      expect(entry.summary).toBeTruthy();
    }
    expect(names).toContain("help");
    expect(h.commands.length).toBe(COMMANDS.length + 1);
  });

  it("help <command> returns that command's detail", async () => {
    const d = renderHelp("hermes:ask") as { name: string; usage: string };
    expect(d.name).toBe("hermes:ask");
    expect(d.usage).toContain("<question>");
  });

  it("nodes:create builds POST /api/nodes/:type with parsed JSON body", async () => {
    const { http, calls } = recorder();
    await runCli(["nodes:create", "attackTicket", "--data", '{"标题":"x","状态":"进行中"}'], http);
    expect(calls[0]).toEqual({ method: "POST", path: "/api/nodes/attackTicket", body: { 标题: "x", 状态: "进行中" } });
  });

  it("hermes:ask joins positional words into the question body", async () => {
    const { http, calls } = recorder();
    await runCli(["hermes:ask", "谁", "最忙"], http);
    expect(calls[0]).toEqual({ method: "POST", path: "/api/hermes/ask", body: { question: "谁 最忙" } });
  });

  it("related builds query string for depth + candidates", async () => {
    const { http, calls } = recorder();
    await runCli(["related", "attackTicket", "t1", "--depth", "2", "--candidates"], http);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/related/attackTicket/t1?depth=2&includeCandidates=1");
  });

  it("unknown command throws with available-commands hint", async () => {
    await expect(runCli(["bogus:cmd"], recorder().http)).rejects.toThrow(/未知命令.*可用命令/);
  });

  it("parseArgs splits positional vs --opts (value and flag)", () => {
    const p = parseArgs(["a", "b", "--depth", "2", "--candidates"]);
    expect(p.positional).toEqual(["a", "b"]);
    expect(p.opts).toEqual({ depth: "2", candidates: true });
  });

  it("import builds multipart upload request with dryRun query (§44)", async () => {
    const { http, calls } = recorder();
    await runCli(["import", "attackTicket", "--file", "/x.xlsx", "--dryRun"], http);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/import?type=attackTicket&dryRun=1");
    expect(calls[0].uploadFile).toBe("/x.xlsx");
  });

  it("export builds GET with saveTo (§44)", async () => {
    const { http, calls } = recorder();
    await runCli(["export", "releasePackage", "--out", "/tmp/r.xlsx"], http);
    expect(calls[0]).toEqual({ method: "GET", path: "/api/export/releasePackage", saveTo: "/tmp/r.xlsx" });
  });

  it("import without --file / export without --out throw (§44)", async () => {
    await expect(runCli(["import", "attackTicket"], recorder().http)).rejects.toThrow(/--file/);
    await expect(runCli(["export", "attackTicket"], recorder().http)).rejects.toThrow(/--out/);
  });

  it("CLI ↔ real backend import closed loop: import file then list reads it back (§44)", async () => {
    const repo = new SqliteRepository(openDb(join(mkdtemp(join(tmpdir(), "combat-cli-io-")), "t.sqlite")));
    const app = createApp({ repo, registry: new FileSchemaRegistry(CFG) });
    // write a real xlsx fixture
    const ws = XLSX.utils.json_to_sheet([{ 标题: "CLI导入单", 状态: "进行中" }]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    const dir = mkdtemp(join(tmpdir(), "combat-cli-xlsx-"));
    const fixture = join(dir, "in.xlsx");
    writeFileSync(fixture, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    // http adapter: handle uploadFile via supertest .attach
    const http: HttpFn = async ({ method, path, body, uploadFile }) => {
      const apiPath = `/api${path.replace(/^\/api/, "")}`;
      if (uploadFile) return (await request(app).post(apiPath).attach("file", uploadFile)).body;
      const m = method.toLowerCase() as "get" | "post" | "put" | "delete";
      return (await (request(app) as any)[m](apiPath).send(body)).body;
    };
    const imp = (await runCli(["import", "attackTicket", "--file", fixture], http)) as { created: number };
    expect(imp.created).toBe(1);
    const list = (await runCli(["nodes:list", "attackTicket"], http)) as { properties: Record<string, unknown> }[];
    expect(list.some(n => n.properties["标题"] === "CLI导入单")).toBe(true);
  });

  it("CLI ↔ real backend closed loop: create then read back", async () => {
    const repo = new SqliteRepository(openDb(join(mkdtempSync(join(tmpdir(), "combat-cli-")), "t.sqlite")));
    const app = createApp({ repo, registry: new FileSchemaRegistry(CFG) });
    // adapt supertest to the HttpFn signature
    const http: HttpFn = async ({ method, path, body }) => {
      const m = method.toLowerCase() as "get" | "post" | "put" | "delete";
      const r = await (request(app) as any)[m](`/api${path.replace(/^\/api/, "")}`).send(body);
      return r.body;
    };
    const created = (await runCli(["nodes:create", "attackTicket", "--data", '{"标题":"闭环单","状态":"进行中"}'], http)) as { id: string };
    expect(created.id).toBeTruthy();
    const got = (await runCli(["nodes:get", created.id], http)) as { properties: Record<string, unknown> };
    expect(got.properties["标题"]).toBe("闭环单");
  });
});
