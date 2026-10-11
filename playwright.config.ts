import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['fixtures/**', 'helpers/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4173' },
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
    command:
      'npm run data:fixture && npm run db:migrate && npm run preview -- --var PUBLIC_DATASET_VERSION:fixture-0',
    url: 'http://localhost:4173/about',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
