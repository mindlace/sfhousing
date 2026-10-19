import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import playwright from 'eslint-plugin-playwright';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  { ignores: ['docs/**', 'e2e/fixtures/**', 'migrations/**', '.superpowers/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // typescript-eslint recommends disabling no-undef for TS projects
      'no-undef': 'off',
      // No base path; plain hrefs are fine (matches planafoot).
      'svelte/no-navigation-without-resolve': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig
      }
    }
  },
  { files: ['e2e/**'], ...playwright.configs['flat/recommended'] },
  {
    // plan-sharing: its components run in the client test project, whose `$app/*` stubs exist
    // for route specs only; sharing code must stay free of `$app/*`.
    files: ['src/lib/sharing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$app/*'],
              message: 'src/lib/sharing must not import $app/* (see docs/dev/testing.md).'
            }
          ]
        }
      ]
    }
  },
  {
    // FZP timelapse: exp/log on determinism paths come from src/lib/timelapse/math.ts (fdlibm),
    // never the engine's Math functions or the `**` operator, which differ across JS engines.
    // Math members with an exact spec (sqrt, fround, floor, ceil, round, trunc, abs, min, max,
    // sign, imul, clz32) stay allowed.
    files: ['src/lib/timelapse/**', 'src/lib/sim/scenario/**', 'pipeline/lib/fzp-cal/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          'exp',
          'log',
          'pow',
          'log1p',
          'expm1',
          'log2',
          'log10',
          'cbrt',
          'sin',
          'cos',
          'tan',
          'asin',
          'acos',
          'atan',
          'atan2',
          'sinh',
          'cosh',
          'tanh',
          'asinh',
          'acosh',
          'atanh',
          'hypot'
        ].map((property) => ({
          object: 'Math',
          property,
          message: 'Use src/lib/timelapse/math.ts (determinism, stage-calibration §4.1a).'
        }))
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**']",
          message:
            'Use exp/log from src/lib/timelapse/math.ts (determinism, stage-calibration §4.1a).'
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message:
            'Use exp/log from src/lib/timelapse/math.ts (determinism, stage-calibration §4.1a).'
        }
      ]
    }
  }
);
