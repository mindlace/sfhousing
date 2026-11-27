// Shared helpers for the plan-sharing e2e specs. Editor navigation and the drag helpers came from
// e2e/brush.spec.ts, which keeps its own editor navigation but strokes with `mouseDrag` and
// `touchDrag` from here. The score helpers (`headerScore`, `headerNet`, `openResults`,
// `settledNet`) read `/`'s header score.
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
import { newVisitor } from './game';

export type Win = Window & { __sfhMap?: SfhMapDebug; __sfhBrush?: SfhBrushDebug };
export type LngLat = [number, number];

// fixture-0's chunk 50_25 holds 15 parcels (lots 0 to 14) around [-122.4186, 37.7601]; chunk 51_25,
// about 700 m east, holds lots 15 to 17 (counts in the manifest's `parcelCount`).
export const FRAME = { center: [-122.4187, 37.76014] as LngLat, zoom: 18.5, pitch: 0, bearing: 0 };
export const FROM: LngLat = [-122.4193, 37.76014];
export const TO: LngLat = [-122.418, 37.76014];
// A shorter stroke that stays inside a 375 px wide map (as in e2e/brush.spec.ts's mobile test).
export const TOUCH_FROM: LngLat = [-122.419, 37.76014];
export const TOUCH_TO: LngLat = [-122.4183, 37.76014];

export const PLAN_KEY = 'sfhousing:plan:v1';
/** The /sim policy's autosave key (`SIM_KEY4` in src/lib/timeline/sim-doc4.ts, schema 4). */
export const SIM_KEY = 'sfhousing:sim:v2';
/** The schema 3 autosave key, carried over to `SIM_KEY` on open (`SIM_KEY` in sim-page/sim-doc.ts). */
export const SIM_KEY_V1 = 'sfhousing:sim:v1';

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

/**
 * `page.goto(path)`, then waits for hydration (the root layout's `data-hydrated` mark, VITE_E2E
 * build only). A link clicked before hydration is a full page load, whose SSR reads data the
 * test's `page.route` never sees; after it, the click is a client navigation.
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
}

export const publishOpen = (page: Page): Locator => page.getByTestId('publish-open');

/**
 * A client-side navigation to `path`: clicks an anchor appended to <main>, inside the app's root,
 * so SvelteKit's router takes it (as a header link would). Needs a hydrated page.
 */
export async function clientNavigate(page: Page, path: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = href;
    document.querySelector('main')!.appendChild(a);
    a.click();
  }, path);
}

/**
 * Opens the header's Menu (saved games, the account entry and About, and below 1024 px the actions).
 * Every spec opens the Menu through this. It waits for hydration first: a tap on the Menu button
 * before hydration is lost (the toggle is a Svelte handler, and the server's HTML has none), so a
 * click on a loaded machine left `aria-expanded` false (issues #96, #109). It finds the button by
 * `[data-header-menu]`, which matches whatever its name.
 */
export async function openHeaderMenu(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  const menu = page.getByRole('banner').locator('[data-header-menu]');
  if (!(await menu.isVisible())) return;
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
}

/**
 * A header action button by name, ready to click. Below 1024 px the header's actions live in the
 * Menu panel, so this opens Menu first when the Menu button shows.
 */
export async function headerAction(page: Page, name: string | RegExp): Promise<Locator> {
  await openHeaderMenu(page);
  const item = page
    .getByRole('banner')
    .getByRole('button', { name, exact: typeof name === 'string' });
  await expect(item).toBeVisible();
  return item;
}

/** The Publish / Share link button, made visible first (the phone Menu opened). */
export async function openPublish(page: Page): Promise<Locator> {
  await openHeaderMenu(page);
  await expect(publishOpen(page)).toBeVisible();
  return publishOpen(page);
}

const visitors = new WeakSet<Page>();

/**
 * `/` as a new visitor, with the map ready and the header actions hydrated (the Publish button
 * exists). The first call for a page makes it a new visitor (`newVisitor`); a spec that seeds its
 * own game goes to `/` with `gotoHydrated(page, '/')` instead, never through here.
 */
