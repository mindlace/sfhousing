// Wall-clock budget: not in test:e2e or signoff. `npm run test:perf` runs it alone, one worker,
// on an idle machine (SFH_E2E_PERF=1, see playwright.config.ts). Moved here from
// e2e/fzp-sim.spec.ts (timeline-ui Task 17): signoff tests assert behaviour and order, not time.
import { expect, test } from '@playwright/test';
import type { SfhFzpDebug } from '../../src/lib/fzp/debug';

type FzpWin = Window & { __sfhFzp?: SfhFzpDebug };

test('the first forecast month arrives within 3 s of navigation', async ({ page }) => {
  const start = Date.now();
  await page.goto('/sim', { waitUntil: 'commit' });
  await page.waitForFunction(() => ((window as FzpWin).__sfhFzp?.filledThrough ?? -1) >= 0, null, {
    polling: 50
  });
  expect(Date.now() - start).toBeLessThan(3_100);
});
