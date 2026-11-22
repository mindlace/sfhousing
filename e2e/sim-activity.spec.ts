// /sim's Activity (timeline-ui, "Activity"): the detail column at rest from md, reached from
// Details' button in the phone sheet. At today it names the goal and offers three starter policies
// that add as the "+" menu does; after Play it shows the totals so far, agreeing with the header.
// Empty kinds say what "+" adds. axe in light and dark at both widths. fixture-0, the VITE_E2E
// build's debug hooks, never pixels.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, slider, waitFilled } from './helpers/run';
import { gotoHydrated, openHeaderMenu, type Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

async function gotoSim(
  page: Page,
  opts: { colorScheme?: 'light' | 'dark'; motion?: 'reduce' | 'no-preference' } = {}
): Promise<void> {
  await page.emulateMedia({
    reducedMotion: opts.motion ?? 'reduce',
    colorScheme: opts.colorScheme ?? 'light'
  });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
const activity = (page: Page): Locator => page.getByTestId('tl-activity');
const details = (page: Page): Locator => page.getByTestId('tl-details');
const editor = (page: Page): Locator => page.getByTestId('inspector');
const policyCount = (page: Page) =>
  page.evaluate(() => {
    const p = (window as FzpWin).__sfhFzp!.policy;
    return p.kinds.zoning.length + p.kinds.permitting.length + p.kinds.money.length;
  });

/** Activity in view: the column at rest from md; below md the headline, then Details' button. */
async function showActivity(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await expect(activity(page)).toHaveCount(0);
    await scoreBar(page).click();
    await details(page).getByRole('button', { name: 'Activity', exact: true }).click();
    await expect
      .poll(() => activity(page).evaluate((el) => el === document.activeElement))
      .toBe(true);
  }
  await expect(activity(page)).toBeVisible();
}

test('a first visit: Activity names the goal and three starters; one adds a policy', async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  await showActivity(page, isMobile);
  await expect(activity(page).getByRole('heading', { level: 2, name: 'Activity' })).toBeVisible();
  await expect(activity(page)).toContainText(/Goal: [\d,]+ homes by \w{3} \d{4}/);
  const starters = activity(page).getByRole('list', { name: 'Try one:' }).getByRole('button');
  await expect(starters).toHaveText([
    'Taller near transit',
    'SB 423 approval clock',
    'A housing bond'
  ]);
  expect(await policyCount(page)).toBe(0);
  await starters.filter({ hasText: 'SB 423 approval clock' }).click();
  await expect(editor(page).getByRole('heading', { level: 2 })).toHaveText('SB 423 approval clock');
  expect(await policyCount(page)).toBe(1);
  // The permitting preset, as the "+" menu adds it (undo and the announcement: SimPage's spec).
  const presets = await page.evaluate(() =>
    (window as FzpWin).__sfhFzp!.policy.kinds.permitting.map((p) => p.preset)
  );
  expect(presets).toEqual(['sb423Clock']);
});

test('after Play the totals show and the starters go', async ({ page, isMobile }) => {
  await gotoSim(page, { motion: 'no-preference' });
  await showActivity(page, isMobile);
  await expect(activity(page).getByText('Try one:')).toBeVisible();
  const asOf = await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf);
  const play = page.getByTestId('tl-play');
  await play.click();
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a, asOf);
  await play.click();
  await expect.poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.playing)).toBe(false);
  await expect(activity(page).getByText('Try one:')).toHaveCount(0);
  const totals = activity(page).getByTestId('tl-totals');
  await expect(totals).toBeVisible();
  await expect(totals.locator('dt')).toHaveText([
    'Approved in new projects',
    'Completed',
    'Stopped',
    'Affordable'
  ]);
  // Completed is the header's homes at the same month.
  const headline = await page.getByTestId('score-bar').textContent();
  const homes = headline!.match(/^([\d,]+) homes? by /)![1];
  await expect(totals.locator('div').filter({ hasText: 'Completed' }).locator('dd')).toHaveText(
    homes
  );
});

test('the empty lanes say what they add; the words add a policy', async ({ page }) => {
  await gotoSim(page);
  const words = page.getByTestId('tl-empty-lane');
  await expect(words).toHaveText([
    'Add a zoning change',
    'Add a permitting change',
    'Add public money'
  ]);
  for (const w of await words.all()) {
    await expect(w).toHaveAttribute('aria-hidden', 'true');
    await expect(w).toHaveAttribute('tabindex', '-1');
  }
  await page.getByTestId('tl-kind-money').getByTestId('tl-empty-lane').click();
  const menu = page.getByRole('group', { name: 'Add to Public money' });
  await expect(menu).toBeVisible();
  // Focus is where a press of the "+" leaves it (the "+"), never on the hidden words.
  await expect(page.getByRole('button', { name: 'Add public money' })).toBeFocused();
});

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];
/** "Mar 2031" as a month count (year × 12 + month), from an item's last words. */
const monthOfText = (t: string): number => {
  const m = t.match(/(\w{3}) (\d{4})$/)!;
  return Number(m[2]) * 12 + MONTH_NAMES.indexOf(m[1]);
};
/** A Day's month count, as monthOfText. */
const monthOfDay = (d: number): number => {
  const at = new Date(d * 86_400_000);
  return at.getUTCFullYear() * 12 + at.getUTCMonth();
};
const latest = (page: Page): Locator =>
  activity(page).getByRole('list', { name: 'Latest' }).getByRole('listitem');
