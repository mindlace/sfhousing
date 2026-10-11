import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `npm run bench:map` (docs/dev/map-perf.md). Headed Chromium on the real GPU: no SwiftShader or
// --use-gl flags. The default `playwright test` sweep ignores e2e/bench/** (playwright.config.ts).
export default defineConfig({
  testDir: 'e2e/bench',
  testMatch: '**/*.bench.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    headless: false,
    channel: process.env.BENCH_CHANNEL || undefined
  },
  webServer: base.webServer
});
