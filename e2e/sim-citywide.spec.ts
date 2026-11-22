// The map citywide on /sim: the feed carries a marker for every project, one diamond an area shows
// below zoom 14, and bars are in far mode. /lesscars and Paint stay as they were: street bars. Reads the map's debug snapshot
// (window.__sfhMap.timelineSnapshot) and the playhead (window.__sfhFzp), never pixels. Runs
// against the VITE_E2E build on fixture-0.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import type { SfhMapDebug } from '../src/lib/map/debug';
import type { TimelineSnapshot } from '../src/lib/map/timelapse/types';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, slider, waitFilled } from './helpers/run';
import { gotoHydrated } from './helpers/sharing';

type Win = Window & { __sfhFzp?: SfhFzpDebug; __sfhMap?: SfhMapDebug };

const keyToggle = (page: Page): Locator => page.getByTestId('map-key-toggle');
const keyPanel = (page: Page): Locator => page.getByRole('group', { name: 'Map key' });

const snap = (page: Page): Promise<TimelineSnapshot | null> =>
  page.evaluate(() => (window as Win).__sfhMap?.timelineSnapshot() ?? null);

/** The map has drawn the filled forecast: cells in, nothing queued, city markers built. */
async function waitMap(page: Page): Promise<TimelineSnapshot> {
  await page.waitForFunction(() => {
    const s = (window as Win).__sfhMap?.timelineSnapshot();
    return !!s && s.cells > 0 && s.pending === 0 && s.cityMarkers > 0;
  });
  return (await snap(page))!;
}

async function gotoSim(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as Win).__sfhFzp?.phase === 'ready');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );
  await waitFilled(page);
  await waitMap(page);
}

/** Opens the key (closed at rest on a phone). */
async function openKey(page: Page): Promise<void> {
  if ((await keyToggle(page).getAttribute('aria-expanded')) !== 'true')
    await keyToggle(page).click();
  await expect(keyPanel(page)).toBeVisible();
}

test('the feed holds a marker for every project on the map, and no city layer draws', async ({
  page
}) => {
  await gotoSim(page);
  const s = (await snap(page))!;
  expect(s.projects).toBeGreaterThan(0);
  expect(s.cityMarkers).toBeGreaterThanOrEqual(s.projects);
  expect(s.layerIds).not.toContain('timeline-city');
});

test('a transit rule from today: every flagged slot on the map has a flagged marker', async ({
  page
}) => {
  await gotoSim(page);
  await slider(page).focus();
  await page.keyboard.press('Home');
  const refills = await page.evaluate(() => (window as Win).__sfhFzp!.refills.length);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await page.waitForFunction((n) => (window as Win).__sfhFzp!.refills.length > n, refills);
  await waitFilled(page);
  await expect
    .poll(async () => {
      const s = (await snap(page))!;
      return s.pending === 0 && s.flagged > 0 && s.cityFlagged >= s.flagged;
    })
    .toBe(true);
});

test('a transit rule: at the default zoom one diamond an area shows once its project begins; Home hides it', async ({
  page
}) => {
  await gotoSim(page);
  await slider(page).focus();
  await page.keyboard.press('Home');
  const refills = await page.evaluate(() => (window as Win).__sfhFzp!.refills.length);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await page.waitForFunction((n) => (window as Win).__sfhFzp!.refills.length > n, refills);
  await waitFilled(page);
  await expect
    .poll(async () => {
      const s = (await snap(page))!;
      return s.pending === 0 && s.marks > 0 && s.marks === s.flagged;
    })
    .toBe(true);
  const zoom = await page.evaluate(() => (window as Win).__sfhMap!.map!.getZoom());
  expect(zoom).toBeLessThan(14);
  // At today no mark is due.
  expect((await snap(page))!.marksShown).toBe(0);
  // At the horizon the marked projects have begun: below 14 one diamond per area, never more
  // than every project's own from 14.
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await snap(page))!.marksShown).toBeGreaterThanOrEqual(1);
  const below = (await snap(page))!.marksShown;
  await page.evaluate(() => (window as Win).__sfhMap!.map!.jumpTo({ zoom: 14.5 }));
  await expect.poll(async () => (await snap(page))!.marksShown).toBeGreaterThanOrEqual(below);
  await page.evaluate((z) => (window as Win).__sfhMap!.map!.jumpTo({ zoom: z }), zoom);
  await expect.poll(async () => (await snap(page))!.marksShown).toBe(below);
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await snap(page))!.marksShown).toBe(0);
});

test('bars are in far mode on /sim', async ({ page }) => {
  await gotoSim(page);
  await expect.poll(async () => (await snap(page))!.barMode).toBe('far');
});

test('/sim: axe clean with the key open, light and dark', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await gotoSim(page);
    await openKey(page);
    await expectNoA11yViolations(page, { include: '[data-testid="map-key-control"]' });
  }
});

test('/lesscars keeps street bars and draws no city feed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, '/lesscars');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready');
  await page.waitForFunction(() => {
    const s = (window as Win).__sfhMap?.timelineSnapshot();
    return !!s && s.cells > 0 && s.pending === 0;
  });
  const s = (await snap(page))!;
  expect(s.barMode).toBe('street');
  expect(s.cityMarkers).toBe(0);
  expect(s.layerIds).not.toContain('timeline-city');
});

test('Paint draws no timeline: no bars', async ({ page }) => {
  await gotoHydrated(page, '/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready');
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
  expect(await snap(page)).toBeNull();
  const ids = await page.evaluate(() =>
    (window as Win).__sfhMap!.map!.getStyle().layers.map((l) => l.id)
  );
  expect(ids.filter((id) => id.startsWith('timeline-'))).toEqual([]);
});
