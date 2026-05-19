import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // allowedHosts:true — this dev server is also the manual-test deploy (reached via
  // arbitrary domains/IP, e.g. www.catown.cloud through nginx). Test env, no secrets/auth;
  // localhost e2e unaffected. Tighten if this ever serves a real environment.
  server: { port: 5173, allowedHosts: true, proxy: { "/api": "http://localhost:3001" } },
});
