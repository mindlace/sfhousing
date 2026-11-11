import { burnInStep, defineConfig, timingStep } from '@mindlace/chreode';

export default defineConfig({
  rules: [
    // Prettier- and eslint-ignored: nothing checks these.
    { match: ['docs/superpowers/**', '.superpowers/**'], triggers: [] },
    // Markdown is prettier-managed; eslint ignores it.
    // docs-index.spec.ts (in test:unit) asserts every docs/dev/*.md is linked from CLAUDE.md.
    // pipeline/test/quality.test.ts (in test:pipeline) asserts pipeline.md's generated Data
    // quality section equals qualityDocSection(). Before the docs/dev/** rule: the first matching
    // rule wins.
    { match: ['docs/dev/pipeline.md'], triggers: ['format', 'unit', 'pipeline'] },
    { match: ['CLAUDE.md', 'docs/dev/**'], triggers: ['format', 'unit'] },
    // The scenario step and the dataset-version code hash read these (the code hash is load-bearing
    // for deploys: both workflows refuse a commit whose dataset is unpublished), so a change here
    // also runs test:pipeline and the dataset check. Before the **/*.md and src/** rules: the first matching rule wins.
    {
      match: [
        'src/lib/generator/**',
        'src/lib/timelapse/**',
        'src/lib/data/**',
        'src/lib/plan/types.ts',
        'src/lib/plan/geometry.ts',
        'src/lib/sim/scenario/**',
        'src/lib/sim/levers/**',
        'src/lib/sim/finance/**',
        'src/lib/scoreboard/**'
      ],
      triggers: ['lint', 'check', 'unit', 'e2e', 'pipeline', 'dataset']
    },
    // The pipeline and the lock feed codeTreeHash/the version, so a change needs its dataset
    // published on staging (docs/dev/pipeline.md).
    {
      match: ['pipeline/**'],
      triggers: ['lint', 'check', 'unit', 'e2e', 'pipeline', 'dataset']
    },
    // Any other markdown is format-only. After the code-hash rules (a .md under pipeline/ or src/lib/data
    // is in the dataset code hash and needs the dataset step): the first matching rule wins.
    { match: ['**/*.md'], triggers: ['format'] },
    { match: ['src/**'], triggers: ['lint', 'check', 'unit', 'e2e'] },
    // fixture-0 is generated; pipeline/test/golden.test.ts compares it with the golden, so a
    // change here also runs test:pipeline. Before the e2e/** rule: the first matching rule wins.
    { match: ['e2e/fixtures/data/**'], triggers: ['lint', 'check', 'e2e', 'pipeline'] },
    { match: ['e2e/**'], triggers: ['lint', 'check', 'e2e'] },
    // scripts/ specs run in the vitest server project; r2-load-local feeds e2e (data:fixture).
    { match: ['scripts/**'], triggers: ['lint', 'check', 'unit', 'e2e'] },
    { match: ['.github/workflows/**'], triggers: ['format', 'workflows'] },
    // wrangler.jsonc: bindings and vars (no dataset version: the build computes it).
    // `wrangler types` (prepare, after the merge) feeds check; scripts/wrangler-config.spec.ts
    // (unit) parses it and asserts PUBLIC_DATASET_VERSION is absent.
    // chreode.config.ts: this file; check type-checks it.
    // A binding change, or a config change that should prove itself on every step, uses `-- --full`.
    { match: ['wrangler.jsonc', 'chreode.config.ts'], triggers: ['format', 'check', 'unit'] },
    // Read only by the release-please workflow.
    {
      match: ['.release-please-manifest.json', 'release-please-config.json'],
      triggers: ['format']
    },
    // Nothing in signoff reads these (the pre-commit hook runs on commit, not in signoff).
    { match: ['LICENSE', '.husky/**'], triggers: [] },
    // Prettier and eslint config; eslint.config.js also loads .gitignore as an ignore file.
    {
      match: ['.prettierignore', '.prettierrc', '.gitignore', 'eslint.config.js'],
      triggers: ['lint']
    },
    // The headed bench (`npm run bench:map`) and the drizzle-kit configs (db:generate, db:migrate)
    // are not signoff steps; lint and check still cover the files themselves.
    {
      match: ['playwright.bench.config.ts', 'drizzle.config.ts', 'drizzle-cf.config.ts'],
      triggers: ['lint', 'check']
    },
    { match: ['playwright.config.ts'], triggers: ['lint', 'check', 'e2e'] },
    // The vitest client project.
    { match: ['vite.config.client-test.ts'], triggers: ['lint', 'check', 'unit'] }
    // Everything else (migrations/, package*.json, .npmrc, .nvmrc, tsconfig.json,
    // vite.config.ts, svelte.config.js) matches no rule and runs every step, dataset included.
  ],
  // A package.json / package-lock.json change that only bumps the version (release-please) runs
  // prettier alone: neither file feeds the dataset code hash (pipeline/lib/version.ts).
  versionBumpTriggers: ['format'],
  steps: [
    { label: 'dataset', run: 'npx tsx scripts/dataset-version.ts --check', when: ['dataset'] },
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
    // Fails on timing crutches (fixed waits, raised timeouts/retries, unconditional skips) that the
    // branch adds to tests. Reads the diff only; runs no tests.
    timingStep({ when: ['unit', 'e2e', 'pipeline'] }),
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
        // Wall-clock budgets live in the client-perf project (`npm run test:perf`), not client.
        ignore: ['src/**/*.perf.svelte.{test,spec}.ts'],
        command: (files, n) =>
          Array.from(
            { length: n },
            () => `npx vitest --run --project client --retry=0 ${files.join(' ')}`
          )
      },
      {
        name: 'server',
        match: ['src/**/*.{test,spec}.ts', 'scripts/**/*.spec.ts'],
        // Wall-clock budgets measure the machine as much as the code: they live in the perf
        // projects (`npm run test:perf`, run by hand on an idle machine), not in signoff.
        ignore: [
          'src/**/*.bench.spec.ts',
          'src/**/*.perf.spec.ts',
          'src/**/*.perf.svelte.{test,spec}.ts'
        ],
        command: (files, n) =>
          Array.from(
            { length: n },
            () => `npx vitest --run --project server --retry=0 ${files.join(' ')}`
          )
      }
    ]
  },
  timing: {
    // Test code and test configs only. The default globs take every file under e2e/ and test/,
    // which here includes fixture data (pmtiles, pbf, png, json) that would be diffed as text.
    // Perf and bench tests (*.perf.*, *.bench.*, e2e/bench/**) keep the default exemption.
    match: [
      '**/*.{spec,test}.{ts,js}',
      'e2e/**/*.ts',
      'pipeline/test/**/*.ts',
      'playwright.config.ts',
      'vite.config.ts',
      'vite.config.client-test.ts'
    ]
  },
  stderrAllowlist: [
    // Under burn-in load, wrangler dev's ProxyWorker (node_modules/wrangler/wrangler-dist/
    // ProxyWorker.js) retries a GET/HEAD whose internal connection to the UserWorker dropped, and
    // warns once the retry succeeds. The request still succeeds; a request that fails for good fails
    // its test. Only the "recovered" line is allowed, not a failure.
    {
      pattern:
        /^\[WebServer\] ▲ \[WARNING\] ProxyWorker: (GET|HEAD) http:\/\/localhost:4173\/\S+ recovered on attempt \d+ after a dropped connection to the UserWorker\s*$/,
      reason: "wrangler dev's proxy recovered a GET after a dropped local connection under load"
    },
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
