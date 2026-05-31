import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: (import.meta.env.MODE as string) || "development",
    release: (import.meta.env.VITE_SENTRY_RELEASE as string) || "combat-frontend",
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE || "0"),
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
