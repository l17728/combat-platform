#!/usr/bin/env node
// Bulk migrate `catch (e: any) { ... e.message ... }` patterns in frontend-v2 src.
// Strategies (applied in order; first match wins per occurrence):
//
//  A. One-liner with message.error(e.message)
//        `catch (e: any) { message.error(e.message); }`
//        → `catch (e) { handleApiError(e); }`
//
//  B. One-liner with message.error(e.message) and trailing code (finally cleanup)
//        `catch (e: any) { message.error(e.message); } finally { ... }`
//        → `catch (e) { handleApiError(e); } finally { ... }`
//
//  C. Block form whose body is a single `message.error(e.message);` statement
//        `} catch (e: any) {\n      message.error(e.message);\n    }`
//        → `} catch (e) {\n      handleApiError(e);\n    }`
//
//  D. Generic fallback: replace `catch (e: any)` → `catch (e)` and inside the
//     block, replace any standalone `e.message` reference to a safe typed
//     extractor. Done by AST-free text scan within the matched block.
//
// We also auto-insert `import { handleApiError } from '<rel>/utils/handleApiError.js';`
// at the top of files that newly use handleApiError but don't import it yet.
//
// Idempotent: rerun is a no-op once migration done.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "apps", "frontend-v2", "src");
const UTILS_HANDLE = join(SRC, "utils", "handleApiError.ts");

import { execSync } from "node:child_process";

function listFiles() {
  const out = execSync(`git ls-files apps/frontend-v2/src`, { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) => /\.(ts|tsx)$/.test(l) && !l.includes("__tests__") && !l.endsWith(".test.ts") && !l.endsWith(".test.tsx")
    )
    .map((rel) => join(ROOT, rel));
}

function relImport(filePath, targetPath) {
  const from = dirname(filePath);
  let rel = relative(from, targetPath).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  // strip .ts and add .js
  rel = rel.replace(/\.ts$/, ".js");
  return rel;
}

function ensureImport(content, filePath) {
  if (/from\s+["'][^"']*handleApiError\.js["']/.test(content)) return content;
  const rel = relImport(filePath, UTILS_HANDLE);
  // Insert after the last top-level import line.
  const lines = content.split("\n");
  let lastImport = -1;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (/^(import\s|export\s+\*|export\s*\{)/.test(lines[i])) lastImport = i;
    else if (lines[i].trim() === "" && lastImport === -1) continue;
    else if (lastImport >= 0 && !/^(import\s|\s)/.test(lines[i])) break;
  }
  const importLine = `import { handleApiError } from "${rel}";`;
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, importLine);
  } else {
    lines.unshift(importLine);
  }
  return lines.join("\n");
}

/**
 * Transform a single file's content. Returns { content, changed, usedHelper }.
 */
function transform(content) {
  let usedHelper = false;
  let changed = false;

  // Pattern A: one-liner `catch (e: any) { message.error(e.message); }`
  const a = /catch\s*\(\s*e\s*:\s*any\s*\)\s*\{\s*message\.error\(e\.message\)\s*;?\s*\}/g;
  if (a.test(content)) {
    content = content.replace(a, "catch (e) { handleApiError(e); }");
    usedHelper = true;
    changed = true;
  }

  // Pattern B: matched a but with extra spacing — already covered by A.

  // Pattern C: block whose body is *only* message.error(e.message);
  // We approach this by finding `catch (e: any) {` then scanning the matched braces.
  const re = /catch\s*\(\s*e\s*:\s*any\s*\)\s*\{/g;
  let m;
  const outChunks = [];
  let cursor = 0;
  while ((m = re.exec(content)) !== null) {
    outChunks.push(content.slice(cursor, m.index));
    const headerEnd = m.index + m[0].length;
    // walk until matching close brace
    let depth = 1;
    let i = headerEnd;
    let inStr = null;
    let inComment = null;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      const next = content[i + 1];
      if (inComment === "line") {
        if (ch === "\n") inComment = null;
        i++;
        continue;
      }
      if (inComment === "block") {
        if (ch === "*" && next === "/") {
          inComment = null;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inStr) inStr = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        i++;
        continue;
      }
      if (ch === "/" && next === "/") {
        inComment = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        inComment = "block";
        i += 2;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    // i now points just past matching close brace
    const closeBraceIndex = i - 1;
    const body = content.slice(headerEnd, closeBraceIndex);
    let newBody = body;
    // Within body, transform e.message usages:
    //  - `e.message` → `(e instanceof Error ? e.message : String(e))`
    //  - keep references inside template literals / strings? Only replace
    //    identifier-style uses (followed by non-identifier char).
    // Conservative transform: replace `e.message` exact token.
    newBody = newBody.replace(/\be\.message\b/g, "(e instanceof Error ? e.message : String(e))");
    // Replace bare `e` casts like `e?.response?.status` if any — leave alone
    // (they’ll TypeError at runtime only on truly weird values; the cast was
    // already inherited from `any` so it’s a non-regression).
    //
    // If the original body had `message.error(<expr>(e instanceof Error ...))`
    // simplify back to `handleApiError(e)` ONLY when it’s the sole statement.
    const bodyTrim = newBody.trim().replace(/;$/, "").trim();
    if (bodyTrim === "message.error((e instanceof Error ? e.message : String(e)))") {
      newBody = newBody.replace(bodyTrim + ";", "handleApiError(e);").replace(bodyTrim, "handleApiError(e)");
      usedHelper = true;
    }
    outChunks.push("catch (e) {" + newBody + "}");
    cursor = i;
    changed = true;
  }
  outChunks.push(content.slice(cursor));
  content = outChunks.join("");

  // After the AST-style walk, also replace one-liner `catch (e: any) { ... }`
  // that may have been split across patterns. (Idempotent.)
  return { content, changed, usedHelper };
}

const files = listFiles();
let touched = 0;
for (const file of files) {
  const orig = readFileSync(file, "utf8");
  if (!orig.includes("catch (e: any)")) continue;
  const { content, changed, usedHelper } = transform(orig);
  if (!changed) continue;
  let out = content;
  if (usedHelper) {
    out = ensureImport(out, file);
  }
  if (out !== orig) {
    writeFileSync(file, out, "utf8");
    touched++;
    console.log("[migrated]", relative(ROOT, file));
  }
}
console.log("Total files touched:", touched);
