// The map key control on the map's bottom right (map-on-screen slice 5, Tasks 3 and 5): on /sim the
// key is open at rest from md and its counts follow the playhead's month; on a phone it starts
// closed, clear of Reset view and the attribution, and its panel scrolls inside the room above it.
// On Paint (`/`, `/p/:id`) it starts closed at every width, names the building types and each
// painted height with its lots, and a height's row outlines its lots on the map. Axe in light and
// dark, open and closed. Layers (Task 6) sits before Key in the same toolbar: the layer switches
// that were the header's View menu. Runs against the VITE_E2E build on fixture-0.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { loginAs, uniqueEmail } from './helpers/auth';
import { slider, waitFilled } from './helpers/run';
import {
  PLAN_KEY,
  chooseTool,
  gotoEditor,
  paintOnce,
  smallText,
  waitForMap,
  type Win as PaintWin
} from './helpers/sharing';

type Win = Window & { __sfhFzp?: SfhFzpDebug; __sfhMap?: { map?: unknown } };
type Box = { x: number; y: number; width: number; height: number };

const control = (page: Page): Locator => page.getByTestId('map-key-control');
const keyToggle = (page: Page): Locator => page.getByTestId('map-key-toggle');
const keyPanel = (page: Page): Locator => page.getByRole('group', { name: 'Map key' });
const layersToggle = (page: Page): Locator => page.getByTestId('map-layers-toggle');
const layersPanel = (page: Page): Locator => page.getByRole('group', { name: 'Map layers' });

/** The control's toggles and whichever panel is open. */
async function ourBoxes(page: Page): Promise<Box[]> {
  const ours = [await boxOf(keyToggle(page))];
  if (await layersToggle(page).isVisible()) ours.push(await boxOf(layersToggle(page)));
  for (const p of [keyPanel(page), layersPanel(page)])
    if (await p.isVisible()) ours.push(await boxOf(p));
  return ours;
}

async function gotoSim(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as Win).__sfhFzp?.phase === 'ready');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );
  await waitFilled(page);
}

/** The key's rows as "label count" strings. */
const counts = (page: Page): Promise<string[]> =>
  keyPanel(page)
    .locator('[data-key-row]')
    .evaluateAll((rows) =>
      rows.map((r) => `${r.querySelector('dt')!.textContent} ${r.querySelector('dd')!.textContent}`)
    );

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** The boxes of every visible element matching `selector`. */
const boxesOf = (page: Page, selector: string): Promise<Box[]> =>
  page.locator(selector).evaluateAll((els) =>
    els
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
  );

/** The key's toolbar and open panel are clear of what the map already shows. */
async function expectClear(page: Page): Promise<void> {
  const ours = await ourBoxes(page);
  const theirs = [
    ...(await boxesOf(page, '.maplibregl-ctrl-bottom-left .maplibregl-ctrl')),
    ...(await boxesOf(page, '.maplibregl-ctrl-bottom-right .maplibregl-ctrl')),
    ...(await boxesOf(page, '.sim-map-reset')),
    ...(await boxesOf(page, '[data-testid="fzp-notices"] > *'))
  ];
  expect(theirs.length).toBeGreaterThan(0);
  for (const a of ours)
    for (const b of theirs) expect(overlaps(a, b), JSON.stringify({ a, b })).toBe(false);
}

