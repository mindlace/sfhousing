// The game on /sim end to end (game-sim, Task 9): the locked page at level 1, a level played to a
// win and levelled up, a tie that does not beat the bar, a second win in another month, zoning
// opening at level 4, given measures only at level 5, and the published view outside the game.
// Runs against the VITE_E2E build on fixture-0, with the real game switched on by
// e2e/helpers/game.ts before the first navigation; every wait is on `window.__sfhFzp` or the page.
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { PLUS_NAME } from '../src/lib/timeline/test/plus';
import { seedGame, seedGoalAmount } from './helpers/game';
import { addPolicy, openKind, slider, waitFilled } from './helpers/run';
import {
  FROM,
  TO,
  chooseTool,
  jumpAndIdle,
  mouseDrag,
  openPublish,
  type Win
} from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

/**
 * A goal amount current law meets inside the window on fixture-0. Read once from the fixture's
 * /sim with the default goal (82,069) and nothing in force: Details' goal row reads "82,065 to go"
 * at today (4 homes) and "81,408 to go, Held at Sep 2066" at the window's end (661 homes). Current
 * law passes 400 in about its 60th month.
 */
const WIN = 400;
/**
 * A goal amount "SB 423 approval clock" (added at today) meets in another month than current law
 * on fixture-0. Read once from the fixture's /sim: the goal's count by month (4 plus
 * `__sfhFzp.completedNet()`) with the empty policy and with the clock; 642 is first met in month
 * 183 with the clock and month 199 without it.
 */
const WIN_APART = 642;

const SB423 = 'SB 423 approval clock';
const BOND = 'A housing bond';
const MONTH = /Goal reached in ([A-Z][a-z]{2} \d{4})/;

// ---- helpers ------------------------------------------------------------------------------------

const fzp = <K extends keyof SfhFzpDebug>(page: Page, key: K): Promise<SfhFzpDebug[K]> =>
  page.evaluate((k) => (window as FzpWin).__sfhFzp![k], key) as Promise<SfhFzpDebug[K]>;

/** `path` loaded and hydrated, the session ready and the forecast filled. */
async function gotoSim(page: Page, path = '/sim'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

/** The number of refills the page has seen. */
const refillCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as FzpWin).__sfhFzp!.refills.length);

/** Waits for a refill after the `before`-th, and the forecast filled again. */
async function waitRefilled(page: Page, before: number): Promise<void> {
  await page.waitForFunction((n) => {
    const f = (window as FzpWin).__sfhFzp!;
    return f.refills.length > n && !f.stale && f.filledThrough === f.lastIndex;
  }, before);
}

/** The playhead to the window's end (the forecast filled first, so End is the last month). */
async function playToEnd(page: Page): Promise<void> {
  await waitFilled(page);
  await slider(page).focus();
  await page.keyboard.press('End');
}

const win = (page: Page): Locator => page.getByTestId('tl-win');
const editor = (page: Page): Locator => page.getByTestId('inspector');
const timeline = (page: Page): Locator => page.getByTestId('tl-timeline');

/** The win card's month ("Mar 2049"), once it shows. */
async function wonMonth(page: Page): Promise<string> {
  await expect(win(page)).toContainText('Goal reached in');
  const m = MONTH.exec((await win(page).textContent()) ?? '');
  expect(m, 'the win card names a month').not.toBeNull();
  return m![1];
}

/** Presses the card's "Level up" and waits for the clock back at today. */
async function levelUp(page: Page): Promise<void> {
  await win(page).getByRole('button', { name: 'Level up' }).click();
  await expect(win(page)).toHaveCount(0);
  await expect.poll(async () => (await fzp(page, 'day')) === (await fzp(page, 'asOf'))).toBe(true);
}

/** Closes the editor if it shows. */
async function closeEditor(page: Page): Promise<void> {
  const close = editor(page).getByRole('button', { name: 'Close editor' });
  if (await close.isVisible()) await close.click();
  await expect(editor(page)).toHaveCount(0);
}

/** A policy's rows (`tl-policy`) by its label. */
const policyRows = (page: Page, label: string): Locator =>
  page.getByTestId('tl-policy').filter({ hasText: label });
/** A policy's row; below md the open kind's sheet holds the last. */
const policyRow = (page: Page, label: string): Locator => policyRows(page, label).last();

/**
 * Shows Details. From md the header score has no aria-expanded and shows Details in the detail
 * column; below md it opens the sheet.
 */
