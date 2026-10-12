import { defineConfig, devices } from '@playwright/test';

const port = process.env.SFH_E2E_PORT ?? '4173';

export default defineConfig({
  testDir: 'e2e',
  // bench/** is the headed GPU benchmark, run only via `npm run bench:map`.
  testIgnore: ['fixtures/**', 'helpers/**', 'bench/**'],
  fullyParallel: true,
  workers: process.env.SFH_E2E_WORKERS ? Number(process.env.SFH_E2E_WORKERS) : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true
      }
    }
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