test('1280 px on /sim: the key is open, its counts follow the playhead, and it covers nothing', async ({
  isMobile,
  page
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- one layout per project
  test.skip(isMobile, 'the desktop layout');
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSim(page);
  await expect(keyPanel(page)).toBeVisible();
  await expect(keyToggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(keyToggle(page)).toHaveText('Key');
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => counts(page)).toContain('Completed 0');
  const atToday = await counts(page);
  expect(atToday).toHaveLength(6);
  expect(atToday).toContain('Stopped 0');
  await page.keyboard.press('PageUp');
  await expect.poll(() => counts(page)).not.toEqual(atToday);
  // The toolbar's words never change.
  await expect(keyToggle(page)).toHaveText('Key');
  await expectClear(page);
  // Right edge 8 px in, above the attribution band.
  const map = await boxOf(page.getByTestId('tl-map'));
  const box = await boxOf(control(page));
  expect(map.x + map.width - (box.x + box.width)).toBeCloseTo(8, 0);
  const attribution = await boxOf(page.locator('.maplibregl-ctrl-bottom-right'));
  expect(box.y + box.height).toBeLessThanOrEqual(attribution.y);
  // Layers sits before Key; opening it closes the key, and it covers nothing either.
  await expect(layersToggle(page)).toHaveText('Layers');
  const l = await boxOf(layersToggle(page));
  const k = await boxOf(keyToggle(page));
  expect(k.x - (l.x + l.width)).toBeCloseTo(4, 0);
  await layersToggle(page).click();
  await expect(layersPanel(page)).toBeVisible();
  await expect(keyPanel(page)).toBeHidden();
  await expect(layersToggle(page)).toBeFocused();
  await expect(layersToggle(page)).toHaveText('Layers');
  await expectClear(page);
});

test('375 px on /sim: the key starts closed, sits clear of Reset and the attribution, opens and scrolls', async ({
  isMobile,
  page
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- one layout per project
  test.skip(!isMobile, 'the phone layout');
  await gotoSim(page);
  await expect(keyToggle(page)).toBeVisible();
  await expect(keyToggle(page)).toHaveAttribute('aria-expanded', 'false');
  const t = await boxOf(keyToggle(page));
  expect(t.height).toBeGreaterThanOrEqual(44);
  expect(t.width).toBeGreaterThanOrEqual(44);
  await expectClear(page);
  await keyToggle(page).click();
  await expect(keyPanel(page)).toBeVisible();
  await expectClear(page);
  const panel = keyPanel(page);
  const map = await boxOf(page.getByTestId('tl-map'));
  const p = await boxOf(panel);
  expect(p.y).toBeGreaterThanOrEqual(map.y);
  expect(p.x).toBeGreaterThanOrEqual(0);
  // The panel scrolls inside its room.
  const scrolls = await panel.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  await panel.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  // Escape closes it and focus goes back to the toggle.
  await panel.focus();
  await page.keyboard.press('Escape');
  await expect(keyPanel(page)).toBeHidden();
  await expect(keyToggle(page)).toBeFocused();

  // The attribution collapsed to its (i) button: the footprint shrinks and the toolbar follows it,
  // still clear of the button and of Reset view, closed and open.
  const block = () =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--map-controls-br-block-size')
    );
  const before = await block();
  const attrib = page.locator('.maplibregl-ctrl-attrib');
  await expect(attrib).toHaveClass(/maplibregl-compact-show/);
  await page.locator('.maplibregl-ctrl-attrib-button').click();
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);
  await expect.poll(block).not.toBe(before);
  const toolbarBefore = t.y;
  await expect.poll(async () => (await boxOf(keyToggle(page))).y).toBeGreaterThan(toolbarBefore);
  await expect(keyToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expectClear(page);
  await keyToggle(page).click();
  await expect(keyPanel(page)).toBeVisible();
  await expectClear(page);
  // Layers too: 44 px, clear of everything, open and closed.
  const l = await boxOf(layersToggle(page));
  expect(l.height).toBeGreaterThanOrEqual(44);
  expect(l.width).toBeGreaterThanOrEqual(44);
  await layersToggle(page).click();
  await expect(layersPanel(page)).toBeVisible();
  await expect(keyPanel(page)).toBeHidden();
  await expectClear(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('/sim key: axe clean, light and dark, open and closed', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await gotoSim(page);
    await expect(keyToggle(page)).toBeVisible();
    for (let k = 0; k < 2; k++) {
      await expectNoA11yViolations(page, { include: '[data-testid="map-key-control"]' });
      await keyToggle(page).click();
    }
    await expect(keyToggle(page)).toHaveAttribute('aria-expanded', /true|false/);
  }
});

// ---- Paint (`/` and `/p/:id`) ----

const OUTLINE_LAYER = 'sim-painted-outline';
const ROW = /^\s*\d+ stor(y|ies) · [\d,]+ lots? · [\d,]+ rebuilt$/;
const heightRows = (page: Page): Locator => keyPanel(page).locator('button[data-height]');
/** The generated controller's deck layers, overlays included. */
const deckIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as PaintWin).__sfhMap!.snapshot()?.layerIds ?? []);

