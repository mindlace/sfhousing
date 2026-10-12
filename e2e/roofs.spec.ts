import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/lib/map/debug';
import type {} from '../src/lib/brush/debug';
import {
  gotoEditor,
  jumpAndIdle,
  paintOnce,
  PLAN_KEY,
  settledNet,
  smallText,
  projectToPage
} from './helpers/sharing';

async function inspectRoof(page: Page, isMobile: boolean) {
  const [x, y] = await projectToPage(page, [-122.418395, 37.76014]);
  await page.getByRole('radio', { name: 'Move' }).click();
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.move(x, y);
  return page.locator(isMobile ? '.sim-map-card' : '[role="tooltip"]');
}

async function dismissRoofCard(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Close', exact: true }).click();
}

// Real application, real worker and GPU. Only HTTP failures/delivery timing are controlled.
test('real SimMap activates roofs without long tasks, then releases them below zoom 15', async ({
  page,
  isMobile
}, testInfo) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/roofs/*.bin', async (r) => {
    await held;
    await r.continue();
  });
  await gotoEditor(page);
  await jumpAndIdle(page);
  await page.evaluate(() => {
    const w = window as unknown as { roofTasks: number[]; roofObserver: PerformanceObserver };
    w.roofTasks = [];
    w.roofObserver = new PerformanceObserver((list) =>
      w.roofTasks.push(...list.getEntries().map((e) => e.duration))
    );
    w.roofObserver.observe({ entryTypes: ['longtask'] });
  });
  release();
  await expect
    .poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot?.()?.activePieceIds.length))
    .toBe(3);
  const tasks = await page.evaluate(() => {
    const w = window as unknown as { roofTasks: number[]; roofObserver: PerformanceObserver };
    const result = [...w.roofTasks, ...w.roofObserver.takeRecords().map((e) => e.duration)];
    w.roofObserver.disconnect();
    return result;
  });
  const details = await inspectRoof(page, isMobile);
  await expect(details).toContainText('Parcel 3512010');
  await dismissRoofCard(page, isMobile);
  await page.getByRole('radio', { name: 'Paint' }).click();
  const ready = await page.evaluate(() => window.__sfhMap!.existingSnapshot()!.roofReadyIds);
  expect(ready).toHaveLength(3);
  await testInfo.attach('roof-active', {
    body: await page
      .getByTestId('map-root')
      .screenshot({ path: testInfo.outputPath('roof-active.png') }),
    contentType: 'image/png'
  });
  await page.evaluate(() => window.__sfhMap!.map!.jumpTo({ zoom: 14 }));
  await expect
    .poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot?.()?.activePieceIds))
    .toEqual([]);
  await expect
    .poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot?.()?.ownedBytes))
    .toBe(0);
  expect(await page.evaluate(() => window.__sfhMap!.existingSnapshot()!.roofReadyIds)).toEqual([]);
  await testInfo.attach('footprint-fallback', {
    body: await page
      .getByTestId('map-root')
      .screenshot({ path: testInfo.outputPath('footprint-fallback.png') }),
    contentType: 'image/png'
  });
  expect(tasks.filter((ms) => ms > 50)).toEqual([]);
  expect(urls.filter((u) => /\.(laz|las|tif|tiff)(?:$|\?)/i.test(u))).toEqual([]);
});

for (const artifact of ['index.json', '50_25-000.json', '50_25-000.bin']) {
  test(`blocked ${artifact} preserves brush, saved plan and score`, async ({ page, isMobile }) => {
    await gotoEditor(page);
    await jumpAndIdle(page);
    await expect
      .poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot()?.activePieceIds.length))
      .toBe(3);
    await page.evaluate((text) => window.__sfhBrush!.load(JSON.parse(text)), smallText);
    await expect.poll(() => page.evaluate(() => window.__sfhBrush!.ops)).toBe(3);
    await expect(page.getByTestId('score-net')).not.toHaveText('0');
    const score = await settledNet(page);
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), PLAN_KEY)).not.toBeNull();
    const saved = await page.evaluate((k) => localStorage.getItem(k), PLAN_KEY);
    let aborted = 0;
    await page.route(`**/roofs/${artifact}`, (r) => {
      aborted++;
      return r.abort();
    });
    await page.reload();
    await page.waitForFunction(() => !!window.__sfhMap?.snapshot() && !!window.__sfhBrush?.ready);
    await jumpAndIdle(page);
    await expect.poll(() => aborted).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__sfhBrush!.ops)).toBe(3);
    expect(await settledNet(page)).toBe(score);
    expect(await page.evaluate((k) => localStorage.getItem(k), PLAN_KEY)).toBe(saved);
    expect(await page.evaluate(() => window.__sfhMap!.existingSnapshot()!.roofReadyIds)).toEqual(
      []
    );
    expect(
      await page.evaluate(
        () =>
          window.__sfhMap!.map!.querySourceFeatures('buildings', { sourceLayer: 'buildings' })
            .length
      )
    ).toBeGreaterThan(0);
    await expect(page.getByTestId('map-root').getByRole('status')).toHaveCount(0);
    await page.evaluate(() =>
      window.__sfhBrush!.load({ schema: 1, datasetVersion: 'fixture-0', ops: [] })
    );
    await expect.poll(() => page.evaluate(() => window.__sfhBrush!.ops)).toBe(0);
    await paintOnce(page, isMobile);
    await expect
      .poll(() => page.evaluate(() => window.__sfhMap!.snapshot()!.parts))
      .toBeGreaterThan(0);
  });
}

test('building source retry replays roof readiness independently of replaced parcels', async ({
  page
}) => {
  await page.route('**/buildings.pmtiles', (r) => r.abort());
  await gotoEditor(page);
  await jumpAndIdle(page);
  await expect
    .poll(() => page.evaluate(() => window.__sfhMap?.roofSnapshot()?.activePieceIds.length))
    .toBe(3);
  await page.evaluate(() =>
    window.__sfhMap!.applyGenerated({
      revision: 0,
      cells: [],
      removedCells: [],
      hide: { add: ['3512011'], remove: [] }
    })
  );
  const retry = page.getByRole('button', { name: 'Retry existing buildings' });
  await expect(retry).toBeVisible();
  await page.unroute('**/buildings.pmtiles');
  await retry.click();
  await expect(retry).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = window.__sfhMap!.map!;
        return m
          .querySourceFeatures('buildings', { sourceLayer: 'buildings' })
          .filter((f) => f.properties.parcelId === '3512011')
          .map((f) =>
            m.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id: f.id })
          );
      })
    )
    .toEqual([{ replaced: true, roofReady: true }]);
  expect(
    await page.evaluate(() =>
      window.__sfhMap!.map!.getFeatureState({
        source: 'buildings',
        sourceLayer: 'buildings',
        id: 'p-7e33516c53ae4a9d6cd9d679'
      })
    )
  ).toEqual({ roofReady: true });
});

async function smallEraseBrush(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: /^Brush \d+ m$/ }).click();
  await page.getByRole('slider', { name: /^Brush/ }).press('Home');
  await page.getByRole('radio', { name: 'Erase' }).click();
}

async function holdStroke(page: Page, isMobile: boolean, point: [number, number]) {
  const [x, y] = point;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }]
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 2, y, id: 1 }]
    });
    return async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    };
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y);
  return () => page.mouse.up();
}

async function erasePixels(page: Page, bytes: Buffer) {
  return page.evaluate(
    async (png) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(png)], { type: 'image/png' })
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const width = bitmap.width;
      bitmap.close();
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Only the eastern half lies over the building. Exclude the center seam.
        if ((i / 4) % width < width / 2 + 5) continue;
        // Opaque erase-ring pink, distinct from the map and generated building palette.
        if (
          Math.abs(data[i] - 190) < 8 &&
          Math.abs(data[i + 1] - 24) < 8 &&
          Math.abs(data[i + 2] - 93) < 8
        )
          count++;
      }
      return count;
    },
    [...bytes]
  );
}

async function configureRoofs(page: Page, roofs: string) {
  if (roofs === 'blocked') await page.route('**/roofs/index.json', (r) => r.abort());
}

for (const { roofs, ready, count } of [
  { roofs: 'loaded', ready: { roofReady: true }, count: 3 },
  { roofs: 'blocked', ready: {}, count: 0 }
]) {
  test(`functional roof edits preserve sibling readiness through an active erase stroke and undo (${roofs})`, async ({
    page,
    isMobile
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await configureRoofs(page, roofs);
    await gotoEditor(page);
    await jumpAndIdle(page, { center: [-122.418422, 37.760135], zoom: 19, pitch: 0, bearing: 0 });
    await expect
      .poll(() => page.evaluate(() => window.__sfhMap!.roofSnapshot()?.activePieceIds.length))
      .toBe(count);
    await page.evaluate(() =>
      window.__sfhBrush!.load({
        schema: 1,
        datasetVersion: 'fixture-0',
        ops: [
          {
            id: 'one-roof-half',
            kind: 'paint',
            stories: 20,
            radiusM: 5,
            path: [[-122.418422, 37.760135]]
          }
        ]
      })
    );
    await expect.poll(() => page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual(['3512010']);
    const state = () =>
      page.evaluate(() => {
        const map = window.__sfhMap!.map!;
        return ['p-7e33516c53ae4a9d6cd9d679', 'p-4f95dedf1e4cbf31e3e45491'].map((id) =>
          map.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id })
        );
      });
    expect(await state()).toEqual([{ ...ready, replaced: true }, ready]);
    await smallEraseBrush(page, isMobile);
    const point = await projectToPage(page, [-122.418422, 37.760135]);
    const clip = { x: point[0] - 80, y: point[1] - 80, width: 160, height: 160 };
    const before = await erasePixels(page, await page.screenshot({ clip }));
    const release = await holdStroke(page, isMobile, point);
    try {
      await expect
        .poll(async () => erasePixels(page, await page.screenshot({ clip })))
        .toBeGreaterThan(before + 10);
      await testInfo.attach('active-erase-over-roofs', {
        body: await page
          .getByTestId('map-root')
          .screenshot({ path: testInfo.outputPath('active-erase-over-roofs.png') }),
        contentType: 'image/png'
      });
      // Worker previews already apply the erase while the pointer remains held.
      await expect.poll(() => page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual([]);
      expect(await state()).toEqual([ready, ready]);
    } finally {
      await release();
    }
    await expect.poll(() => page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual([]);
    expect(await state()).toEqual([ready, ready]);
    await expect.poll(() => page.evaluate(() => window.__sfhMap!.generatedParcels())).toEqual([]);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual(['3512010']);
    expect(await state()).toEqual([{ ...ready, replaced: true }, ready]);
    expect(
      await page.evaluate(() => window.__sfhMap!.generatedParcels().map((p) => p.parcelId))
    ).toEqual(['3512010']);
    expect(await page.evaluate(() => window.__sfhMap!.roofSnapshot()!.activePieceIds)).toHaveLength(
      count
    );
  });
}
