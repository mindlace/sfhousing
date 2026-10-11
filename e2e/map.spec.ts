// Map view e2e (spec §6 E1–E10, §4.8 states). Runs against the VITE_E2E build, which exposes
// window.__sfhMap (src/lib/map/debug.ts) and window.__sfhBrush (src/lib/brush/debug.ts). E2–E8
// paint with brush-tool's toolbar through the worker host.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhBrushDebug } from '../src/lib/brush/debug';
import type { TypologyId } from '../src/lib/generator';
import type { SfhMapDebug } from '../src/lib/map/debug';
import type { ControllerSnapshot } from '../src/lib/map/generated-controller';
import { typologyLabel } from '../src/lib/map/tooltip';
import { expectNoA11yViolations } from './helpers/a11y';
import {
  FRAME,
  FROM,
  TO,
  TOUCH_FROM,
  TOUCH_TO,
  mouseDrag,
  ops,
  paintOnce,
  touchDrag
} from './helpers/sharing';

const ATTRIBUTION = '© OpenStreetMap · Overture Maps (Esri, Microsoft, USGS) · DataSF · Protomaps';
const BUILDINGS = '**/data/fixture-0/buildings.pmtiles';
// Fixture parcel 3512014 (e2e/fixtures/data/fixture-0/parcels/50_25.json): label point and a
// 60 m existing building.
const PARCEL_3512014: [number, number] = [-122.4179679, 37.7601348];

type Win = Window & {
  __sfhMap?: SfhMapDebug;
  __sfhBrush?: SfhBrushDebug;
  __cspViolations?: string[];
};

async function gotoReady(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
}

// Jump the camera and resolve on the next `idle` (all tiles loaded, nothing animating).
async function jumpAndIdle(
  page: Page,
  frame: { center: [number, number]; zoom: number; pitch?: number; bearing?: number }
): Promise<void> {
  await page.evaluate(
    (f) =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.jumpTo(f);
      }),
    frame
  );
}

async function waitIdle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) resolve();
        else map.once('idle', () => resolve());
      })
  );
}

// Page coordinates of a lng/lat on the map canvas.
async function projectToPage(page: Page, lngLat: [number, number]): Promise<[number, number]> {
  return page.evaluate((ll) => {
    const map = (window as Win).__sfhMap!.map!;
    const p = map.project(ll);
    const r = map.getCanvas().getBoundingClientRect();
    return [r.left + p.x, r.top + p.y] as [number, number];
  }, lngLat);
}

// ---- painting helpers (brush-tool's toolbar and the worker host) --------------------------------

const CHUNK = '**/data/fixture-0/parcels/50_25.json';

type TileWin = Win & { __tileLoads?: number; __firstFrame?: ControllerSnapshot | null };

// Fixture parcel label points (lng/lat), decoded from the chunk's 1e-7 degree integers.
const LABELS: Map<string, [number, number]> = (() => {
  const chunk = JSON.parse(
    readFileSync(new URL('./fixtures/data/fixture-0/parcels/50_25.json', import.meta.url), 'utf8')
  ) as { id: string[]; label: number[] };
  return new Map(
    chunk.id.map((id, i) => [id, [chunk.label[2 * i] / 1e7, chunk.label[2 * i + 1] / 1e7]])
  );
})();

/** `/` with the map ready and the brush editor's worker ready. */
async function gotoEditor(page: Page): Promise<void> {
  await gotoReady(page);
  await page.waitForFunction(() => !!(window as Win).__sfhBrush?.ready);
}

/** Selects a brush tool, then strokes FROM → TO (mouse) or TOUCH_FROM → TOUCH_TO (one finger). */
async function stroke(page: Page, isMobile: boolean, tool: 'Paint' | 'Erase'): Promise<void> {
  await jumpAndIdle(page, FRAME);
  const radio = page.getByRole('radio', { name: tool });
  if (isMobile) await radio.tap();
  else await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await touchDrag(
      cdp,
      await projectToPage(page, TOUCH_FROM),
      await projectToPage(page, TOUCH_TO)
    );
  } else {
    await mouseDrag(page, FROM, TO);
  }
}

/** Controller state plus the replacing (non-ADU) generated parcels, both sorted by id. */
async function settled(page: Page) {
  return page.evaluate(() => {
    const m = (window as Win).__sfhMap!;
    const s = m.snapshot();
    const gen = m.generatedParcels();
    return {
      parts: s?.parts ?? 0,
      pending: s?.pending ?? 0,
      hidden: m.hiddenSize,
      hiddenIds: m.hiddenIds(),
      generated: gen.length,
      replacing: gen.filter((g) => g.typology !== 'adu').map((g) => g.parcelId)
    };
  });
}

