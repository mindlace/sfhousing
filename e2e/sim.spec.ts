// /sim e2e (plan 3, Task 12; the dock, sim-ux plan 2): the /fzp redirect, the header score and
// phone Menu, the policy dock (tabs, Results, rail, phone sheet), a transit rule, a Paint stroke and its undo, a category protection, Back and Forward
// after a reroll, and the accessibility checks. Runs against the VITE_E2E build, which exposes
// window.__sfhFzp (src/lib/fzp/debug.ts, with /sim's `levers` field), window.__sfhSim (the live
// preview, src/lib/sim-page/debug.ts) and window.__sfhMap.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import type { SfhSimDebug } from '../src/lib/sim-page/debug';
import { formatCount } from '../src/lib/scoreboard/format';
import { expectNoA11yViolations } from './helpers/a11y';
import { slider, startRun } from './helpers/run';
import {
  FRAME,
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

// ---- helpers ------------------------------------------------------------------------------------

function fzp<K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> {
  return page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;
}
const leverStatus = (page: Page) => fzp(page, 'levers');
type SimWin = Win & { __sfhSim?: SfhSimDebug };
/** The live preview's state (`window.__sfhSim`, src/lib/sim-page/debug.ts). */
const simPreview = (page: Page) =>
  page.evaluate(() => (window as SimWin).__sfhSim?.preview ?? null);

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

/** /sim (or `path`), ready, in Setup; with `run`, a run started and paused (the day at or just past asOf). */
async function gotoSim(
  page: Page,
  path = '/sim',
  { run = false }: { run?: boolean } = {}
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await waitReady(page);
  if (run) await startRun(page);
}

const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
/** The dock's Results face (`data-testid="score-details"`): Run and the header score show it. */
const scoreDetails = (page: Page): Locator => page.getByRole('region', { name: 'Results' });
/** The policy dock. Its root is `display: contents`: the docked panel, rail or sheet is the box. */
const panel = (page: Page): Locator => page.getByTestId('dock');
/** The docked panel (from md). */
const dockPanel = (page: Page): Locator => page.locator('.sfh-dock-panel');
/** The phone sheet's handle (below md). */
const handle = (page: Page): Locator => page.getByTestId('dock-handle');
const tabOf = (page: Page, name: string): Locator =>
  panel(page).getByRole('tab', { name, exact: true });
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

/** The dock shows its body: the docked panel from md, the sheet open (peek or full) below. */
const dockShown = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      !!document.querySelector('.sfh-dock-panel') ||
      document.querySelector('[data-testid="dock-handle"]')?.getAttribute('aria-expanded') ===
        'true'
  );

/** The dock, opened if it is not already (from md the Policy button, below md the handle). */
async function openPolicy(page: Page): Promise<Locator> {
  if (!(await dockShown(page))) {
    if (await handle(page).isVisible()) await handle(page).click();
    else await (await headerAction(page, 'Policy')).click();
  }
  await expect.poll(() => dockShown(page)).toBe(true);
  return panel(page);
}

/** Opens the dock (on the editing face, in Setup) and selects the tab `name`. */
async function openTab(page: Page, name: string): Promise<void> {
  await openPolicy(page);
  await tabOf(page, name).click();
  await expect(tabOf(page, name)).toHaveAttribute('aria-selected', 'true');
}

/** Below md: folds an open sheet to its handle (a no-op from md). */
async function closeSheet(page: Page): Promise<void> {
  if (!(await handle(page).isVisible())) return;
  if ((await handle(page).getAttribute('aria-expanded')) !== 'true') return;
  await panel(page).getByRole('button', { name: 'Collapse Policy' }).click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
}

/** The Transit tab's layer rows, the FZP baseline row left out. */
const layerRows = (page: Page): Locator =>
  panel(page)
    .getByRole('list', { name: 'Transit layers' })
    .locator('[data-layer-row]:not([data-layer-row="fzp"])');
/** A layer row's select button (its name ends in the lot count). */
const selectButton = (row: Locator): Locator => row.locator(':scope > button');

/**
 * Opens the Transit tab and presses "+ Transit layer" once the brush catalog allows it (it is
 * aria-disabled until then, and Playwright waits for it to be enabled), then waits for the new
 * layer's lot count. Returns its row, selected and expanded.
 */
