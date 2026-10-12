import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { roofGpuLaunchOptions } from './scripts/roof-gpu-launch';

// Required alongside software suites. The strict held-response test body is unchanged.
export default defineConfig({
  ...base,
  testMatch: 'roofs.spec.ts',
  testIgnore: [],
  workers: 1,
  globalSetup: './scripts/roof-gpu-playwright-setup.ts',
  projects: base.projects!.map((project) => ({
    ...project,
    use: {
      ...project.use,
      headless: roofGpuLaunchOptions.headless,
      launchOptions: roofGpuLaunchOptions
    }
  }))
});
