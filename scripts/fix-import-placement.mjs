#!/usr/bin/env node
// Fix broken handleApiError import placement caused by migrate-catch-any.mjs.
// The bad pattern is a top-level import line `import { handleApiError } from "../utils/handleApiError.js";`
// inserted INSIDE a multi-line `import { ... } from '...';` block. We detect
// any handleApiError import that is inside another import block (or sandwiched
// where the lines are non-import statements) and move it to be after the LAST
// top-level import (i.e., after the line `from '<x>';` that closes the section).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

function listFiles() {
  const out = execSync(`git ls-files apps/frontend-v2/src`, { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.(ts|tsx)$/.test(l))
    .map((rel) => join(ROOT, rel));
}

/**
 * Compute import section end:
 *  - Walk top of file. Track brace/paren depth across multi-line imports.
 *  - Lines that are `import ...;` (single-line) count as imports.
 *  - Lines that open multi-line imports `import {` increase depth, decrease on
 *    `} from '...';` lines.
 *  - First non-import, non-blank line at depth 0 marks end.
 */
function findImportSectionEnd(lines) {
  let depth = 0;
  let lastImportEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (depth > 0) {
      // inside multi-line import; close when we see `} from ...` or just `}`
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      depth += openCount - closeCount;
      if (depth === 0) lastImportEnd = i;
      continue;
    }
    // depth == 0
    if (/^\/\//.test(trimmed) || /^\/\*/.test(trimmed)) {
      // comment at top, allow
      continue;
    }
    if (/^import\s/.test(trimmed)) {
      // Could be single-line or start of multi-line
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      depth = openCount - closeCount;
      if (depth === 0) lastImportEnd = i; // single-line import line
      continue;
    }
    // Not import, not blank, not comment → end of imports
    break;
  }
  return lastImportEnd;
}

const files = listFiles();
let touched = 0;
for (const file of files) {
  const orig = readFileSync(file, "utf8");
  if (!orig.includes("import { handleApiError } from")) continue;
  const lines = orig.split("\n");
  // Find any line that has the handleApiError import
  const handleIdx = lines.findIndex((l) =>
    /^\s*import\s+\{\s*handleApiError\s*\}\s+from\s+["'][^"']+["'];?\s*$/.test(l)
  );
  if (handleIdx < 0) continue;
  // Determine the correct insertion point ignoring the misplaced line
  const linesWithoutHandle = [...lines];
  linesWithoutHandle.splice(handleIdx, 1);
  const correctIdx = findImportSectionEnd(linesWithoutHandle);
  // If correctIdx == handleIdx - 1 (already at right spot) and the line above
  // is a complete import, we're fine.
  // We re-insert at correctIdx + 1
  const isCorrect = correctIdx + 1 === handleIdx;
  if (isCorrect) continue;
  const importLine = lines[handleIdx];
  linesWithoutHandle.splice(correctIdx + 1, 0, importLine);
  const out = linesWithoutHandle.join("\n");
  if (out !== orig) {
    writeFileSync(file, out, "utf8");
    touched++;
    console.log("[fixed]", relative(ROOT, file));
  }
}
console.log("Total fixed:", touched);
