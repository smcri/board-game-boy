// Root ESLint flat config — conservative rule set targeted at bug-prevention.
// See docs/decisions/ADR-0001-record-format.md for project conventions.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // Skip generated, vendor, and build outputs.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.vite/**',
      '**/bundles/**',
      '**/.data/**',
      '**/coverage/**',
      'apps/*/dist/**',
      'packages/*/dist/**',
    ],
  },

  // Base recommended rules.
  js.configs.recommended,

  // TypeScript files: typed-aware rules.
  ...tseslint.configs.recommended,

  // Project-wide bug-prevention rules.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: false, // type-aware rules require tsconfig refs; skip for speed
      },
    },
    rules: {
      // Catches missing-await bugs (the libsql migration class). Without
      // typed linting we can only catch the obvious form; project-aware mode
      // is opt-in later.
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'off', // false-positive prone

      // Imports.
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],

      // Allow `_`-prefixed unused args (common pattern in this codebase).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // We deliberately use `any` at LangGraph 0.0.21 typing boundaries and
      // a handful of test fixtures. Downgrade to warn rather than block.
      '@typescript-eslint/no-explicit-any': 'warn',

      // `no-undef` is redundant with TS; turn it off for .ts files.
      'no-undef': 'off',
    },
  },

  // Apps must not redeclare shared Zod enums — they must import the canonical
  // `LlmProvider`, `SearchProvider`, `BuildMode`, etc., from `@bgb/shared`.
  // This rule would have caught the duplicate-enum class of bug we hit.
  {
    files: ['apps/**/src/**/*.ts', 'apps/**/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Match `z.enum([...])` literal calls in apps/. Shared package is
          // the only place these are allowed.
          selector:
            "CallExpression[callee.object.name='z'][callee.property.name='enum']",
          message:
            "Do not declare z.enum([...]) inside apps/. Import the canonical schema from '@bgb/shared' instead — this preserves single-source-of-truth for cross-cutting enums.",
        },
      ],
    },
  },

  // Test files: relax the rule (mocks frequently use `any`).
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // CommonJS config files (PostCSS, Tailwind) — opt in to node globals.
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Normaliser files deliberately match ASCII control chars; that's the
  // *whole point* of these regexes. Suppress the rule narrowly.
  {
    files: ['apps/ui/src/lib/storage.ts', 'apps/ui/src/components/SettingsPanel.tsx'],
    rules: { 'no-control-regex': 'off' },
  },
];
