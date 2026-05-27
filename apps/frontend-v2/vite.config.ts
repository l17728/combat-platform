import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.VITE_API_PORT || '3001';
const apiTarget = `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    allowedHosts: true,
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: 5174,
    allowedHosts: true,
    proxy: { '/api': apiTarget },
  },
} as any);
