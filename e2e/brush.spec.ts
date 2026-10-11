// Brush tool e2e (spec §6 Playwright 1–6, §7). Runs against the VITE_E2E build, which exposes
// window.__sfhBrush (src/lib/brush/debug.ts) and window.__sfhMap (src/lib/map/debug.ts), and
// shortens the worker's chunk retries to 50/100/200 ms.
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { MSG } from '../src/lib/brush/messages';
import type { SfhBrushDebug } from '../src/lib/brush/debug';
import type { SfhMapDebug } from '../src/lib/map/debug';
import { expectNoA11yViolations } from './helpers/a11y';

type Win = Window & { __sfhMap?: SfhMapDebug; __sfhBrush?: SfhBrushDebug };
type LngLat = [number, number];

// fixture-0 holds one chunk (50_25) of 14 parcels around [-122.4186, 37.7601].
const FRAME = { center: [-122.4187, 37.76014] as LngLat, zoom: 18.5, pitch: 0, bearing: 0 };
const CHUNK = '**/data/fixture-0/parcels/50_25.json';

async function gotoEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => {
    const w = window as Win;
    return !!w.__sfhMap?.map && !!w.__sfhBrush?.ready;
  });
}

// Jump the camera and resolve on the next `idle` (all tiles loaded, nothing animating).
async function jumpAndIdle(page: Page, frame: typeof FRAME): Promise<void> {
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

async function projectToPage(page: Page, lngLat: LngLat): Promise<[number, number]> {
  return page.evaluate((ll) => {
    const map = (window as Win).__sfhMap!.map!;
    const p = map.project(ll);
    const r = map.getCanvas().getBoundingClientRect();
    return [r.left + p.x, r.top + p.y] as [number, number];
  }, lngLat);
}

const ops = (page: Page) => page.evaluate(() => (window as Win).__sfhBrush!.ops);
// Generated building parts in map-view's controller (debugSnapshot().parts).
const generated = (page: Page) =>
  page.evaluate(() => (window as Win).__sfhMap!.snapshot()?.parts ?? 0);
const center = (page: Page) =>
  page.evaluate(() => (window as Win).__sfhMap!.map!.getCenter().toArray() as LngLat);

function brushStatus(page: Page): Locator {
  return page.locator('.brush-toolbar').getByRole('status');
}

async function mouseDrag(page: Page, from: LngLat, to: LngLat, steps = 15): Promise<void> {
  const [x0, y0] = await projectToPage(page, from);
  const [x1, y1] = await projectToPage(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

// One-finger drag through CDP, so Chromium emits real touch and pointer events.
async function touchDrag(
  cdp: CDPSession,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  steps = 12,
  midway?: () => Promise<void>
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x0, y: y0, id: 1 }]
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, id: 1 }]
    });
    if (midway && i === Math.floor(steps / 2)) await midway();
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function lastCommitMeasure(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const e = performance.getEntriesByName('sfh-brush-commit', 'measure');
    return e.length ? e[e.length - 1].duration : null;
  });
}

