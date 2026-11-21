// /sim's pool levels (timeline-ui, "A pool's bar shows its level"): with A housing bond added, its
// bar in the open Public money kind shows no level until its money arrives and drains after Play;
// the bar's name carries ", N% left" at the playhead's month. axe on the rows, light and dark.
// fixture-0, the VITE_E2E build's debug hooks, never pixels. Below md the kind is a sheet over an
// inert timeline, so the playhead moves with the sheet closed.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, openKind, slider, waitFilled } from './helpers/run';
import type { Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

async function gotoSim(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
  await page.goto('/sim');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

/** A housing bond, as the starter and the "+" menu add it, filled, its editor closed. */
async function addBond(page: Page): Promise<void> {
  await addPolicy(page, 'Public money', 'A housing bond');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await waitFilled(page);
}

/** The bond's bar, Public money open. */
async function bondBar(page: Page): Promise<Locator> {
  await openKind(page, 'Public money');
  return page.getByTestId('tl-kind-money').getByTestId('tl-bar').last();
}

/** Below md: the kind's sheet closed, so the playhead can move. */
async function closeSheet(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile) return;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Public money' })).toHaveCount(0);
}

test('a housing bond: no level before its money arrives; after Play its bar drains', async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  await addBond(page);
  let bar = await bondBar(page);
  // At today: no level, no words.
  await expect(bar.getByTestId('tl-level')).toHaveAttribute('data-left', '');
  await expect(bar).not.toHaveAttribute('aria-label', /left$/);
  await closeSheet(page, isMobile);
  // Play past the bond's money: its level shows, and its words say the same number.
  const arrival = await page.evaluate(() => {
    const p = (window as FzpWin).__sfhFzp!.policy.kinds.money[0].spans[0].what;
    return p.tag === 'fund' && p.pool?.inflows[0].kind === 'once' ? p.pool.inflows[0].day : 0;
  });
  expect(arrival).toBeGreaterThan(0);
  await page.getByTestId('tl-speed').click();
  const play = page.getByTestId('tl-play');
  await play.click();
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a + 365, arrival);
  await play.click();
  await expect.poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.playing)).toBe(false);
  bar = await bondBar(page);
  const level = bar.getByTestId('tl-level');
  await expect(level).toHaveAttribute('data-left', /^\d+$/);
  let left = await level.getAttribute('data-left');
  await expect(bar).toHaveAttribute('aria-label', new RegExp(`, ${left}% left$`));
  await expect(bar).toHaveText(new RegExp(`, ${left}% left$`));
  // At the computed edge (End) the bond has been drawn on: below 100.
  await closeSheet(page, isMobile);
  await slider(page).focus();
  await page.keyboard.press('End');
  bar = await bondBar(page);
  await expect(level).toHaveAttribute('data-left', /^\d+$/);
  left = await level.getAttribute('data-left');
  expect(Number(left)).toBeLessThan(100);
  await expect(bar).toHaveAttribute('aria-label', new RegExp(`, ${left}% left$`));
  await expect(bar).toHaveText(new RegExp(`, ${left}% left$`));
  // Home: at today, nothing again.
  await closeSheet(page, isMobile);
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.day))
    .toBe(await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf));
  bar = await bondBar(page);
  await expect(bar.getByTestId('tl-level')).toHaveAttribute('data-left', '');
  await expect(bar).not.toHaveAttribute('aria-label', /left$/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Public money rows with levels: axe clean, ${scheme}`, async ({ page }) => {
    await gotoSim(page, scheme);
    await addBond(page);
    await slider(page).focus();
    await page.keyboard.press('End');
    const bar = await bondBar(page);
    await expect(bar.getByTestId('tl-level')).toHaveAttribute('data-left', /^\d+$/);
    await expectNoA11yViolations(page, { include: ['[data-testid=tl-timeline]'] });
  });
}
