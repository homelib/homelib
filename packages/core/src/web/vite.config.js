// @ts-check

import {join} from 'path';

import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  root: __dirname,
  publicDir: join(__dirname, 'public'),
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
    outDir: join(__dirname, '../../bld/web'),
    emptyOutDir: true,
  },
});
