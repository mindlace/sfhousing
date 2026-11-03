// Scoreboard e2e (scoreboard spec §6 E2E, on the sim-ux layout): the score is the header's
// (`HeaderScore`, "{n} homes added" and the RHNA meter), and the scoreboard is the dock's Results
// face, which pressing the score shows. Runs against the VITE_E2E build, which exposes
// window.__sfhBrush and window.__sfhMap and shortens the worker's chunk retries to 50/100/200 ms.
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/a11y';
import {
  FRAME,
  FROM,
  TO,
  chooseTool,
  gotoEditor,
  headerNet,
  headerScore,
  jumpAndIdle,
  mouseDrag,
  oldVersionText,
  openResults,
  resultsFace,
  seedPlanRow,
  smallText,
  waitForMap,
  type Win
} from './helpers/sharing';

// fixture-0's chunk 50_25 holds 15 parcels around [-122.4186, 37.7601] (51_25: lots 15-17).
const CHUNK = '**/data/fixture-0/parcels/50_25.json';

/** The header score's text has settled: unchanged across 3 polls >= 100 ms apart. */
async function settled(page: Page): Promise<void> {
  let prev = '';
  let stable = 0;
  await expect
    .poll(
      async () => {
        const t = (await headerScore(page).textContent())?.trim() ?? '';
        stable = t === prev ? stable + 1 : 0;
        prev = t;
        return stable;
      },
      { intervals: [100], timeout: 10_000 }
    )
    .toBeGreaterThanOrEqual(3);
}

