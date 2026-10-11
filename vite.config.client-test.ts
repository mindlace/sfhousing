import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      // Route component specs only: `src/lib` code must still never import `$app/*`.
      '$app/state': fileURLToPath(new URL('./src/test-stubs/app/state.ts', import.meta.url)),
      '$app/navigation': fileURLToPath(
        new URL('./src/test-stubs/app/navigation.ts', import.meta.url)
      )
    }
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
    // Browser test files share one renderer main thread. Run them one at a time so the
    // GL-heavy SimMap specs cannot stall the frame-budget test (C5) in another file.
    fileParallelism: false,
    exclude: ['src/lib/server/**']
  }
});
