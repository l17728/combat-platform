// DETERMINISM helper: invoked by the backend webServer command (cwd =
// apps/backend) immediately before `tsx src/server.ts` boots, so the fresh
// backend always opens an empty SQLite db AND reads pristine schema config.
// Running it here (after Playwright has confirmed port 3001 is free and any
// previous backend process has exited) avoids the cross-run race where
// global-setup runs at the wrong time relative to the webServer.
const { rmSync } = require("node:fs");
const { execSync } = require("node:child_process");
const { join } = require("node:path");

for (const f of ["combat.sqlite", "combat.sqlite-wal", "combat.sqlite-shm"]) {
  try { rmSync(join(process.cwd(), f), { force: true }); } catch { /* ignore */ }
}

// Schema-mutation e2e (PATCH /api/schema) permanently rewrites the live
// config/schemas/*.json. Restore them from git HEAD before the backend boots
// so every run starts from the pristine committed schema (cross-run
// determinism + no shared dev-config corruption). cwd here = apps/backend.
try {
  execSync("git checkout -- config/schemas/attackTicket.json config/schemas/person.json",
    { cwd: join(process.cwd(), "..", ".."), stdio: "ignore" });
} catch { /* ignore (e.g. files unchanged) */ }
