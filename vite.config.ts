import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    __LEARNR_BUILD_ID__: JSON.stringify(process.env.LEARNR_BUILD_ID ?? 'development'),
    __LEARNR_BROWSER_TARGET__: JSON.stringify(process.env.LEARNR_BROWSER_TARGET ?? 'chromium'),
  },
  build: {
    outDir: process.env.LEARNR_OUT_DIR ?? 'dist',
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(projectRoot, 'sidepanel.html'),
        settings: resolve(projectRoot, 'settings.html'),
        history: resolve(projectRoot, 'history.html'),
        note: resolve(projectRoot, 'note.html'),
        microphone: resolve(projectRoot, 'microphone.html'),
        offscreen: resolve(projectRoot, 'offscreen.html'),
        background: resolve(projectRoot, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
