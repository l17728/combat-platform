import { defineConfig } from "vitest/config";

// When running against a shared Postgres database (COMBAT_TEST_DB_URL set),
// tests MUST run sequentially because they share the same db (TRUNCATEd
// between makeTestApp() calls). Parallel file execution would corrupt
// state across vitest workers.
const USE_PG = !!process.env.COMBAT_TEST_DB_URL;

export default defineConfig({
  test: {
    // Vitest default: parallel files. Switch to sequential when we share PG.
    fileParallelism: !USE_PG,
    pool: USE_PG ? "forks" : undefined,
    poolOptions: USE_PG
      ? { forks: { singleFork: true } }
      : undefined,
    // PG transactions are async; some suites involve large fixtures so the
    // SQLite-fast timeouts can flake on PG. Bump moderately for both paths.
    testTimeout: USE_PG ? 30000 : 10000,
    hookTimeout: USE_PG ? 30000 : 10000,
  },
});
