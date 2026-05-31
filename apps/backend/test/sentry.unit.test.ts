import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initSentry, captureException, isSentryEnabled } from "../src/sentry.js";

describe("sentry integration", () => {
  let originalDsn: string | undefined;

  beforeEach(() => {
    originalDsn = process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it("initSentry without SENTRY_DSN is no-op (idempotent)", () => {
    delete process.env.SENTRY_DSN;
    expect(() => initSentry()).not.toThrow();
    expect(isSentryEnabled()).toBe(false);
  });

  it("captureException without init is silently no-op", () => {
    delete process.env.SENTRY_DSN;
    expect(() => captureException(new Error("test"), { source: "unit" })).not.toThrow();
    expect(() => captureException("string err")).not.toThrow();
  });
});
