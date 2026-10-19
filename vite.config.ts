import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import VitestFlakeReporter from '@mindlace/chreode/reporters/vitest';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const SRC_LIB = fileURLToPath(new URL('./src/lib', import.meta.url));

/**
 * The pipeline project imports src by relative path and has no `$lib` alias. This resolves the
 * `$lib` imports of src modules only (pipeline/test/simulate-replay.test.ts runs `simulate`), so
 * pipeline code itself still cannot import `$lib`: the pipeline runs outside SvelteKit.
 */
const srcLibForSrc: Plugin = {
  name: 'pipeline-src-lib',
  enforce: 'pre',
  resolveId(id, importer) {
    if (!(id === '$lib' || id.startsWith('$lib/'))) return null;
    if (importer === undefined || !importer.startsWith(`${SRC_LIB}/`)) return null;
    return this.resolve(SRC_LIB + id.slice('$lib'.length), importer, { skipSelf: true });
  }
};

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    // The largest client chunk (~1.1 MB) is the MapLibre GL bundle. The limit sits just above it, so a
    // jump in chunk size past 1.2 MB warns again.
    chunkSizeWarningLimit: 1200
  },
  test: {
    expect: { requireAssertions: true },
    // Root-level only (vitest ignores project reporters). Records client retried-passes;
    // server and pipeline run with no retries, so they never record.
    reporters: ['default', new VitestFlakeReporter()],
    projects: [
      // Browser/client tests live in a standalone config that omits sveltekit() + tailwindcss().
      './vite.config.client-test.ts',
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.spec.ts'],
          exclude: ['src/**/*.svelte.{test,spec}.ts']
        }
      },
      // Data pipeline: standalone (no SvelteKit config); imports src/lib/data by relative path.
      {
        plugins: [srcLibForSrc],
        test: {
          name: 'pipeline',
          environment: 'node',
          include: ['pipeline/test/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 300_000,
          expect: { requireAssertions: true }
        }
      }
    ]
  }
});
