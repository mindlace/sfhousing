import { defineConfig, devices } from '@playwright/test';

const port = process.env.SFH_E2E_PORT ?? '4173';

const perf = '**/*.perf.spec.ts';
// bench/** is the headed GPU benchmark, run only via `npm run bench:map`.
const ignored = ['fixtures/**', 'helpers/**', 'bench/**', perf];
const desktop = devices['Desktop Chrome'];
const mobile = {
  ...devices['Desktop Chrome'],
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: process.env.SFH_E2E_WORKERS ? Number(process.env.SFH_E2E_WORKERS) : undefined,
  forbidOnly: !!process.env.CI,
  // One retry everywhere: a retried pass still passes, but chreode's reporter records it, and
  // the third occurrence of the same flake fails signoff.
  retries: 1,
  reporter: process.env.CI
    ? [['github'], ['list'], ['@mindlace/chreode/reporters/playwright']]
    : [['list'], ['@mindlace/chreode/reporters/playwright']],
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'chromium', testIgnore: ignored, use: desktop },
    { name: 'mobile', testIgnore: ignored, use: mobile },
    // Wall-clock budgets run alone, after every parallel test: parallel workers compete for CPU and
    // inflate the timings. The chain chromium+mobile -> chromium-perf -> mobile-perf keeps them serial.
    {
      name: 'chromium-perf',
      testMatch: perf,
      use: desktop,
      dependencies: ['chromium', 'mobile']
    },
    { name: 'mobile-perf', testMatch: perf, use: mobile, dependencies: ['chromium-perf'] }
  ],
  webServer: {
    // VITE_E2E=1 compiles the map debug hook (window.__sfhMap) into this build only.
    command: `npm run data:fixture && npm run db:migrate && VITE_E2E=1 npm run build && wrangler dev --port ${port} --var ENVIRONMENT:development --var PUBLIC_DATASET_VERSION:fixture-0`,
    url: `http://localhost:${port}/about`,
    // A reused :4173 server may be a stale build from another worktree, which silently tests the wrong code; Playwright now fails loudly if the port is busy.
    reuseExistingServer: false,
    timeout: 180_000
  }
});
