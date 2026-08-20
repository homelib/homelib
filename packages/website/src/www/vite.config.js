// @ts-check

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import react from '@vitejs/plugin-react';
import {codeToHtml} from 'shiki';
import {defineConfig} from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

const codeSamples = {
  en: {file: 'code-sample.txt'},
  'zh-CN': {file: 'code-sample.zh-CN.txt'},
};

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

    const htmlByLocale = {};
    for (const [locale, sample] of Object.entries(codeSamples)) {
      const code = readFileSync(join(root, sample.file), 'utf8');
      htmlByLocale[locale] = await codeToHtml(code, {
        lang: 'ts',
        theme: 'github-light',
      });
    }

    return `export default ${JSON.stringify(htmlByLocale)};`;
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
