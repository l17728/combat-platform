import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || "combat-backend",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE || "0"),
  });
  initialized = true;
}

export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  if (!initialized) return;
  if (ctx) Sentry.setContext("combat", ctx);
  Sentry.captureException(err);
}

export function isSentryEnabled(): boolean {
  return initialized;
}
