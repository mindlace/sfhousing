// /sim e2e (plan 3, Task 12): the /fzp redirect, the header score bar and phone Menu, the policy
// panel, a street brush, a freehand stroke and its undo, a brushed protection, Back and Forward
// after a reroll, and the accessibility checks. Runs against the VITE_E2E build, which exposes
// window.__sfhFzp (src/lib/fzp/debug.ts, with /sim's `levers` field) and window.__sfhMap.
// Fixture-0 files are read from disk (frontage.bin through the shared codec); names, lots and
// counts are derived from them, never hard-coded.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { frontingRows, readFrontage } from '../src/lib/data/frontage-codec';
import { readScenarioParcels } from '../src/lib/data/scenario-codec';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { formatCount } from '../src/lib/scoreboard/format';
import { expectNoA11yViolations } from './helpers/a11y';
import {
  FROM,
  TO,
  TOUCH_FROM,
  TOUCH_TO,
  headerAction,
  jumpAndIdle,
  mouseDrag,
  openHeaderMenu,
  projectToPage,
  touchDrag,
  type Win
} from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

// ---- fixture-0 ----------------------------------------------------------------------------------

const SCENARIO = new URL('./fixtures/data/fixture-0/scenarios/fzp/', import.meta.url);
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, SCENARIO)));

/** "1 lot", "3 lots": the brush card's count (brush-summary.ts `count`). */
const lotCount = (n: number): string => `${formatCount(n)} ${n === 1 ? 'lot' : 'lots'}`;

/**
 * The first street name in fixture-0's frontage dictionary, and the lots a Street brush on it
 * selects: `frontingRows` at depth 0 (the form's default), eligible lots only (as the worker's
 * `resolveBrushRows` filters them).
 */
async function firstStreet(): Promise<{ name: string; lots: number }> {
  const parcels = await readScenarioParcels(bytes('parcels.bin'));
  const frontage = await readFrontage(bytes('frontage.bin'), parcels);
  const name = frontage.names[0];
  const rows = frontingRows(frontage, (s) => frontage.segName[s] === 0, 0);
  return { name, lots: rows.filter((i) => parcels.eligible[i] === 1).length };
}

// ---- helpers ------------------------------------------------------------------------------------

function fzp<K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> {
  return page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;
}
const leverStatus = (page: Page) => fzp(page, 'levers');

/** The page is ready, the map is up and the levers sent with the session are in force. */
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready', undefined, {
    timeout: 20_000
  });
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
  await expect
    .poll(async () => (await leverStatus(page)).status, { timeout: 20_000 })
    .toBe('current');
}

async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await waitReady(page);
}

const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
const scoreDetails = (page: Page): Locator => page.getByRole('region', { name: 'Score details' });
const panel = (page: Page): Locator => page.getByTestId('policy-panel');
const menuButton = (page: Page): Locator =>
  page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true });
/** Hidden ones included: below md it waits in the Menu, which closes when the sheet opens. */
const policyButton = (page: Page): Locator =>
  page
    .getByRole('banner')
    .getByRole('button', { name: 'Policy', exact: true, includeHidden: true });

async function openScore(page: Page): Promise<Locator> {
  if ((await scoreBar(page).getAttribute('aria-expanded')) !== 'true') await scoreBar(page).click();
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(scoreDetails(page)).toBeVisible();
  return scoreDetails(page);
}

/** The policy panel, opened if it is not already (docked from md, the sheet through Menu below). */
async function openPolicy(page: Page): Promise<Locator> {
  if (!(await panel(page).isVisible())) await (await headerAction(page, 'Policy')).click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

/** Closes the phone sheet, which is modal: the rest of the page is inert while it shows. */
async function closeSheet(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile || !(await panel(page).isVisible())) return;
  await panel(page).getByRole('button', { name: 'Close policy' }).click();
  await expect(panel(page)).toBeHidden();
}