async function addTransitLayer(page: Page): Promise<Locator> {
  await openTab(page, 'Transit');
  const n = await layerRows(page).count();
  await panel(page).getByRole('button', { name: 'Add transit layer' }).click({ timeout: 20_000 });
  const row = layerRows(page).nth(n);
  await expect(selectButton(row)).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByRole('group', { name: 'Stop types' })).toBeVisible();
  await expect(selectButton(row)).toHaveAccessibleName(/ · [\d,]+ lots?$/, { timeout: 20_000 });
  return row;
}
const customList = (page: Page): Locator =>
  panel(page).getByRole('list', { name: 'Painted areas' }).getByRole('listitem');

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
 * Chooses a stroke tool from the open Paint tab. On a phone this folds the sheet to its handle for
 * the palette strip (layout ruling 5).
 */
async function chooseTool(page: Page, isMobile: boolean, choose: () => Promise<void>) {
  await choose();
  if (isMobile) {
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('palette-strip')).toBeVisible();
  }
}

/** The palette strip's Done: back to Move, the sheet open full on the Paint tab. */
async function stripDone(page: Page): Promise<void> {
  await page.getByTestId('palette-strip').getByRole('button', { name: 'Done' }).click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(tabOf(page, 'Paint')).toHaveAttribute('aria-selected', 'true');
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

/**
 * From now on, each time the "Updating the simulation" pill shows, records the docked panel's and
 * the time bar's boxes at that moment (a MutationObserver, so a pill that shows briefly is still
 * measured).
 */
async function watchBoxesWhileUpdating(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Box = { x: number; y: number; width: number; height: number };
    const w = window as unknown as { __updatingBoxes?: { panel: Box; bar: Box }[] };
    const row = document.querySelector('[data-testid="fzp-lever-status"]')!;
    const box = (selector: string): Box => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    w.__updatingBoxes = [];
    new MutationObserver(() => {
      if (!(row.textContent ?? '').includes('Updating the simulation')) return;
      w.__updatingBoxes!.push({
        panel: box('.sfh-dock-panel'),
        bar: box('[data-testid="fzp-scrubber"]')
      });
    }).observe(row, { childList: true, subtree: true, characterData: true });
  });
}

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

test('/fzp?seed=5 lands on /sim?seed=5 and its levers come into force', async ({ page }) => {
  await page.goto('/fzp?seed=5');
  await expect(page).toHaveURL(/\/sim\?seed=5$/);
  await waitReady(page);
  expect((await leverStatus(page)).status).toBe('current');
  expect(await fzp(page, 'seed')).toBe(5);
});

test('/sim starts on the Family Zoning Plan; the header score flips the dock to Results', async ({
  page
}) => {
  await gotoSim(page);

  const { baseline, shown } = JSON.parse(
    await page.evaluate(() => JSON.stringify((window as FzpWin).__sfhFzp!.score))
  ) as { baseline: { completedNet: number }; shown: { completedNet: number }[] };
  await expect(scoreBar(page)).toHaveText(
    `${formatCount(baseline.completedNet + shown[0].completedNet)} homes added`
  );
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');
  const details = await openScore(page);
  await expect(details.getByText('What the plan added')).toBeVisible();
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

test('from md the Policy button folds the dock to a rail and reopens it, and returns focus', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the docked panel is md+');
  await gotoSim(page);
  // Docked and open by default on Transit, without taking focus.
  await expect(dockPanel(page)).toBeVisible();
  await expect(tabOf(page, 'Transit')).toHaveAttribute('aria-selected', 'true');
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'true');
  expect(await panel(page).evaluate((d) => d.contains(document.activeElement))).toBe(false);
  await policyButton(page).click();
  await expect(dockPanel(page)).toBeHidden();
  await expect(page.getByTestId('dock-rail')).toBeVisible();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'false');

  // Opened by the user: focus moves to the selected tab; Escape folds it and focus returns.
  await policyButton(page).click();
  await expect(dockPanel(page)).toBeVisible();
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(tabOf(page, 'Transit')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dockPanel(page)).toBeHidden();
  await expect(policyButton(page)).toBeFocused();

  await policyButton(page).click();
  await panel(page).getByRole('button', { name: 'Collapse Policy' }).click();
  await expect(dockPanel(page)).toBeHidden();
  await expect(policyButton(page)).toBeFocused();
});

