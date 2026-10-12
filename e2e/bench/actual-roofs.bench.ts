/* eslint-disable playwright/no-skipped-test, playwright/no-conditional-in-test, playwright/no-conditional-expect -- Explicit opt-in and shared empty/replacement/named scenario contracts. */
// Explicit opt-in, previously built roofer 1.0.0 real sample. This is not final-beta/city evidence.
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { RoofHeader, RoofIndex } from '../../src/lib/data/building-roofs';
import type {} from '../../src/lib/map/debug';
import type {} from '../../src/lib/brush/debug';
import { roofGpuCapability } from '../../scripts/roof-gpu-capability';

const VERSION = '2026-10-12-c9b71965';
const INDEX_HASH = '49384f5d1e8954bdd28ada6de1a6e2e0686e3bfa04029f962de46d357bc47faf';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ROUTES = [
  {
    id: '49_24-000',
    name: 'Noe',
    center: [-122.4305161, 37.7517123],
    point: [-122.4301238993, 37.7517358556],
    pieces: 58,
    triangles: 4366
  },
  {
    id: '51_24-000',
    name: 'Mission',
    center: [-122.4131308, 37.75435421610044],
    point: [-122.4135750554, 37.7539762986],
    pieces: 40,
    triangles: 1808
  }
] as const;
const idsTriangles = (chunks: Record<string, string>) =>
  ROUTES.filter((r) => chunks[r.id] === 'active').reduce((sum, r) => sum + r.triangles, 0);
const PAINT = [
  { parcel: '3654007', point: [-122.4301282, 37.7517769] },
  { parcel: '3640036', point: [-122.4136747, 37.7539018] },
  { parcel: '3640109', point: [-122.4135098, 37.7539182] }
] as const;
type Tasks = Window & { roofTasks: number[]; roofObserver: PerformanceObserver };

