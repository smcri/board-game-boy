import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/main.tsx',
      name: 'BGB',
      fileName: 'game',
      formats: ['iife'],
    },
    cssCodeSplit: false,
    assetsInlineLimit: 65536,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