test('below md the sheet opens from the handle or the Menu, and focus returns to Menu', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the sheet is below md');
  await gotoSim(page);
  // Closed to its handle by default; the sheet is not modal.
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(handle(page)).toHaveText('Transit');
  await handle(page).click();
  await expect(tabOf(page, 'Transit')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await handle(page).click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');

  await openHeaderMenu(page);
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'false');
  await policyButton(page).click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'true');
  await panel(page).getByRole('button', { name: 'Collapse Policy' }).click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(policyButton(page)).toHaveAttribute('aria-expanded', 'false');
  // The Policy button waits in the closed Menu, so focus returns to the Menu button.
  await expect(menuButton(page)).toBeFocused();

  await (await headerAction(page, 'Policy')).click();
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton(page)).toBeFocused();
});

test('the header score flips the dock to Results and back in Setup; in a run it keeps Results', async ({
  page
}) => {
  await gotoSim(page);
  await openScore(page);
  expect(await fzp(page, 'runPhase')).toBe('setup');
  await expect(panel(page).getByRole('button', { name: 'Edit policy' })).toBeVisible();
  await scoreBar(page).click();
  await expect(scoreDetails(page)).toBeHidden();
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(tabOf(page, 'Transit')).toBeVisible();

  await startRun(page);
  await expect(scoreDetails(page)).toBeVisible();
  await scoreBar(page).click();
  await expect(scoreDetails(page)).toBeVisible();
  expect(await fzp(page, 'runPhase')).toBe('run');
});

// ---- brushes ------------------------------------------------------------------------------------

test('a transit layer resolves its lots and updates the levers', async ({ page }) => {
  await gotoSim(page);
  const before = await leverStatus(page);

  await watchLeverNotices(page);
  const row = await addTransitLayer(page);
  await expect(layerRows(page)).toHaveCount(1);
  await expect(selectButton(row)).toContainText('Near regional rail and Muni Metro');

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
  // No building flash on a transit edit (sim-ux spec, Goal 2).
  for (let k = 0; k < 10; k++) {
    expect(await simPreview(page)).toBe('none');
    await page.waitForTimeout(100);
  }
});

test('a notice never moves the docked panel or the time bar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop rule; phones push content down by design');
  await gotoSim(page);
  const row = await addTransitLayer(page);
  await expect
    .poll(async () => (await leverStatus(page)).status, { timeout: 20_000 })
    .toBe('current');
  const before = await leverStatus(page);
  const panelBox = await dockPanel(page).boundingBox();
  const barBox = await page.getByTestId('fzp-scrubber').boundingBox();
  await watchBoxesWhileUpdating(page);
  // A chip edit sends a revision: the "Updating the simulation" pill shows until it is current.
  await row
    .getByRole('group', { name: 'Stop types' })
    .getByRole('button', { name: /^Muni Rapid bus/ })
    .click();
  await expect
    .poll(async () => {
      const l = await leverStatus(page);
      return l.status === 'current' && (l.sentRev ?? -1) > (before.sentRev ?? -1);
    })
    .toBe(true);
  const seen = await page.evaluate(
    () =>
      (
        window as unknown as {
          __updatingBoxes?: { panel: unknown; bar: unknown }[];
        }
      ).__updatingBoxes ?? []
  );
  expect(seen.length, 'the Updating pill never showed').toBeGreaterThan(0);
  for (const s of seen) {
    expect(s.panel).toEqual(panelBox);
    expect(s.bar).toEqual(barBox);
  }
  expect(await dockPanel(page).boundingBox()).toEqual(panelBox);
  expect(await page.getByTestId('fzp-scrubber').boundingBox()).toEqual(barBox);
});

test('a Paint stroke adds a custom brush and Ctrl+Z removes it', async ({ isMobile, page }) => {
  await gotoSim(page);
  await openTab(page, 'Paint');
  const paint = panel(page).getByRole('radio', { name: 'Paint', exact: true });
  await expect(paint).toBeEnabled();
  await chooseTool(page, isMobile, () => paint.click());
  await strokeOnce(page, isMobile);

  // Done goes back to Move and reopens the sheet on Paint.
  if (isMobile) await stripDone(page);
  await expect(customList(page)).toHaveCount(1);
  await expect(customList(page).first()).toContainText(/\d+ stor/);
  await closeSheet(page);

  await page.keyboard.press('Control+z');
  await openPolicy(page);
  await expect(customList(page)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^Redo: / })).toBeEnabled();
});

