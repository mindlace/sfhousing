import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// SFH_BENCH_DATASET=<v> benches a live dataset version loaded into local R2 (docs/dev/map-perf.md).
const liveDataset = process.env.SFH_BENCH_DATASET;
const server = base.webServer as { command: string };

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
    baseURL: `http://localhost:${process.env.SFH_E2E_PORT ?? '4173'}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    // The §4.12 pass bar names a 2022 MacBook Air, a DPR 2 display; Desktop Chrome defaults to 1.
    deviceScaleFactor: 2,
    headless: false,
    channel: process.env.BENCH_CHANNEL || undefined
  },
  webServer: liveDataset
    ? {
        ...server,
        // A dataset already in local R2 (`npm run data:local -- <v>`): no fixture load, and the
        // worker serves <v> instead of fixture-0.
        command: server.command
          .replace('npm run data:fixture && ', '')
          .replace('PUBLIC_DATASET_VERSION:fixture-0', `PUBLIC_DATASET_VERSION:${liveDataset}`)
      }
    : base.webServer
});
