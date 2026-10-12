import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { 'import.meta.env.VITE_E2E': JSON.stringify('1') },
  plugins: [
    tailwindcss(),
    svelte(),
    {
      name: 'committed-roof-fixture',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!/^\/data\/fixture-0\/roofs\/[a-zA-Z0-9_-]+\.(json|bin)$/.test(req.url ?? ''))
            return next();
          try {
            const bytes = await readFile(new URL(`./e2e/fixtures${req.url}`, import.meta.url));
            res.setHeader(
              'Content-Type',
              req.url!.endsWith('.json') ? 'application/json' : 'application/octet-stream'
            );
            res.end(bytes);
          } catch {
            next();
          }
        });
      }
    }
  ],
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
    // Positive roof coverage is the REQUIRED test:roofs:gpu gate; software checks fallback.
    exclude: [
      'src/lib/server/**',
      'src/lib/map/roof-layer.svelte.spec.ts',
      'src/lib/map/SimMap.roofs.svelte.spec.ts'
    ]
  }
});
