import {join} from 'path';

import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  root: 'src/program',
  publicDir: join(__dirname, 'public'),
  resolve: {
    // conditions: ['source'],
    // preserveSymlinks: false,
    dedupe: ['react', 'react-dom', 'mobx'],
  },
  plugins: [react()],
  optimizeDeps: {
    include: ['routra', 'routra-react'],
  },
  server: {
    port: 4780,
    strictPort: true,
  },
  build: {
    target: 'es2018',
    sourcemap: true,
    outDir: join(__dirname, 'bld/program'),
    emptyOutDir: true,
  },
});
