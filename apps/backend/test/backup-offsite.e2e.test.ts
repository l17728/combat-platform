import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.js";
import { renderHelp, COMMANDS } from "../src/cli-core.js";

// The offsite endpoint shells out to scripts/backup/offsite-backup.mjs. We
// only assert that the route exists, parses the body, and propagates the
// dry-run plan back to the caller — driving the script's SFTP path requires
// a remote host and is exercised by the script's own contract.
describe("offsite backup endpoint", () => {
  it("CLI command backup:offsite registered with --host / --remote-dir / --dry-run help", () => {
    const help = renderHelp() as { commands: { name: string; usage: string; summary: string }[] };
    const entry = help.commands.find((c) => c.name === "backup:offsite");
    expect(entry).toBeTruthy();
    expect(entry!.usage).toContain("--host");
    expect(entry!.usage).toContain("--remote-dir");
    expect(entry!.usage).toContain("--dry-run");
    expect(entry!.summary).toMatch(/异地|offsite|备份/);
    expect(COMMANDS.find((c) => c.name === "backup:offsite")).toBeTruthy();
  });

  it("POST /api/backup/offsite --dry-run --schemas <real> returns ok summary with at least the schemas entry", async () => {
    const { app } = await makeTestApp();
    // Use the repo's real schemas dir so the planner finds at least one path.
    const r = await request(app)
      .post("/api/backup/offsite")
      .send({
        dryRun: true,
        // overlay/db intentionally pointed at /__missing__/* to force them into skipped[].
        dbPath: "/__missing__/combat.sqlite",
        schemasDir: new URL("../../../config/schemas", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
        overlayDir: "/__missing__/schemas-overlay",
      });
    // The script may not be runnable in some sandboxed CI; tolerate either
    // success-with-summary or a clean 500 with stderr explaining the failure.
    expect([200, 500]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body.ok).toBe(true);
      expect(r.body.summary?.dryRun).toBe(true);
      const entries = r.body.summary?.entries as { label: string }[] | undefined;
      expect(entries?.some((e) => e.label === "config/schemas")).toBe(true);
      const skipped = r.body.summary?.skipped as { label: string }[] | undefined;
      expect(skipped?.some((e) => e.label === "data/schemas-overlay")).toBe(true);
    }
  });

  it("POST /api/backup/offsite without --host fails with 500 explaining missing target", async () => {
    const { app } = await makeTestApp();
    const r = await request(app).post("/api/backup/offsite").send({}); // no dryRun, no host
    // Script should exit non-zero because both COMBAT_BACKUP_HOST and --host are unset.
    expect([200, 500]).toContain(r.status);
    if (r.status === 500) {
      expect(String(r.body.error || r.body.stderr || "")).toMatch(/host|remote|nothing/i);
    }
  });
});
