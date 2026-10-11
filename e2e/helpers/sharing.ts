// Shared helpers for the plan-sharing e2e specs. Editor navigation and the drag helpers are copied
// from e2e/scoreboard.spec.ts and e2e/brush.spec.ts (those specs keep their own copies).
import {
  expect,
  type APIRequestContext,
  type CDPSession,
  type Locator,
  type Page
} from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { SfhBrushDebug } from '../../src/lib/brush/debug';
import type { SfhMapDebug } from '../../src/lib/map/debug';

export type Win = Window & { __sfhMap?: SfhMapDebug; __sfhBrush?: SfhBrushDebug };
export type LngLat = [number, number];

// fixture-0 holds one chunk (50_25) of 14 parcels around [-122.4186, 37.7601].
export const FRAME = { center: [-122.4187, 37.76014] as LngLat, zoom: 18.5, pitch: 0, bearing: 0 };
export const FROM: LngLat = [-122.4193, 37.76014];
export const TO: LngLat = [-122.418, 37.76014];
// A shorter stroke that stays inside a 375 px wide map (as in e2e/brush.spec.ts's mobile test).
export const TOUCH_FROM: LngLat = [-122.419, 37.76014];
export const TOUCH_TO: LngLat = [-122.4183, 37.76014];

export const PLAN_KEY = 'sfhousing:plan:v1';

/** `src/lib/sharing/fixtures/plans/small.json` as raw text (3 ops on fixture-0). */
export const smallText = readFileSync(
  new URL('../../src/lib/sharing/fixtures/plans/small.json', import.meta.url),
  'utf8'
);

/** Waits for the map and brush to be ready (a shared plan page or the editor). */
export async function waitForMap(page: Page): Promise<void> {
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => {
    const w = window as Win;
    return !!w.__sfhMap?.map && !!w.__sfhBrush?.ready;
  });
}

export const publishOpen = (page: Page): Locator => page.getByTestId('publish-open');

/** `/` with the map ready and the header actions hydrated (the Publish button exists). */
export async function gotoEditor(page: Page): Promise<void> {
  await page.goto('/');
  await waitForMap(page);
  await expect(publishOpen(page)).toBeVisible();
}

export async function jumpAndIdle(page: Page, frame: typeof FRAME = FRAME): Promise<void> {
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

export async function projectToPage(page: Page, lngLat: LngLat): Promise<[number, number]> {
  return page.evaluate((ll) => {
    const map = (window as Win).__sfhMap!.map!;
    const p = map.project(ll);
    const r = map.getCanvas().getBoundingClientRect();
    return [r.left + p.x, r.top + p.y] as [number, number];
  }, lngLat);
}

export async function mouseDrag(page: Page, from: LngLat, to: LngLat, steps = 15): Promise<void> {
  const [x0, y0] = await projectToPage(page, from);
  const [x1, y1] = await projectToPage(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

// One-finger drag through CDP, so Chromium emits real touch and pointer events.
export async function touchDrag(
  cdp: CDPSession,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  steps = 12
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
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export const ops = (page: Page): Promise<number> =>
  page.evaluate(() => (window as Win).__sfhBrush!.ops);

/**
 * Paints one stroke at FRAME: a mouse drag FROM → TO on desktop; on the mobile project, switch to
 * Paint mode and drag TOUCH_FROM → TOUCH_TO with one finger. Resolves once the editor holds
 * exactly one op.
 */
export async function paintOnce(page: Page, isMobile: boolean): Promise<void> {
  await jumpAndIdle(page);
  if (isMobile) {
    await page.getByRole('radio', { name: 'Paint' }).tap();
    await expect(page.getByRole('radio', { name: 'Paint' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    const cdp = await page.context().newCDPSession(page);
    const a = await projectToPage(page, TOUCH_FROM);
    const b = await projectToPage(page, TOUCH_TO);
    await touchDrag(cdp, a, b);
  } else {
    await mouseDrag(page, FROM, TO);
  }
  await expect.poll(() => ops(page)).toBe(1);
}

/** Waits until the net readout is unchanged across 3 polls >= 100 ms apart; returns its text. */
export async function settledNet(page: Page): Promise<string> {
  const net = page.getByTestId('score-net');
  let prev = '';
  let stable = 0;
  await expect
    .poll(
      async () => {
        const t = (await net.textContent())?.trim() ?? '';
        stable = t === prev ? stable + 1 : 0;
        prev = t;
        return stable;
      },
      { intervals: [100], timeout: 10_000 }
    )
    .toBeGreaterThanOrEqual(3);
  return prev;
}

/** The open Publish dialog (native modal). */
export const publishDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: /Publish this plan|Published/ });

/** `old-version.json`: small.json on the absent dataset version `fixture-0000`. */
export const oldVersionText = readFileSync(
  new URL('../../src/lib/sharing/fixtures/plans/old-version.json', import.meta.url),
  'utf8'
);

/**
 * Seeds a raw plan row through the preview's e2e-only `POST /api/e2e/plans` (VITE_E2E build with
 * ENVIRONMENT=development) and returns its id, for states the public API refuses to create: a
 * retired dataset version (N6) or an unparsable body. `datasetVersion` defaults to `fixture-0000`.
 * The write goes through the preview's own D1 binding, so it never contends for the SQLite file.
 */
export async function seedPlanRow(
  request: APIRequestContext,
  opts: { body: string; datasetVersion?: string }
): Promise<string> {
  const res = await request.post('/api/e2e/plans', { data: opts });
  // 201 = a new row; 200 = this body was already seeded (local D1 persists across runs).
  expect([200, 201], await res.text()).toContain(res.status());
  return ((await res.json()) as { id: string }).id;
}
