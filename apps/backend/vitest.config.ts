import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Some tests (e.g. archive.e2e) construct `new FileSchemaRegistry("config/schemas")`
// using a path relative to the workspace root. Vitest runs with cwd = apps/backend,
// so we chdir to the workspace root at config load (before any test file is loaded)
// so that workspace-relative paths resolve correctly.
const workspaceRoot = resolve(__dirname, "..", "..");
process.chdir(workspaceRoot);

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    root: __dirname,
  },
});
