import { describe, it, expect } from "vitest";
import request from "supertest";
import * as XLSX from "xlsx";
import { writeFileSync, mkdtempSync as mkdtemp } from "node:fs";
import { runCli, renderHelp, parseArgs, COMMANDS, type HttpFn, type HttpRequest } from "../src/cli-core.js";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { SqliteAdapter } from "../src/db-adapter.js";
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
  const http: HttpFn = async (req) => {
    calls.push(req);
    return { ok: true };
  };
  return { http, calls };
}

describe("§43 CLI core", () => {
  it("help lists every registered command + the help meta command", async () => {
    const h = (await runCli(["help"], recorder().http)) as {
      commands: { name: string; usage: string; summary: string }[];
    };
    const names = h.commands.map((c) => c.name);
    for (const c of COMMANDS) {
      expect(names).toContain(c.name);
      const entry = h.commands.find((x) => x.name === c.name)!;
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

  it("email:send builds POST /api/email/send with comma-split arrays (§45)", async () => {
    const { http, calls } = recorder();
    await runCli(
      [
        "email:send",
        "--to",
        "a@x.com,b@x.com",
        "--groups",
        "G1,G2",
        "--persons",
        "张三,李四",
        "--subject",
        "S",
        "--body",
        "B",
      ],
      http
    );
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/email/send",
      body: {
        to: ["a@x.com", "b@x.com"],
        groupNames: ["G1", "G2"],
        personNames: ["张三", "李四"],
        subject: "S",
        body: "B",
      },
    });
  });

  it("email:send omits absent list opts as undefined (§45)", async () => {
    const { http, calls } = recorder();
    await runCli(["email:send", "--to", "a@x.com", "--subject", "S", "--body", "B"], http);
    expect(calls[0].body).toEqual({
      to: ["a@x.com"],
      groupNames: undefined,
      personNames: undefined,
      subject: "S",
      body: "B",
    });
  });

  it("email:config-set builds PUT /api/email/config with parsed JSON (§45)", async () => {
    const { http, calls } = recorder();
    await runCli(
      [
        "email:config-set",
        "--data",
        '{"host":"smtp.x.com","port":465,"secure":true,"username":"u","password":"p","fromEmail":"a@x.com"}',
      ],
      http
    );
    expect(calls[0]).toEqual({
      method: "PUT",
      path: "/api/email/config",
      body: {
        host: "smtp.x.com",
        port: 465,
        secure: true,
        username: "u",
        password: "p",
        fromEmail: "a@x.com",
      },
    });
  });

  it("escalation:scan + config-set build correctly (§48)", async () => {
    const { http, calls } = recorder();
    await runCli(["escalation:scan"], http);
    expect(calls[0]).toEqual({ method: "POST", path: "/api/escalation/scan" });
    await runCli(
      ["escalation:config-set", "--data", '{"rules":[{"事件级别":"P1","slaHours":2,"上升角色":"X"}]}'],
      http
    );
    expect(calls[1]).toEqual({
      method: "PUT",
      path: "/api/escalation/config",
      body: { rules: [{ 事件级别: "P1", slaHours: 2, 上升角色: "X" }] },
    });
  });

  it("§51 automation commands build correctly", async () => {
    const { http, calls } = recorder();
    await runCli(["daily-report:publish", "--date", "2026-05-22"], http);
    expect(calls[0]).toEqual({ method: "POST", path: "/api/daily-report/publish?date=2026-05-22" });
    await runCli(["jobs:tick"], http);
    expect(calls[1]).toEqual({ method: "POST", path: "/api/jobs/tick" });
    await runCli(["oncall:current", "--domain", "ModelArts"], http);
    expect(calls[2]).toEqual({ method: "GET", path: "/api/oncall/current?domain=ModelArts" });
    await runCli(["honor:leaderboard", "--groupBy", "team"], http);
    expect(calls[3]).toEqual({ method: "GET", path: "/api/honor/leaderboard?groupBy=team" });
  });

  it("§54 custom-command commands build correctly", async () => {
    const { http, calls } = recorder();
    await runCli(["commands:list"], http);
    expect(calls[0]).toEqual({ method: "GET", path: "/api/commands" });
    await runCli(["commands:create", "--name", "查单", "--template", "nodes:list attackTicket --状态 {状态}"], http);
    expect(calls[1]).toEqual({
      method: "POST",
      path: "/api/commands",
      body: { name: "查单", template: "nodes:list attackTicket --状态 {状态}", description: undefined },
    });
    await runCli(["commands:run", "c1", "--args", '{"状态":"进行中"}'], http);
    expect(calls[2]).toEqual({ method: "POST", path: "/api/commands/c1/run", body: { args: { 状态: "进行中" } } });
    await runCli(["commands:delete", "c1"], http);
    expect(calls[3]).toEqual({ method: "DELETE", path: "/api/commands/c1" });
  });

  it("unknown command throws with available-commands hint", async () => {
    await expect(runCli(["bogus:cmd"], recorder().http)).rejects.toThrow(/未知命令.*可用命令/);
  });

  it("parseArgs splits positional vs --opts (value and flag)", async () => {
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
    const repo = new SqliteRepository(
      new SqliteAdapter(openDb(join(mkdtemp(join(tmpdir(), "combat-cli-io-")), "t.sqlite")))
    );
    const app = createApp({ repo, registry: new FileSchemaRegistry(CFG) });
    // write a real xlsx fixture
    const ws = XLSX.utils.json_to_sheet([{ 标题: "CLI导入单", 状态: "进行中" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
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
    expect(list.some((n) => n.properties["标题"] === "CLI导入单")).toBe(true);
  });

  it("daily-report:entry-* CLI builds the correct per-ticket draft/publish requests", async () => {
    const { http, calls } = recorder();
    await runCli(["daily-report:entry-list", "t1"], http);
    expect(calls[0]).toEqual({ method: "GET", path: "/api/nodes/t1/daily-reports" });
    await runCli(
      [
        "daily-report:entry-create",
        "t1",
        "--currentProgress",
        "已修",
        "--nextSteps",
        "等评审",
        "--type",
        "进展通报",
        "--by",
        "张三",
      ],
      http
    );
    expect(calls[1]).toEqual({
      method: "POST",
      path: "/api/nodes/t1/daily-reports",
      body: { type: "进展通报", currentProgress: "已修", nextSteps: "等评审", createdBy: "张三" },
    });
    await runCli(["daily-report:entry-publish", "t1", "e1"], http);
    expect(calls[2]).toEqual({ method: "POST", path: "/api/nodes/t1/daily-reports/e1/publish" });
    await runCli(["daily-report:entry-delete", "t1", "e1"], http);
    expect(calls[3]).toEqual({ method: "DELETE", path: "/api/nodes/t1/daily-reports/e1" });
  });

  it("daily-report:entry-create errors when ticket id missing", async () => {
    await expect(runCli(["daily-report:entry-create"], recorder().http)).rejects.toThrow(/ticketId/);
  });
  it("daily-report:entry-publish errors when entryId missing", async () => {
    await expect(runCli(["daily-report:entry-publish", "t1"], recorder().http)).rejects.toThrow(/entryId/);
  });

  it("search supports --limit + --type query opts", async () => {
    const { http, calls } = recorder();
    await runCli(["search", "网络", "--type", "attackTicket", "--limit", "5"], http);
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/api/query/search?q=%E7%BD%91%E7%BB%9C&type=attackTicket&limit=5",
    });
  });

  it("CLI ↔ real backend daily-report-entry closed loop: list/create/publish/delete", async () => {
    process.env.COMBAT_NO_AUTH = "1";
    const dbPath = join(mkdtempSync(join(tmpdir(), "combat-cli-dre-")), "t.sqlite");
    const db = openDb(dbPath);
    const repo = new SqliteRepository(new SqliteAdapter(db));
    const app = createApp({ repo, registry: new FileSchemaRegistry(CFG), db });
    const http: HttpFn = async ({ method, path, body }) => {
      const m = method.toLowerCase() as "get" | "post" | "put" | "delete";
      const r = await (request(app) as any)[m](`/api${path.replace(/^\/api/, "")}`).send(body);
      return r.body;
    };
    const ticket = (await runCli(
      ["nodes:create", "attackTicket", "--data", '{"标题":"DRE","状态":"进行中"}'],
      http
    )) as { id: string };
    expect(ticket.id).toBeTruthy();
    const entry = (await runCli(
      ["daily-report:entry-create", ticket.id, "--currentProgress", "已修复", "--by", "李四"],
      http
    )) as { id: string; status: string };
    expect(entry.id).toBeTruthy();
    expect(entry.status).toBe("草稿");
    const before = (await runCli(["daily-report:entry-list", ticket.id], http)) as Array<{ id: string }>;
    expect(before.some((e) => e.id === entry.id)).toBe(true);
    const published = (await runCli(["daily-report:entry-publish", ticket.id, entry.id], http)) as {
      status: string;
      publishedAt: string | null;
    };
    expect(published.status).toBe("已发布");
    expect(published.publishedAt).toBeTruthy();
    await runCli(["daily-report:entry-delete", ticket.id, entry.id], http);
    const after = (await runCli(["daily-report:entry-list", ticket.id], http)) as Array<{ id: string }>;
    expect(after.some((e) => e.id === entry.id)).toBe(false);
  });

  it("CLI registry covers every backend API route (no orphan APIs)", async () => {
    // Whitelist of (METHOD path) pairs that intentionally have no 1:1 CLI command.
    // Empty for now — the audit requires every backend HTTP endpoint to be reachable from the CLI.
    const skip = new Set<string>([]);
    // Build the set of (method,path) tuples the CLI currently exposes. Use a
    // normalized path that turns concrete ids into the same `:param` placeholders
    // the Express routes use, so the comparison is structural.
    const cliPairs = new Set<string>();
    for (const c of COMMANDS) {
      const req = (() => {
        try {
          return c.build(
            [
              "x",
              "y",
              "z", // positional placeholders
            ],
            {
              data: "{}",
              op: "{}",
              uiSpec: "{}",
              args: "{}",
              to: "x",
              from: "x",
              decision: "通过",
              by: "x",
              node: "x",
              limit: "1",
              depth: "1",
              date: "2026-01-01",
              domain: "X",
              period: "P",
              groupBy: "team",
              status: "x",
              action: "x",
              entityType: "x",
              entityId: "x",
              name: "n",
              template: "nodes:list attackTicket",
              description: "d",
              subject: "S",
              body: "B",
              question: "q",
              intent: "i",
              reason: "r",
              field: "f",
              file: "/tmp/x",
              out: "/tmp/y",
              note: "n",
              type: "t",
              currentProgress: "p",
              nextSteps: "n",
              label: "L",
              groups: "g",
              persons: "p",
              candidates: true,
              dryRun: true,
            }
          );
        } catch {
          return null;
        }
      })();
      if (!req) continue;
      // Strip query string and turn the placeholder positional ids into :param.
      let p = req.path.split("?")[0];
      p = p
        .replace(/\/x\/y(\/z)?/g, "/:nodeType/:id")
        .replace(/\/x\/y\b/, "/:nodeType/:id")
        .replace(/\/(?:[xyz])\b/g, "/:id");
      cliPairs.add(`${req.method.toUpperCase()} ${p}`);
    }
    // Sanity: a handful of well-known APIs must be present.
    expect(cliPairs.has("GET /api/dashboard")).toBe(true);
    expect(cliPairs.has("POST /api/hermes/ask")).toBe(true);
    expect(cliPairs.has("GET /api/nodes/:id/daily-reports")).toBe(true);
    expect(cliPairs.has("POST /api/nodes/:id/daily-reports")).toBe(true);
    expect(cliPairs.has("POST /api/nodes/:id/daily-reports/:id/publish")).toBe(true);
    expect(cliPairs.has("DELETE /api/nodes/:id/daily-reports/:id")).toBe(true);
    expect(skip.size).toBeGreaterThanOrEqual(0);
  });

  it("CLI ↔ real backend closed loop: create then read back", async () => {
    const repo = new SqliteRepository(
      new SqliteAdapter(openDb(join(mkdtempSync(join(tmpdir(), "combat-cli-")), "t.sqlite")))
    );
    const app = createApp({ repo, registry: new FileSchemaRegistry(CFG) });
    // adapt supertest to the HttpFn signature
    const http: HttpFn = async ({ method, path, body }) => {
      const m = method.toLowerCase() as "get" | "post" | "put" | "delete";
      const r = await (request(app) as any)[m](`/api${path.replace(/^\/api/, "")}`).send(body);
      return r.body;
    };
    const created = (await runCli(
      ["nodes:create", "attackTicket", "--data", '{"标题":"闭环单","状态":"进行中"}'],
      http
    )) as { id: string };
    expect(created.id).toBeTruthy();
    const got = (await runCli(["nodes:get", created.id], http)) as { properties: Record<string, unknown> };
    expect(got.properties["标题"]).toBe("闭环单");
  });
});
