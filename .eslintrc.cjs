/**
 * Root ESLint config (legacy .eslintrc.cjs).
 * Goals: keep new code clean, do not block on existing warnings.
 * - TypeScript: parser + @typescript-eslint/recommended
 * - React Hooks rules for frontend-v2
 * - Pragmatic rules: no-unused-vars/no-console as warn, prefer-const as error
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  rules: {
    'prefer-const': 'warn',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-empty-function': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-catch': 'warn',
    'no-useless-escape': 'warn',
  },
  overrides: [
    {
      files: ['apps/frontend-v2/**/*.{ts,tsx}'],
      rules: {
        'react-hooks/rules-of-hooks': 'warn',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/e2e/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
    {
      files: ['scripts/**/*.{js,mjs,cjs,ts}'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.worktrees/',
    'apps/frontend/',
    'apps/*/dist/',
    'apps/*/build/',
    'apps/backend/uploads/',
    'data_backup_production/',
    '**/playwright-report/',
    '**/test-results/',
    'scripts/deploy/node_modules/',
    'scripts/deploy-v2/node_modules/',
    'coverage/',
    '*.png',
    '*.xlsx',
    '*.sqlite*',
  ],
};
