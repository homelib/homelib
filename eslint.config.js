import mufan, {configs} from '@mufan/eslint-plugin';
import {defineConfig, globalIgnores} from 'eslint/config';

const LIBRARY_TEST_RULES = {
  '@mufan/import': 'off',
  '@mufan/scoped-modules': 'off',
};

export default defineConfig([
  globalIgnores([
    'packages/core/bld/',
    'packages/terminal/bld/',
    'packages/web/bld/',
    'packages/website/.bld/',
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
    files: ['packages/core/src/library/tests/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
    rules: LIBRARY_TEST_RULES,
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
    files: ['packages/terminal/src/library/tests/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
    rules: LIBRARY_TEST_RULES,
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
    files: ['packages/utils/src/library/tests/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
    rules: LIBRARY_TEST_RULES,
  },
  // packages/website/src/www
  {
    files: ['packages/website/src/www/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/xiaomi/src/cli
  {
    files: ['packages/xiaomi/src/cli/**/*.{ts,tsx}'],
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
    files: ['packages/xiaomi/src/cli/**/*.test.{ts,tsx}'],
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
    files: ['packages/xiaomi/src/library/tests/**/*.test.{ts,tsx}'],
    extends: [configs.dev],
    rules: LIBRARY_TEST_RULES,
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