/** `/` restored from an autosave of the small plan: 6 and 12 stories, and an erase. */
async function seedTwoHeights(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, plan]) => {
      if (sessionStorage.getItem('sfh-e2e-seeded')) return;
      sessionStorage.setItem('sfh-e2e-seeded', '1');
      localStorage.setItem(
        key,
        JSON.stringify({ v: 1, savedAt: '2026-11-18T00:00:00.000Z', plan })
      );
    },
    [PLAN_KEY, smallText.trim()] as const
  );
}

/** What Paint's map already shows: the key's toolbar and open panel are clear of all of it. */
async function expectPaintClear(page: Page): Promise<void> {
  const ours = await ourBoxes(page);
  const theirs = [
    ...(await boxesOf(page, '.maplibregl-ctrl-bottom-left .maplibregl-ctrl')),
    ...(await boxesOf(page, '.maplibregl-ctrl-bottom-right .maplibregl-ctrl')),
    ...(await boxesOf(page, '.sim-map-reset')),
    ...(await boxesOf(page, '[data-testid="fzp-notices"] > *')),
    ...(await boxesOf(page, '[data-testid="stroke-chip"]')),
    ...(await boxesOf(page, '[data-testid="palette-strip"]')),
    ...(await boxesOf(page, '[data-testid="dock-handle"]')),
    ...(await boxesOf(page, '[data-testid="dock"]'))
  ];
  expect(theirs.length).toBeGreaterThan(0);
  for (const a of ours)
    for (const b of theirs) expect(overlaps(a, b), JSON.stringify({ a, b })).toBe(false);
}

test('/ : the key starts closed; opened, it lists the types and, after a stroke, its height', async ({
  isMobile,
  page
}) => {
  await gotoEditor(page);
  await expect(keyToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(keyToggle(page)).toHaveText('Key');
  await expectPaintClear(page);
  await keyToggle(page).click();
  const types = keyPanel(page).getByRole('list', { name: 'New buildings' });
  await expect(types.getByRole('listitem')).toHaveText([
    'ADU',
    'House or plex',
    'Walk-up',
    '5-over-1',
    'Mid-rise',
    'Tower'
  ]);
  await expect(keyPanel(page).getByRole('list', { name: 'Painted' })).toHaveCount(0);
  await expectPaintClear(page);
  await keyToggle(page).click();
  await expect(keyPanel(page)).toBeHidden();

  await paintOnce(page, isMobile);
  await keyToggle(page).click();
  await expect(keyPanel(page)).toBeVisible();
  await expect(heightRows(page)).toHaveCount(1);
  await expect(heightRows(page)).toHaveText(/^\s*6 stories · [\d,]+ lots? · [\d,]+ rebuilt$/);
  await expect(heightRows(page)).toHaveAttribute('aria-pressed', 'false');
  // The toolbar's words never change.
  await expect(keyToggle(page)).toHaveText('Key');
  await expectPaintClear(page);
});

test('/ : focusing a height outlines it on the map', async ({ page }) => {
  await seedTwoHeights(page);
  await gotoEditor(page);
  await keyToggle(page).click();
  await expect(heightRows(page)).toHaveCount(2);
  await expect(heightRows(page).first()).toHaveText(ROW);
  await expect(heightRows(page).last()).toHaveText(ROW);
  await expect(heightRows(page).first()).toHaveText(/^\s*6 stories/);
  await expect(heightRows(page).last()).toHaveText(/^\s*12 stories/);
  expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);
  // The panel sits before the toolbar (Layers, then Key): from Layers, Shift+Tab reaches the
  // panel's last control, the 12-story row.
  await layersToggle(page).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(heightRows(page).last()).toBeFocused();
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);
  // Tab back to the toolbar: the outline goes with the focus.
  await page.keyboard.press('Tab');
  await expect(layersToggle(page)).toBeFocused();
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
  // A press pins it past the blur; a second press clears it.
  await heightRows(page).first().focus();
  await page.keyboard.press('Space');
  await expect(heightRows(page).first()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);
  await heightRows(page).first().click();
  await expect(heightRows(page).first()).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(0, 0);
  await keyToggle(page).focus();
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
});