/** A panel section's disclosure, expanded. */
async function expandSection(page: Page, title: string): Promise<void> {
  const button = panel(page).getByRole('button', { name: title, exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/**
 * "Add a brush", then the kind's button once the brush catalog allows it; the form opens named
 * `title` exactly.
 */
async function openBrushForm(page: Page, kind: string, title: string): Promise<Locator> {
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  await panel(page).getByRole('button', { name: 'Add a brush' }).click();
  const choice = panel(page).getByRole('button', { name: kind, exact: true });
  await expect(choice).toBeEnabled({ timeout: 20_000 });
  await choice.click();
  const form = panel(page).getByRole('form', { name: title, exact: true });
  await expect(form).toBeVisible();
  return form;
}

const brushList = (page: Page): Locator =>
  panel(page).getByRole('list', { name: 'Your brushes' }).getByRole('listitem');

/** One stroke across fixture-0's parcel row: a mouse drag on desktop, a finger on the phone. */
async function strokeOnce(page: Page, isMobile: boolean): Promise<void> {
  await jumpAndIdle(page);
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

/**
 * Chooses a stroke tool from the open panel. On a phone this closes the sheet for the floating
 * tool bar (layout ruling 5).
 */
async function chooseTool(page: Page, isMobile: boolean, choose: () => Promise<void>) {
  await choose();
  if (isMobile) {
    await expect(panel(page)).toBeHidden();
    await expect(page.getByTestId('phone-tool-bar')).toBeVisible();
  }
}

/**
 * Records, from now on, each change to the lever notice row with the lever status at that moment
 * (a MutationObserver, so a notice that shows only briefly is still seen).
 */
async function watchLeverNotices(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as FzpWin & { __leverSeen?: { status: string; text: string }[] };
    const row = document.querySelector('[data-testid="fzp-lever-status"]')!;
    w.__leverSeen = [];
    new MutationObserver(() => {
      w.__leverSeen!.push({
        status: w.__sfhFzp!.levers.status,
        text: (row.textContent ?? '').trim()
      });
    }).observe(row, { childList: true, subtree: true, characterData: true });
  });
}
const leverSeen = (page: Page) =>
  page.evaluate(
    () =>
      (window as FzpWin & { __leverSeen?: { status: string; text: string }[] }).__leverSeen ?? []
  );

// W6b: the footer links stay visible, unobscured and tappable (as in e2e/fzp.spec.ts).
const FOOTER_LINKS = ['About', 'Data & licences', 'Source code (GitHub)'];

async function expectFooterReachable(page: Page): Promise<void> {
  for (const name of FOOTER_LINKS) {
    const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', {
      name,
      exact: true
    });
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport({ ratio: 1 });
    const hit = await link.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        ok: !!top && el.contains(top),
        top: top ? `${top.tagName}.${top.className}` : 'null'
      };
    });
    expect(hit.ok, `${name} covered by ${hit.top}`).toBe(true);
    await link.tap({ trial: true });
  }
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
}

// ---- the redirect and the shell -----------------------------------------------------------------

test('/fzp?seed=5 lands on /sim?seed=5&start=fzp and its levers come into force', async ({
  page
}) => {
  await page.goto('/fzp?seed=5');
  await expect(page).toHaveURL(/\/sim\?seed=5&start=fzp$/);
  await waitReady(page);
  expect((await leverStatus(page)).status).toBe('current');
  expect(await fzp(page, 'seed')).toBe(5);
});

test('/sim starts on current law; the score bar opens the score details', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  await openPolicy(page);
  await expect(
    panel(page).getByRole('checkbox', { name: /^Current law/ }),
    'current law is the only stock layer'
  ).toBeChecked();
  await expect(panel(page).getByRole('radio', { name: 'Current law', exact: true })).toBeChecked();
  await closeSheet(page, isMobile);

  const { baseline, shown } = JSON.parse(
    await page.evaluate(() => JSON.stringify((window as FzpWin).__sfhFzp!.score))
  ) as { baseline: { completedNet: number }; shown: { completedNet: number }[] };
  await expect(scoreBar(page)).toHaveText(
    `${formatCount(baseline.completedNet + shown[0].completedNet)} homes added`
  );
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');
  const details = await openScore(page);
  await expect(details.getByText('What your policy added')).toBeVisible();
});

test('at 375 px the links and Policy wait in Menu; the score bar stays pinned', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone header');
  await gotoSim(page);
  await expect(scoreBar(page)).toBeVisible();
  const menu = menuButton(page);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  const menuPanel = page.locator(`[id="${await menu.getAttribute('aria-controls')}"]`);
  const items = [
    menuPanel.getByRole('link', { name: 'Paint', exact: true }),
    menuPanel.getByRole('link', { name: 'Simulate', exact: true }),
    menuPanel.getByRole('button', { name: 'Policy', exact: true })
  ];
  for (const item of items) await expect(item).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  for (const item of items) await expect(item).toBeVisible();
  await expect(scoreBar(page)).toBeVisible();
});

