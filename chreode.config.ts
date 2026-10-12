import { defineConfig } from '@mindlace/chreode';

export default defineConfig({
  rules: [
    // Prettier- and eslint-ignored: nothing checks these.
    { match: ['docs/superpowers/**', '.superpowers/**'], triggers: [] },
    // Markdown is prettier-managed; eslint ignores it.
    // docs-index.spec.ts (in test:unit) asserts every docs/dev/*.md is linked from CLAUDE.md.
    { match: ['CLAUDE.md', 'docs/dev/**'], triggers: ['format', 'unit'] },
    { match: ['**/*.md'], triggers: ['format'] },
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
    { label: 'test:unit', run: 'npm run test:unit', when: ['unit'], policeStderr: true },
    {
      label: 'test:e2e',
      run: 'npm run test:e2e',
      when: ['e2e'],
      policeStderr: true,
      timeoutMs: 15 * 60_000
    },
    { label: 'lint:workflows', run: 'npm run lint:workflows', when: ['workflows'] }
  ],
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
    }
  ],
  // npm ci also runs prepare (wrangler types / svelte-kit sync) for the merged tree.
  afterMerge: 'npx -y npm@11.21.0 ci'
});
