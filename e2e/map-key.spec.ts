// The map key control on the map's bottom right (map-on-screen slice 5, Task 3): on /sim the key
// is open at rest from md and its counts follow the playhead's month; on a phone it starts closed,
// clear of Reset view and the attribution, and its panel scrolls inside the room above it. Axe in
// light and dark, open and closed. Runs against the VITE_E2E build on fixture-0.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { slider, waitFilled } from './helpers/run';

type Win = Window & { __sfhFzp?: SfhFzpDebug; __sfhMap?: { map?: unknown } };
type Box = { x: number; y: number; width: number; height: number };

const control = (page: Page): Locator => page.getByTestId('map-key-control');
const keyToggle = (page: Page): Locator => page.getByTestId('map-key-toggle');
const keyPanel = (page: Page): Locator => page.getByRole('group', { name: 'Map key' });

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
  const ours = [await boxOf(keyToggle(page))];
  if (await keyPanel(page).isVisible()) ours.push(await boxOf(keyPanel(page)));
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