test('from md the Policy button closes and reopens the docked panel and returns focus', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the docked panel is md+');
  await gotoSim(page);
  // Docked and open by default, without taking focus.
  await expect(panel(page)).toBeVisible();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).not.toBeFocused();
  await policyButton(page).click();
  await expect(panel(page)).toBeHidden();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'false');

  // Opened by the user: focus moves into the panel; Escape closes it and focus returns.
  await policyButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(policyButton(page)).toBeFocused();

  await policyButton(page).click();
  await panel(page).getByRole('button', { name: 'Close policy' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(policyButton(page)).toBeFocused();
});

test('below md Policy opens the modal sheet from the Menu and focus returns to Menu', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the sheet is below md');
  await gotoSim(page);
  // Closed by default; the sheet opens from the Menu and is modal.
  await expect(panel(page)).toBeHidden();
  await openHeaderMenu(page);
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'false');
  await policyButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Close policy' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'false');
  // The Policy button waits in the closed Menu, so focus returns to the Menu button.
  await expect(menuButton(page)).toBeFocused();

  await (await headerAction(page, 'Policy')).click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(menuButton(page)).toBeFocused();
});

// ---- brushes ------------------------------------------------------------------------------------

test('a Street brush on the first frontage name selects its fronting lots', async ({ page }) => {
  const street = await firstStreet();
  expect(street.lots, 'fixture-0 has an eligible lot on its first street').toBeGreaterThan(0);
  await gotoSim(page);
  const before = await leverStatus(page);

  const form = await openBrushForm(page, 'Street', 'Add a street brush');
  await form.getByRole('combobox', { name: 'Street name' }).fill(street.name);
  await form.getByRole('button', { name: 'Add street' }).click();
  await expect(form.getByRole('list', { name: 'Chosen streets' })).toContainText(street.name);
  await watchLeverNotices(page);
  await form.getByRole('button', { name: 'Save brush' }).click();

  await expect(brushList(page)).toHaveCount(1);
  await expect(brushList(page).first()).toContainText(lotCount(street.lots));

  // The levers go resolving -> current; the updating notice shows, then clears.
  await expect
    .poll(async () => {
      const l = await leverStatus(page);
      return l.status === 'current' && (l.sentRev ?? -1) > (before.sentRev ?? -1);
    })
    .toBe(true);
  await expect(page.getByTestId('fzp-lever-status')).toHaveText('');
  const seen = await leverSeen(page);
  const resolving = seen.findIndex(
    (s) => s.status === 'resolving' && s.text.startsWith('Updating the simulation for your policy')
  );
  expect(resolving, JSON.stringify(seen)).toBeGreaterThanOrEqual(0);
  expect(
    seen.slice(resolving + 1).some((s) => s.text === ''),
    JSON.stringify(seen)
  ).toBe(true);
});

test('a Paint stroke adds a freehand brush and Ctrl+Z removes it', async ({ isMobile, page }) => {
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  const paint = panel(page).getByRole('radio', { name: 'Paint', exact: true });
  await expect(paint).toBeEnabled();
  await chooseTool(page, isMobile, () => paint.click());
  await strokeOnce(page, isMobile);

  if (isMobile) {
    // Done goes back to Move and reopens the sheet.
    await page.getByTestId('phone-tool-bar').getByRole('button', { name: 'Done' }).click();
    await expect(panel(page)).toBeVisible();
  }
  await expect(brushList(page)).toHaveCount(1);
  await expect(brushList(page).first()).toContainText(/Raise/);
  if (isMobile) {
    await panel(page).getByRole('button', { name: 'Close policy' }).click();
    await expect(panel(page)).toBeHidden();
  }

  await page.keyboard.press('Control+z');
  await openPolicy(page);
  await expect(brushList(page)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^Redo: / })).toBeEnabled();
});

test('a brushed protection shows the protections line in the score', async ({ isMobile, page }) => {
  await gotoSim(page);
  const before = await leverStatus(page);
  await openPolicy(page);
  await expandSection(page, 'Protections');
  const protect = panel(page).getByRole('button', { name: 'Protect lots with the brush' });
  await expect(protect).toBeEnabled();
  await chooseTool(page, isMobile, () => protect.click());
  await strokeOnce(page, isMobile);

  await expect
    .poll(async () => {
      const l = await leverStatus(page);
      return l.status === 'current' && (l.sentRev ?? -1) > (before.sentRev ?? -1);
    })
    .toBe(true);
  const details = await openScore(page);
  await expect(details).toContainText(
    /\d[\d,]* lots? protected: [\d,]+ fewer homes? of zoned capacity/
  );
});