test('a painted area is selected, outlined and removed from the Paint tab', async ({
  isMobile,
  page
}) => {
  const OUTLINE_LAYER = 'sim-painted-outline';
  await gotoSim(page);
  await openTab(page, 'Paint');
  const paint = panel(page).getByRole('radio', { name: 'Paint', exact: true });
  await expect(paint).toBeEnabled();
  await chooseTool(page, isMobile, () => paint.click());
  await strokeOnce(page, isMobile);
  if (isMobile) await stripDone(page);
  await expect(customList(page)).toHaveCount(1);

  // Selecting the row outlines its lots (Move is chosen: nothing else would).
  const row = customList(page).first().getByRole('button', { pressed: false });
  await row.first().click();
  await expect(customList(page).first().getByRole('button', { pressed: true })).toBeVisible();
  await expect.poll(() => deckIds(page), { timeout: 20_000 }).toContain(OUTLINE_LAYER);

  // Remove is one change: the row and its outline go, and Undo brings the row back unselected.
  await panel(page)
    .getByRole('button', { name: /^Remove: / })
    .click();
  await expect(customList(page)).toHaveCount(0);
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
  await panel(page)
    .getByRole('button', { name: /^Undo: Removed: / })
    .click();
  await expect(customList(page)).toHaveCount(1);
  await expect(customList(page).first().getByRole('button', { pressed: false })).toBeVisible();
  expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);
});

