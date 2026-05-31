#!/usr/bin/env node
/**
 * v2.2 P1 §1 — 验证 SQLite expression index 真的被走了。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb } = await import("../apps/backend/src/db.ts");

const dir = mkdtempSync(join(tmpdir(), "explain-"));
const dbPath = join(dir, "explain.sqlite");
const db = openDb(dbPath);

// seed many rows so query planner has stats
const stmt = db.prepare(
  "INSERT INTO nodes(id, nodeType, properties, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const STATUSES = ["待响应", "处理中", "进行中", "已解决", "已关闭"];
for (let i = 0; i < 10000; i++) {
  stmt.run(
    `id-${i}`,
    "attackTicket",
    JSON.stringify({ 状态: STATUSES[i % 5], 标题: `t-${i}` }),
    `t-${i}`,
    "2026-01-01",
    "2026-01-01"
  );
}
db.exec("ANALYZE");

console.log("All indexes on nodes:");
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='nodes'").all();
for (const i of idx) console.log("  ", i.name);
console.log("");

console.log("EXPLAIN QUERY PLAN — queryNodesByProperty equivalent:");
const rows = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT * FROM nodes
     WHERE "nodeType" = ? AND json_extract(properties, '$.状态') = ?`
  )
  .all("attackTicket", "进行中");
for (const r of rows) console.log("  ", JSON.stringify(r));

console.log("");
console.log("EXPLAIN QUERY PLAN — queryNodes 全表扫:");
const rows2 = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM nodes WHERE "nodeType" = ?`).all("attackTicket");
for (const r of rows2) console.log("  ", JSON.stringify(r));

console.log("");
console.log("EXPLAIN QUERY PLAN — 单 json_extract WHERE(无 nodeType):");
const rows3 = db
  .prepare(`EXPLAIN QUERY PLAN SELECT * FROM nodes WHERE json_extract(properties, '$.状态') = ?`)
  .all("进行中");
for (const r of rows3) console.log("  ", JSON.stringify(r));

db.close();
rmSync(dir, { recursive: true, force: true });
