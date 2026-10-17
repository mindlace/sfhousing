import { burnInStep, defineConfig } from '@mindlace/chreode';

export default defineConfig({
  rules: [
    // Prettier- and eslint-ignored: nothing checks these.
    { match: ['docs/superpowers/**', '.superpowers/**'], triggers: [] },
    // Markdown is prettier-managed; eslint ignores it.
    // docs-index.spec.ts (in test:unit) asserts every docs/dev/*.md is linked from CLAUDE.md.
    { match: ['CLAUDE.md', 'docs/dev/**'], triggers: ['format', 'unit'] },
    { match: ['**/*.md'], triggers: ['format'] },
    // The scenario step and the dataset-version code hash read these, so a change here also runs
    // test:pipeline. Before the src/** rule: the first matching rule wins.
    {
      match: [
        'src/lib/generator/**',
        'src/lib/timelapse/**',
        'src/lib/data/**',
        'src/lib/plan/types.ts',
        'src/lib/plan/geometry.ts'
      ],
      triggers: ['lint', 'check', 'unit', 'e2e', 'pipeline']
    },
    { match: ['src/**'], triggers: ['lint', 'check', 'unit', 'e2e'] },
    { match: ['e2e/**'], triggers: ['lint', 'check', 'e2e'] },
    // scripts/ specs run in the vitest server project; r2-load-local feeds e2e (data:fixture).
    { match: ['scripts/**'], triggers: ['lint', 'check', 'unit', 'e2e'] },
    { match: ['.github/workflows/**'], triggers: ['format', 'workflows'] }
    // Everything else (pipeline/, migrations/, package*.json, root configs, .husky/) matches
    // no rule and runs every step.
  ],
  steps: [
    { label: 'format', run: 'npx prettier --check .', when: ['format'], supersededBy: ['lint'] },
    { label: 'lint', run: 'npm run lint', when: ['lint'] },
    { label: 'check', run: 'npm run check', when: ['check'] },
    { label: 'test:pipeline', run: 'npm run test:pipeline', when: ['pipeline'] },
    { label: 'test:unit', run: 'npm run test:unit', when: ['unit'], policeStderr: true },
    {
      label: 'test:e2e',
      run: 'npm run test:e2e',
      when: ['e2e'],
      policeStderr: true,
      timeoutMs: 15 * 60_000
    },
    // Each Playwright invocation rebuilds the app (webServer), hence the longer ceiling.
    burnInStep({ when: ['unit', 'e2e'], timeoutMs: 20 * 60_000 }),
    { label: 'lint:workflows', run: 'npm run lint:workflows', when: ['workflows'] }
  ],
  // Retried-then-passed tests become `flake` issues; the third occurrence fails signoff.
  flakes: {},
  burnIn: {
    runners: [
      {
        name: 'e2e',
        match: 'e2e/**/*.spec.ts',
        // Not tests (helpers, fixtures, the headed bench), or not in the chromium project (perf).
        ignore: ['e2e/helpers/**', 'e2e/fixtures/**', 'e2e/bench/**', 'e2e/**/*.perf.spec.ts'],
        // chromium only: --repeat-each multiplies across every project otherwise.
        command: (files, n) =>
          `npx playwright test --project chromium --repeat-each=${n} --retries=0 ${files.join(' ')}`
      },
      {
        // Before server, whose globs also match *.svelte.spec.ts.
        name: 'client',
        match: 'src/**/*.svelte.{test,spec}.ts',
        command: (files, n) =>
          Array.from(
            { length: n },
            () => `npx vitest --run --project client --retry=0 ${files.join(' ')}`
          )
      },
      {
        name: 'server',
        match: ['src/**/*.{test,spec}.ts', 'scripts/**/*.spec.ts'],
        command: (files, n) =>
          Array.from(
            { length: n },
            () => `npx vitest --run --project server --retry=0 ${files.join(' ')}`
          )
      }
    ]
  },
  stderrAllowlist: [
    // e2e/cache-headers.spec.ts and e2e/pages-a11y.spec.ts request /no-such-page on purpose;
    // wrangler dev logs each 404 to stderr as this three-line block.
    {
      pattern: /^\[WebServer\] ✘ \[ERROR\]\s*$/,
      reason: 'header of the expected /no-such-page 404 log block from wrangler dev'
    },
    {
      pattern: /^\[WebServer\]\s+\[404\] GET \/no-such-page\s*$/,
      reason: 'the expected /no-such-page 404 that the e2e cache-headers and a11y specs request'
    },
    {
      pattern: /^\[WebServer\]\s*$/,
      reason: 'empty spacer lines wrangler dev prints around each log block'
    },
    // wrangler's esbuild warns about SvelteKit's generated .svelte-kit/output/server/chunks/client.js
    // (`import "devalue";`) because devalue declares "sideEffects": false. Nothing in the repo can
    // change that output. Each line of the block is anchored to this exact warning.
    {
      pattern:
        /^\[WebServer\] ▲ \[WARNING\] Ignoring this import because "node_modules\/devalue\/index\.js" was marked as having no side effects \[ignored-bare-import\]\s*$/,
      reason:
        'header of the esbuild ignored-bare-import warning for devalue in the SvelteKit server output'
    },
    {
      pattern: /^\[WebServer\]\s+\.svelte-kit\/output\/server\/chunks\/client\.js:\d+:\d+:\s*$/,
      reason: 'location line of the devalue ignored-bare-import warning (SvelteKit server chunk)'
    },
    {
      pattern: /^\[WebServer\]\s+\d+ │ import "devalue";\s*$/,
      reason: 'code frame of the devalue ignored-bare-import warning'
    },
    {
      pattern: /^\[WebServer\]\s+╵\s+~{9}\s*$/,
      reason:
        'underline of the devalue import (9 tildes); generic shape, so any other 9-character esbuild underline would also match'
    },
    {
      pattern: /^\[WebServer\]\s+"sideEffects" is false in the enclosing "package\.json" file:\s*$/,
      reason: 'explanation line of the devalue ignored-bare-import warning'
    },
    {
      pattern: /^\[WebServer\]\s+node_modules\/devalue\/package\.json:\d+:\d+:\s*$/,
      reason: 'location line of the devalue package.json sideEffects note'
    },
    {
      pattern: /^\[WebServer\]\s+\d+ │\s+"sideEffects": false,\s*$/,
      reason: 'code frame of the devalue package.json sideEffects note'
    },
    {
      pattern: /^\[WebServer\]\s+╵\s+~{13}\s*$/,
      reason:
        'underline of "sideEffects" (13 tildes); generic shape, so any other 13-character esbuild underline would also match'
    }
  ],
  // npm ci also runs prepare (wrangler types / svelte-kit sync) for the merged tree.
  afterMerge: 'npx -y npm@11.21.0 ci'
});
