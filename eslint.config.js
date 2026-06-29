import mufan, {configs} from '@mufan/eslint-plugin';
import {defineConfig, globalIgnores} from 'eslint/config';

export default defineConfig([
  globalIgnores(['packages/core/bld/']),
  {
    files: ['**/*.{js,mjs,cjs}'],
    plugins: {'@mufan': mufan},
    extends: [configs.javascript],
  },
  {
    files: ['eslint.config.js'],
    plugins: {'@mufan': mufan},
    extends: [configs.dev],
  },
  // packages/core/src/library
  {
    files: ['packages/core/src/library/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/core/src/library/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
  },
]);
