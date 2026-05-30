#!/usr/bin/env node
// Phase 2a follow-up: wrap `await repo.METHOD(...)` with parens whenever it is
// immediately followed by member access / index / chained method call.
// I.e. turn:   await repo.queryNodes("x")[0].id
// into:        (await repo.queryNodes("x"))[0].id
// And:         await repo.queryNodes("x").filter(...)
// into:        (await repo.queryNodes("x")).filter(...)
//
// Approach: find each `await repo.METHOD(`, walk the source to match its closing
// paren (paren-counter, respecting string literals), then if the very next char
// (after the close) is one of `[` `.` (and not `.then` etc., which would be ok),
// wrap.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_METHODS = [
  "createNode", "getNode", "updateNode", "queryNodes",
  "createEdge", "queryEdges", "deleteEdges", "deleteEdgeById",
  "appendProgress", "listProgress", "listAllProgress",
  "deleteNode", "logAudit", "listAuditLog",
  "getSetting", "setSetting",
  "createProposal", "listProposals", "getProposal", "updateProposalStatus",
  "createReminder", "listReminders", "getReminder", "updateReminderStatus",
];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node phase2a-paren-wrap.mjs <file>...");
  process.exit(1);
}

function matchEndParen(src, openIdx) {
  // openIdx points at '('. Walk to matching ')' respecting strings + template.
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  while (i < src.length) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

let total = 0;
for (const f of files) {
  const path = resolve(f);
  let src = readFileSync(path, "utf8");
  const original = src;
  let i = 0;
  let out = "";
  const re = new RegExp(`await\\s+repo\\.(${REPO_METHODS.join("|")})\\(`, "g");
  let m;
  let last = 0;
  const ops = [];  // collect {startAwait, endParen, openParen}
  while ((m = re.exec(src)) !== null) {
    const startAwait = m.index;       // start of "await"
    const openParen = m.index + m[0].length - 1;
    const endParen = matchEndParen(src, openParen);
    if (endParen < 0) continue;
    // Skip whitespace + newlines to find the next significant char.
    // We intentionally do NOT skip past `;`, `,`, `)` — those end the expression.
    let j = endParen + 1;
    while (j < src.length && /[\s]/.test(src[j])) j++;
    const next = src[j];
    // Handle `?.` optional chaining and `!.` non-null assertion as two chars
    const next2 = src.slice(j, j + 2);
    if (next === "[" || next === "." || next2 === "?." || next2 === "!.") {
      // Don't wrap if it's `.then(`, `.catch(`, `.finally(` (already a Promise chain)
      if (next === ".") {
        const slice = src.slice(j+1, j+9);
        if (/^(then|catch|finally)\b/.test(slice)) continue;
      }
      ops.push({ startAwait, openParen, endParen });
    }
  }
  if (ops.length === 0) {
    console.log(`· ${f}: no chained awaits`);
    continue;
  }
  // Apply edits in reverse order
  ops.sort((a, b) => b.startAwait - a.startAwait);
  for (const op of ops) {
    src = src.slice(0, op.startAwait) + "(" + src.slice(op.startAwait, op.endParen + 1) + ")" + src.slice(op.endParen + 1);
  }
  if (src !== original) {
    writeFileSync(path, src, "utf8");
    console.log(`✓ ${f}: wrapped ${ops.length} chained await(s)`);
    total += ops.length;
  }
}
console.log(`\nDone. ${total} wraps applied.`);
