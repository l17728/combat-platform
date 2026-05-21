import { describe, it, expect } from "vitest";
import request from "supertest";
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