export async function gotoEditor(page: Page): Promise<void> {
  if (!visitors.has(page)) {
    visitors.add(page);
    await newVisitor(page);
  }
  await page.goto('/');
  await waitForMap(page);
  // Attached, not visible: below 1024 px it waits in the closed header Menu.
  await expect(publishOpen(page)).toBeAttached();
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

/**
 * Waits until a tap would open project `projectId`'s card (or one of its phases',
 * `<projectId>:phase:<n>`) at one of `candidates`, tried in order, and returns the page point to
 * tap. The gate is the map's own pick
 * (`__sfhMap.timelinePartAt`) with the canvas topmost there, so it covers the chunk not yet
 * installed, the part not yet drawn at the playhead's day and a sheet over the map. Tap once: in
 * the simulation a miss is not idempotent (it selects the lot's plan, and on a phone that sheet covers the
 * map), so a retried tap after a miss can never land. With `nudge`, each candidate also tries a
 * few pixels outwards from the map's centre, past a taller neighbour's roof leaning over it.
 */
export async function waitProjectAt(
  page: Page,
  projectId: string,
  candidates: LngLat[],
  opts: { nudge?: boolean } = {}
): Promise<[number, number]> {
  const handle = await page.waitForFunction(
    ([id, lls, nudge]) => {
      const debug = (window as Win).__sfhMap;
      const map = debug?.map;
      if (!debug || !map) return null;
      const canvas = map.getCanvas();
      const r = canvas.getBoundingClientRect();
      for (const ll of lls) {
        const p = map.project(ll);
        const out = Math.sign(p.x - r.width / 2);
        for (const step of nudge ? [0, 4, 8, 12] : [0]) {
          const x = p.x + out * step;
          if (x < 0 || x >= r.width || p.y < 0 || p.y >= r.height) continue;
          const point: [number, number] = [r.left + x, r.top + p.y];
          if (document.elementFromPoint(point[0], point[1]) !== canvas) continue;
          const hit = debug.timelinePartAt(x, p.y)?.projectId;
          if (hit === id || hit?.startsWith(`${id}:phase:`)) return point;
        }
      }
      return null;
    },
    [projectId, candidates, opts.nudge ?? false] as const
  );
  return (await handle.jsonValue())!;
}

/** Clicks (taps on the phone) project `projectId` at `at` once, as soon as it is pickable there. */
export async function tapProject(
  page: Page,
  isMobile: boolean,
  projectId: string,
  at: LngLat,
  opts: { nudge?: boolean } = {}
): Promise<void> {
  const point = await waitProjectAt(page, projectId, [at], opts);
  if (isMobile) await page.touchscreen.tap(point[0], point[1]);
  else await page.mouse.click(point[0], point[1]);
}

/**
 * A straight mouse stroke `from` → `to`. A stroke covers every parcel within its radius of the
 * path's segments, so a straight drag covers the same parcels however many moves it takes. Each
 * move during a stroke costs the page a preview and a software-GL frame (about 100 ms idle, 300 to
 * 500 ms under a full parallel run), so few steps: 15 made two strokes take 12 s of a 30 s test
 * under load (#68).
 */
export async function mouseDrag(page: Page, from: LngLat, to: LngLat, steps = 3): Promise<void> {
  const [x0, y0] = await projectToPage(page, from);
  const [x1, y1] = await projectToPage(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

/**
 * A straight one-finger drag through CDP, so Chromium emits real touch and pointer events. As with
 * `mouseDrag`, few moves: a stroke covers the same parcels however many moves it takes, and each
 * costs a preview and a software-GL frame; 12 moves took 3 to 6 s of a test at 15 workers. The
 * brush starts a stroke on the touch's pointerdown and needs no minimum of moves (a touch with none
 * is a stamp), and in Move MapLibre pans by each move's delta. `midway` runs after move
 * `floor(steps / 2)` (a second finger mid-stroke, say).
 */
export async function touchDrag(
  cdp: CDPSession,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  steps = 3,
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

/**
 * The brush hook's op count, or null while the page has no hook (between documents, or before the
 * BrushEditor of a page that just loaded has mounted). Use it under `expect.poll`: a null keeps the
 * poll going, where a throw would end it at once (#141).
 */
export const ops = (page: Page): Promise<number | null> =>
  page.evaluate(() => (window as Win).__sfhBrush?.ops ?? null);

/**
 * Chooses a brush tool from `/`'s Paint tab. From md the tab is open in the dock. Below md it sits
 * in the dock's sheet: the handle opens it, and Paint or Erase folds it to the palette strip
 * (whose tool button switches Paint and Erase, and whose Done chooses Move).
 */
export async function chooseTool(page: Page, tool: 'Move' | 'Paint' | 'Erase'): Promise<void> {
  const handle = page.getByTestId('dock-handle');
  const strip = page.getByTestId('palette-strip');
  const radio = page.getByRole('radio', { name: tool, exact: true });
  if (!(await handle.isVisible())) {
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
    return;
  }
  if (await strip.isVisible()) {
    if (tool === 'Move') {
      await strip.getByRole('button', { name: 'Done' }).click();
      await expect(radio).toHaveAttribute('aria-checked', 'true');
      return;
    }
    const current = strip.getByRole('button', { name: /^Tool: / });
    if ((await current.getAttribute('aria-label')) !== `Tool: ${tool}`) await current.click();
    await expect(strip.getByRole('button', { name: `Tool: ${tool}` })).toBeVisible();
    return;
  }
  if ((await handle.getAttribute('aria-expanded')) !== 'true') await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  const checked = (await radio.getAttribute('aria-checked')) === 'true';
  if (!checked) await radio.click();
  if (tool === 'Move') {
    await expect(radio).toHaveAttribute('aria-checked', 'true');
  } else {
    // Already the tool: the sheet stays open, so fold it by its handle.
    if (checked) await handle.click();
    await expect(strip.getByRole('button', { name: `Tool: ${tool}` })).toBeVisible();
  }
}

/**
 * Paints one stroke at FRAME: a mouse drag FROM → TO on desktop; on the mobile project, switch to
 * Paint mode and drag TOUCH_FROM → TOUCH_TO with one finger. Resolves once the editor holds
 * exactly one op.
 */
export async function paintOnce(page: Page, isMobile: boolean): Promise<void> {
  await jumpAndIdle(page);
  if (isMobile) {
    await chooseTool(page, 'Paint');
    // The strip and the folded sheet are in place: project after the layout settles.
    await jumpAndIdle(page);
    const cdp = await page.context().newCDPSession(page);
    const a = await projectToPage(page, TOUCH_FROM);
    const b = await projectToPage(page, TOUCH_TO);
    await touchDrag(cdp, a, b);
  } else {
    await mouseDrag(page, FROM, TO);
  }
  await expect.poll(() => ops(page)).toBe(1);
}

/** The header score on `/` and `/p/:id`: "Room for {n} homes" while the brush is on show. */
export const headerScore = (page: Page): Locator =>
  page.getByRole('banner').getByTestId('score-bar');

/** The header score's count, read from its text ("Room for 1,234 homes" → 1234). */
export async function headerNet(page: Page): Promise<number> {
  const t = (await headerScore(page).textContent()) ?? '';
  // A compact count ("Room for 1.2M homes") would parse as 12: fail loudly instead.
  if (/\d\s*[KM]\b/.test(t.replace(/homes[\s\S]*$/, '')))
    throw new Error(`headerNet cannot read a compact count: ${JSON.stringify(t)}`);
  return Number(t.replace(/homes[\s\S]*$/, '').replace(/[^\d-]/g, ''));
}

/**
 * The header score once it is final for the plan the page holds; returns its text. Final means
 * not `aria-busy` (every chunk the plan needs is loaded, the worker's `complete`) and above 0 (a
 * diff of the plan arrived: before the first one the bar reads 0 and is not busy). Needs no map:
 * the worker scores the plan whether or not the map has loaded. Exact for a plan loaded whole
 * (`/p/:id`); after a stroke, use `committedNet`.
 */
export async function finalNet(page: Page): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        text = await headerScore(page).evaluate((el) =>
          el.getAttribute('aria-busy') === 'false' ? (el.textContent ?? '').trim() : ''
        );
        return Number(text.replace(/homes[\s\S]*$/, '').replace(/[^\d-]/g, ''));
      },
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);
  return text;
}

/**
 * The header score after a stroke's commit (call once the editor holds the op). Until the
 * commit's diff arrives the bar can show the last preview's score, not busy; `lastStats` is set
 * by that diff, and the header takes its score on the next animation frame (`frameLatest`).
 */
export async function committedNet(page: Page): Promise<string> {
  await page.waitForFunction(() => (window as Win).__sfhBrush?.lastStats != null);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  return finalNet(page);
}

/** The dock's Details face (PaintDetails on `/` and `/p/:id`; its internal id is 'results'). */
export const resultsFace = (page: Page): Locator => page.getByRole('region', { name: 'Details' });

/** Shows the dock's Details face by pressing the header score (when it is not already shown). */
export async function openResults(page: Page): Promise<Locator> {
  const score = headerScore(page);
  if ((await score.getAttribute('aria-expanded')) !== 'true') await score.click();
  await expect(score).toHaveAttribute('aria-expanded', 'true');
  await expect(resultsFace(page)).toBeVisible();
  return resultsFace(page);
}

/** Waits until the header score is unchanged across 3 polls >= 100 ms apart; returns its text. */
export async function settledNet(page: Page): Promise<string> {
  const net = headerScore(page);
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
  opts: { body: string; datasetVersion?: string; kind?: 'plan' | 'sim' }
): Promise<string> {
  const res = await request.post('/api/e2e/plans', { data: opts });
  // 201 = a new row; 200 = this body was already seeded (local D1 persists across runs).
  expect([200, 201], await res.text()).toContain(res.status());
  return ((await res.json()) as { id: string }).id;
}