/** `state.replaced` of each rendered existing-buildings feature of `id` at its label point. */
async function replacedAt(page: Page, id: string, at: [number, number]): Promise<unknown[]> {
  return page.evaluate(
    ([id, at]) => {
      const map = (window as Win).__sfhMap!.map!;
      return map
        .queryRenderedFeatures(map.project(at as [number, number]), {
          layers: ['existing-buildings']
        })
        .filter((f) => String(f.id) === id)
        .map((f) => f.state.replaced);
    },
    [id, at] as const
  );
}

/** The first of `ids` whose existing building is rendered at its label point, else null. */
async function firstRendered(page: Page, ids: string[]): Promise<string | null> {
  for (const id of ids) {
    const ll = LABELS.get(id);
    if (ll && (await replacedAt(page, id, ll)).length > 0) return id;
  }
  return null;
}

const tileLoads = (page: Page) => page.evaluate(() => (window as TileWin).__tileLoads ?? 0);

/** Rendered features of the chunk error outline anywhere in the viewport. */
const errorOutline = (page: Page) =>
  page.evaluate(() => {
    const map = (window as Win).__sfhMap!.map!;
    return map.queryRenderedFeatures({ layers: ['chunk-error-line'] }).length;
  });

/**
 * Records the controller snapshot on the first MapLibre `render` after the revision advances
 * with generated parts present: the first frame that draws the update's buildings.
 */
async function recordFirstFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as TileWin;
    const map = w.__sfhMap!.map!;
    const rev0 = w.__sfhMap!.snapshot()!.revision;
    w.__firstFrame = null;
    const on = () => {
      const s = w.__sfhMap!.snapshot();
      if (s && s.revision > rev0 && s.parts > 0) {
        w.__firstFrame = s;
        map.off('render', on);
      }
    };
    map.on('render', on);
  });
}

async function firstFrame(page: Page): Promise<ControllerSnapshot> {
  await page.waitForFunction(() => !!(window as TileWin).__firstFrame);
  return (await page.evaluate(() => (window as TileWin).__firstFrame))!;
}

