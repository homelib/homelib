import mufan, {configs} from '@mufan/eslint-plugin';
import {defineConfig, globalIgnores} from 'eslint/config';

export default defineConfig([
  globalIgnores([
    'packages/x/bld/',
    'packages/core/bld/',
    'packages/http/bld/',
    'packages/dashboard/bld/',
    'packages/cli/bld/',
    'packages/universal/bld/',
    'packages/xiaomi/bld/',
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
  // packages/x/src/library
  {
    files: ['packages/x/src/library/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/x/src/node
  {
    files: ['packages/x/src/node/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/x/src/browser
  {
    files: ['packages/x/src/browser/**/*.{ts,tsx}'],
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
  // packages/core/src/mobx
  {
    files: ['packages/core/src/mobx/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/core/src/browser
  {
    files: ['packages/core/src/browser/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/core/src/test
  {
    files: ['packages/core/src/test/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript, configs.dev],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/http/src/definitions
  {
    files: ['packages/http/src/definitions/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/http/src/library
  {
    files: ['packages/http/src/library/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/dashboard/src/program
  {
    files: ['packages/dashboard/src/program/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript, configs.react],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/dashboard
  {
    files: ['packages/dashboard/*.ts'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript, configs.dev],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/cli/src/program
  {
    files: ['packages/cli/src/program/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/universal/src/library
  {
    files: ['packages/universal/src/library/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/universal/src/browser
  {
    files: ['packages/universal/src/browser/**/*.{ts,tsx}'],
    plugins: {'@mufan': mufan},
    extends: [configs.typescript],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // packages/xiaomi/src/library
  {
    files: ['packages/xiaomi/src/library/**/*.{ts,tsx}'],
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
