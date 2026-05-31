#!/usr/bin/env node
// Run backend tests against a local PostgreSQL.
//
// Default URL: postgres://postgres:postgres@localhost:5433/combat_test_regression
// Override with COMBAT_TEST_DB_URL env var if needed.
//
// Prereqs:
//   - PostgreSQL reachable at the URL above
//   - Database `combat_test_regression` exists (UTF-8 encoding recommended)
//
// Cross-platform: works on Windows/Linux/macOS without cross-env.

import { spawn } from "node:child_process";

const PG_URL = process.env.COMBAT_TEST_DB_URL || "postgres://postgres:postgres@localhost:5433/combat_test_regression";

const env = { ...process.env, COMBAT_TEST_DB_URL: PG_URL };

const child = spawn("npm", ["run", "test", "--workspace=@combat/backend"], { stdio: "inherit", env, shell: true });

child.on("exit", (code) => process.exit(code ?? 1));
