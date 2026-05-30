import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { SqliteRepository } from "../src/repository.js";
import { FileSchemaRegistry } from "../src/registry.js";
import { createApp } from "../src/app.js";
import { SqliteAdapter } from "../src/db-adapter.js";

export function makeTestApp() {
  process.env.COMBAT_NO_AUTH = "1";
  const dir = mkdtempSync(join(tmpdir(), "combat-"));
  const cfgDir = join(dir, "schemas"); mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, "attackTicket.json"), JSON.stringify({
    nodeType: "attackTicket", label: "攻关单", identityKeys: ["攻关单号"], derivedToKG: true,
    fields: [
      { name: "标题", type: "string", label: "标题", required: true },
      { name: "状态", type: "enum", label: "状态", required: true,
        enumValues: ["待响应", "处理中", "进行中", "已解决", "已关闭"] },
    ],
  }));
  writeFileSync(join(cfgDir, "person.json"), JSON.stringify({
    nodeType: "person", label: "人员", identityKeys: ["employeeId"], derivedToKG: true,
    fields: [{ name: "name", type: "string", label: "姓名", required: true },
             { name: "employeeId", type: "string", label: "工号" }],
  }));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(db);
  const registry = new FileSchemaRegistry(cfgDir);
  return { app: createApp({ repo, registry, adapter, dbPath }), repo, registry, cfgDir };
}