const itemTexts = async (page: Page): Promise<string[]> =>
  (await latest(page).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());

test('mid-play the list names stage changes up to the playhead; Home empties it', async ({
  page,
  isMobile
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await gotoSim(page);
  await showActivity(page, isMobile);
  const asOf = await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf);
  // Two years on (Day > asOf + 700): the window is filled, so the feed is whole.
  await slider(page).focus();
  for (let k = 0; k < 2; k++) await page.keyboard.press('PageUp');
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a + 700, asOf);
  const day = await page.evaluate(() => (window as FzpWin).__sfhFzp!.day);
  await expect(activity(page).getByRole('heading', { level: 3, name: 'Latest' })).toBeVisible();
  await expect.poll(() => latest(page).count()).toBeGreaterThan(0);
  const texts = await itemTexts(page);
  expect(texts.length).toBeLessThanOrEqual(6);
  const months = texts.map(monthOfText);
  for (const [i, t] of texts.entries()) {
    expect(t).toMatch(/^(◆Under your policy )?(Approved|Building|Completed) [\d,]+ homes? /);
    // After today and at or before the playhead, newest first.
    expect(months[i]).toBeGreaterThanOrEqual(monthOfDay(asOf));
    expect(months[i]).toBeLessThanOrEqual(monthOfDay(day));
  }
  expect(months).toEqual([...months].sort((a, b) => b - a));
  // Each item is one line.
  const heights = await latest(page).evaluateAll((li) => li.map((e) => e.clientHeight));
  expect(new Set(heights).size).toBe(1);
  // Home: at today the list goes with the totals.
  await page.keyboard.press('Home');
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day === a, asOf);
  await expect(activity(page).getByRole('heading', { level: 3 })).toHaveCount(0);
  await expect(latest(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

/**
 * From the playhead, a month at a time back (at most `steps`), until a listed project is under
 * the person's policy; true when one is.
 */
async function backToAMark(page: Page, steps: number): Promise<boolean> {
  const marked = latest(page).filter({ hasText: 'Under your policy' });
  for (let k = 0; k <= steps; k++) {
    const day = await page.evaluate(() => (window as FzpWin).__sfhFzp!.day);
    await expect(activity(page).getByRole('heading', { level: 3, name: 'Latest' })).toBeVisible();
    if ((await marked.count()) > 0) return true;
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((d) => (window as FzpWin).__sfhFzp!.day < d, day);
  }
  return false;
}

/** Back to Activity after an edit: from md the editor closes (Escape); below md the sheet. */
async function activityAfterEdit(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile) await page.keyboard.press('Escape');
  await showActivity(page, isMobile);
}

test('a transit rule from today: a listed project under it carries the mark', async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  await slider(page).focus();
  await page.keyboard.press('Home');
  const refills = await page.evaluate(() => (window as FzpWin).__sfhFzp!.refills.length);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await page.waitForFunction((n) => (window as FzpWin).__sfhFzp!.refills.length > n, refills);
  await waitFilled(page);
  await activityAfterEdit(page, isMobile);
  // From the end, a month at a time back, until a listed project is under the rule.
  await slider(page).focus();
  await page.keyboard.press('End');
  const last = await page.evaluate(() => (window as FzpWin).__sfhFzp!.lastIndex);
  expect(await backToAMark(page, last)).toBe(true);
  const item = latest(page).filter({ hasText: 'Under your policy' }).first();
  // The glyph is hidden from AT; the words say it.
  await expect(item.locator('[aria-hidden=true]')).toHaveText('◆');
  await expect(item.locator('.sr-only')).toHaveText('Under your policy');
});

/** A client navigation to /sim from /about, so the browser fetches what a route can fail. */
async function simFromAbout(page: Page): Promise<void> {
  await gotoHydrated(page, '/about');
  await openHeaderMenu(page);
  await page.getByRole('banner').getByRole('link', { name: 'Simulate', exact: true }).click();
  await expect(page).toHaveURL(/\/sim$/);
}
const radius = (loc: Locator) =>
  loc.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));

