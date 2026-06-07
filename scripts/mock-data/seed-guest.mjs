#!/usr/bin/env node
// seed-guest — 将 default 租户的 demo 数据复制到 guest 租户
// 用法: node scripts/mock-data/seed-guest.mjs [--db ./data/combat.sqlite]
// 前提: 后端服务已停止（直接操作 SQLite 文件）
//
// 功能:
//   1. 清空 guest 租户旧数据（nodes/edges/progress_log/wiki_articles）
//   2. 复制 default 租户全部 nodes（生成新 UUID）
//   3. 复制 edges（sourceId/targetId 按映射表替换）
//   4. 复制 progress_log（ownerId 按映射表替换）
//   5. 复制指定 wiki 文章（标题关键词匹配）
//
// 幂等性: 每次运行先清空 guest 数据再重新复制，可重复执行。

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dbIdx = args.indexOf("--db");
const dbPath = dbIdx >= 0 ? resolve(args[dbIdx + 1]) : resolve("data/combat.sqlite");

const wikiKeywords = args.indexOf("--wiki");
const wikiFilter =
  wikiKeywords >= 0 ? args[wikiKeywords + 1]?.split(",").map((k) => k.trim()) : ["金剛", "金刚", "定风波"];

console.log(`=== seed-guest: ${dbPath} ===\n`);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

function copyTable(srcTenant, dstTenant, table, idMap) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE tenant_id = ?`).all(srcTenant);
  if (!rows.length) {
    console.log(`  ${table}: 0 rows (source empty), skipped`);
    return 0;
  }

  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => "?").join(", ");
  const insert = db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`);

  let count = 0;
  const insertMany = db.transaction(() => {
    for (const row of rows) {
      const newRow = { ...row };
      newRow.id = randomUUID();
      newRow.tenant_id = dstTenant;

      if (table === "edges") {
        newRow.sourceId = idMap.get(row.sourceId) || row.sourceId;
        newRow.targetId = idMap.get(row.targetId) || row.targetId;
      }
      if (table === "progress_log") {
        newRow.ownerId = idMap.get(row.ownerId) || row.ownerId;
      }

      insert.run(...cols.map((c) => newRow[c]));
      count++;
    }
  });

  insertMany();
  console.log(`  ${table}: ${count} rows copied`);
  return count;
}

function seedWiki(srcTenant, dstTenant, keywords) {
  const likeClauses = keywords.map(() => `title LIKE ?`).join(" OR ");
  const params = keywords.map((k) => `%${k}%`);
  params.unshift(srcTenant);

  const rows = db.prepare(`SELECT * FROM wiki_articles WHERE tenant_id = ? AND (${likeClauses})`).all(...params);

  if (!rows.length) {
    console.log(`  wiki_articles: 0 rows matched keywords [${keywords}], skipped`);
    return 0;
  }

  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => "?").join(", ");
  const insert = db.prepare(`INSERT INTO wiki_articles (${cols.join(", ")}) VALUES (${placeholders})`);

  let count = 0;
  for (const row of rows) {
    const newRow = { ...row };
    newRow.id = randomUUID();
    newRow.tenant_id = dstTenant;
    insert.run(...cols.map((c) => newRow[c]));
    count++;
  }

  console.log(`  wiki_articles: ${count} rows matched [${keywords.join(", ")}]`);
  return count;
}

// --- Main ---
try {
  // 1. 清空 guest 旧数据
  console.log("1. 清空 guest 旧数据...");
  db.exec(`
    DELETE FROM progress_log WHERE tenant_id = 'guest';
    DELETE FROM edges WHERE tenant_id = 'guest';
    DELETE FROM nodes WHERE tenant_id = 'guest';
    DELETE FROM wiki_articles WHERE tenant_id = 'guest';
  `);
  console.log("  done\n");

  // 2. 复制 nodes 并建立 ID 映射
  console.log("2. 复制 nodes...");
  const nodeRows = db.prepare("SELECT * FROM nodes WHERE tenant_id = 'default'").all();
  const idMap = new Map();

  if (!nodeRows.length) {
    console.log("  default 租户无 nodes 数据，退出");
    process.exit(0);
  }

  const nodeCols = Object.keys(nodeRows[0]);
  const nodePlaceholders = nodeCols.map(() => "?").join(", ");
  const nodeInsert = db.prepare(`INSERT INTO nodes (${nodeCols.join(", ")}) VALUES (${nodePlaceholders})`);

  let nodeCount = 0;
  const insertNodes = db.transaction(() => {
    for (const row of nodeRows) {
      const newId = randomUUID();
      idMap.set(row.id, newId);

      const newRow = { ...row, id: newId, tenant_id: "guest" };
      nodeInsert.run(...nodeCols.map((c) => newRow[c]));
      nodeCount++;
    }
  });
  insertNodes();
  console.log(`  nodes: ${nodeCount} rows copied, ${idMap.size} IDs mapped\n`);

  // 3. 复制 edges 和 progress_log
  console.log("3. 复制 edges + progress_log...");
  copyTable("default", "guest", "edges", idMap);
  copyTable("default", "guest", "progress_log", idMap);

  // 4. 复制指定 wiki 文章
  console.log("\n4. 复制 wiki 文章...");
  seedWiki("default", "guest", wikiFilter);

  // 5. 验证
  console.log("\n5. 验证...");
  const verify = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM nodes WHERE tenant_id='guest') as nodes,
        (SELECT COUNT(*) FROM edges WHERE tenant_id='guest') as edges,
        (SELECT COUNT(*) FROM progress_log WHERE tenant_id='guest') as progress,
        (SELECT COUNT(*) FROM wiki_articles WHERE tenant_id='guest') as wiki`
    )
    .get();

  const dangling = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM edges e
       WHERE e.tenant_id='guest'
       AND (e.sourceId NOT IN (SELECT id FROM nodes WHERE tenant_id='guest')
         OR e.targetId NOT IN (SELECT id FROM nodes WHERE tenant_id='guest'))`
    )
    .get();

  console.log(
    `  guest: ${verify.nodes} nodes, ${verify.edges} edges, ${verify.progress} progress, ${verify.wiki} wiki`
  );
  console.log(`  dangling edges: ${dangling.cnt} (should be 0)`);

  if (dangling.cnt > 0) {
    console.error("\n⚠️  有断裂引用，请检查！");
    process.exit(1);
  }

  console.log("\n✅ seed-guest 完成");
} finally {
  db.close();
}
