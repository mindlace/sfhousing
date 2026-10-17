import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const PARCELS = '/data/fixture-0/scenarios/fzp/parcels.bin';

// The app's CSP blocks inline scripts, so the codec bundle is injected with CSP bypassed.
test.use({ bypassCSP: true });

test('serves scenario parcels as an immutable octet-stream', async ({ request }) => {
  const res = await request.get(PARCELS);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/octet-stream');
  expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('decodes scenario parcels in the browser through the shared codec', async ({ page }) => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/lib/data/scenario-codec.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'sfhScenario'
  });
  const content = bundle.outputFiles[0].text;

  await page.goto('/about');
  await page.addScriptTag({ content });

  const decoded = await page.evaluate(async (url) => {
    const codec = (
      window as unknown as {
        sfhScenario: {
          readScenarioParcels(body: ReadableStream<Uint8Array>): Promise<{
            count: number;
            id: string[];
            envelopeStories: Uint8Array;
          }>;
        };
      }
    ).sfhScenario;
    const res = await fetch(url);
    const parcels = await codec.readScenarioParcels(res.body!);
    const row = parcels.id.indexOf('3512014');
    return {
      count: parcels.count,
      row,
      envelope: row < 0 ? null : parcels.envelopeStories[row]
    };
  }, PARCELS);

  expect(decoded.count).toBe(14);
  expect(decoded.row).toBeGreaterThanOrEqual(0);
  expect(decoded.envelope).toBe(65);
});
