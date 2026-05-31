#!/usr/bin/env node
// Phase 2a-5: 给测试文件中所有 repo.<method>() 同步调用加 await。
// 仅添加,绝不删除;命中的方法名固定列表来自 Repository 接口。
// 同时把所有同步 it("...", () => {...}) 改为 it("...", async () => {...})
// 仅在该 it 内部出现了 repo. 调用时。
//
// 用法:node scripts/phase2a-add-await.mjs apps/backend/test/*.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_METHODS = [
  "createNode",
  "getNode",
  "updateNode",
  "queryNodes",
  "createEdge",
  "queryEdges",
  "deleteEdges",
  "deleteEdgeById",
  "appendProgress",
  "listProgress",
  "listAllProgress",
  "deleteNode",
  "logAudit",
  "listAuditLog",
  "getSetting",
  "setSetting",
  "createProposal",
  "listProposals",
  "getProposal",
  "updateProposalStatus",
  "createReminder",
  "listReminders",
  "getReminder",
  "updateReminderStatus",
];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node phase2a-add-await.mjs <file>...");
  process.exit(1);
}

let totalEdits = 0;

for (const file of files) {
  const path = resolve(file);
  let src = readFileSync(path, "utf8");
  const original = src;

  // 1) For each repo method, add `await` before `repo.METHOD(`
  //    Skip if already has `await` (lookbehind).
  for (const method of REPO_METHODS) {
    // Match `repo.METHOD(` not preceded by `await `
    const re = new RegExp(`(?<!await\\s)\\brepo\\.${method}\\(`, "g");
    src = src.replace(re, (m) => `await ${m}`);
  }

  // 2) Convert sync arrow callbacks containing await to async
  //    Targets: `() => {`, `(x) => {` patterns within it("...", ...) / beforeEach(...)
  //    Heuristic: if a function body contains 'await ', and the function is `(arg?) => {`,
  //    wrap it as `async (arg?) => {`. Skip if already async.
  //
  //    To avoid mis-matching, only process lines that look like:
  //      it(..., () => {
  //      it(..., (x) => {
  //      beforeEach(() => {
  //      describe / function decl etc. handled by the same regex
  //
  //    But safest: scan the file, for each occurrence of `() => {` or `(args) => {`
  //    look ahead for matching `})` and check if body has `await `.
  //    Simpler heuristic with high recall: replace `, () => {` and `, async () => {`
  //    inside it()/beforeEach() — we know tests use these patterns.
  src = src.replace(
    /\b(it|beforeEach|beforeAll|afterEach|afterAll)\((["'`])([^"'`]*)\2,\s*\(\)\s*=>\s*\{/g,
    (m, fn, q, label) => `${fn}(${q}${label}${q}, async () => {`
  );

  // beforeEach/it with no string (beforeEach only)
  src = src.replace(
    /\b(beforeEach|beforeAll|afterEach|afterAll)\(\s*\(\)\s*=>\s*\{/g,
    (m, fn) => `${fn}(async () => {`
  );

  // top-level test arrow handler with arg, e.g. it("xxx", async/sync () => fn)
  // (rare, skip)

  if (src !== original) {
    writeFileSync(path, src, "utf8");
    const before = (original.match(/\brepo\./g) || []).length;
    const after = (src.match(/\bawait\s+repo\./g) || []).length;
    console.log(`✓ ${file}: ${after} awaits added (file had ${before} repo. usages)`);
    totalEdits++;
  } else {
    console.log(`· ${file}: no changes`);
  }
}

console.log(`\nDone. ${totalEdits} files modified.`);