test.describe('scoreboard', () => {
  test.describe('desktop', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');

    test('paint: the header score turns nonzero within 150 ms of pointer-up', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await expect(headerScore(page)).toHaveText(/^0 homes/);

      // Record EVERY text change of the header score, so the settled value's timestamp is known.
      await page.evaluate(() => {
        const el = document.querySelector('header [data-testid="score-bar"]')!;
        const w = window as unknown as { __netLog: { t: number; text: string }[] };
        w.__netLog = [];
        new MutationObserver(() => {
          const text = el.textContent?.trim() ?? '';
          const last = w.__netLog.at(-1);
          if (last?.text !== text) w.__netLog.push({ t: performance.now(), text });
        }).observe(el, { childList: true, characterData: true, subtree: true });
      });

      await mouseDrag(page, FROM, TO);
      await expect.poll(() => headerNet(page)).toBeGreaterThan(0);
      await settled(page);

      const { log, upAt } = await page.evaluate(() => {
        const marks = performance.getEntriesByName('sfh-brush-pointerup');
        return {
          log: (window as unknown as { __netLog: { t: number; text: string }[] }).__netLog,
          upAt: marks.length ? marks[marks.length - 1].startTime : undefined
        };
      });
      expect(upAt).toBeDefined();
      const final = log.at(-1)!;
      expect(final.text).not.toMatch(/^0 homes/);
      // A change before pointer-up (a preview diff) clamps to 0; the final value must land ≤ 150 ms.
      const ms = Math.max(0, final.t - upAt!);
      test.info().annotations.push({ type: 'sfh-score-latency', description: `${ms} ms` });
      expect(ms).toBeLessThanOrEqual(150);
    });

    test('Results: the same number as the header, the neighbourhood list, then erase to empty', async ({
      page
    }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, FROM, TO);
      await expect.poll(() => headerNet(page)).toBeGreaterThan(0);
      await settled(page);
      const net = await headerNet(page);

      const results = await openResults(page);
      await expect(results.getByTestId('score-net')).toHaveText(net.toLocaleString('en-US'));
      await expect(results.getByTestId('target-rhna')).toBeVisible();
      // The header meter and the Results' primary row read the same percentage.
      const meterText = await page
        .getByRole('banner')
        .getByRole('meter')
        .getAttribute('aria-valuetext');
      await expect(results.getByTestId('target-rhna').getByRole('meter')).toHaveAttribute(
        'aria-valuetext',
        meterText!
      );
      await results.getByText('By neighborhood').click();
      await expect(results.getByTestId('hood-row').first()).toBeVisible();

      // Back to the Paint tab (the flip), erase the same path: the score empties.
      await page.getByRole('button', { name: 'Back to painting' }).click();
      await chooseTool(page, 'Erase');
      await mouseDrag(page, FROM, TO);
      await expect.poll(() => headerNet(page)).toBe(0);
      await openResults(page);
      await expect(resultsFace(page).getByTestId('score-net')).toHaveText('0');
      await expect(
        resultsFace(page).getByText('Paint a height on the map to add homes.')
      ).toBeVisible();
    });

    test('while parcels load, the header score is busy and Results says Updating…', async ({
      page
    }) => {
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route(CHUNK, async (r) => {
        await held;
        await r.continue();
      });
      await gotoEditor(page);
      const results = await openResults(page);
      await page.evaluate((f) => (window as Win).__sfhMap!.map!.jumpTo(f), FRAME);
      await expect(results.getByText('Updating…')).toBeVisible({ timeout: 10_000 });
      await expect(headerScore(page)).toHaveAttribute('aria-busy', 'true');
      release();
      await expect(results.getByText('Updating…')).toBeHidden({ timeout: 10_000 });
      await expect(headerScore(page)).toHaveAttribute('aria-busy', 'false');
    });

    test('a share link with a dataset version absent from R2 shows "recalculated"', async ({
      page,
      request
    }) => {
      const id = await seedPlanRow(request, {
        body: oldVersionText,
        datasetVersion: 'fixture-0000'
      });
      await page.goto(`/p/${id}`);
      await waitForMap(page);
      await expect.poll(() => headerNet(page)).toBeGreaterThan(0);
      await expect(await openResults(page)).toContainText(
        'plan made on data fixture-0000, recalculated on current data'
      );

      // Negative: a plan on the current dataset carries no such note.
      const res = await request.post('/api/plans', {
        data: smallText,
        headers: { 'content-type': 'application/json' }
      });
      expect(res.ok(), await res.text()).toBe(true);
      const { id: freshId } = (await res.json()) as { id: string };
      await page.goto(`/p/${freshId}`);
      await waitForMap(page);
      await expect.poll(() => headerNet(page)).toBeGreaterThan(0);
      await expect(await openResults(page)).not.toContainText('recalculated');
    });

    test('a blocked chunk shows the warning in Results, and Retry recovers', async ({ page }) => {
      await page.route(CHUNK, (r) => r.abort());
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);

      const results = await openResults(page);
      const warning = results.getByText("Some areas didn't load (1). Totals leave them out.");
      await expect(warning).toBeVisible({ timeout: 5_000 });

      await page.unroute(CHUNK);
      await results.getByRole('button', { name: 'Retry' }).click();
      await expect(warning).toBeHidden({ timeout: 5_000 });
    });

    test('axe: Results with both disclosures open', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, FROM, TO);
      await expect.poll(() => headerNet(page)).toBeGreaterThan(0);
      const results = await openResults(page);
      for (const d of await results.locator('details > summary').all()) await d.click();
      await expect(results.locator('details[open]')).toHaveCount(2);
      await expectNoA11yViolations(page);
    });
  });

  test.describe('mobile', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => !isMobile, 'mobile project only');

    test('axe: Results open in the sheet', async ({ page }) => {
      await gotoEditor(page);
      await headerScore(page).tap();
      await expect(resultsFace(page)).toBeVisible();
      await expectNoA11yViolations(page);
    });

    test('375 px: the score is in the header; it opens Results in the sheet and Paint flips back', async ({
      page
    }) => {
      await gotoEditor(page);
      const header = page.getByRole('banner');
      await expect(headerScore(page)).toBeVisible();
      await expect(headerScore(page)).toBeInViewport({ ratio: 1 });
      // No bar under the sheet: its handle sits on the map region's bottom.
      const handle = page.getByTestId('dock-handle');
      const region = (await page.locator('#map-region').boundingBox())!;
      const sheet = (await page.locator('.sfh-dock-sheet').boundingBox())!;
      expect(Math.abs(sheet.y + sheet.height - (region.y + region.height))).toBeLessThanOrEqual(1);

      await headerScore(page).tap();
      await expect(headerScore(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      await expect(resultsFace(page).getByTestId('score-net')).toBeVisible();
      // The sheet stays below the header and inside the map region.
      const open = (await page.locator('.sfh-dock-sheet').boundingBox())!;
      const h = (await header.boundingBox())!;
      expect(open.y).toBeGreaterThanOrEqual(h.y + h.height);
      expect(open.y + open.height).toBeLessThanOrEqual(region.y + region.height + 1);

      await page.getByRole('button', { name: 'Back to painting' }).tap();
      await expect(page.getByRole('radiogroup', { name: 'Brush tool' })).toBeVisible();
      await expect(headerScore(page)).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
