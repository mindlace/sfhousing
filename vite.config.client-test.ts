import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
  },
  test: {
    name: 'client',
    expect: { requireAssertions: true },
    browser: {
      enabled: true,
      provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
      instances: [{ browser: 'chromium', headless: true }]
    },
    include: ['src/**/*.svelte.{test,spec}.ts'],
    exclude: ['src/lib/server/**']
  }
});
