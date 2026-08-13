import mufan, {configs} from '@mufan/eslint-plugin';
import {defineConfig, globalIgnores} from 'eslint/config';

export default defineConfig([
  globalIgnores([
    'packages/core/bld/',
    'packages/terminal/bld/',
    'packages/web/bld/',
    'packages/utils/bld/',
    'packages/xiaomi/bld/',
    'packages/playground/bld/',
  ]),
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
  // packages/core/src/exports
  {
    files: ['packages/core/src/exports/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/core/src/library
  {
    files: ['packages/core/src/library/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript, configs.react],
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
  // packages/terminal/src/library
  {
    files: ['packages/terminal/src/library/**/*.{ts,tsx}'],
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
    files: ['packages/terminal/src/library/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
  },
  // packages/web/src/library
  {
    files: ['packages/web/src/library/**/*.{ts,tsx}'],
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
    files: ['packages/web/src/library/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
  },
  // packages/utils/src/library
  {
    files: ['packages/utils/src/library/**/*.{ts,tsx}'],
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
    files: ['packages/utils/src/library/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
  },
  // packages/xiaomi/src/library
  {
    files: ['packages/xiaomi/src/library/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript, configs.react],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/xiaomi/src/library/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
  },
  // packages/playground/src/program
  {
    files: ['packages/playground/src/program/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
