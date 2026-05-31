/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_TRACES_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