// ---- Back and Forward ---------------------------------------------------------------------------

/**
 * Waits until the page shows the future the address bar names: that seed and not representative,
 * or (with no seed) the representative future.
 */
async function expectAddressFuture(page: Page): Promise<void> {
  const raw = new URL(page.url()).searchParams.get('seed');
  if (raw === null) {
    await expect.poll(() => fzp(page, 'representative'), { timeout: 20_000 }).toBe(true);
  } else {
    await expect.poll(() => fzp(page, 'seed'), { timeout: 20_000 }).toBe(Number(raw));
    expect(await fzp(page, 'representative')).toBe(false);
  }
  expect(await fzp(page, 'phase')).toBe('ready');
}

test('Back after a reroll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/fzp?seed=5');
  await expect(page).toHaveURL(/\/sim\?seed=5&start=fzp$/);
  await waitReady(page);
  await expectAddressFuture(page);

  await (await headerAction(page, 'Another future')).click();
  await expect(page).toHaveURL((u) => /^\/sim$/.test(u.pathname) && !/\bseed=5&/.test(u.search));
  await expect(page).toHaveURL(/\/sim\?seed=\d+&start=fzp$/);
  const seed = Number(new URL(page.url()).searchParams.get('seed'));
  await expectAddressFuture(page);

  // Leave by a client navigation: Back is then SvelteKit's popstate onto the URL it stored before
  // the reroll's replaceState (?seed=5), while the address bar names the rerolled seed.
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'Simulate', exact: true }).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expectAddressFuture(page);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/sim\\?seed=${seed}&start=fzp$`));
  await expectAddressFuture(page);
  await page.goForward();
  await expect(page).toHaveURL(/\/sim$/);
  await expectAddressFuture(page);
});

// ---- accessibility and layout -------------------------------------------------------------------

test('axe: the policy panel open', async ({ page }) => {
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  await expandSection(page, 'Protections');
  await expectNoA11yViolations(page);
});

test('axe: the Area brush form open', async ({ page }) => {
  await gotoSim(page);
  const form = await openBrushForm(page, 'Area', 'Add an area brush');
  await expect(form.getByRole('group', { name: 'Zoning districts' })).toBeVisible();
  await expectNoA11yViolations(page);
});

/**
 * WCAG 2.2 2.4.11 (Focus Not Obscured): each button of the map's bottom-left navigation control
 * (zoom in, zoom out, compass) stays clear of `cover`, and, focused, is the topmost element at its
 * centre.
 */
async function expectNavControlClear(page: Page, cover: Locator): Promise<void> {
  const buttons = page.locator('.maplibregl-ctrl-bottom-left button');
  await expect(buttons).toHaveCount(3);
  const c = (await cover.boundingBox())!;
  for (const button of await buttons.all()) {
    await button.focus();
    const b = (await button.boundingBox())!;
    const name = await button.getAttribute('aria-label');
    const overlaps =
      b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height;
    expect(overlaps, `${name} at ${JSON.stringify(b)} overlaps ${JSON.stringify(c)}`).toBe(false);
    const topmost = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(topmost, `${name} is covered`).toBe(true);
  }
}

test('from md the docked panel leaves the zoom and compass control uncovered', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the docked panel is md+, and a coarse pointer gets no navigation control');
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSim(page);
  await expect(panel(page)).toBeVisible();
  await expectNavControlClear(page, panel(page));
});

test('below md on a fine pointer the phone tool bar leaves the zoom control uncovered', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'a coarse pointer gets no navigation control');
  await page.setViewportSize({ width: 700, height: 800 });
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  await chooseTool(page, true, () =>
    panel(page).getByRole('radio', { name: 'Paint', exact: true }).click()
  );
  await expect(page.getByTestId('phone-tool-bar')).toBeVisible();
  await expectNavControlClear(page, page.getByTestId('phone-tool-bar'));
});

test('at 375 px: no horizontal scroll, and the footer links stay unobscured', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'W6b is the phone layout');
  await gotoSim(page);
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);

  // With the score details open.
  await openScore(page);
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);
  await scoreBar(page).click();
  await expect(scoreDetails(page)).toBeHidden();

  // With the floating tool bar showing (a stroke tool chosen).
  await openPolicy(page);
  await expandSection(page, 'Your zoning');
  await chooseTool(page, true, () =>
    panel(page).getByRole('radio', { name: 'Paint', exact: true }).click()
  );
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);
});

// ---- permitting timelines (plan 4) ----------------------------------------------------------------

/** The "Permitting timelines" disclosure: its name carries the set's label ("…, <summary>"). */
const timingToggle = (page: Page): Locator =>
  panel(page).getByRole('button', { name: /^Permitting timelines/ });

async function openTiming(page: Page): Promise<void> {
  await openPolicy(page);
  const toggle = timingToggle(page);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

const timingLabel = (page: Page): Locator => panel(page).getByTestId('timing-label');
const routeTimeline = (page: Page, route: string): Locator =>
  panel(page).getByRole('group', { name: `${route} timeline` });

/** Waits for a lever revision above `before` to be in force. */
async function expectNewRevision(page: Page, before: number | null): Promise<void> {
  await expect
    .poll(
      async () => {
        const l = await leverStatus(page);
        return l.status === 'current' && (l.sentRev ?? -1) > (before ?? -1);
      },
      { timeout: 20_000 }
    )
    .toBe(true);
}

test('choosing a preset sends timers and the label changes', async ({ page }) => {
  await gotoSim(page);
  await openTiming(page);
  const before = (await leverStatus(page)).sentRev;
  await panel(page).getByLabel('Preset').selectOption({ label: "Permits at San Diego's pace" });
  await expectNewRevision(page, before);
  await expect(timingLabel(page)).toHaveText("Permits at San Diego's pace");
  await expect(timingToggle(page)).toContainText("Permits at San Diego's pace");
});

test('a keyboard edit makes the set custom and Revert undoes it', async ({ page }) => {
  await gotoSim(page);
  await openTiming(page);
  await expect(timingLabel(page)).toHaveText('SF as observed');
  const timeline = routeTimeline(page, 'Discretionary');
  await timeline.getByRole('button').first().focus();
  for (let i = 0; i < 8; i++) {
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    if (name?.startsWith('Permit review,')) break;
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.locator(':focus')).toHaveAccessibleName(/^Permit review,/);
  await page.keyboard.press('Enter');
  const before = (await leverStatus(page)).sentRev;
  const shorten = panel(page).getByRole('button', { name: 'Shorten by 0.5 month' });
  for (let i = 0; i < 3; i++) await shorten.click();
  await expect(timingLabel(page)).toHaveText('Custom (from SF as observed)');
  await expectNewRevision(page, before);

  const edited = (await leverStatus(page)).sentRev;
  await panel(page).getByRole('button', { name: 'Revert to SF as observed' }).click();
  await expect(timingLabel(page)).toHaveText('SF as observed');
  await expectNewRevision(page, edited);
});

test('the minimum is visible', async ({ page }) => {
  await gotoSim(page);
  await openTiming(page);
  const timeline = routeTimeline(page, 'Discretionary');
  await timeline.getByRole('button', { name: /^Permit review,/ }).click();
  const months = panel(page).getByLabel('Typical months');
  await months.fill('0');
  await months.press('Tab');
  await expect(panel(page).getByText('At the minimum')).toBeVisible();
  await expect(
    timeline.getByRole('button', { name: /^Permit review,.*at the minimum/ })
  ).toBeVisible();
  const shown = Number(await months.inputValue());
  expect(shown).toBeGreaterThan(0);
});

test('route shares sum to 100', async ({ page }) => {
  await gotoSim(page);
  await openTiming(page);
  const share = (name: string) => panel(page).getByLabel(`${name} share, %`);
  await share('Permit only').fill('100');
  await share('Permit only').press('Tab');
  await expect(share('Permit only')).toHaveValue('100');
  await expect(share('Discretionary')).toHaveValue('0');
  await expect(share('Streamlined')).toHaveValue('0');
});

test('axe: the timelines section open, details open (1280 px; the 375 px sheet on mobile)', async ({
  page
}) => {
  await gotoSim(page);
  await openTiming(page);
  await routeTimeline(page, 'Discretionary').getByRole('button').nth(1).click();
  await expect(panel(page).getByLabel('Typical months')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('at 375 px with the timelines open: no horizontal scroll', async ({ isMobile, page }) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoSim(page);
  await openTiming(page);
  await routeTimeline(page, 'Discretionary').getByRole('button').nth(1).click();
  await expect(panel(page).getByLabel('Typical months')).toBeVisible();
  await expectNoHorizontalScroll(page);
  const box = (await panel(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375);
});