test.describe('map view', () => {
  test('E1: / loads the map with exact attribution, no console errors or CSP violations', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.text().includes('Content Security Policy'))
        errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const w = window as Win;
      w.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        w.__cspViolations!.push(`${e.violatedDirective} ${e.blockedURI}`)
      );
    });

    await gotoReady(page);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    // The canvas fills the map root (guards the container against collapsing to 0 px high).
    const rootBox = (await page.getByTestId('map-root').boundingBox())!;
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!;
    expect(Math.abs(canvasBox.height - rootBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvasBox.width - rootBox.width)).toBeLessThanOrEqual(1);
    const link = page.getByTestId('map-root').getByRole('link', { name: ATTRIBUTION, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveText(ATTRIBUTION);
    await expect(link).toHaveAttribute('href', '/attribution');
    await waitIdle(page);
    await expectNoA11yViolations(page);

    expect(await page.evaluate(() => (window as Win).__cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('E6: WebGL 2 off shows the fallback and passes axe', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2') return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    await page.goto('/');
    const root = page.getByTestId('map-root');
    await expect(root).toHaveAttribute('data-state', 'unsupported', { timeout: 20_000 });
    const alert = root.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('This map needs WebGL 2');
    await expectNoA11yViolations(page);
  });

  // ---- §4.8 states (controller addendum, Ruling 12) --------------------------------------------

  test('buildings unreachable: banner with Retry; retry after recovery clears it', async ({
    page
  }) => {
    await page.route(BUILDINGS, (r) => r.fulfill({ status: 404 }));
    await gotoReady(page);
    const banner = page
      .getByRole('status')
      .filter({ hasText: "Existing buildings couldn't load. Generated buildings still work." });
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const retry = banner.getByRole('button', { name: 'Retry existing buildings' });
    await expect(retry).toHaveText('Retry');

    await page.unroute(BUILDINGS);
    await retry.click();
    await expect(banner).toBeHidden();
    // The retried source loads a tile and no new banner appears.
    await jumpAndIdle(page, { center: PARCEL_3512014, zoom: 16 });
    await expect(banner).toBeHidden();
  });

  test('context lost: overlay with Reload; restoring the context returns to ready', async ({
    page
  }) => {
    await gotoReady(page);
    await page.evaluate(() => {
      const gl = (window as Win).__sfhMap!.map!.getCanvas().getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_lose_context')!;
      (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx = ext;
      ext.loseContext();
    });
    const root = page.getByTestId('map-root');
    await expect(root).toHaveAttribute('data-state', 'context-lost');
    const overlay = root.getByRole('alert');
    await expect(overlay).toContainText("The map's graphics stopped. Reload the page to continue.");
    await expect(overlay.getByRole('button', { name: 'Reload' })).toBeVisible();

    await page.evaluate(() =>
      (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx.restoreContext()
    );
    await expect(root).toHaveAttribute('data-state', 'ready');
    await expect(overlay).toBeHidden();
  });

  test('loading bar: shows after 300 ms while tiles are slow, gone after idle', async ({
    page
  }) => {
    await gotoReady(page);
    await waitIdle(page);
    await page.route(BUILDINGS, async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await r.continue();
    });
    const bar = page.getByTestId('map-root').locator('.sim-map-bar');
    await expect(bar).toHaveCount(0);
    // z16 needs the buildings archive's z15 tile, which neither default frame loaded.
    await page.evaluate((center) => {
      (window as Win).__sfhMap!.map!.jumpTo({ center, zoom: 16 });
    }, PARCEL_3512014);
    await expect(bar).toHaveAttribute('aria-hidden', 'true', { timeout: 1400 });
    await waitIdle(page);
    await expect(bar).toHaveCount(0);
  });

  // ---- 375 px, touch (mobile project only) ----------------------------------------------------

  test.describe('mobile', () => {
    // The brief scopes these to the 375 px touch project; chromium has no touch or Reset view.
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => !isMobile, 'mobile project only');

    test('E4: at 375 px, no horizontal scroll, tap shows the card, Close dismisses it', async ({
      page
    }) => {
      await gotoReady(page);

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBe(true);
      await expect(page.locator('.maplibregl-ctrl-attrib.maplibregl-compact-show')).toBeVisible();
      await expect(page.getByRole('link', { name: ATTRIBUTION, exact: true })).toBeVisible();

      await jumpAndIdle(page, { center: PARCEL_3512014, zoom: 17, pitch: 0, bearing: 0 });
      const [x, y] = await projectToPage(page, PARCEL_3512014);
      await page.touchscreen.tap(x, y);

      const card = page.getByTestId('map-root').locator('.sim-map-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Parcel 3512014');
      await expect(card).toContainText('Existing building');

      const buttons = page.getByTestId('map-root').locator('button:visible');
      expect(await buttons.count()).toBeGreaterThan(0);
      for (const b of await buttons.all()) {
        const box = await b.boundingBox();
        const name = (await b.getAttribute('aria-label')) ?? (await b.textContent());
        expect(box, `button ${name}`).not.toBeNull();
        expect(box!.width, `button ${name} width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `button ${name} height`).toBeGreaterThanOrEqual(44);
      }

      await card.getByRole('button', { name: 'Close' }).click();
      await expect(card).toBeHidden();
    });

    test('reset view: 44×44 button restores the default frame', async ({ page }) => {
      await gotoReady(page);
      const reset = page.getByRole('button', { name: 'Reset view' });
      await expect(reset).toBeVisible();
      const box = (await reset.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);

      await jumpAndIdle(page, { center: PARCEL_3512014, zoom: 16.5, pitch: 0, bearing: 30 });
      await reset.click();
      const zoom = await page.evaluate(() => (window as Win).__sfhMap!.map!.getZoom());
      expect(zoom).toBeCloseTo(12.2, 2);
    });

    test('attribution collapses after a user drag and re-expands from the (i) button', async ({
      page
    }) => {
      await gotoReady(page);
      const attrib = page.locator('.maplibregl-ctrl-attrib.maplibregl-compact');
      await expect(attrib).toHaveClass(/maplibregl-compact-show/);

      const canvas = (await page.locator('.maplibregl-canvas').boundingBox())!;
      const cx = canvas.x + canvas.width / 2;
      const cy = canvas.y + canvas.height / 3;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 40, cy + 20, { steps: 5 });
      await page.mouse.move(cx + 80, cy + 40, { steps: 5 });
      await page.mouse.up();
      await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);

      const button = attrib.locator('.maplibregl-ctrl-attrib-button');
      await expect(button).toBeVisible();
      await button.click();
      await expect(attrib).toHaveClass(/maplibregl-compact-show/);
      await expect(page.getByRole('link', { name: ATTRIBUTION, exact: true })).toBeVisible();
    });
  });

  // ---- painting (brush-tool + worker host) -----------------------------------------------------

  test('E2: paint a stroke, then erase', async ({ page, isMobile }) => {
    await gotoEditor(page);
    expect(await settled(page)).toMatchObject({ parts: 0, hidden: 0 });

    await paintOnce(page, isMobile);
    // Expected hidden set: the parcels whose generated building replaces the existing one, i.e.
    // every non-ADU typology (generator: replacesExisting = typology !== 'adu'), read from the
    // controller's generated layers. The hidden ids come from the worker's hide diff.
    await expect
      .poll(async () => {
        const s = await settled(page);
        return (
          s.pending === 0 &&
          s.parts > 0 &&
          s.replacing.length > 0 &&
          s.hidden === s.replacing.length &&
          s.hiddenIds.join() === s.replacing.join()
        );
      })
      .toBe(true);
    const s = await settled(page);
    expect(s.hiddenIds).toEqual(s.replacing);
    expect(s.hidden).toBe(s.replacing.length);
    test.info().annotations.push({
      type: 'E2',
      description: `parts ${s.parts}, generated parcels ${s.generated}, hidden ${s.hidden}`
    });

    await stroke(page, isMobile, 'Erase');
    await expect.poll(() => ops(page)).toBe(2);
    await expect
      .poll(async () => {
        const t = await settled(page);
        return { parts: t.parts, hidden: t.hidden, pending: t.pending };
      })
      .toEqual({ parts: 0, hidden: 0, pending: 0 });
  });

  test.describe('fine pointer', () => {
    // Hover tooltips need a mouse; the mobile project is touch-only (its tap card is E4).
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');

    test('E3: hover generated and existing buildings', async ({ page }) => {
      await gotoEditor(page);
      await paintOnce(page, false);
      await expect
        .poll(async () => {
          const s = await settled(page);
          return s.pending === 0 && s.replacing.length > 0;
        })
        .toBe(true);
      const gen = await page.evaluate(() => (window as Win).__sfhMap!.generatedParcels());
      const target = gen.find((g) => g.typology !== 'adu');
      expect(target).toBeDefined();

      const tip = page.getByTestId('map-root').getByRole('tooltip');
      const [gx, gy] = await projectToPage(page, LABELS.get(target!.parcelId)!);
      await page.mouse.move(gx, gy);
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(`Parcel ${target!.parcelId}`);
      await expect(tip).toContainText(typologyLabel(target!.typology as TypologyId, target!.units));
      await expect(tip).toContainText(/\bunits?\b/);
      await expect(tip).not.toContainText('Existing building');

      // 3512014 (60 m, 40 units) lies under the stroke, but a 6-story building is not bigger, so
      // it keeps its existing building.
      expect(gen.map((g) => g.parcelId)).not.toContain('3512014');
      const [ex, ey] = await projectToPage(page, PARCEL_3512014);
      await page.mouse.move(ex, ey, { steps: 5 });
      await expect(tip).toContainText('Parcel 3512014');
      await expect(tip).toContainText('Existing building');
    });
  });

  test('E5: feature-state persists across a z11 round trip and a tile refetch', async ({
    page,
    isMobile
  }) => {
    await gotoEditor(page);
    await paintOnce(page, isMobile);
    await expect
      .poll(async () => {
        const s = await settled(page);
        return s.pending === 0 && s.hidden > 0;
      })
      .toBe(true);
    await waitIdle(page);

    // A replaced parcel with a rendered existing building in view (some fixture parcels have no
    // building).
    const hidden = (await settled(page)).hiddenIds;
    const replaced = await firstRendered(page, hidden);
    expect(replaced, `one of ${hidden.join(', ')} has a rendered building`).not.toBeNull();
    const at = LABELS.get(replaced!)!;
    test.info().annotations.push({ type: 'E5', description: `replaced parcel ${replaced}` });
    expect(await replacedAt(page, replaced!, at)).toEqual([true]);

    await page.evaluate(() => {
      const w = window as TileWin;
      w.__tileLoads = 0;
      w.__sfhMap!.map!.on('sourcedata', (e) => {
        if (e.sourceId === 'buildings' && e.tile) w.__tileLoads!++;
      });
    });
    await jumpAndIdle(page, { center: FRAME.center, zoom: 11, pitch: 0, bearing: 0 });
    await jumpAndIdle(page, FRAME);
    expect(await replacedAt(page, replaced!, at)).toEqual([true]);

    // The zoom trip may be served from MapLibre's tile cache: force a real refetch and re-parse.
    const before = await tileLoads(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = (window as Win).__sfhMap!.map!;
          map.refreshTiles('buildings');
          map.once('idle', () => resolve());
          map.triggerRepaint();
        })
    );
    await waitIdle(page);
    expect(await tileLoads(page)).toBeGreaterThan(before);
    expect(await replacedAt(page, replaced!, at)).toEqual([true]);
  });

  test('E7: chunk failure outline, chip and Retry', async ({ page, isMobile }) => {
    await page.route(CHUNK, (r) => r.fulfill({ status: 500 }));
    await gotoEditor(page);
    await paintOnce(page, isMobile);

    const chip = page
      .getByTestId('map-root')
      .getByRole('status')
      .filter({ hasText: "Some parcels didn't load" });
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await expect(chip).toHaveText(/^Some parcels didn't load —\s*Retry$/);
    const retry = chip.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await expect.poll(() => errorOutline(page)).toBeGreaterThan(0);
    expect((await settled(page)).parts).toBe(0);

    await page.unroute(CHUNK);
    await retry.click();
    await expect(chip).toBeHidden({ timeout: 5_000 });
    await expect.poll(() => errorOutline(page)).toBe(0);
    await expect.poll(async () => (await settled(page)).parts).toBeGreaterThan(0);
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('E8: reduced motion renders full height on the first frame', async ({
      page,
      isMobile
    }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await recordFirstFrame(page);
      await paintOnce(page, isMobile);
      const first = await firstFrame(page);
      expect(first.layerIds.filter((id) => id.startsWith('rising-'))).toEqual([]);
      const scales = Object.entries(first.elevationScale);
      expect(scales.length).toBeGreaterThan(0);
      for (const [id, v] of scales) expect(v, id).toBe(1);
    });
  });

  // Control for E8: with motion allowed, the same first-frame probe sees a rising layer, so E8's
  // assertion is able to fail.
  test('E8 control: default motion rises in from the first frame', async ({ page, isMobile }) => {
    await gotoEditor(page);
    await jumpAndIdle(page, FRAME);
    await recordFirstFrame(page);
    await paintOnce(page, isMobile);
    const first = await firstFrame(page);
    expect(first.layerIds.some((id) => id.startsWith('rising-'))).toBe(true);
  });

  // ---- E9 golden screenshots, E10 first-paint budget -------------------------------------------

  test.describe('goldens', () => {
    // Goldens are Chromium SwiftShader only (spec §6 E9); the mobile project has a different frame.
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      process.platform !== 'darwin',
      'E9 goldens are generated on darwin, where signoff (the merge gate) runs; ci.yml on Linux is feedback only'
    );
    test.use({ reducedMotion: 'reduce' });

    for (const scheme of ['light', 'dark'] as const) {
      test(`E9: golden screenshot map-${scheme}.png`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await gotoEditor(page);
        await waitIdle(page);
        await page.evaluate(
          (text) => (window as Win).__sfhBrush!.load(JSON.parse(text)),
          readFileSync(
            new URL('../src/lib/sharing/fixtures/plans/small.json', import.meta.url),
            'utf8'
          )
        );
        // Worker completion: all 3 ops loaded, nothing pending, revision unchanged across polls.
        await expect.poll(() => ops(page)).toBe(3);
        let prev = -1;
        let stable = 0;
        await expect
          .poll(
            async () => {
              const s = await page.evaluate(() => {
                const m = (window as Win).__sfhMap!;
                const snap = m.snapshot();
                return {
                  rev: snap?.revision ?? -1,
                  pending: snap?.pending ?? 1,
                  parts: snap?.parts ?? 0
                };
              });
              stable = s.pending === 0 && s.rev === prev ? stable + 1 : 0;
              prev = s.rev;
              return stable;
            },
            { intervals: [100], timeout: 20_000 }
          )
          .toBeGreaterThanOrEqual(3);
        // The spec's default desktop frame, as written (generated buildings may be off-frame).
        await jumpAndIdle(page, {
          center: [-122.4194, 37.7749],
          zoom: 13,
          pitch: 55,
          bearing: -20
        });
        await waitIdle(page);
        await expect(page.getByTestId('map-root')).toHaveScreenshot(`map-${scheme}.png`, {
          maxDiffPixelRatio: 0.01,
          animations: 'disabled'
        });
      });
    }
  });

  test('E10 @budget: ≤ 5 MB transferred until first idle', async ({ page }) => {
    // Local-preview proxy for the staging check. Bytes are CDP encodedDataLength totals; they can
    // vary a little run to run (headers, compression, which tiles the first frame picks), so the
    // measured value is annotated and only the generous 5 MB ceiling is asserted.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let bytes = 0;
    cdp.on('Network.loadingFinished', (e) => {
      bytes += e.encodedDataLength;
    });
    await gotoReady(page);
    await waitIdle(page);
    test.info().annotations.push({ type: 'E10', description: `${bytes} bytes` });
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