test.describe('brush tool', () => {
  test.describe('desktop', () => {
    // Desktop mouse painting; the mobile project defaults to Move (covered below).
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');

    test('paint: a drag paints 6 stories, map-view shows the buildings, ≤ 150 ms', async ({
      page
    }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await expect(page.getByRole('radio', { name: 'Paint' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(await generated(page)).toBe(0);

      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);

      await expect(brushStatus(page)).toHaveText(/^Painted 6 stories on \d+ parcels/);
      expect(await ops(page)).toBe(1);
      await expect.poll(() => generated(page)).toBeGreaterThanOrEqual(1);

      const ms = await lastCommitMeasure(page);
      test.info().annotations.push({ type: 'sfh-brush-commit', description: `${ms} ms` });
      expect(ms).not.toBeNull();
      expect.soft(ms!).toBeLessThanOrEqual(150);
    });

    test('undo and redo by keyboard revert and restore the counts', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      await expect(brushStatus(page)).toHaveText(/^Painted 6 stories/);
      await expect.poll(() => generated(page)).toBeGreaterThanOrEqual(1);
      const painted = await generated(page);

      await page.keyboard.press('Control+z');
      await expect.poll(() => ops(page)).toBe(0);
      await expect(brushStatus(page)).toHaveText('Undid paint, 6 stories');
      await expect.poll(() => generated(page)).toBe(0);

      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => ops(page)).toBe(1);
      await expect.poll(() => generated(page)).toBe(painted);
    });

    test('stamps: a click and a keyboard Enter each add one op', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      const canvas = page.locator('.maplibregl-canvas');
      await expect(canvas).toHaveAttribute('aria-label', MSG.mapLabel);

      const [x, y] = await projectToPage(page, FRAME.center);
      await page.mouse.click(x, y);
      await expect.poll(() => ops(page)).toBe(1);

      // Reach the canvas by Tab so it matches :focus-visible.
      await page.locator('body').focus();
      await expect
        .poll(
          async () => {
            await page.keyboard.press('Tab');
            return canvas.evaluate((el) => el === document.activeElement);
          },
          { intervals: [0], timeout: 10_000 }
        )
        .toBe(true);
      expect(await canvas.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
      await page.keyboard.press('Enter');
      await expect.poll(() => ops(page)).toBe(2);
    });

    test('a failed chunk shows the Retry chip, and Retry recovers', async ({ page }) => {
      await page.route(CHUNK, (r) => r.abort());
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      expect(await ops(page)).toBe(1);

      const chip = page.getByRole('status').filter({ hasText: "Some parcels didn't load —" });
      await expect(chip).toBeVisible({ timeout: 5_000 });
      const retry = chip.getByRole('button', { name: 'Retry' });
      await expect(retry).toBeVisible();
      expect(await generated(page)).toBe(0);

      await page.unroute(CHUNK);
      await retry.click();
      await expect(chip).toBeHidden({ timeout: 5_000 });
      await expect.poll(() => generated(page)).toBeGreaterThan(0);
    });

    test('axe: the editor with the keyboard shortcuts disclosure open', async ({ page }) => {
      await gotoEditor(page);
      const keys = page.getByRole('button', { name: 'Keyboard shortcuts' });
      await keys.click();
      await expect(keys).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('table', { name: 'Keyboard shortcuts' })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  });

  test.describe('mobile', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => !isMobile, 'mobile project only');

    test('Move pans; Paint paints; a second finger mid-stroke adds no op', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      const cdp = await page.context().newCDPSession(page);
      await expect(page.getByRole('radio', { name: 'Move' })).toHaveAttribute(
        'aria-checked',
        'true'
      );

      // Move: a one-finger drag pans and creates no op.
      const before = await center(page);
      const a = await projectToPage(page, [-122.419, 37.76014]);
      const b = await projectToPage(page, [-122.4183, 37.76014]);
      await touchDrag(cdp, a, b);
      await expect.poll(async () => (await center(page))[0]).not.toBeCloseTo(before[0], 6);
      expect(await ops(page)).toBe(0);

      // Paint: a drag creates one op.
      await jumpAndIdle(page, FRAME);
      await page.getByRole('radio', { name: 'Paint' }).tap();
      await expect(page.getByRole('radio', { name: 'Paint' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      const p = await projectToPage(page, [-122.419, 37.76014]);
      const q = await projectToPage(page, [-122.4183, 37.76014]);
      await touchDrag(cdp, p, q);
      await expect.poll(() => ops(page)).toBe(1);

      // A second touch mid-stroke cancels it: still one op.
      await jumpAndIdle(page, FRAME);
      await touchDrag(cdp, p, q, 12, async () => {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { x: (p[0] + q[0]) / 2, y: p[1], id: 1 },
            { x: (p[0] + q[0]) / 2, y: p[1] + 80, id: 2 }
          ]
        });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: (p[0] + q[0]) / 2 + 10, y: p[1], id: 1 },
            { x: (p[0] + q[0]) / 2 + 10, y: p[1] + 100, id: 2 }
          ]
        });
      });
      // A tap stamp afterwards makes exactly two: the cancelled stroke committed nothing.
      await page.touchscreen.tap((p[0] + q[0]) / 2, p[1]);
      await expect.poll(() => ops(page)).toBe(2);
      expect(await ops(page)).toBe(2);
    });

    test('axe: the editor with the radius popover open', async ({ page }) => {
      await gotoEditor(page);
      const opener = page.getByRole('button', { name: /^Brush \d+ m$/ });
      await expect(opener).toHaveText(/^\d+ m$/);
      await opener.tap();
      await expect(opener).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('group', { name: 'Brush radius' })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  });
});
