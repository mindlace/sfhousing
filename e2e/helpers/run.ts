// /sim's Setup and Run phases (spec §1) for e2e: the page opens in Setup, the scrubber pinned at
// the present and disabled, so a test that scrubs, plays or presses a marker starts a run first.
import { expect, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../../src/lib/fzp/debug';

type FzpWin = Window & { __sfhFzp?: SfhFzpDebug };

export const slider = (page: Page): Locator =>
  page.getByRole('slider', { name: 'Date in the simulation' });

/** Run, then Pause once it plays, then Home on the slider: the run waits paused at asOf. */
export async function startRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.playing), { timeout: 20_000 })
    .toBe(true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await slider(page).focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => {
    const f = (window as FzpWin).__sfhFzp!;
    return f.day === f.asOf && !f.playing;
  });
}
