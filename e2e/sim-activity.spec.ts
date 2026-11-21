// /sim's Activity (timeline-ui, "Activity"): the detail column at rest from md, reached from
// Details' button in the phone sheet. At today it names the goal and offers three starter policies
// that add as the "+" menu does; after Play it shows the totals so far, agreeing with the header.
// Empty kinds say what "+" adds. axe in light and dark at both widths. fixture-0, the VITE_E2E
// build's debug hooks, never pixels.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { waitFilled } from './helpers/run';
import type { Win } from './helpers/sharing';

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
  await expect(activity(page)).toContainText(/State target: [\d,]+ homes by \w{3} \d{4}/);
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
  await expect(totals.locator('dt')).toHaveText(['Approved', 'Completed', 'Stopped', 'Affordable']);
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
  await expect(page.getByRole('group', { name: 'Add to Public money' })).toBeVisible();
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
