// @ts-check

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import react from '@vitejs/plugin-react';
import {codeToHtml} from 'shiki';
import {defineConfig} from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

const codeSamplePath = join(root, 'code-sample.txt');

const homeCodePlugin = {
  name: 'home-code',
  resolveId(source) {
    if (source === 'virtual:home-code') {
      return '\0virtual:home-code';
    }
  },
  async load(id) {
    if (id !== '\0virtual:home-code') {
      return;
    }

    const code = readFileSync(codeSamplePath, 'utf8');
    const html = await codeToHtml(code, {lang: 'ts', theme: 'github-light'});

    return `export default ${JSON.stringify(html)};`;
  },
};

export default defineConfig({
  root,
  publicDir: join(root, 'public'),
  plugins: [react(), homeCodePlugin],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  clearScreen: false,
  server: {
    host: true,
  },
  build: {
    target: 'es2024',
    outDir: join(root, '../../.bld/www'),
    emptyOutDir: true,
  },
});