async function openDetails(page: Page): Promise<Locator> {
  const score = page.getByTestId('score-bar');
  const details = page.getByTestId('tl-details');
  const expanded = await score.getAttribute('aria-expanded');
  if (expanded === null) {
    if (!(await details.isVisible())) await score.click();
  } else {
    if (expanded !== 'true') await score.click();
    await expect(score).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(details).toBeVisible();
  return details;
}

/** The zoning policies' painted areas in the document, counted. */
const paintedAreas = (page: Page): Promise<number> =>
  page.evaluate(() =>
    (window as FzpWin)
      .__sfhFzp!.policy.kinds.zoning.filter((p) => p.where.tag === 'painted')
      .flatMap((p) => p.spans)
      .reduce((n, s) => n + (s.what.tag === 'brushes' ? s.what.brushes.length : 0), 0)
  );

/** A second context on this project's device, with its own storage. */
async function otherPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const ctx = await browser.newContext({
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor
  });
  return ctx.newPage();
}

/** Publishes the page's policy and returns the `/s/<id>` path. */
async function publish(page: Page): Promise<string> {
  const opener = await openPublish(page);
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Publish this policy|Published/ });
  await expect(dialog.getByRole('heading', { name: 'Publish this policy' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByRole('heading', { name: 'Published' })).toBeVisible();
  const link = await dialog.getByLabel('Link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();
  const path = new URL(link).pathname;
  expect(path).toMatch(/^\/s\/[1-9A-HJ-NP-Za-km-z]{8}$/);
  return path;
}

// ---- levels -------------------------------------------------------------------------------------

test('level 1: /sim is locked', async ({ page }) => {
  await seedGame(page, 1);
  await page.goto('/sim');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  const locked = page.getByTestId('sim-locked');
  await expect(locked).toBeVisible();
  await locked.getByRole('link', { name: 'Go to Paint' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('level 2: nothing to add, play to a win, level up', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the kinds a level up adds open in place from md');
  await seedGame(page, 2);
  await seedGoalAmount(page, WIN);
  await gotoSim(page);

  for (const kind of ['Zoning', 'Permitting', 'Public money'] as const) {
    await expect(timeline(page).getByRole('button', { name: PLUS_NAME[kind] })).toHaveCount(0);
  }
  await expect(page.getByTestId('tl-kind-zoning').getByTestId('tl-locked-lane')).toHaveText(
    'Unlocks at level 4'
  );
  await expect(page.getByTestId('tl-kind-permitting').getByTestId('tl-locked-lane')).toHaveText(
    'Unlocks when you level up'
  );
  await expect(page.getByTestId('tl-kind-money').getByTestId('tl-locked-lane')).toHaveText(
    'Unlocks at level 5'
  );

  await playToEnd(page);
  const month = await wonMonth(page);
  await levelUp(page);

  const permitting = page.getByTestId('tl-kind-permitting');
  await expect(permitting.getByRole('button', { name: 'Permitting', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await expect(permitting.getByRole('button', { name: PLUS_NAME.Permitting })).toBeVisible();
  await expect(page.getByTestId('tl-bar-flag')).toBeVisible();
  await expect(page.getByTestId('tl-bar-flag')).toHaveText(/To beat/);
  const details = await openDetails(page);
  await expect(details.getByTestId('tl-to-beat')).toHaveText(`To beat: ${month}`);
});

test('level 2 to 3 without a change is a tie', async ({ page }) => {
  await seedGame(page, 2);
  await seedGoalAmount(page, WIN);
  await gotoSim(page);
  await playToEnd(page);
  await wonMonth(page);
  await levelUp(page);

  await playToEnd(page);
  await expect(page.getByTestId('tl-goal-notice')).toHaveText(/Beat .* to level up\./);
  await expect(win(page)).toHaveCount(0);
});

test('level 3: win, keep playing, win again elsewhere', async ({ page }) => {
  await seedGame(page, 3);
  await seedGoalAmount(page, WIN_APART);
  await gotoSim(page);

  let before = await refillCount(page);
  await addPolicy(page, 'Permitting', SB423);
  await closeEditor(page);
  await waitRefilled(page, before);
  await playToEnd(page);
  const first = await wonMonth(page);
  await win(page).getByRole('button', { name: 'Keep playing' }).click();
  await expect(win(page)).toHaveCount(0);

  // Remove the policy: an edit, so the seen result goes and the empty policy's comes.
  await openKind(page, 'Permitting');
  await policyRow(page, SB423).getByTestId('tl-bar').first().click();
  await expect(editor(page).getByRole('heading', { name: SB423 })).toBeVisible();
  before = await refillCount(page);
  await editor(page).getByRole('button', { name: 'Remove policy' }).click();
  await expect.poll(async () => (await fzp(page, 'policy')).kinds.permitting.length).toBe(0);
  await waitRefilled(page, before);
  await playToEnd(page);
  const second = await wonMonth(page);
  expect(second).not.toBe(first);
  await levelUp(page);
});

test('level 4: zoning opens, money stays locked', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a mouse stroke with the editor beside the map is md+');
  // The zoning height limits are the costliest overlay and this test never looks at them.
  await page.addInitScript(() =>
    localStorage.setItem('sfhousing:view', JSON.stringify({ heightLimits: false }))
  );
  await seedGame(page, 4);
  await gotoSim(page);
  await page.waitForFunction(() => !!(window as FzpWin).__sfhMap?.map);

  await addPolicy(page, 'Zoning', 'Painted area');
  await chooseTool(page, 'Paint');
  await jumpAndIdle(page);
  await mouseDrag(page, FROM, TO);
  await expect.poll(() => paintedAreas(page)).toBe(1);
  expect((await fzp(page, 'policy')).kinds.zoning).toHaveLength(1);
  await expect(page.getByTestId('tl-kind-money').getByTestId('tl-locked-lane')).toHaveText(
    'Unlocks when you level up'
  );
});

test('level 5: given measures only', async ({ page }) => {
  await seedGame(page, 5);
  await gotoSim(page);
  await openKind(page, 'Public money');
  await timeline(page).getByRole('button', { name: PLUS_NAME['Public money'] }).last().click();
  const menu = page.getByRole('group', { name: 'Add to Public money' });
  await expect(menu.getByRole('button', { name: BOND, exact: true })).toBeVisible();
  for (const name of ['Your own pool', 'City funding scale', 'Market terms']) {
    await expect(menu.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await menu.getByRole('button', { name: BOND, exact: true }).click();
  await expect.poll(async () => (await fzp(page, 'policy')).kinds.money.length).toBe(1);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('[data-funding-editor]')).toHaveCount(0);

  // The bar's box: its wrapper's left, a share of the window.
  const left = () =>
    policyRow(page, BOND)
      .getByTestId('tl-bar')
      .first()
      .locator('xpath=..')
      .evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const from = async () => (await fzp(page, 'policy')).kinds.money[0].spans[0].from;
  const wasLeft = await left();
  const wasFrom = await from();
  const year = editor(page).getByRole('combobox', { name: 'From year' });
  await year.selectOption(String(Number(await year.inputValue()) + 1));
  await expect.poll(from).toBeGreaterThan(wasFrom);
  await expect.poll(left).toBeGreaterThan(wasLeft);
});

// ---- the published view -------------------------------------------------------------------------

test('the published view is outside the game', async ({ page, browser }, testInfo) => {
  const author = await otherPage(browser, testInfo);
  let path: string;
  try {
    await gotoSim(author);
    await addPolicy(author, 'Zoning', 'Transit rule');
    await closeEditor(author);
    path = await publish(author);
  } finally {
    await author.context().close();
  }

  await seedGame(page, 2);
  await gotoSim(page, path);
  await openKind(page, 'Zoning');
  await expect(policyRows(page, 'Transit rule')).not.toHaveCount(0);
  for (const row of await policyRows(page, 'Transit rule').all())
    await expect(row).not.toHaveAttribute('data-locked');
  await expect(page.getByTestId('tl-locked-lane')).toHaveCount(0);
  await expect(page.getByTestId('tl-bar-flag')).toHaveCount(0);
});

test('a given measure publishes and runs in the view', async ({ page, browser }, testInfo) => {
  const author = await otherPage(browser, testInfo);
  let path: string;
  try {
    await seedGame(author, 5);
    await gotoSim(author);
    await addPolicy(author, 'Public money', BOND);
    await closeEditor(author);
    path = await publish(author);
  } finally {
    await author.context().close();
  }

  await seedGame(page, 3);
  await gotoSim(page, path);
  await openKind(page, 'Public money');
  await expect(policyRows(page, BOND)).not.toHaveCount(0);
  for (const row of await policyRows(page, BOND).all())
    await expect(row).not.toHaveAttribute('data-locked');
  expect((await fzp(page, 'policy')).kinds.money[0].preset).toBe('housing-bond');
});