function sample() {
  const root = new URL(`../../pipeline/out/${VERSION}/roofs/`, import.meta.url);
  const bytes = readFileSync(new URL('index.json', root));
  expect(sha(bytes)).toBe(INDEX_HASH);
  const index = JSON.parse(bytes.toString()) as RoofIndex;
  expect(index.datasetVersion).toBe(VERSION);
  expect(index.chunks.map((c) => c.chunkId)).toEqual(ROUTES.map((r) => r.id));
  const headers = Object.fromEntries(
    index.chunks.map((ref, i) => {
      const headerBytes = readFileSync(new URL(`${ref.chunkId}.json`, root));
      expect(sha(headerBytes)).toBe(ref.headerSha256);
      const h = JSON.parse(headerBytes.toString()) as RoofHeader;
      expect(h.datasetVersion).toBe(VERSION);
      expect(h.pieces).toHaveLength(ROUTES[i].pieces);
      expect(new Set(h.pieces.map((p) => p.pieceId)).size).toBe(ROUTES[i].pieces);
      return [ref.chunkId, h];
    })
  );
  return { index, headers };
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000
  });
  await page.waitForFunction(() => window.__sfhMap?.map && window.__sfhBrush?.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const m = window.__sfhMap!.map!;
        if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) resolve();
        else m.once('idle', () => resolve());
      })
  );
}
async function camera(page: Page, center: readonly number[], zoom = 17) {
  await page.evaluate(
    ({ center, zoom }) =>
      new Promise<void>((resolve) => {
        const map = window.__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.jumpTo({ center: center as [number, number], zoom, pitch: 55, bearing: 0 });
      }),
    { center: [...center], zoom }
  );
}
async function active(page: Page, id: string, headers: Record<string, RoofHeader>) {
  await expect
    .poll(() => page.evaluate((id) => window.__sfhMap!.roofSnapshot()?.chunks[id], id), {
      timeout: 30_000
    })
    .toBe('active');
  const state = await page.evaluate(() => ({
    roof: window.__sfhMap!.roofSnapshot()!,
    existing: window.__sfhMap!.existingSnapshot()!,
    composition: window.__sfhMap!.compositionSnapshot()!
  }));
  const ids = Object.entries(state.roof.chunks)
    .filter(([, status]) => status === 'active')
    .map(([id]) => id);
  const expected = ids.flatMap((id) => headers[id].pieces.map((p) => p.pieceId)).sort();
  expect([...state.roof.activePieceIds].sort()).toEqual(expected);
  expect(state.existing.roofReadyIds).toEqual(expected);
  expect(new Set(state.composition.roofs.map((r) => r.id)).size).toBe(
    state.composition.roofs.length
  );
  expect(
    state.composition.roofs
      .filter((r) => r.active)
      .map((r) => r.id)
      .sort()
  ).toEqual(ids.map((id) => `existing-roof-${id}`).sort());
  for (const layer of state.composition.roofs)
    expect(state.roof.chunks[layer.id.replace('existing-roof-', '')]).toBe(
      layer.active ? 'active' : 'preparing'
    );
  expect(state.composition.duplicatePublications).toBe(0);
  expect(state.composition.maxRoofs).toBeLessThanOrEqual(Object.keys(headers).length);
  expect(state.roof.totalBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(state.roof.observation!.maxTotalBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(state.roof.observation!.invalidComponents).toBe(0);
  expect(state.roof.maxInFlight).toBeLessThanOrEqual(4);
  return state;
}
async function disposed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = window.__sfhMap!.roofSnapshot()!;
        return {
          pieces: r.activePieceIds,
          ready: window.__sfhMap!.existingSnapshot()!.roofReadyIds,
          layers: window.__sfhMap!.compositionSnapshot()!.roofs,
          jobs: r.inFlight,
          owned: r.ownedBytes,
          reserved: r.reservedBytes,
          retired: r.retiredIds
        };
      })
    )
    .toEqual({ pieces: [], ready: [], layers: [], jobs: 0, owned: 0, reserved: 0, retired: [] });
}
function requests(page: Page) {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return () => {
    expect(
      urls.filter((u) => /\.(laz|las|tif|tiff)(?:$|\?)/i.test(u) || /\/roofs\/audit\.json/.test(u))
    ).toEqual([]);
    expect(urls.filter((u) => /\/data\//.test(u) && !u.includes(`/data/${VERSION}/`))).toEqual([]);
  };
}
async function native(page: Page) {
  const gpu = await page.evaluate(roofGpuCapability);
  expect(gpu.parallel, 'KHR_parallel_shader_compile is required').toBe(true);
  expect(gpu.renderer).not.toMatch(/SwiftShader|llvmpipe|Software/i);
  if (process.platform === 'darwin') expect(gpu.renderer).toMatch(/Metal/i);
  return gpu;
}

test.describe('actual roofs', () => {
  test.skip(process.env.BENCH_DATASET_VERSION === undefined, 'Opt in with BENCH_DATASET_VERSION');

  test.beforeEach(() => expect(process.env.BENCH_DATASET_VERSION).toBe(VERSION));

  test('first idle stays within 5 MiB without roof warmup', async ({ page }) => {
    const safe = requests(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let bytes = 0;
    const roofs: string[] = [];
    cdp.on('Network.loadingFinished', (e) => {
      bytes += e.encodedDataLength;
    });
    page.on('request', (r) => {
      if (/\/roofs\//.test(r.url())) roofs.push(r.url());
    });
    await ready(page);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(roofs).toEqual([]);
    safe();
    console.log(`actual roofs first-idle version=${VERSION} encodedBytes=${bytes}`);
  });

  for (const replacements of [false, true])
    test(`10 s per route, ${replacements ? 'editor replacements' : 'empty plan'}`, async ({
      page,
      browser
    }, info) => {
      const { index, headers } = sample();
      const safe = requests(page);
      await ready(page);
      const gpu = await native(page);
      await page.evaluate(() => {
        const w = window as unknown as Tasks;
        w.roofTasks = [];
        w.roofObserver = new PerformanceObserver((list) =>
          w.roofTasks.push(...list.getEntries().map((e) => e.duration))
        );
        w.roofObserver.observe({ entryTypes: ['longtask'] });
      });
      if (replacements) {
        await page.evaluate(
          ({ version, paint }) =>
            window.__sfhBrush!.load({
              schema: 1,
              datasetVersion: version,
              ops: paint.map((p) => ({
                id: p.parcel,
                kind: 'paint' as const,
                stories: 20,
                radiusM: 5,
                path: [[...p.point] as [number, number]]
              }))
            }),
          { version: VERSION, paint: PAINT }
        );
        await expect
          .poll(() =>
            page.evaluate(() => window.__sfhMap!.generatedParcels().map((p) => p.parcelId))
          )
          .toEqual(expect.arrayContaining(PAINT.map((p) => p.parcel)));
        expect(await page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual(
          expect.arrayContaining(PAINT.map((p) => p.parcel))
        );
      }
      const results = [];
      for (const route of ROUTES) {
        await camera(page, route.center);
        await active(page, route.id, headers);
        // Validate delivered bytes only after cold activation. No explicit index/header fetch warms activation.
        const servedIndex = await page.request.get(`/data/${VERSION}/roofs/index.json`);
        expect(sha(await servedIndex.body())).toBe(INDEX_HASH);
        for (const ref of index.chunks) {
          const response = await page.request.get(ref.headerUrl);
          expect(sha(await response.body())).toBe(ref.headerSha256);
        }
        const frames = await page.evaluate(
          ({ route }) =>
            new Promise<{ deltas: number[]; renderChecks: number; invalid: number }>((resolve) => {
              const m = window.__sfhMap!.map!;
              const out = { deltas: [] as number[], renderChecks: 0, invalid: 0 };
              const visible = () => {
                const p = m.project(route.point as [number, number]);
                const c = m.getCanvas();
                const r = window.__sfhMap!.roofSnapshot()!;
                out.renderChecks++;
                if (
                  p.x < 0 ||
                  p.y < 0 ||
                  p.x > c.clientWidth ||
                  p.y > c.clientHeight ||
                  r.chunks[route.id] !== 'active'
                )
                  out.invalid++;
              };
              m.on('render', visible);
              let start = -1,
                last = -1;
              const step = (t: number) => {
                if (start < 0) start = last = t;
                if (t > last) out.deltas.push(t - last);
                last = t;
                const elapsed = t - start;
                if (elapsed >= 10_000) {
                  m.off('render', visible);
                  return resolve(out);
                }
                const phase = (elapsed % 5000) / 5000;
                const offset = phase < 0.5 ? -0.0003 + phase * 0.0012 : 0.0009 - phase * 0.0012;
                m.jumpTo({ center: [route.center[0], route.center[1] + offset] });
                requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            }),
          { route }
        );
        expect(frames.deltas.length).toBeGreaterThanOrEqual(500);
        expect(frames.renderChecks).toBeGreaterThanOrEqual(500);
        expect(frames.invalid).toBe(0);
        const sorted = frames.deltas.sort((a, b) => a - b);
        const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
        const state = await active(page, route.id, headers);
        const result = {
          route: route.name,
          replacements,
          frames: sorted.length,
          renderChecks: frames.renderChecks,
          p50: percentile(0.5),
          p95: percentile(0.95),
          gpu,
          browser: browser.version(),
          viewport: page.viewportSize(),
          dpr: await page.evaluate(() => devicePixelRatio),
          dataset: VERSION,
          fitter: 'previously built 1.0.0 sample',
          indexHash: INDEX_HASH,
          residentChunks: Object.entries(state.roof.chunks)
            .filter(([, s]) => s === 'active')
            .map(([id]) => id),
          triangles: route.triangles,
          residentTriangles: idsTriangles(state.roof.chunks),
          refreshCadenceMs: percentile(0.5),
          composition: state.composition,
          accounting: state.roof.observation,
          maxJobs: state.roof.maxInFlight
        };
        results.push(result);
        console.log('ACTUAL_ROOF_BENCH', JSON.stringify(result));
        await info.attach(`${route.name}-${replacements ? 'replacements' : 'empty'}`, {
          body: await page.getByTestId('map-root').screenshot(),
          contentType: 'image/png'
        });

        await camera(page, route.center, 14);
        await disposed(page);
        await camera(page, route.center);
        await active(page, route.id, headers);
      }
      await camera(page, ROUTES[1].center, 14);
      await disposed(page);
      const tasks = await page.evaluate(() => {
        const w = window as unknown as Tasks;
        const tasks = [...w.roofTasks, ...w.roofObserver.takeRecords().map((e) => e.duration)];
        w.roofObserver.disconnect();
        return tasks;
      });
      await info.attach('actual-roof-measurements', {
        body: JSON.stringify({ results, longtasks: tasks }),
        contentType: 'application/json'
      });
      console.log('ACTUAL_ROOF_LONGTASKS', JSON.stringify(tasks));
      for (const result of results) expect(result.p95).toBeLessThanOrEqual(16.7);
      expect(tasks.filter((n) => n > 50)).toEqual([]);
      safe();
    });
});

// Named identities from the validated sample's bounded audit extract, not the old spike viewer.
test.describe('actual roofs named local visuals', () => {
  test.skip(process.env.BENCH_DATASET_VERSION === undefined, 'Opt in with BENCH_DATASET_VERSION');

  test('named sample roofs/fallbacks and real multi-parcel editing with Undo', async ({
    page
  }, info) => {
    expect(process.env.BENCH_DATASET_VERSION).toBe(VERSION);
    const { headers } = sample();
    const safe = requests(page);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await ready(page);
    await native(page);
    const named = [
      {
        name: 'WholeFoods-3016508c-spike-fallback',
        center: [-122.4309055, 37.75201905],
        zoom: 18,
        active: [] as string[],
        fallback: ['p-61ef2628f8a6ad14b7b2d5e9', 'p-b8dcb25231e63a5a7ca47a01']
      },
      {
        name: 'a96b2333-partial-invalid-geometry',
        center: [-122.4302535, 37.7521213],
        zoom: 18,
        active: ['p-6c541e4e10e7ce8b8c863a4f'],
        fallback: ['p-87db11fc77cda6d5dbd0378f']
      },
      {
        name: 'pitched-6b033538',
        center: [-122.4301238993, 37.7517358556],
        zoom: 18,
        active: ['p-63f26e27bc624a437fa4256c'],
        fallback: [] as string[]
      },
      {
        name: 'Mission-3a56e932-multiparcel',
        center: [-122.4135750554, 37.7539762986],
        zoom: 18,
        active: [
          'p-6056f8467079b601299e995d',
          'p-723cc12a445b1e3e85498729',
          'p-cc7d454febddd6e00d94424a'
        ],
        fallback: [] as string[]
      },
      {
        name: 'Salesforce-626a57f8-inactive-coverage-fallback',
        center: [-122.3969145, 37.7897754],
        zoom: 15.3,
        active: [] as string[],
        fallback: ['p-0d690a382ab384da5554b994', 'p-9304f97d3b1bf5a1ccd5ffe0']
      }
    ];
    for (const n of named) {
      await camera(page, n.center, n.zoom);
      if (n.active.length)
        await expect
          .poll(() => page.evaluate(() => window.__sfhMap!.roofSnapshot()!.activePieceIds))
          .toEqual(expect.arrayContaining(n.active));
      const evidence = await page.evaluate(({ active, fallback }) => {
        const map = window.__sfhMap!.map!;
        const ready = window.__sfhMap!.existingSnapshot()!.roofReadyIds;
        const features = map.queryRenderedFeatures().filter((f) => f.source === 'buildings');
        return {
          active: active.every((id) => ready.includes(id)),
          fallback: fallback.every((id) => !ready.includes(id)),
          visibleFallback: fallback.filter((id) => features.some((f) => String(f.id) === id)),
          camera: { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch() },
          activeIds: window
            .__sfhMap!.roofSnapshot()!
            .activePieceIds.filter((id) => active.includes(id))
        };
      }, n);
      expect(evidence.active).toBe(true);
      expect(evidence.fallback).toBe(true);
      expect(evidence.visibleFallback.sort()).toEqual([...n.fallback].sort());
      const path = `/tmp/sfh-roof-actual-${n.name}.png`;
      await info.attach(n.name, {
        body: await page.getByTestId('map-root').screenshot({ path }),
        contentType: 'image/png'
      });
      console.log('ACTUAL_NAMED_VISUAL', JSON.stringify({ name: n.name, path, ...evidence }));
    }
    await camera(page, [-122.4135750554, 37.7539762986], 18);
    await active(page, '51_24-000', headers);
    await page.getByRole('radio', { name: 'Paint', exact: true }).click();
    await page.getByRole('button', { name: '20 stories', exact: true }).click();
    // A real UI stamp creates one editor op, so Undo exercises the normal editor history.
    const p = await page.evaluate(() => {
      const map = window.__sfhMap!.map!;
      const p = map.project([-122.4136747, 37.7539018]);
      const r = map.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    });
    // Use the minimum brush radius to replace one parcel while retaining its sibling.
    await page.getByRole('slider', { name: /^Brush/ }).press('Home');
    await page.mouse.click(p.x, p.y);
    await expect
      .poll(() => page.evaluate(() => window.__sfhMap!.generatedParcels().map((p) => p.parcelId)))
      .toContain('3640036');
    expect(await page.evaluate(() => window.__sfhMap!.hiddenIds())).toContain('3640036');
    expect(await page.evaluate(() => window.__sfhMap!.hiddenIds())).not.toContain('3640109');
    const sibling = await page.evaluate(() => {
      const map = window.__sfhMap!.map!;
      return ['p-6056f8467079b601299e995d', 'p-cc7d454febddd6e00d94424a'].map((id) =>
        map.getFeatureState({ source: 'buildings', sourceLayer: 'buildings', id })
      );
    });
    for (const state of sibling) {
      expect(state.roofReady).toBe(true);
      expect(state.replaced).not.toBe(true);
    }
    await active(page, '51_24-000', headers);
    await info.attach('Mission-generated-one-parcel', {
      body: await page
        .getByTestId('map-root')
        .screenshot({ path: '/tmp/sfh-roof-actual-Mission-generated-one-parcel.png' }),
      contentType: 'image/png'
    });
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => page.evaluate(() => window.__sfhMap!.generatedParcels())).toEqual([]);
    expect(await page.evaluate(() => window.__sfhMap!.hiddenIds())).toEqual([]);
    await active(page, '51_24-000', headers);
    await info.attach('Mission-Undo', {
      body: await page
        .getByTestId('map-root')
        .screenshot({ path: '/tmp/sfh-roof-actual-Mission-Undo.png' }),
      contentType: 'image/png'
    });
    safe();
  });
});