test('the no-scenario message is a card; a load failure is a chip with Retry', async ({ page }) => {
  await page.route('**/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    delete manifest.scenarios;
    await route.fulfill({ response, json: manifest });
  });
  await simFromAbout(page);
  const status = page.getByTestId('fzp-status');
  await expect(status).toContainText("isn't available for dataset fixture-0");
  await expect(status).toHaveAttribute('data-shape', 'card');
  expect(await radius(status)).toBe(8);
  // The link sits under the words.
  const link = status.getByRole('link', { name: 'Go to the editor' });
  const words = status.getByText(/isn't available/);
  expect((await link.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await words.boundingBox())!.y + (await words.boundingBox())!.height
  );

  await page.unroute('**/manifest.json');
  await page.route('**/scenarios/fzp/calibration.json', (route) => route.fulfill({ status: 500 }));
  await simFromAbout(page);
  const failed = page.getByTestId('fzp-status');
  await expect(failed).toHaveText("The simulation couldn't load.");
  await expect(failed).toHaveAttribute('role', 'alert');
  const chip = page.locator('[data-shape=chip]').filter({ has: failed });
  await expect(chip).toHaveCount(1);
  expect(await radius(chip)).toBeGreaterThan(8);
  await expect(chip.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

/** At 1280x800 a transit rule and a housing bond in force, mid-play (three years on), filled. */
async function midPlayWithTwo(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await page.keyboard.press('Escape');
  await addPolicy(page, 'Public money', 'A housing bond');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await waitFilled(page);
  const asOf = await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf);
  await slider(page).focus();
  for (let k = 0; k < 3; k++) await page.keyboard.press('PageUp');
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a + 1000, asOf);
  await waitFilled(page);
  await expect(activity(page).getByTestId('tl-totals')).toBeVisible();
}

const column = (page: Page): Locator => page.getByTestId('tl-inspector');

test('1280×800 mid-play with a transit rule and a bond: at least four Latest items are inside the column', async ({
  page,
  isMobile
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- one layout per project
  test.skip(isMobile, 'the desktop column');
  await midPlayWithTwo(page);
  await expect(latest(page)).toHaveCount(6);
  // Latest first, then the totals.
  const order = await activity(page).evaluate((a) => {
    const h3 = a.querySelector('h3')!;
    const dl = a.querySelector('[data-testid=tl-totals]')!;
    return Boolean(h3.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  const inside = await column(page).evaluate((col) => {
    col.scrollTop = 0;
    const c = col.getBoundingClientRect();
    return [...col.querySelectorAll('ol li')].filter((li) => {
      const r = li.getBoundingClientRect();
      return r.top >= c.top && r.bottom <= c.bottom;
    }).length;
  });
  expect(inside).toBeGreaterThanOrEqual(4);
});

/** The column's cue (`moreBelow`): data-more, and its ::after's opacity, height and colour. */
const cue = (col: Locator) =>
  col.evaluate((el) => {
    const a = getComputedStyle(el, '::after');
    return {
      more: el.hasAttribute('data-more'),
      opacity: a.opacity,
      height: a.height,
      color: a.backgroundColor,
      events: a.pointerEvents
    };
  });

test("the column's fade shows while more is below and goes at the end; under forced colours it is a line", async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  await slider(page).focus();
  await page.keyboard.press('End');
  await waitFilled(page);
  await showActivity(page, isMobile);
  // After today Details is longer than the column, and than the phone's sheet.
  await activity(page).getByRole('button', { name: 'Details', exact: true }).click();
  await expect(details(page)).toBeVisible();
  const col = column(page);
  expect(await col.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect
    .poll(() => cue(col))
    .toMatchObject({ more: true, opacity: '1', height: '24px', events: 'none' });
  await col.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => cue(col)).toMatchObject({ more: false, opacity: '0' });
  // Under forced colours: a 2 px CanvasText line at the foot while more is below.
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await col.evaluate((el) => (el.scrollTop = 0));
  const canvasText = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'CanvasText';
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  await expect
    .poll(() => cue(col))
    .toMatchObject({ more: true, opacity: '1', height: '2px', color: canvasText });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Activity: axe clean, ${scheme}, at today and after Play`, async ({ page, isMobile }) => {
    await gotoSim(page, { colorScheme: scheme });
    await showActivity(page, isMobile);
    await expect(activity(page).getByText('Try one:')).toBeVisible();
    await expectNoA11yViolations(page, {
      include: ['[data-testid=tl-inspector]', '[data-testid=tl-dock]']
    });
    await page.getByRole('slider', { name: 'Date in the simulation' }).focus();
    await page.keyboard.press('End');
    await waitFilled(page);
    await expect(activity(page).getByTestId('tl-totals')).toBeVisible();
    await expectNoA11yViolations(page, { include: ['[data-testid=tl-inspector]'] });
  });
}
