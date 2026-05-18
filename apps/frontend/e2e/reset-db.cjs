// DETERMINISM helper: invoked by the backend webServer command (cwd =
// apps/backend) immediately before `tsx src/server.ts` boots, so the fresh
// backend always opens an empty SQLite db. Running it here (after Playwright
// has confirmed port 3001 is free and any previous backend process has
// exited) avoids the cross-run race where global-setup deletes the files
// while the OS still holds a pending handle from the prior run.
const { rmSync } = require("node:fs");
const { join } = require("node:path");
for (const f of ["combat.sqlite", "combat.sqlite-wal", "combat.sqlite-shm"]) {
  try { rmSync(join(process.cwd(), f), { force: true }); } catch { /* ignore */ }
}
