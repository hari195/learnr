import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __LEARNR_BUILD_ID__: JSON.stringify(process.env.LEARNR_BUILD_ID ?? 'development'),
    __LEARNR_BROWSER_TARGET__: JSON.stringify(process.env.LEARNR_BROWSER_TARGET ?? 'chromium'),
  },
  build: {
    outDir: process.env.LEARNR_OUT_DIR ?? 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(projectRoot, 'src/content.tsx'),
      name: 'LearnrContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
