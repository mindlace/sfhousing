// /sim e2e (plan 3, Task 12): the /fzp redirect, the header score bar and phone Menu, the policy
// panel, a transit rule, a Paint stroke and its undo, a category protection, Back and Forward
// after a reroll, and the accessibility checks. Runs against the VITE_E2E build, which exposes
// window.__sfhFzp (src/lib/fzp/debug.ts, with /sim's `levers` field) and window.__sfhMap.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
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

/** /sim (or `path`), ready, in Setup; with `run`, a run started and paused at asOf. */
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

/** A panel section's disclosure, expanded. */
async function expandSection(page: Page, title: string): Promise<void> {
  const button = panel(page).getByRole('button', { name: title, exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/**
 * "Add transit rule" once the brush catalog allows it (it is aria-disabled until then, and
 * Playwright waits for it to be enabled); the form opens named `title` exactly.
 */
async function openBrushForm(page: Page, title: string): Promise<Locator> {
  await openPolicy(page);
  await expandSection(page, 'New zoning rules');
  await panel(page).getByRole('button', { name: 'Add transit rule' }).click({ timeout: 20_000 });
  const form = panel(page).getByRole('form', { name: title, exact: true });
  await expect(form).toBeVisible();
  return form;
}

const ruleList = (page: Page): Locator =>
  panel(page).getByRole('list', { name: 'New zoning rules' }).getByRole('listitem');
const customList = (page: Page): Locator =>
  panel(page).getByRole('list', { name: 'Custom zoning' }).getByRole('listitem');

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

/**
 * From now on, each time the "Updating the simulation" pill shows, records the policy panel's and
 * the time bar's boxes at that moment (a MutationObserver, so a pill that shows briefly is still
 * measured).
 */
async function watchBoxesWhileUpdating(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Box = { x: number; y: number; width: number; height: number };
    const w = window as unknown as { __updatingBoxes?: { panel: Box; bar: Box }[] };
    const row = document.querySelector('[data-testid="fzp-lever-status"]')!;
    const box = (testid: string): Box => {
      const r = document.querySelector(`[data-testid="${testid}"]`)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    w.__updatingBoxes = [];
    new MutationObserver(() => {
      if (!(row.textContent ?? '').includes('Updating the simulation')) return;
      w.__updatingBoxes!.push({ panel: box('policy-panel'), bar: box('fzp-scrubber') });
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

test('/sim starts on the Family Zoning Plan; the score bar opens the score details', async ({
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

test('a transit rule resolves its lots and updates the levers', async ({ page }) => {
  await gotoSim(page);
  const before = await leverStatus(page);

  const form = await openBrushForm(page, 'Add a transit rule');
  await form.getByRole('checkbox', { name: /^Muni Metro/ }).check();
  await watchLeverNotices(page);
  await form.getByRole('button', { name: 'Save rule' }).click();

  await expect(ruleList(page)).toHaveCount(1);
  await expect(ruleList(page).first()).toContainText('Near Muni Metro');

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

test('a notice never moves the docked panel or the time bar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop rule; phones push content down by design');
  await gotoSim(page);
  const before = await leverStatus(page);
  const form = await openBrushForm(page, 'Add a transit rule');
  await form.getByRole('checkbox', { name: /^Muni Metro/ }).check();
  const panelBox = await panel(page).boundingBox();
  const barBox = await page.getByTestId('fzp-scrubber').boundingBox();
  await watchBoxesWhileUpdating(page);
  // Saving the rule sends a revision: the "Updating the simulation" pill shows until it is current.
  await form.getByRole('button', { name: 'Save rule' }).click();
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
  expect(await panel(page).boundingBox()).toEqual(panelBox);
  expect(await page.getByTestId('fzp-scrubber').boundingBox()).toEqual(barBox);
});

test('a Paint stroke adds a custom brush and Ctrl+Z removes it', async ({ isMobile, page }) => {
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Custom zoning');
  const paint = panel(page).getByRole('radio', { name: 'Paint', exact: true });
  await expect(paint).toBeEnabled();
  await chooseTool(page, isMobile, () => paint.click());
  await strokeOnce(page, isMobile);

  if (isMobile) {
    // Done goes back to Move and reopens the sheet.
    await page.getByTestId('phone-tool-bar').getByRole('button', { name: 'Done' }).click();
    await expect(panel(page)).toBeVisible();
  }
  await expect(customList(page)).toHaveCount(1);
  await expect(customList(page).first()).toContainText(/Allow \d+ stor/);
  if (isMobile) {
    await panel(page).getByRole('button', { name: 'Close policy' }).click();
    await expect(panel(page)).toBeHidden();
  }

  await page.keyboard.press('Control+z');
  await openPolicy(page);
  await expect(customList(page)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^Redo: / })).toBeEnabled();
});

test('a category protection shows the protections line in the score', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  const before = await leverStatus(page);
  await openPolicy(page);
  await expandSection(page, 'Protections');
  await panel(page).getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }).check();

  await expect
    .poll(async () => {
      const l = await leverStatus(page);
      return l.status === 'current' && (l.sentRev ?? -1) > (before.sentRev ?? -1);
    })
    .toBe(true);
  // The phone sheet is modal: close it to reach the score bar.
  if (isMobile) await panel(page).getByRole('button', { name: 'Close policy' }).click();
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

test('axe: the policy panel open', async ({ page }) => {
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'New zoning rules');
  await expandSection(page, 'Custom zoning');
  await expandSection(page, 'Protections');
  await expectNoA11yViolations(page);
});

// ---- Setup and Run (spec §1) ----------------------------------------------------------------------

test('Run locks the policy and Change policy returns to the present', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  expect(await fzp(page, 'runPhase')).toBe('setup');
  // The phone sheet is modal: Run sits under it, so it starts closed there.
  if (isMobile && (await panel(page).isVisible())) {
    await panel(page).getByRole('button', { name: 'Close policy' }).click();
  }
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('run');
  await expect
    .poll(() => fzp(page, 'day'), { timeout: 20_000 })
    .toBeGreaterThan(await fzp(page, 'asOf'));
  await openPolicy(page);
  const change = panel(page).getByRole('button', { name: 'Change policy' });
  await expect(change).toBeVisible();
  await expandSection(page, 'Protections');
  const rent = panel(page).getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' });
  await expect(rent).toBeDisabled();

  await change.click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('setup');
  await expect.poll(() => fzp(page, 'day')).toBe(await fzp(page, 'asOf'));
  expect(await fzp(page, 'playing')).toBe(false);
  await expect(rent).toBeEnabled();
  await expect(slider(page)).toBeDisabled();
});

test('axe: the policy panel open during a run', async ({ page }) => {
  await gotoSim(page, '/sim', { run: true });
  await openPolicy(page);
  await expect(panel(page).getByRole('button', { name: 'Change policy' })).toBeVisible();
  await expandSection(page, 'Protections');
  await expectNoA11yViolations(page);
});

test('axe: the Transit rule form open', async ({ page }) => {
  await gotoSim(page);
  const form = await openBrushForm(page, 'Add a transit rule');
  await expect(form.getByRole('group', { name: 'Bands' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a rule card has a Show on map toggle; pressed, the panel passes axe', async ({ page }) => {
  await gotoSim(page);
  const form = await openBrushForm(page, 'Add a transit rule');
  await form.getByRole('checkbox', { name: /^Muni Metro/ }).check();
  await form.getByRole('button', { name: 'Save rule' }).click();
  await expect(ruleList(page)).toHaveCount(1);
  const toggle = ruleList(page)
    .first()
    .getByRole('button', { name: /^Show on map/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
  await expandSection(page, 'Custom zoning');
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
  await expandSection(page, 'Custom zoning');
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

/** Run from Setup (the phone sheet, modal, closed first), until the run is on. */
async function pressRun(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile && (await panel(page).isVisible())) {
    await panel(page).getByRole('button', { name: 'Close policy' }).click();
  }
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => fzp(page, 'runPhase')).toBe('run');
}

test('Setup shows the height limits and transit; Run hides them; Change policy brings them back', async ({
  isMobile,
  page
}) => {
  await gotoSim(page);
  await expect.poll(() => deckIds(page), { timeout: 20_000 }).toContain(LIMITS_LAYER);
  await expect.poll(() => mapVisibility(page, 'transit-access')).toBe('visible');
  await expect(await headerAction(page, 'View')).toBeVisible();

  await pressRun(page, isMobile);
  await expect.poll(() => deckIds(page)).not.toContain(LIMITS_LAYER);
  await expect.poll(() => mapVisibility(page, 'transit-access')).toBe('none');
  await openHeaderMenu(page);
  await expect(viewButtons(page)).toHaveCount(0);

  await openPolicy(page);
  await panel(page).getByRole('button', { name: 'Change policy' }).click();
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

test('at 768 px the header fits in Setup and in Run, and the score stays put', async ({
  isMobile,
  page
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await gotoSim(page);
  await expect(page.getByRole('banner').getByRole('button', { name: 'View' })).toBeVisible();
  const setupCentre = await expectHeaderFits(page);
  await pressRun(page, isMobile);
  await expect(viewButtons(page)).toHaveCount(0);
  const runCentre = await expectHeaderFits(page);
  expect(Math.abs(runCentre - setupCentre)).toBeLessThanOrEqual(1);
});

// ---- outlines of painted lots while erasing (plan 2, Task 5) ---------------------------------------

test('the eraser outlines painted lots, only while chosen', async ({ isMobile, page }) => {
  const OUTLINE_LAYER = 'sim-painted-outline';
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Custom zoning');
  const tool = (name: string) => panel(page).getByRole('radio', { name, exact: true });
  await chooseTool(page, isMobile, () => tool('Paint').click());
  await strokeOnce(page, isMobile);
  if (isMobile) {
    await page.getByTestId('phone-tool-bar').getByRole('button', { name: 'Done' }).click();
    await expect(panel(page)).toBeVisible();
  }
  await expect(customList(page)).toHaveCount(1);
  expect(await deckIds(page)).not.toContain(OUTLINE_LAYER);

  await chooseTool(page, isMobile, () => tool('Erase').click());
  await expect.poll(() => deckIds(page)).toContain(OUTLINE_LAYER);

  if (isMobile) {
    await page.getByTestId('phone-tool-bar').getByRole('button', { name: 'Done' }).click();
    await expect(panel(page)).toBeVisible();
  } else {
    await tool('Move').click();
  }
  await expect.poll(() => deckIds(page)).not.toContain(OUTLINE_LAYER);
});

// ---- paint feedback (plan 2, Task 6) ---------------------------------------------------------------

test('a Paint stroke shows its buildings, then they fade', async ({ isMobile, page }) => {
  const isFeedback = (ids: string[]) => ids.some((id) => id.startsWith('sim-feedback-'));
  await gotoSim(page);
  await openPolicy(page);
  await expandSection(page, 'Custom zoning');
  const tool = (name: string) => panel(page).getByRole('radio', { name, exact: true });
  await chooseTool(page, isMobile, () => tool('Paint').click());
  await strokeOnce(page, isMobile);
  await expect.poll(async () => isFeedback(await deckIds(page)), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => isFeedback(await deckIds(page)), { timeout: 4_000 }).toBe(false);

  if (isMobile) {
    await page.getByTestId('phone-tool-bar').getByRole('button', { name: 'Done' }).click();
    await expect(panel(page)).toBeVisible();
  }
  await expect(customList(page)).toHaveCount(1);
  // An Erase stroke never adds one: sample the layers through the stroke and after it.
  await chooseTool(page, isMobile, () => tool('Erase').click());
  const seen: boolean[] = [];
  const sampling = (async () => {
    for (let k = 0; k < 20; k++) {
      seen.push(isFeedback(await deckIds(page)));
      await page.waitForTimeout(100);
    }
  })();
  await strokeOnce(page, isMobile);
  await sampling;
  expect(seen).not.toContain(true);
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
