// Halos and marks on /sim (map-on-screen slice 5, Task 4): the page turns halos on from the dataset
// date, so nothing rings at today; a ring shows once the playhead reaches its stage change and
// hides again when the playhead goes back; marks appear only under a policy of the person's, one
// per flagged project on the map, and only then does the key name the mark. Reads the map's debug
// snapshot (window.__sfhMap.timelineSnapshot) and the playhead (window.__sfhFzp), never pixels.
// Runs against the VITE_E2E build on fixture-0.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import type { SfhMapDebug } from '../src/lib/map/debug';
import type { TimelineSnapshot } from '../src/lib/map/timelapse/types';
import { expectNoA11yViolations } from './helpers/a11y';
import { touchLaptop } from './helpers/pointer';
import { addPolicy, slider, waitFilled } from './helpers/run';
import { headerAction } from './helpers/sharing';

type Win = Window & { __sfhFzp?: SfhFzpDebug; __sfhMap?: SfhMapDebug };

const keyToggle = (page: Page): Locator => page.getByTestId('map-key-toggle');
const keyPanel = (page: Page): Locator => page.getByRole('group', { name: 'Map key' });
const markButton = (page: Page): Locator =>
  keyPanel(page).getByRole('button', { name: 'Under your policy' });

const snap = (page: Page): Promise<TimelineSnapshot | null> =>
  page.evaluate(() => (window as Win).__sfhMap?.timelineSnapshot() ?? null);
const dayOf = (page: Page): Promise<number> => page.evaluate(() => (window as Win).__sfhFzp!.day);

/** The map has drawn the filled forecast: cells in, nothing queued, halo records built. */
async function waitMap(page: Page): Promise<TimelineSnapshot> {
  await page.waitForFunction(() => {
    const s = (window as Win).__sfhMap?.timelineSnapshot();
    return !!s && s.cells > 0 && s.pending === 0 && s.halos > 0;
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

test('no halo shows at today', async ({ page }) => {
  await gotoSim(page);
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => dayOf(page))
    .toBe(await page.evaluate(() => (window as Win).__sfhFzp!.asOf));
  const asOf = await page.evaluate(() => (window as Win).__sfhFzp!.asOf);
  // At the default zoom the merged view stands in: city records exist ahead, none drawn yet.
  const merged = await waitMap(page);
  expect(merged.ringMinZoom).toBe(14);
  expect(merged.cityRecords).toBeGreaterThan(0);
  expect(merged.cityRings).toBe(0);
  expect(merged.cityGlows).toBe(0);
  for (const d of merged.cityDays) expect(d).toBeGreaterThan(asOf);
  // From 14 each project's own rings: halos are on (rings exist ahead), and none is due yet.
  await page.evaluate(() => (window as Win).__sfhMap!.map!.jumpTo({ zoom: 14.5 }));
  const s = await waitMap(page);
  expect(s.halos).toBeGreaterThan(0);
  expect(s.halosShown).toBe(0);
  expect(s.marksShown).toBe(0);
  for (const d of s.haloDays) expect(d).toBeGreaterThan(asOf);
});

test('stepping the playhead past the first stage change shows its halo; Home hides it again', async ({
  page
}) => {
  await gotoSim(page);
  // Below zoom 14 the city layer's merged ring stands for a project's own (the halo layer's
  // ringMinZoom gate, map-interfaces.md); from 14 the project's own ring shows.
  await page.evaluate(() => (window as Win).__sfhMap!.map!.jumpTo({ zoom: 14.5 }));
  const [d] = (await waitMap(page)).haloDays;
  await slider(page).focus();
  await page.keyboard.press('Home');
  let day = await dayOf(page);
  expect(day).toBeLessThan(d);
  while (day < d) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => dayOf(page)).toBeGreaterThan(day);
    day = await dayOf(page);
  }
  await expect.poll(async () => (await snap(page))!.halosShown).toBeGreaterThanOrEqual(1);
  expect((await snap(page))!.day).toBe(day);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await snap(page))!.halosShown).toBe(0);
});

test('the default document draws no marks, and the key names no mark', async ({ page }) => {
  await gotoSim(page);
  await openKey(page);
  await expect(keyPanel(page).getByText('Just changed stage')).toBeVisible();
  await expect(keyPanel(page).getByText('Bar: progress and chance of finishing')).toBeVisible();
  const s = (await snap(page))!;
  expect(s.flagged).toBe(0);
  expect(s.marks).toBe(0);
  await expect(markButton(page)).toHaveCount(0);
});

test('a transit rule from today: the key names the mark; marks equal the flagged slots on the map', async ({
  page
}) => {
  // The header's Undo, named by the change, shows where a pointer is coarse: a touch laptop here.
  await touchLaptop(page);
  await gotoSim(page);
  await slider(page).focus();
  await page.keyboard.press('Home');
  const refills = await page.evaluate(() => (window as Win).__sfhFzp!.refills.length);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await page.waitForFunction((n) => (window as Win).__sfhFzp!.refills.length > n, refills);
  await waitFilled(page);
  // The edit's cells replace the old ones, their records with them: every flagged slot on the map
  // has its one mark, and no mark is left without one.
  await expect
    .poll(async () => {
      const s = (await snap(page))!;
      return s.pending === 0 && s.marks > 0 && s.marks === s.flagged;
    })
    .toBe(true);
  await openKey(page);
  await expect(markButton(page)).toBeVisible();
  // Its claim waits behind a tap.
  await expect(keyPanel(page).getByText(/Your zoning sets its height limit/)).toHaveCount(0);
  await markButton(page).click();
  await expect(keyPanel(page).getByRole('tooltip')).toHaveText(
    'Your zoning sets its height limit, or your pool funds it.'
  );
  // The first Escape closes only the explanation; the key stays open.
  await markButton(page).focus();
  await expect(keyPanel(page).getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keyPanel(page).getByRole('tooltip')).toHaveCount(0);
  await expect(keyPanel(page)).toBeVisible();
  await expect(markButton(page)).toBeFocused();

  // Undo takes the rule away: the refill's cells replace the flagged ones, and their marks go.
  const before = await page.evaluate(() => (window as Win).__sfhFzp!.refills.length);
  await (await headerAction(page, 'Undo: Added: Transit rule')).click();
  await page.waitForFunction((n) => (window as Win).__sfhFzp!.refills.length > n, before);
  await waitFilled(page);
  await expect
    .poll(async () => {
      const s = (await snap(page))!;
      return { pending: s.pending, marks: s.marks, flagged: s.flagged };
    })
    .toEqual({ pending: 0, marks: 0, flagged: 0 });
  await openKey(page);
  await expect(markButton(page)).toHaveCount(0);
});

test('/sim with halos on: axe clean with the key open, light and dark', async ({ page }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await gotoSim(page);
    await slider(page).focus();
    await page.keyboard.press('Home');
    await addPolicy(page, 'Zoning', 'Transit rule');
    await waitFilled(page);
    await openKey(page);
    await expect(markButton(page)).toBeVisible();
    await expectNoA11yViolations(page, { include: '[data-testid="map-key-control"]' });
    await markButton(page).focus();
    await expect(keyPanel(page).getByRole('tooltip')).toBeVisible();
    await expectNoA11yViolations(page, { include: '[data-testid="map-key-control"]' });
  }
});
