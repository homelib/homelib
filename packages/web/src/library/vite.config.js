// @ts-check

import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  publicDir: join(root, 'public'),
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  clearScreen: false,
  server: {
    host: true,
  },
  build: {
    target: 'es2024',
    outDir: join(root, '../../bld/web'),
    emptyOutDir: true,
  },
});
