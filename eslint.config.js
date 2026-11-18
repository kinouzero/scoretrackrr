import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: [
      '.svelte-kit/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'src/lib/domain/engine/validators.generated.js',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    files: ['src/lib/domain/**/*.ts'],
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Domain modules must use static imports from trusted source code.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'svelte',
            'svelte/*',
            'dexie',
            '$app/*',
            '$env/*',
            '#lib/storage/*',
            '#lib/application/*',
            '#lib/components/*',
            '#lib/multiplayer/*',
            'node:*',
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'indexedDB',
        'localStorage',
        'sessionStorage',
        'fetch',
        'WebSocket',
        'RTCPeerConnection',
      ],
    },
  },
);
