// Map view e2e (spec §6 E1–E10, §4.8 states). Runs against the VITE_E2E build, which exposes
// window.__sfhMap (src/lib/map/debug.ts). Tests that need brush-tool's painting or worker host
// are test.fixme until W6.
import { expect, test, type Page } from '@playwright/test';
import type { SfhMapDebug } from '../src/lib/map/debug';
import { expectNoA11yViolations } from './helpers/a11y';

const ATTRIBUTION = '© OpenStreetMap · Overture Maps (Esri, Microsoft, USGS) · DataSF · Protomaps';
const BUILDINGS = '**/data/fixture-0/buildings.pmtiles';
// Fixture parcel 3512014 (e2e/fixtures/data/fixture-0/parcels/50_25.json): label point and a
// 60 m existing building.
const PARCEL_3512014: [number, number] = [-122.4179679, 37.7601348];

type Win = Window & { __sfhMap?: SfhMapDebug; __cspViolations?: string[] };

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

  // ---- W6: need brush-tool painting and the worker host ----------------------------------------

  const W6: [title: string, reason: string][] = [
    ['E2: paint a stroke, then erase', 'W6: needs brush-tool painting + worker host'],
    [
      'E3: hover generated and existing buildings',
      'W6: generated hover needs worker-host buildings'
    ],
    ['E5: feature-state persists across a z11 round trip', 'W6: needs painted replaced parcel'],
    ['E7: chunk failure outline, chip and Retry', 'W6: needs worker host retryChunks'],
    [
      'E8: reduced motion renders full height on the first frame',
      'W6: needs worker-host-generated buildings'
    ],
    [
      'E9: golden screenshots map-light.png and map-dark.png',
      'W6: golden screenshots need fixture plan rendered via worker host'
    ],
    [
      'E10 @budget: ≤ 5 MB transferred until first idle',
      'W6/staging: @budget runs post-deploy against staging only'
    ]
  ];
  for (const [title, reason] of W6) {
    // eslint-disable-next-line playwright/expect-expect -- fixme placeholder, never runs
    test.fixme(title, { annotation: { type: 'fixme', description: reason } }, () => {});
  }
});
