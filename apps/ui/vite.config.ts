import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// For GitHub Pages deployment: use VITE_BASE_PATH env var (default '/').
const basePath = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react()],
  base: basePath,
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'ES2022',
  },
});
