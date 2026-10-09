import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      '.impeccable/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    rules: {
      'one-var': ['error', 'never'],
      'lines-between-class-members': ['error', 'always'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        {
          blankLine: 'always',
          prev: [
            'export',
            'function',
            'class',
            'block-like',
            'if',
            'for',
            'while',
            'switch',
            'try',
          ],
          next: '*',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: ['export', 'function', 'class', 'return', 'if', 'for', 'while', 'switch', 'try'],
        },
        {
          blankLine: 'always',
          prev: ['multiline-const', 'multiline-let', 'multiline-var', 'multiline-expression'],
          next: '*',
        },
        { blankLine: 'any', prev: 'import', next: 'import' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
