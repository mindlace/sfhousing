// Brush tool e2e (spec §6 Playwright 1–6, §7), on the dock's Paint tab (sim-ux plan 5): painting,
// stamps, undo and redo by keyboard, the stroke chip and the failure chip. Runs against the
// VITE_E2E build, which exposes window.__sfhBrush (src/lib/brush/debug.ts) and
// window.__sfhMap (src/lib/map/debug.ts), and shortens the worker's chunk retries to 50/100/200 ms.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MSG } from '../src/lib/brush/messages';
import type { SfhBrushDebug } from '../src/lib/brush/debug';
import type { Plan } from '../src/lib/plan';
import type { SfhMapDebug } from '../src/lib/map/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import {
  PLAN_KEY,
  chooseTool,
  gotoEditor as gotoEditorWithActions,
  mouseDrag,
  publishDialog,
  publishOpen,
  settledNet,
  touchDrag,
  waitForMap
} from './helpers/sharing';

type Win = Window & { __sfhMap?: SfhMapDebug; __sfhBrush?: SfhBrushDebug };
type LngLat = [number, number];

// fixture-0's chunk 50_25 holds 15 parcels around [-122.4186, 37.7601] (51_25: lots 15-17).
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

/**
 * The brush's announcements (a stroke's result, a refusal, Undid, Redid): a polite status
 * over the map's top that shows them in the stroke chip. The status line in the notice stack
 * (`brush-status`) carries only loading, the zoom hint and failures.
 */
function announcement(page: Page): Locator {
  return page.getByTestId('brush-announcement');
}
const strokeChip = (page: Page): Locator => page.getByTestId('stroke-chip');
/** map-view's chip for failed parcel chunks, with its Retry. */
const failureChip = (page: Page): Locator =>
  page.getByRole('status').filter({ hasText: "Some parcels didn't load —" });

/**
 * With the failure chip and the stroke chip both on screen, they do not overlap, and a press at
 * Retry's centre reaches Retry (the stroke chip sits a row lower and takes no presses).
 */
async function expectChipsApart(page: Page): Promise<void> {
  await expect(failureChip(page)).toBeVisible();
  await expect(strokeChip(page)).toBeVisible();
  const a = (await failureChip(page).boundingBox())!;
  const b = (await strokeChip(page).boundingBox())!;
  const overlap =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, `failure ${JSON.stringify(a)} stroke ${JSON.stringify(b)}`).toBe(false);
  const retry = failureChip(page).getByRole('button', { name: 'Retry' });
  const r = (await retry.boundingBox())!;
  const hit = await retry.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), {
    x: r.x + r.width / 2,
    y: r.y + r.height / 2
  });
  expect(hit).toBe(true);
}

/** Records every error the editor worker answers with (bad-request, internal) in the page. */
async function recordWorkerErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const W = window.Worker;
    const w = window as unknown as { __sfhWorkerErrors: string[] };
    w.__sfhWorkerErrors = [];
    window.Worker = class extends W {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        this.addEventListener('message', (e: MessageEvent) => {
          const d = e.data as { type?: string; code?: string };
          if (d?.type === 'error') w.__sfhWorkerErrors.push(String(d.code));
        });
      }
    };
  });
}
const workerErrors = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sfhWorkerErrors: string[] }).__sfhWorkerErrors);

/** The height palette's preset (the Paint tab is open in the dock from md). */
async function pickStories(page: Page, n: number): Promise<void> {
  const swatch = page.getByRole('button', { name: `${n} stories`, exact: true });
  await swatch.click();
  await expect(swatch).toHaveAttribute('aria-pressed', 'true');
}

