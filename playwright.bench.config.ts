import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
import { benchDataset } from './scripts/bench-map-config';
import { roofGpuLaunchOptions } from './scripts/roof-gpu-launch';

const dataset = benchDataset(process.env.BENCH_DATASET_VERSION);

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
    // The §4.12 pass bar names a 2022 MacBook Air, a DPR 2 display; Desktop Chrome defaults to 1.
    deviceScaleFactor: 2,
    headless: false,
    channel: process.env.BENCH_CHANNEL || undefined,
    ...(dataset !== 'fixture-0'
      ? { launchOptions: { ...roofGpuLaunchOptions, headless: false } }
      : {})
  },
  webServer:
    dataset === 'fixture-0'
      ? base.webServer
      : {
          ...base.webServer,
          command: `npm run db:migrate && VITE_E2E=1 npm run preview -- --var PUBLIC_DATASET_VERSION:${dataset}`
        }
});
