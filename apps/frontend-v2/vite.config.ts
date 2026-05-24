import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    allowedHosts: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
  preview: {
    port: 5174,
    allowedHosts: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
} as any);