test.describe('brush tool', () => {
  test.describe('desktop', () => {
    // Desktop mouse painting; the mobile project defaults to Move (covered below).
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');

    // Its pointer-up-to-commit budget (150 ms) is e2e/perf/brush-commit.perf.spec.ts's.
    test('paint: a drag paints 6 stories, map-view shows the buildings', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await expect(page.getByRole('radio', { name: 'Paint' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(await generated(page)).toBe(0);

      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);

      await expect(strokeChip(page)).toHaveText(/^6 stories on \d+ lots/);
      expect(await ops(page)).toBe(1);
      await expect.poll(() => generated(page)).toBeGreaterThanOrEqual(1);
    });

    test('undo and redo by keyboard revert and restore the counts', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      await expect(announcement(page)).toHaveText(/^6 stories on \d+ lots/);
      await expect.poll(() => generated(page)).toBeGreaterThanOrEqual(1);
      const painted = await generated(page);

      await page.keyboard.press('Control+z');
      await expect.poll(() => ops(page)).toBe(0);
      await expect(announcement(page)).toHaveText('Undid paint, 6 stories');
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

    test('a stroke while parcels failed: the stroke chip clears the failure chip and its Retry', async ({
      page
    }) => {
      await page.route(CHUNK, (r) => r.abort());
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      await expect(failureChip(page)).toBeVisible();
      // A stroke with the failure chip up: its result shows a row lower.
      await mouseDrag(page, [-122.4193, 37.7603], [-122.418, 37.7603]);
      await expect.poll(() => ops(page)).toBe(2);
      await expectChipsApart(page);
    });

    test('a published plan, then a stroke: the button reads Publish again', async ({ page }) => {
      await gotoEditorWithActions(page);
      // The strokes need the camera, not the tiles: the worker resolves lots city-wide.
      await page.evaluate((f) => (window as Win).__sfhMap!.map!.jumpTo(f), FRAME);
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      await expect.poll(() => ops(page)).toBe(1);

      await publishOpen(page).click();
      const dialog = publishDialog(page);
      await dialog.getByLabel('Title').fill('One height');
      await dialog.getByRole('button', { name: 'Publish' }).click();
      await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(publishOpen(page)).toHaveText('Share link');

      // A new op list: its hash differs from the published one.
      await pickStories(page, 8);
      await mouseDrag(page, [-122.4193, 37.7603], [-122.418, 37.7603]);
      await expect.poll(() => ops(page)).toBe(2);
      await expect(publishOpen(page)).toHaveText('Publish');
    });

    test('a restored plan undoes and redoes over its load: the score follows, no worker errors', async ({
      page
    }) => {
      await recordWorkerErrors(page);
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      await expect.poll(() => ops(page)).toBe(1);
      // The commit's diff (and its score) has arrived once the chip names the stroke.
      await expect(announcement(page)).toHaveText(/^6 stories on \d+ lots/);
      const one = await settledNet(page);
      // An erase over the same lots: the score must change.
      await chooseTool(page, 'Erase');
      await mouseDrag(page, [-122.4193, 37.76014], [-122.418, 37.76014]);
      await expect.poll(() => ops(page)).toBe(2);
      await expect(announcement(page)).toHaveText(/^Erased \d+ lots?/);
      const two = await settledNet(page);
      expect(two).not.toBe(one);

      // The autosave restores the plan: the editor `load`s it and the worker gets the whole plan.
      await expect
        .poll(() =>
          page.evaluate(
            (k) =>
              JSON.parse(JSON.parse(localStorage.getItem(k) ?? '{"plan":"{}"}').plan).ops?.length,
            PLAN_KEY
          )
        )
        .toBe(2);
      await page.reload();
      await waitForMap(page);
      await expect.poll(() => ops(page)).toBe(2);
      expect(await settledNet(page)).toBe(two);

      // Undo pops the restored plan's last stroke, as the worker holds it.
      await page.keyboard.press('Control+z');
      await expect.poll(() => ops(page)).toBe(1);
      await expect(announcement(page)).toHaveText('Undid erase');
      expect(await settledNet(page)).toBe(one);

      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => ops(page)).toBe(2);
      expect(await settledNet(page)).toBe(two);
      expect(await workerErrors(page)).toEqual([]);
    });

    test('a parent loads a plan through oneditor and the buildings render', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      expect(await generated(page)).toBe(0);
      const q = (d: number) => Math.round(d * 1e6) / 1e6;
      const plan: Plan = {
        schema: 1,
        datasetVersion: 'fixture-0',
        ops: [
          {
            kind: 'paint',
            stories: 6,
            radiusM: 80,
            path: [[q(FRAME.center[0]), q(FRAME.center[1])]],
            id: 'Lo4dPlanAb12'
          }
        ]
      };

      await page.evaluate((p) => (window as Win).__sfhBrush!.load(p), plan);

      await expect.poll(() => ops(page)).toBe(1);
      await expect.poll(() => generated(page)).toBeGreaterThan(0);
    });

    test('axe: the editor with the keyboard shortcuts list open', async ({ page }) => {
      await gotoEditor(page);
      // A popover from ShortcutsButton, the last control in the Paint tab.
      const dock = page.getByTestId('dock');
      const button = dock.getByRole('button', { name: 'Keyboard shortcuts' });
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
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
      // Move is the touch default: the sheet holds the tools, and no palette strip shows.
      await expect(page.getByTestId('palette-strip')).toBeHidden();
      await chooseTool(page, 'Move');
      const handle = page.getByTestId('dock-handle');
      await handle.click();
      await expect(handle).toHaveAttribute('aria-expanded', 'false');

      // Move: a one-finger drag pans and creates no op.
      const before = await center(page);
      const a = await projectToPage(page, [-122.419, 37.76014]);
      const b = await projectToPage(page, [-122.4183, 37.76014]);
      await touchDrag(cdp, a, b);
      await expect.poll(async () => (await center(page))[0]).not.toBeCloseTo(before[0], 6);
      expect(await ops(page)).toBe(0);

      // Paint: a drag creates one op.
      // Paint folds the sheet to the palette strip.
      await chooseTool(page, 'Paint');
      await jumpAndIdle(page, FRAME);
      const p = await projectToPage(page, [-122.419, 37.76014]);
      const q = await projectToPage(page, [-122.4183, 37.76014]);
      const mapHeight = () =>
        page.getByTestId('map-root').evaluate((el) => el.getBoundingClientRect().height);
      // Nothing visible in the status line (parcels loaded, no zoom hint) before measuring.
      await expect(page.getByTestId('brush-status')).toHaveText('');
      const heightBefore = await mapHeight();
      await touchDrag(cdp, p, q);
      await expect.poll(() => ops(page)).toBe(1);
      // The stroke's result shows in the chip over the map: the map keeps its height.
      await expect(strokeChip(page)).toHaveText(/^6 stories on \d+ lots/);
      expect(await mapHeight()).toBe(heightBefore);

      // A second touch mid-stroke cancels it: still one op.
      await jumpAndIdle(page, FRAME);
      await touchDrag(cdp, p, q, 4, async () => {
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

    test('a stroke while parcels failed: the stroke chip clears the failure chip and its Retry', async ({
      page
    }) => {
      await page.route(CHUNK, (r) => r.abort());
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      const cdp = await page.context().newCDPSession(page);
      await chooseTool(page, 'Paint');
      await jumpAndIdle(page, FRAME);
      const p = await projectToPage(page, [-122.419, 37.76014]);
      const q = await projectToPage(page, [-122.4183, 37.76014]);
      await touchDrag(cdp, p, q);
      await expect.poll(() => ops(page)).toBe(1);
      await expect(failureChip(page)).toBeVisible();
      await touchDrag(cdp, p, q);
      await expect.poll(() => ops(page)).toBe(2);
      await expectChipsApart(page);
    });

    test('axe: the editor with the radius popover open', async ({ page }) => {
      await gotoEditor(page);
      // The palette strip's size pop-over (Paint folds the sheet to the strip).
      await chooseTool(page, 'Paint');
      const opener = page
        .getByTestId('palette-strip')
        .getByRole('button', { name: /^Brush \d+ m$/ });
      await expect(opener).toHaveText(/^\d+ m$/);
      await opener.tap();
      await expect(opener).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('group', { name: 'Brush radius' })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  });
});
