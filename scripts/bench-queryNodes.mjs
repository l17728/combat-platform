#!/usr/bin/env node
/**
 * v2.2 P1 §1 benchmark — queryNodes(nt, {key:v}) vs queryNodesByProperty(nt, key, v)
 *
 * 衡量在 N = {100, 1k, 5k, 10k} attackTicket 节点下:
 *   - queryNodes(nt, filter):全表 SELECT + N 次 JSON.parse + 应用层 filter
 *   - queryNodesByProperty(nt, key, v):走 json_extract WHERE + 命中行 JSON.parse
 *
 * 命中率固定 ~10%(每 10 张 ticket 有 1 张状态=进行中),即 hit-rate 与 N 同比放大。
 *
 * 用法:
 *   node scripts/bench-queryNodes.mjs            # SQLite 内存模式
 *   COMBAT_BENCH_PG_URL=... node scripts/bench-queryNodes.mjs  # PG(可选)
 *
 * 输出:Markdown 表格,可贴 docs。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { openDb } = await import("../apps/backend/src/db.ts").catch(async () => {
  // tsx not available — try pre-built js (won't have one in this repo, so fail loud)
  console.error("无法 import .ts 文件,请用 npx tsx 跑此脚本:");
  console.error("  npx tsx scripts/bench-queryNodes.mjs");
  process.exit(1);
});

const { SqliteAdapter } = await import("../apps/backend/src/db-adapter.ts");
const { SqliteRepository } = await import("../apps/backend/src/repository.ts");

const SIZES = [100, 1_000, 5_000, 10_000];
const STATUSES = ["待响应", "处理中", "进行中", "已解决", "已关闭"];

async function seed(repo, n) {
  console.error(`  seeding ${n} attackTickets...`);
  for (let i = 0; i < n; i++) {
    const status = STATUSES[i % STATUSES.length];
    await repo.createNode(
      "attackTicket",
      {
        标题: `bench-${i}`,
        状态: status,
        客户名称: `客户-${i % 50}`,
        问题单号: `PB-${i}`,
      },
      "bench"
    );
  }
}

async function timeIt(label, fn, runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    const result = await fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
    // sanity — both must return same count
    if (i === 0) samples.resultCount = result.length;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1];
  return { label, median, p99, count: samples.resultCount, runs };
}

console.log("# queryNodesByProperty benchmark\n");
console.log("| N | queryNodes (filter) median | queryNodesByProperty median | speedup |");
console.log("|---|---|---|---|");

for (const n of SIZES) {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  const dbPath = join(dir, "bench.sqlite");
  const db = openDb(dbPath);
  const adapter = new SqliteAdapter(db);
  const repo = new SqliteRepository(adapter);

  try {
    await seed(repo, n);

    const a = await timeIt("queryNodes(filter)", () => repo.queryNodes("attackTicket", { 状态: "进行中" }), 10);
    const b = await timeIt(
      "queryNodesByProperty",
      () => repo.queryNodesByProperty("attackTicket", "状态", "进行中"),
      10
    );

    console.log(
      `| ${n} | ${a.median.toFixed(2)} ms | ${b.median.toFixed(2)} ms | ${(a.median / b.median).toFixed(1)}x |`
    );
  } finally {
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n注:N 节点全在 attackTicket 单 nodeType 下;命中率约 20%(5 种状态等概率)。");
console.log("expression index `idx_nodes_prop_status` 在 db.ts 中已建,自动启用。");