test('a category protection shows the protections line in the score', async ({ page }) => {
  await gotoSim(page);
  const before = await leverStatus(page);
  await openTab(page, 'Protect');
  await panel(page).getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }).check();

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
  await expect(page).toHaveURL(/\/sim\?seed=5$/);
  await waitReady(page);
  await expectAddressFuture(page);

  await (await headerAction(page, 'Another future')).click();
  await expect(page).toHaveURL((u) => /^\/sim$/.test(u.pathname) && !/\bseed=5$/.test(u.search));
  await expect(page).toHaveURL(/\/sim\?seed=\d+$/);
  const seed = Number(new URL(page.url()).searchParams.get('seed'));
  await expectAddressFuture(page);

  // Leave by a client navigation: Back is then SvelteKit's popstate onto the URL it stored before
  // the reroll's replaceState (?seed=5), while the address bar names the rerolled seed.
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'Simulate', exact: true }).click();
  await expect(page).toHaveURL(/\/sim$/);
  await expectAddressFuture(page);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/sim\\?seed=${seed}$`));
  await expectAddressFuture(page);
  await page.goForward();
  await expect(page).toHaveURL(/\/sim$/);
  await expectAddressFuture(page);
});

// ---- accessibility and layout -------------------------------------------------------------------

for (const name of ['Transit', 'Paint', 'Protect']) {
  test(`axe: the dock open on ${name}`, async ({ page }) => {
    await gotoSim(page);
    await openTab(page, name);
    await expectNoA11yViolations(page);
  });
}

// ---- Setup and Run (spec §1) ----------------------------------------------------------------------

test('Run flips the dock to Results and Edit policy returns to the present', async ({ page }) => {
  await gotoSim(page);
  expect(await fzp(page, 'runPhase')).toBe('setup');
  await openTab(page, 'Protect');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('run');
  await expect
    .poll(() => fzp(page, 'day'), { timeout: 20_000 })
    .toBeGreaterThan(await fzp(page, 'asOf'));
  // A run offers Results only: no tabs, no Undo, and the header score reports it.
  await expect(scoreDetails(page)).toBeVisible();
  await expect(panel(page).getByRole('tablist')).toHaveCount(0);
  await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'true');
  const edit = panel(page).getByRole('button', { name: 'Edit policy' });
  await expect(edit).toBeVisible();

  await edit.click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('setup');
  await expect.poll(() => fzp(page, 'day')).toBe(await fzp(page, 'asOf'));
  expect(await fzp(page, 'playing')).toBe(false);
  // Back on the tab used before Run, its controls live.
  await expect(tabOf(page, 'Protect')).toHaveAttribute('aria-selected', 'true');
  await expect(tabOf(page, 'Protect')).toBeFocused();
  await expect(
    panel(page).getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' })
  ).toBeEnabled();
  await expect(slider(page)).toBeDisabled();
});

test('at 375 px in a run the sheet peeks Results, and the scrubber and footer links stay unobscured', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'the phone layout');
  await gotoSim(page, '/sim', { run: true });
  await expect(scoreDetails(page)).toBeVisible();
  await expect(handle(page)).toHaveText('Results');
  const sheet = (await page.locator('.sfh-dock-sheet').boundingBox())!;
  const bar = (await page.getByTestId('fzp-scrubber').boundingBox())!;
  const viewport = page.viewportSize()!;
  // A peek: at most 40dvh, above the time bar.
  expect(sheet.height).toBeLessThanOrEqual(viewport.height * 0.4 + 1);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y + 0.5);
  // Every scrubber control is the topmost element at its centre.
  for (const control of await page.getByTestId('fzp-scrubber').getByRole('button').all()) {
    if (!(await control.isVisible())) continue;
    const hit = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(hit, `${await control.getAttribute('aria-label')} is covered`).toBe(true);
  }
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);
});

test('the Today marker in a run returns to Setup; Replay at the horizon does not', async ({
  page
}) => {
  await gotoSim(page, '/sim', { run: true });
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(() => fzp(page, 'day')).toBe(await fzp(page, 'horizon'));
  await expect.poll(() => fzp(page, 'playing')).toBe(false);

  // Replay restarts the run from the present: scrubbing forward from asOf is not "back to Today".
  await page.getByTestId('fzp-play').click();
  await expect.poll(() => fzp(page, 'playing')).toBe(true);
  expect(await fzp(page, 'runPhase')).toBe('run');

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => fzp(page, 'playing')).toBe(false);
  await page.getByTestId('fzp-start').click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('setup');
  expect(await fzp(page, 'day')).toBe(await fzp(page, 'asOf'));
  await expect(page.getByTestId('fzp-play-label')).toHaveText('Run');
});

test('axe: the dock on Results during a run', async ({ page }) => {
  await gotoSim(page, '/sim', { run: true });
  await openPolicy(page);
  await expect(panel(page).getByRole('button', { name: 'Edit policy' })).toBeVisible();
  await expect(scoreDetails(page)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a selected layer's expanded editor passes axe", async ({ page }) => {
  await gotoSim(page);
  const row = await addTransitLayer(page);
  // A bound reached: More on the outer band is aria-disabled at the inner band's height.
  const outer = row.getByRole('group', { name: 'Band 2' });
  for (let k = 0; k < 2; k++) await outer.getByRole('button', { name: 'More stories' }).click();
  await expect(outer.getByRole('button', { name: 'More stories' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await expectNoA11yViolations(page);
  // The FZP baseline selected instead: the layer folds, the baseline row is pressed.
  const fzp = panel(page).getByRole('button', { name: 'FZP baseline', exact: true });
  await fzp.click();
  await expect(fzp).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByRole('group', { name: 'Stop types' })).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test('layer edits are one undo step per run; the row stays selected and expanded', async ({
  page
}) => {
  await gotoSim(page);
  const row = await addTransitLayer(page);
  const inner = row.getByRole('group', { name: 'Band 1' });
  for (let k = 0; k < 3; k++) await inner.getByRole('button', { name: 'More stories' }).click();
  await expect(inner).toContainText('9 stories');
  const undo = panel(page).getByRole('button', { name: /^Undo/ });
  await expect(undo).toHaveAccessibleName(
    'Undo: Edited: Allowed up to 9 stories near regional rail and Muni Metro'
  );
  await undo.click();
  await expect(inner).toContainText('6 stories');
  await expect(selectButton(row)).toHaveAttribute('aria-pressed', 'true');
  await expect(row.getByRole('group', { name: 'Stop types' })).toBeVisible();
  // The next undo takes back the layer itself.
  await expect(undo).toHaveAccessibleName(
    'Undo: Allowed up to 6 stories near regional rail and Muni Metro'
  );
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
  await expect(dockPanel(page)).toBeVisible();
  await expectNavControlClear(page, dockPanel(page));
  // Folded to the rail, the control moves beside the rail.
  await (await headerAction(page, 'Policy')).click();
  await expect(page.getByTestId('dock-rail')).toBeVisible();
  await expectNavControlClear(page, page.getByTestId('dock-rail'));
});

test('below md on a fine pointer the palette strip leaves the zoom control uncovered', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'a coarse pointer gets no navigation control');
  await page.setViewportSize({ width: 700, height: 800 });
  await gotoSim(page);
  await openTab(page, 'Paint');
  await chooseTool(page, true, () =>
    panel(page).getByRole('radio', { name: 'Paint', exact: true }).click()
  );
  await expect(page.getByTestId('palette-strip')).toBeVisible();
  await expectNavControlClear(page, page.getByTestId('palette-strip'));
});

test('at 375 px: no horizontal scroll, and the footer links stay unobscured', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'W6b is the phone layout');
  await gotoSim(page);
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);

  // With the sheet on Results (the header score).
  await openScore(page);
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);
  await scoreBar(page).click();
  await expect(scoreDetails(page)).toBeHidden();

  // With the palette strip showing (a stroke tool chosen).
  await openTab(page, 'Paint');
  await chooseTool(page, true, () =>
    panel(page).getByRole('radio', { name: 'Paint', exact: true }).click()
  );
  await expectNoHorizontalScroll(page);
  await expectFooterReachable(page);
});

// ---- permitting timelines (plan 4) ----------------------------------------------------------------

/** The Permits tab: the permitting timelines. */
async function openTiming(page: Page): Promise<void> {
  await openTab(page, 'Permits');
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

test('axe: the Permits tab open, details open (1280 px; the 375 px sheet on mobile)', async ({
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
  const box = (await page.locator('.sfh-dock-sheet').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375);
});

// ---- map overlays (plan 2, Task 4) ----------------------------------------------------------------

const LIMITS_LAYER = 'sim-height-limits';
const mapVisibility = (page: Page, id: string) =>
  page.evaluate(
    (l) => (window as Win).__sfhMap!.map!.getLayoutProperty(l, 'visibility') ?? 'visible',
    id
  );
const deckIds = (page: Page) =>
  page.evaluate(() => (window as Win).__sfhMap!.timelineSnapshot()?.layerIds ?? []);
/** Hidden ones included: below md the View button waits in the header Menu. */
const viewButtons = (page: Page): Locator =>
  page.getByRole('banner').getByRole('button', { name: 'View', exact: true, includeHidden: true });

/** Run from Setup, until the run is on (the phone sheet sits above the time bar, never on it). */
async function pressRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('run');
}

test('Setup shows the height limits and transit; Run hides them; Edit policy brings them back', async ({
  page
}) => {
  await gotoSim(page);
  await expect.poll(() => deckIds(page), { timeout: 20_000 }).toContain(LIMITS_LAYER);
  await expect.poll(() => mapVisibility(page, 'transit-access')).toBe('visible');
  await expect(await headerAction(page, 'View')).toBeVisible();

  await pressRun(page);
  await expect.poll(() => deckIds(page)).not.toContain(LIMITS_LAYER);
  await expect.poll(() => mapVisibility(page, 'transit-access')).toBe('none');
  await openHeaderMenu(page);
  await expect(viewButtons(page)).toHaveCount(0);

  await page.keyboard.press('Escape'); // the Menu
  await openPolicy(page);
  await panel(page).getByRole('button', { name: 'Edit policy' }).click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('setup');
  await expect.poll(() => deckIds(page)).toContain(LIMITS_LAYER);
  await expect.poll(() => mapVisibility(page, 'transit-access')).toBe('visible');
  await expect(viewButtons(page)).toHaveCount(1);
});

test('the Zoning height limits toggle removes the limits and survives a reload', async ({
  page
}) => {
  await gotoSim(page);
  await expect.poll(() => deckIds(page), { timeout: 20_000 }).toContain(LIMITS_LAYER);
  await (await headerAction(page, 'View')).click();
  await page.getByRole('checkbox', { name: 'Zoning height limits' }).uncheck();
  await expect.poll(() => deckIds(page)).not.toContain(LIMITS_LAYER);
  await gotoSim(page);
  await (await headerAction(page, 'View')).click();
  await expect(page.getByRole('checkbox', { name: 'Zoning height limits' })).not.toBeChecked();
  expect(await deckIds(page)).not.toContain(LIMITS_LAYER);
});

/** The map canvas's pixels, as a PNG. */
const mapShot = (page: Page) => page.getByTestId('map-root').locator('canvas').first().screenshot();

test('zoomed in over the loaded lots, the glass lids draw: the toggle changes the map', async ({
  isMobile,
  page
}) => {
  test.skip(isMobile, 'the desktop map is enough to see the lids');
  await gotoSim(page);
  await expect.poll(() => deckIds(page), { timeout: 20_000 }).toContain(LIMITS_LAYER);
  // Past LIDS_FADE (contours gone), pitched over the fixture's lots.
  await jumpAndIdle(page, { ...FRAME, zoom: 17, pitch: 55 });
  // The lids answer comes after the moveend; wait until two frames agree.
  let on = await mapShot(page);
  await expect
    .poll(
      async () => {
        const next = await mapShot(page);
        const same = next.equals(on);
        on = next;
        return same;
      },
      { timeout: 20_000, intervals: [500] }
    )
    .toBe(true);
  await (await headerAction(page, 'View')).click();
  await page.getByRole('checkbox', { name: 'Zoning height limits' }).uncheck();
  await expect.poll(() => deckIds(page)).not.toContain(LIMITS_LAYER);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await mapShot(page)).equals(on), { timeout: 10_000 }).toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the open View menu on /sim has no axe violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoSim(page);
    await (await headerAction(page, 'View')).click();
    const group = page.getByRole('group', { name: 'Map layers' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('checkbox', { name: 'Zoning height limits' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['header'] });
  });
}

test('without transit: no transit.json request, no transit layers, View has only the height limits', async ({
  page
}) => {
  const transitAsked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/transit.json')) transitAsked.push(r.url());
  });
  // SSR reads the manifest server-side, so strip it where the intercept applies: the /sim load
  // re-runs in the browser on client navigation (as e2e/transit.spec.ts does for /).
  await page.route('**/data/fixture-0/manifest.json', async (route) => {
    const res = await route.fetch();
    const manifest = (await res.json()) as Record<string, unknown>;
    delete manifest.transit;
    await route.fulfill({ response: res, json: manifest });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(async () => {
    // A try that fell back to a full /sim load (the link clicked before hydration) asked for
    // transit.json through SSR's manifest: only the try that passes counts.
    transitAsked.length = 0;
    await page.goto('/attribution');
    await page.evaluate(() => ((window as Window & { __spa?: boolean }).__spa = true));
    await openHeaderMenu(page);
    await page.getByRole('banner').getByRole('link', { name: 'Simulate', exact: true }).click();
    await waitReady(page);
    expect(await page.evaluate(() => (window as Window & { __spa?: boolean }).__spa)).toBe(true);
  }).toPass({ timeout: 40_000 });
  await expect.poll(() => deckIds(page), { timeout: 20_000 }).toContain(LIMITS_LAYER);
  const transitLayers = await page.evaluate(() =>
    (window as Win)
      .__sfhMap!.map!.getStyle()
      .layers.map((l) => l.id)
      .filter((id) => id.startsWith('transit'))
  );
  expect(transitLayers).toEqual([]);
  expect(transitAsked).toEqual([]);
  await (await headerAction(page, 'View')).click();
  const group = page.getByRole('group', { name: 'Map layers' });
  await expect(group.getByRole('checkbox')).toHaveCount(1);
  await expect(group.getByRole('checkbox', { name: 'Zoning height limits' })).toBeChecked();
});

/** The visible header items, left to right, with their boxes. */
async function headerRow(page: Page): Promise<{ name: string; left: number; right: number }[]> {
  return page.evaluate(() => {
    const banner = document.querySelector('header')!;
    const items = [
      ...banner.querySelectorAll<HTMLElement>('a, button, [data-header-status] > *')
    ].filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0);
    // Only the outermost of nested items (the save state's wrapper, not its chip as well).
    return items
      .filter((el) => !items.some((o) => o !== el && o.contains(el)))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: (el.textContent ?? '').trim(), left: r.left, right: r.right };
      })
      .sort((a, b) => a.left - b.left);
  });
}

async function expectHeaderFits(page: Page): Promise<number> {
  await expectNoHorizontalScroll(page);
  const banner = page.getByRole('banner');
  const fit = await banner.evaluate((b) => ({ scroll: b.scrollWidth, client: b.clientWidth }));
  expect(fit.scroll, 'the header overflows').toBeLessThanOrEqual(fit.client);
  const row = await headerRow(page);
  for (let i = 1; i < row.length; i++)
    expect(row[i].left, `"${row[i].name}" overlaps "${row[i - 1].name}"`).toBeGreaterThanOrEqual(
      row[i - 1].right - 0.5
    );
  const score = (await scoreBar(page).boundingBox())!;
  return score.x + score.width / 2;
}

test('at 768 px the header fits in Setup and in Run, and the score stays put', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await gotoSim(page);
  await expect(page.getByRole('banner').getByRole('button', { name: 'View' })).toBeVisible();
  const setupCentre = await expectHeaderFits(page);
  await pressRun(page);
  await expect(viewButtons(page)).toHaveCount(0);
  const runCentre = await expectHeaderFits(page);
  expect(Math.abs(runCentre - setupCentre)).toBeLessThanOrEqual(1);
});

// ---- outlines of painted lots while erasing (plan 2, Task 5) ---------------------------------------

test('the eraser outlines painted lots, only while chosen', async ({ isMobile, page }) => {
  const OUTLINE_LAYER = 'sim-painted-outline';
  await gotoSim(page);
  await openTab(page, 'Paint');
  const tool = (name: string) => panel(page).getByRole('radio', { name, exact: true });
  await chooseTool(page, isMobile, () => tool('Paint').click());
  await strokeOnce(page, isMobile);
  if (isMobile) await stripDone(page);
  await expect(customList(page)).toHaveCount(1);
  expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);

  await chooseTool(page, isMobile, () => tool('Erase').click());
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);

  if (isMobile) await stripDone(page);
  else await tool('Move').click();
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
});

// ---- live preview while painting (sim-ux plan 3, Task 4) ---------------------------------------

const isPreviewLayer = (ids: string[]) => ids.some((id) => id.startsWith('sim-feedback-'));

/**
 * Starts a drag across fixture-0's parcel row and holds it mid-stroke (a mouse on desktop, one
 * finger on the phone): down, then two moves. Returns the release.
 */
async function holdDrag(page: Page, isMobile: boolean): Promise<() => Promise<void>> {
  const [x0, y0] = await projectToPage(page, isMobile ? TOUCH_FROM : FROM);
  const [x1, y1] = await projectToPage(page, isMobile ? TOUCH_TO : TO);
  const mid: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove', [x, y]: [number, number]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x, y, id: 1 }] });
    await touch('touchStart', [x0, y0]);
    await touch('touchMove', mid);
    await touch('touchMove', [x1, y1]);
    return async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
  }
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(...mid);
  await page.mouse.move(x1, y1);
  return () => page.mouse.up();
}

test('a Paint drag shows live buildings under the brush, fading on release', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  // gotoSim emulates reduced motion, under which a release clears at once: the fade needs it off.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openTab(page, 'Paint');
  const tool = (name: string) => panel(page).getByRole('radio', { name, exact: true });
  await chooseTool(page, isMobile, () => tool('Paint').click());
  await jumpAndIdle(page);
  expect(await simPreview(page)).toBe('none');

  const release = await holdDrag(page, isMobile);
  await expect.poll(() => simPreview(page), { timeout: 10_000 }).toBe('live');
  expect(isPreviewLayer(await deckIds(page))).toBe(true);
  await release();

  await expect.poll(() => simPreview(page)).toBe('fading');
  await expect.poll(() => simPreview(page), { timeout: 4_000 }).toBe('none');
  expect(isPreviewLayer(await deckIds(page))).toBe(false);
  if (isMobile) await stripDone(page);
  await expect(customList(page)).toHaveCount(1);
});

test('an Erase drag shows no buildings', async ({ isMobile, page }) => {
  await gotoSim(page);
  await openTab(page, 'Paint');
  const tool = (name: string) => panel(page).getByRole('radio', { name, exact: true });
  await chooseTool(page, isMobile, () => tool('Paint').click());
  await strokeOnce(page, isMobile);
  if (isMobile) await stripDone(page);
  await expect(customList(page)).toHaveCount(1);
  await expect.poll(() => simPreview(page)).toBe('none');
  // Sample the preview through an Erase stroke and after it.
  await chooseTool(page, isMobile, () => tool('Erase').click());
  const seen: (string | null)[] = [];
  const sampling = (async () => {
    for (let k = 0; k < 20; k++) {
      seen.push(await simPreview(page));
      await page.waitForTimeout(100);
    }
  })();
  await strokeOnce(page, isMobile);
  await sampling;
  expect(seen.every((s) => s === 'none')).toBe(true);
  expect(isPreviewLayer(await deckIds(page))).toBe(false);
});

test('hovering a building shows its allowed and buildable stories', async ({ isMobile, page }) => {
  // Hover tooltips need a mouse; the phone's tap card carries the same text.
  test.skip(isMobile, 'chromium project only');
  await gotoSim(page);
  // 3512014: fixture-0's 60 m, 40-unit building (map.spec E3 hovers it on the editor)
  const lot: [number, number] = [-122.4179679, 37.7601348];
  await jumpAndIdle(page, { center: lot, zoom: 16, pitch: 0, bearing: 0 });
  const [x, y] = await projectToPage(page, lot);
  await page.mouse.move(x, y, { steps: 5 });
  const tip = page.getByTestId('map-root').getByRole('tooltip');
  await expect(tip).toContainText('Parcel 3512014');
  await expect(tip).toContainText(/Allowed: \d+( · (Buildable here: \d+|Protected))?/, {
    timeout: 10_000
  });
});
