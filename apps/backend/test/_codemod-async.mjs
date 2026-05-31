// One-shot codemod: convert sync makeApp/makeTestApp calls to async + await.
// Run: node apps/backend/test/_codemod-async.mjs
// Idempotent — running twice is a no-op.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const FILES = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".ts") && f !== "helpers.ts" && !f.startsWith("_"))
  .map((f) => join(TEST_DIR, f));

const CALL_NAME_RE = /\b(makeApp|makeTestApp)([A-Za-z0-9]*)\b/g;

let touched = 0;

for (const filePath of FILES) {
  const original = readFileSync(filePath, "utf8");
  const lines = original.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip the function-declaration line: rename to async function instead.
    if (/^\s*(?:export\s+)?function\s+(?:makeApp|makeTestApp)[A-Za-z0-9]*\b/.test(line)) {
      lines[i] = line.replace(/(^\s*(?:export\s+)?)function\s+/, "$1async function ");
      continue;
    }

    // Skip already-async function declarations
    if (/^\s*(?:export\s+)?async\s+function\s+(?:makeApp|makeTestApp)[A-Za-z0-9]*\b/.test(line)) {
      continue;
    }

    // Replace call sites: any `<name>(...)` not preceded by `await` or word/dot
    lines[i] = line.replace(/([^\w.\)\]]|^)((?:makeApp|makeTestApp)[A-Za-z0-9]*)(\s*\()/g, (m, pre, name, paren) => {
      // skip if preceding context shows `await `
      if (/await\s*$/.test(pre)) return m;
      return `${pre}await ${name}${paren}`;
    });
    // squash duplicate awaits
    lines[i] = lines[i].replace(/await\s+await\s+/g, "await ");
  }

  const updated = lines.join("\n");
  if (updated !== original) {
    writeFileSync(filePath, updated);
    touched++;
    console.log(`rewrote: ${filePath}`);
  }
}

console.log(`\n${touched} file(s) rewritten.`);
