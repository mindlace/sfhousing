import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import base from './vite.config.client-test.ts';
import { roofGpuLaunchOptions } from './scripts/roof-gpu-launch.ts';

// Required positive roof correctness/cold-activation gate; never silently skips unsupported hosts.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    name: 'roof-gpu',
    include: [
      'src/lib/map/roof-layer.svelte.spec.ts',
      'src/lib/map/SimMap.roofs.svelte.spec.ts',
      'src/lib/map/SimMap.roof-import-*.svelte.spec.ts'
    ],
    exclude: [],
    setupFiles: ['./scripts/roof-gpu-vitest-setup.ts'],
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: roofGpuLaunchOptions,
        contextOptions: { reducedMotion: 'reduce' }
      }),
      instances: [{ browser: 'chromium', headless: roofGpuLaunchOptions.headless }]
    }
  }
});
