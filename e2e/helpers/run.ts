// /sim's Setup and Run phases (spec §1) for e2e: the page opens in Setup, the scrubber pinned at
// the present and disabled, so a test that scrubs, plays or presses a marker starts a run first.
import { expect, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../../src/lib/fzp/debug';

type FzpWin = Window & { __sfhFzp?: SfhFzpDebug };

export const slider = (page: Page): Locator =>
  page.getByRole('slider', { name: 'Date in the simulation' });

/**
 * Run, then Pause once it plays: the run waits paused, the day just past asOf (or at asOf if the
 * pause beat the first frame). It stays in Run: only a user jump to Today (Home, the Today marker)
 * returns to Setup, so a test that needs asOf in a run reads `__sfhFzp.day` instead.
 */
export async function startRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.playing), { timeout: 20_000 })
    .toBe(true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => {
    const f = (window as FzpWin).__sfhFzp!;
    return f.runPhase === 'run' && !f.playing;
  });
}
