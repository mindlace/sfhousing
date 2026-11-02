import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// SFH_BROWSER picks the engine for a one-off run (the AC-11 cross-engine goldens); the default
// stays chromium so `npm run test:unit` is unchanged.
const ENGINES = ['chromium', 'webkit', 'firefox'] as const;
const engine = process.env.SFH_BROWSER ?? 'chromium';
if (!(ENGINES as readonly string[]).includes(engine)) {
  throw new Error(`SFH_BROWSER must be one of ${ENGINES.join(', ')}, got "${engine}"`);
}

/** Browser specs whose assertions are wall-clock budgets: project client-perf (`npm run test:perf`). */
export const CLIENT_PERF_SPECS = 'src/**/*.perf.svelte.{test,spec}.ts';

/**
 * The browser project. `perf: false` (client, in test:unit) runs every browser spec but the
 * wall-clock budgets; `perf: true` (client-perf, in test:perf) runs only those, with no retry:
 * a retried budget measures the machine twice, not the code.
 */
export function clientTestConfig({ perf }: { perf: boolean }) {
  return defineConfig({
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
    // Pre-bundle the deck/luma entry points the GPU specs import. Left to lazy discovery, a cold
    // cache re-optimises mid-run and luma logs PipelineFactory errors, which fail every GPU test.
    optimizeDeps: {
      include: [
        '@deck.gl/core',
        '@deck.gl/layers',
        '@deck.gl/maplibre',
        '@luma.gl/core',
        '@luma.gl/engine'
      ]
    },
    test: {
      name: perf ? 'client-perf' : 'client',
      // Browser tests get one retry so a flake is recorded rather than absorbed or fatal.
      // The server project stays at 0: pure logic must not flake.
      retry: perf ? 0 : 1,
      expect: { requireAssertions: true },
      browser: {
        enabled: true,
        provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
        instances: [{ browser: engine as (typeof ENGINES)[number], headless: true }]
      },
      include: perf ? [CLIENT_PERF_SPECS] : ['src/**/*.svelte.{test,spec}.ts'],
      // Browser test files share one renderer main thread. Run them one at a time so the
      // GL-heavy SimMap specs cannot stall the frame-budget test (C5) in another file.
      fileParallelism: false,
      exclude: perf ? [] : ['src/lib/server/**', CLIENT_PERF_SPECS]
    }
  });
}

export default clientTestConfig({ perf: false });