test('/p/:id: the read-only plan lists its heights', async ({ page, request }) => {
  const res = await request.post('/api/plans', {
    data: smallText,
    headers: { 'content-type': 'application/json' }
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/p/${id}`);
  await waitForMap(page);
  await expect(keyToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await keyToggle(page).click();
  await expect(heightRows(page)).toHaveCount(2);
  await expect(heightRows(page).first()).toHaveText(
    /^\s*6 stories · [\d,]+ lots? · [\d,]+ rebuilt$/
  );
  await expect(heightRows(page).last()).toHaveText(
    /^\s*12 stories · [\d,]+ lots? · [\d,]+ rebuilt$/
  );
  await heightRows(page).last().click();
  await expect(heightRows(page).last()).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);
  await expectPaintClear(page);
});

test('/ key: axe clean, light and dark', async ({ page }) => {
  await seedTwoHeights(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await gotoEditor(page);
    await expectNoA11yViolations(page, { include: '[data-testid="map-key-control"]' });
    await keyToggle(page).click();
    await expect(heightRows(page)).toHaveCount(2);
    await expect(heightRows(page).first()).toHaveText(ROW);
    await heightRows(page).first().click();
    await expect(heightRows(page).first()).toHaveAttribute('aria-pressed', 'true');
    await expectNoA11yViolations(page, { include: '[data-testid="map-key-control"]' });
  }
});

/** The page's `heightLots` requests to the worker, counted from the first script. */
async function countHeightLots(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __heightLotsAsked: number };
    w.__heightLotsAsked = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      if ((args[0] as { type?: string } | null)?.type === 'heightLots') w.__heightLotsAsked++;
      return (post as (...a: unknown[]) => void).apply(this, args);
    } as Worker['postMessage'];
  });
  return () =>
    page.evaluate(() => (window as unknown as { __heightLotsAsked: number }).__heightLotsAsked);
}

/** Each way a phone closes or hides the key, and the way back to it. */
const PHONE_CLOSE: Record<string, { close(p: Page): Promise<void>; back(p: Page): Promise<void> }> =
  {
    'the toggle': { close: (p) => keyToggle(p).click(), back: (p) => keyToggle(p).click() },
    Escape: { close: (p) => p.keyboard.press('Escape'), back: (p) => keyToggle(p).click() },
    'a tap on the map': {
      close: (p) => p.touchscreen.tap(40, 160),
      back: (p) => keyToggle(p).click()
    },
    // The handle's press is a press in the map box, so the panel closes as the sheet opens.
    'the sheet opening': {
      close: async (p) => {
        await p.getByTestId('dock-handle').click();
        await expect(keyToggle(p)).toBeHidden();
      },
      back: async (p) => {
        await p.getByTestId('dock-handle').click();
        await expect(keyToggle(p)).toHaveAttribute('aria-expanded', 'false');
        await keyToggle(p).click();
      }
    }
  };

for (const [how, { close, back }] of Object.entries(PHONE_CLOSE)) {
  test(`/ on a phone: a pressed height loses its outline when the key closes by ${how}`, async ({
    isMobile,
    page
  }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- the phone's ways to close
    test.skip(!isMobile, 'the phone layout');
    const asked = await countHeightLots(page);
    await seedTwoHeights(page);
    await gotoEditor(page);
    await keyToggle(page).click();
    await expect(heightRows(page)).toHaveCount(2);
    const row = heightRows(page).last();
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);
    const before = await asked();
    await close(page);
    await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
    expect(await asked()).toBe(before);
    // Reopened: nothing pressed, nothing outlined, nothing asked.
    await back(page);
    await expect(keyPanel(page)).toBeVisible();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);
    expect(await asked()).toBe(before);
  });
}

// ---- Layers beside Key (Task 6): the switches left the header's View menu for the map ----

/** Where focus is: inside the map's own controls, the key control, or elsewhere. */
const focusAt = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return {
      testid: a?.dataset.testid ?? null,
      inMap: !!a?.closest('.maplibregl-map'),
      inControl: !!a?.closest('[data-testid="map-key-control"]')
    };
  });

test('keyboard: Tab from the zoom controls reaches Layers, then Key; Escape returns focus', async ({
  isMobile,
  page
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- the zoom controls are fine-pointer only
  test.skip(isMobile, 'the desktop layout');
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoEditor(page);
  await expect(layersToggle(page)).toBeVisible();
  // The last of the map's zoom and compass buttons.
  await page.locator('.maplibregl-ctrl-bottom-left button').last().focus();
  // Only the map's own controls (the attribution's links) lie between them and Layers.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const at = await focusAt(page);
    if (at.testid === 'map-layers-toggle') break;
    expect(at.inMap, JSON.stringify(at)).toBe(true);
  }
  await expect(layersToggle(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(keyToggle(page)).toBeFocused();
  // Both closed: the next stop is past the control, the page's next region.
  await page.keyboard.press('Tab');
  expect((await focusAt(page)).inControl).toBe(false);
  await page.keyboard.press('Shift+Tab');
  await expect(keyToggle(page)).toBeFocused();

  // Enter opens Key; Escape closes it and focus is on Key again.
  await page.keyboard.press('Enter');
  await expect(keyPanel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keyPanel(page)).toBeHidden();
  await expect(keyToggle(page)).toBeFocused();
  // Layers by keyboard: Space opens it, Shift+Tab reaches its switches (the panel sits before
  // the toolbar), Space toggles one, Escape closes the panel and returns focus to Layers.
  await page.keyboard.press('Shift+Tab');
  await expect(layersToggle(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(layersPanel(page)).toBeVisible();
  await expect(keyPanel(page)).toBeHidden();
  await expect(layersToggle(page)).toBeFocused();
  const stops = layersPanel(page).getByRole('checkbox', { name: 'Transit stops' });
  const capacity = layersPanel(page).getByRole('checkbox', { name: /^Transit capacity/ });
  await page.keyboard.press('Shift+Tab');
  await expect(capacity).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(stops).toBeFocused();
  await page.keyboard.press('Space');
  await expect(stops).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(layersPanel(page)).toBeHidden();
  await expect(layersToggle(page)).toBeFocused();
});

test('375 px: Layers and Key are 44 px, inside the map, clear of Reset and the attribution', async ({
  isMobile,
  page
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- the phone layout
  test.skip(!isMobile, 'the phone layout');
  await gotoEditor(page);
  const map = await boxOf(page.getByTestId('map-root'));
  for (const t of [layersToggle(page), keyToggle(page)]) {
    const b = await boxOf(t);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.x).toBeGreaterThanOrEqual(map.x);
    expect(b.x + b.width).toBeLessThanOrEqual(map.x + map.width);
    expect(b.y).toBeGreaterThanOrEqual(map.y);
    expect(b.y + b.height).toBeLessThanOrEqual(map.y + map.height);
  }
  await expectPaintClear(page);
  for (const [toggle, panel] of [
    [layersToggle(page), layersPanel(page)],
    [keyToggle(page), keyPanel(page)]
  ] as const) {
    await toggle.click();
    await expect(panel).toBeVisible();
    await expectPaintClear(page);
    await toggle.click();
    await expect(panel).toBeHidden();
  }
  // With a stroke tool the palette strip shows: the toolbar still clears it and Reset.
  await chooseTool(page, 'Paint');
  await expect(page.getByTestId('palette-strip')).toBeVisible();
  await expectPaintClear(page);
  await layersToggle(page).click();
  await expect(layersPanel(page)).toBeVisible();
  await expectPaintClear(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

/** Each project's widths: the fine-pointer layouts, and the phones. */
const WIDTHS = { desktop: [768, 1024, 1280], phone: [320, 375] };

for (const where of ['/', '/sim'] as const)
  test(`${where}: at every width, Layers and Key and each open panel cover nothing`, async ({
    isMobile,
    page
  }) => {
    for (const width of WIDTHS[isMobile ? 'phone' : 'desktop']) {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 800 });
      if (where === '/') await gotoEditor(page);
      else await gotoSim(page);
      const clear = where === '/' ? expectPaintClear : expectClear;
      await expect(layersToggle(page)).toBeVisible();
      await clear(page);
      for (const [toggle, panel] of [
        [layersToggle(page), layersPanel(page)],
        [keyToggle(page), keyPanel(page)]
      ] as const) {
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
        await expect(panel).toBeVisible();
        await clear(page);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          `${where} at ${width}`
        ).toBeLessThanOrEqual(width);
      }
    }
  });

test('1024 px signed in on /sim: no View in the header, the status cell is not clipped', async ({
  isMobile,
  page
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- the lg header
  test.skip(isMobile, 'the desktop header');
  await loginAs(page, uniqueEmail('map-key-header'));
  await page.setViewportSize({ width: 1024, height: 800 });
  await gotoSim(page);
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('button', { name: 'View', exact: true })).toHaveCount(0);
  const account = page.locator('[data-header-account]');
  await expect(account).toBeVisible();
  // The plan's measure: a 24-character handle (shown at its 160 px cap), the playhead at End.
  await account.locator('span').evaluate((s) => (s.textContent = `@${'h'.repeat(24)}`));
  await slider(page).focus();
  await page.keyboard.press('End');
  const fzpAt = (k: 'day' | 'asOf') =>
    page.evaluate((key) => (window as Win).__sfhFzp![key] as number, k);
  await expect.poll(() => fzpAt('day')).toBeGreaterThan(await fzpAt('asOf'));
  const fits = () =>
    page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('[data-header-status]')!;
      const r = cell.getBoundingClientRect();
      const inside = [...cell.querySelectorAll<HTMLElement>('*')]
        .filter((e) => e.checkVisibility())
        .map((e) => e.getBoundingClientRect())
        .filter((b) => b.width > 0);
      const score = document.querySelector('[data-testid="score-box"]')!.getBoundingClientRect();
      const header = document.querySelector('header')!;
      return {
        clipped: inside.some((b) => b.right > r.right + 0.5),
        overlapsScore: r.right > score.left + 0.5,
        overflow: header.scrollWidth > header.clientWidth
      };
    });
  expect(await fits()).toEqual({ clipped: false, overlapsScore: false, overflow: false });
  // "Autosave off", the widest save state, in the cell's sizer: still not clipped.
  const swapped = await page.evaluate(() => {
    const sizer = document.querySelector(
      '[data-testid="save-state"] > span[aria-hidden="true"]:first-child'
    );
    if (!sizer) return false;
    const chip = document.createElement('span');
    chip.className =
      'inline-flex min-h-6 min-w-6 items-center rounded-full border px-2 whitespace-nowrap';
    chip.textContent = 'Autosave off';
    sizer.replaceChildren(chip);
    return true;
  });
  expect(swapped).toBe(true);
  expect(await fits()).toEqual({ clipped: false, overlapsScore: false, overflow: false });
});
