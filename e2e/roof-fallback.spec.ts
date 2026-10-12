import { expect, test } from '@playwright/test';
import type {} from '../src/lib/map/debug';
import type {} from '../src/lib/brush/debug';
import {
  gotoEditor,
  jumpAndIdle,
  paintOnce,
  PLAN_KEY,
  settledNet,
  smallText
} from './helpers/sharing';

test('missing parallel compilation keeps editable footprints, saved plans and scores with zero roof ownership', async ({
  page,
  isMobile
}) => {
  let delivered = 0;
  page.on('response', (r) => {
    if (r.url().endsWith('/roofs/50_25-000.bin') && r.ok()) delivered++;
  });
  await gotoEditor(page);
  await jumpAndIdle(page);
  expect(
    await page.evaluate(
      () =>
        !!window
          .__sfhMap!.map!.getCanvas()
          .getContext('webgl2')!
          .getExtension('KHR_parallel_shader_compile')
    )
  ).toBe(false);
  await expect.poll(() => delivered).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot()?.ownedBytes)).toBe(0);
  expect(await page.evaluate(() => window.__sfhMap!.roofSnapshot()!.activePieceIds)).toEqual([]);
  expect(await page.evaluate(() => window.__sfhMap!.existingSnapshot()!.roofReadyIds)).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        window.__sfhMap!.map!.queryRenderedFeatures(undefined, { layers: ['existing-buildings'] })
          .length
    )
  ).toBeGreaterThan(0);
  await page.evaluate((text) => window.__sfhBrush!.load(JSON.parse(text)), smallText);
  await expect.poll(() => page.evaluate(() => window.__sfhBrush!.ops)).toBe(3);
  await expect(page.getByTestId('score-net')).not.toHaveText('0');
  const score = await settledNet(page);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), PLAN_KEY)).not.toBeNull();
  const saved = await page.evaluate((k) => localStorage.getItem(k), PLAN_KEY);
  await page.reload();
  await page.waitForFunction(() => !!window.__sfhMap?.snapshot() && !!window.__sfhBrush?.ready);
  await jumpAndIdle(page);
  await expect.poll(() => page.evaluate(() => window.__sfhBrush!.ops)).toBe(3);
  expect(await settledNet(page)).toBe(score);
  expect(await page.evaluate((k) => localStorage.getItem(k), PLAN_KEY)).toBe(saved);
  await expect.poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot()?.ownedBytes)).toBe(0);
  await page.evaluate(() =>
    window.__sfhBrush!.load({ schema: 1, datasetVersion: 'fixture-0', ops: [] })
  );
  await expect.poll(() => page.evaluate(() => window.__sfhBrush!.ops)).toBe(0);
  await paintOnce(page, isMobile);
  await expect
    .poll(() => page.evaluate(() => window.__sfhMap!.snapshot()!.parts))
    .toBeGreaterThan(0);
  await expect(page.getByTestId('map-root').getByRole('status')).toHaveCount(0);
});
