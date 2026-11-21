// /sim's Details (timeline-ui, "Details"): the headline opens it, focused; its Chart switch redraws
// the one timeline chart and closing Details puts Homes back; the goal rows hold at the deadline;
// axe in light and dark at both widths. fixture-0, the VITE_E2E build's debug hooks, never pixels.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, slider, waitFilled } from './helpers/run';
import type { Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

async function gotoSim(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

const scoreBar = (page: Page): Locator => page.getByTestId('score-bar');
const details = (page: Page): Locator => page.getByTestId('tl-details');
const editor = (page: Page): Locator => page.getByTestId('inspector');
/** The one timeline chart's figure; `data-lens` is the lens drawn. */
const chart = (page: Page): Locator => page.getByTestId('tl-lanes').getByRole('figure');

/** Presses the headline and waits for Details (the column from md, the sheet below). */
async function openDetails(page: Page): Promise<void> {
  await scoreBar(page).click();
  await expect(details(page)).toBeVisible();
}

test('the headline opens Details, focused; it names no RHNA', async ({ page, isMobile }) => {
  await gotoSim(page);
  await addPolicy(page, 'Zoning', 'Transit rule');
  await expect(editor(page)).toBeVisible();
  await openDetails(page);
  await expect(editor(page)).toHaveCount(0);
  await expect(details(page).getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  if (isMobile) {
    await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'true');
  } else {
    await expect(scoreBar(page)).not.toHaveAttribute('aria-expanded');
    await expect
      .poll(() => details(page).evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
  }
  // Sources open, the text as shown. The closed "Homes by income level" panel cites its source
  // documents by their published names (hashed finance-score labels); Details' own words never
  // say RHNA.
  for (const summary of await details(page).locator('details > summary').all())
    await summary.click();
  await expect(details(page).getByTestId('fzp-sources')).toHaveAttribute('open', '');
  const shown = await details(page).innerText();
  expect(shown).not.toMatch(/RHNA/);
  expect(shown).not.toMatch(/\bFZP\b/);
});

test('By source redraws the timeline chart; closing Details puts Homes back', async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  await openDetails(page);
  await expect(chart(page)).toHaveAttribute('data-lens', 'homes');
  await details(page).getByRole('radio', { name: 'By source' }).check();
  await expect(chart(page)).toHaveAttribute('data-lens', 'source');
  await expect(chart(page)).toHaveAccessibleName('By source');
  if (isMobile) {
    // The headline again closes the sheet.
    await scoreBar(page).click();
    await expect(scoreBar(page)).toHaveAttribute('aria-expanded', 'false');
  } else {
    // A policy's editor takes the column.
    await addPolicy(page, 'Zoning', 'Transit rule');
    await expect(editor(page)).toBeVisible();
  }
  await expect(details(page)).toHaveCount(0);
  await expect(chart(page)).toHaveAttribute('data-lens', 'homes');
});

test('past the deadline the goal rows say Held at Jan 2031', async ({ page }) => {
  await gotoSim(page);
  await openDetails(page);
  await slider(page).focus();
  await page.keyboard.press('End');
  await waitFilled(page);
  await expect(details(page).getByTestId('goal-row-goal')).toContainText('Held at Jan 2031');
  await expect(details(page).getByTestId('goal-row-buffer')).toContainText('Held at Jan 2031');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Details: axe clean, ${scheme}, with a policy, mid-play, the table open`, async ({
    page
  }) => {
    await gotoSim(page, scheme);
    await addPolicy(page, 'Zoning', 'Transit rule');
    await waitFilled(page);
    await openDetails(page);
    await slider(page).focus();
    await page.keyboard.press('End');
    await page.keyboard.press('PageDown');
    await waitFilled(page);
    await details(page).getByText('Show as table').click();
    await expect(
      details(page).getByRole('table', { name: 'Homes by year, from today' })
    ).toBeVisible();
    await expect(details(page).getByRole('radio', { name: 'From your policy' })).toBeVisible();
    await expectNoA11yViolations(page, { include: ['[data-testid=tl-inspector]'] });
  });
}
