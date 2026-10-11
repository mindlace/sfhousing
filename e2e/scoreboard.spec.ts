// Scoreboard e2e (scoreboard spec §6 E2E). Runs against the VITE_E2E build, which exposes
// window.__sfhBrush and window.__sfhMap and shortens the worker's chunk retries to 50/100/200 ms.
import { expect, test, type Page } from '@playwright/test';
import type { SfhBrushDebug } from '../src/lib/brush/debug';
import type { SfhMapDebug } from '../src/lib/map/debug';
import { expectNoA11yViolations } from './helpers/a11y';

type Win = Window & { __sfhMap?: SfhMapDebug; __sfhBrush?: SfhBrushDebug };
type LngLat = [number, number];

// fixture-0 holds one chunk (50_25) of 14 parcels around [-122.4186, 37.7601].
const FRAME = { center: [-122.4187, 37.76014] as LngLat, zoom: 18.5, pitch: 0, bearing: 0 };
const CHUNK = '**/data/fixture-0/parcels/50_25.json';
const FROM: LngLat = [-122.4193, 37.76014];
const TO: LngLat = [-122.418, 37.76014];

async function gotoEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 20_000
  });
  await page.waitForFunction(() => {
    const w = window as Win;
    return !!w.__sfhMap?.map && !!w.__sfhBrush?.ready;
  });
}

async function jumpAndIdle(page: Page, frame: typeof FRAME): Promise<void> {
  await page.evaluate(
    (f) =>
      new Promise<void>((resolve) => {
        const map = (window as Win).__sfhMap!.map!;
        map.once('idle', () => resolve());
        map.jumpTo(f);
      }),
    frame
  );
}

async function projectToPage(page: Page, lngLat: LngLat): Promise<[number, number]> {
  return page.evaluate((ll) => {
    const map = (window as Win).__sfhMap!.map!;
    const p = map.project(ll);
    const r = map.getCanvas().getBoundingClientRect();
    return [r.left + p.x, r.top + p.y] as [number, number];
  }, lngLat);
}

async function mouseDrag(page: Page, from: LngLat, to: LngLat, steps = 15): Promise<void> {
  const [x0, y0] = await projectToPage(page, from);
  const [x1, y1] = await projectToPage(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

const region = (page: Page) => page.getByRole('region', { name: 'Housing scoreboard' });

test.describe('scoreboard', () => {
  test.describe('desktop', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'chromium project only');

    test('paint: the net count turns nonzero within 150 ms of pointer-up', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      const net = page.getByTestId('score-net');
      await expect(net).toHaveText('0');

      // Record EVERY text change of the net readout, so the settled value's timestamp is known.
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="score-net"]')!;
        const w = window as unknown as { __netLog: { t: number; text: string }[] };
        w.__netLog = [];
        new MutationObserver(() => {
          const text = el.textContent?.trim() ?? '';
          const last = w.__netLog.at(-1);
          if (last?.text !== text) w.__netLog.push({ t: performance.now(), text });
        }).observe(el, { childList: true, characterData: true, subtree: true });
      });

      await mouseDrag(page, FROM, TO);
      await expect(net).not.toHaveText('0');
      // Settled: the readout is unchanged across 3 polls, >= 100 ms apart.
      let prev = '';
      let stable = 0;
      await expect
        .poll(
          async () => {
            const t = (await net.textContent())?.trim() ?? '';
            stable = t === prev ? stable + 1 : 0;
            prev = t;
            return stable;
          },
          { intervals: [100], timeout: 10_000 }
        )
        .toBeGreaterThanOrEqual(3);

      const { log, upAt } = await page.evaluate(() => {
        const marks = performance.getEntriesByName('sfh-brush-pointerup');
        return {
          log: (window as unknown as { __netLog: { t: number; text: string }[] }).__netLog,
          upAt: marks.length ? marks[marks.length - 1].startTime : undefined
        };
      });
      expect(upAt).toBeDefined();
      const final = log.at(-1)!;
      expect(final.text).not.toBe('0');
      // A change before pointer-up (a preview diff) clamps to 0; the final value must land ≤ 150 ms.
      const ms = Math.max(0, final.t - upAt!);
      test.info().annotations.push({ type: 'sfh-score-latency', description: `${ms} ms` });
      expect(ms).toBeLessThanOrEqual(150);
    });

    test('erase: erasing the painted path returns to the empty state', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      const net = page.getByTestId('score-net');
      await mouseDrag(page, FROM, TO);
      await expect(net).not.toHaveText('0');

      await page.getByRole('radio', { name: 'Erase' }).click();
      await mouseDrag(page, FROM, TO);
      await expect(net).toHaveText('0');
      await expect(region(page).getByText('Paint a height on the map to add homes.')).toBeVisible();
    });

    // eslint-disable-next-line playwright/expect-expect -- fixme placeholder, never runs
    test.fixme('W6: needs plan-sharing share links (W5c) to load a plan whose datasetVersion is absent from R2', async () => {
      // A share link with an absent dataset version shows the "recalculated" note.
    });

    test('a blocked chunk shows the warning, and Retry recovers', async ({ page }) => {
      await page.route(CHUNK, (r) => r.abort());
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);

      const warning = region(page).getByText("Some areas didn't load (1). Totals leave them out.");
      await expect(warning).toBeVisible({ timeout: 5_000 });

      await page.unroute(CHUNK);
      await region(page).getByRole('button', { name: 'Retry' }).click();
      await expect(warning).toBeHidden({ timeout: 5_000 });
    });

    test('axe: the scoreboard with both disclosures open', async ({ page }) => {
      await gotoEditor(page);
      await jumpAndIdle(page, FRAME);
      await mouseDrag(page, FROM, TO);
      await expect(page.getByTestId('score-net')).not.toHaveText('0');
      for (const d of await region(page).locator('details > summary').all()) await d.click();
      await expect(region(page).locator('details[open]')).not.toHaveCount(0);
      await expectNoA11yViolations(page);
    });
  });

  test.describe('mobile', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => !isMobile, 'mobile project only');

    test('axe: the scoreboard sheet open', async ({ page }) => {
      await gotoEditor(page);
      await region(page)
        .getByRole('button', { name: /net new homes/ })
        .tap();
      await expect(page.getByRole('group', { name: 'Scoreboard details' })).toBeVisible();
      await expectNoA11yViolations(page);
    });

    test('375 px: the brush bar sits on the scorebar; the open sheet covers it', async ({
      page
    }) => {
      await gotoEditor(page);
      const bar = region(page).getByRole('button', { name: /net new homes/ });
      const toolbar = page.locator('.brush-toolbar');
      const [barBox, toolBox] = await Promise.all([bar.boundingBox(), toolbar.boundingBox()]);
      expect(Math.abs(toolBox!.y + toolBox!.height - barBox!.y)).toBeLessThanOrEqual(1);

      await bar.tap();
      const sheet = page.getByRole('group', { name: 'Scoreboard details' });
      await expect(sheet).toBeVisible();
      const hit = await page.evaluate(
        ([x, y]) =>
          !!document
            .elementFromPoint(x, y)
            ?.closest('[role="group"][aria-label="Scoreboard details"]'),
        [toolBox!.x + toolBox!.width / 2, toolBox!.y + toolBox!.height / 2]
      );
      expect(hit).toBe(true);
    });
  });
});
