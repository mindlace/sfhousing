// bench:map cases for the game's runs (closing spec, sec-design-bench; docs/dev/map-perf.md):
//  1. a run with drops on the run view (the whole city, flat), with the pointer moving over the
//     run layer the whole time: rAF frame-time p50/p95 from the press of Run to the run's end;
//     passes at p95 <= 16.7 ms;
//  2. the wait from a purchase (stop-rail) to the next run's forecast being ready: the time from
//     the press of Buy until Run's aria-busy clears, three fresh contexts, their median. No bar.
// Lines start `bench:map`. Needs a display.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PRICES } from '../../src/lib/game/catalogue/tuning';
import { seedGame } from '../helpers/game';
import { runLayer, runTotals, waitPhase } from '../helpers/play';
import { waitFilled } from '../helpers/run';
import { BAR_MS, pct, verdict } from './bench-util';

/** The live dataset under bench (`playwright.bench.config.ts`), else fixture-0. */
const DATASET = process.env.SFH_BENCH_DATASET ?? 'fixture-0';
/** Samples of the purchase case, each from a fresh context. */
const BUY_REPS = 3;
/** The node bought: shown at rung 0, and a zoning purchase is the slowest kind. */
const NODE = 'stop-rail';

/**
 * `CLOCK.buyS` of the balance script, read from its text: importing it would load
 * `catalogue/play.ts` and so `nodes.ts`, which no e2e file imports.
 */
function readBuyS(): number {
  const text = readFileSync(new URL('../../scripts/tree-balance.ts', import.meta.url), 'utf8');
  const m = /export const CLOCK = \{[^}]*\bbuyS: (\d+(?:\.\d+)?)/.exec(text);
  if (!m) throw new Error('bench: CLOCK.buyS not found in scripts/tree-balance.ts');
  return Number(m[1]);
}

async function waitMapReady(page: Page): Promise<void> {
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
    timeout: 30_000
  });
}

async function rendererOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const r = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  });
}

// ---- 1. a run with drops, citywide, moving pointer -------------------------------------------------

test('bench:map: run with drops, citywide, moving pointer', async ({ page }) => {
  // No goal amount and no run time: the run as a player has it.
  await seedGame(page, { phase: 'runs', runs: 1 });
  await page.goto('/');
  await waitMapReady(page);
  await waitFilled(page);
  await waitPhase(page, 'tree');

  const renderer = await rendererOf(page);
  const dpr = await page.evaluate(() => devicePixelRatio);

  await page.getByTestId('tree-run').click();
  const layer = runLayer(page);
  // The forecast may still be readying after the press (starting): wait for the run itself.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="run-layer"]')?.getAttribute('data-state') === 'running'
  );
  await expect(layer).toHaveAttribute('data-state', 'running');
  const found = await layer.boundingBox();
  expect(found, 'bench: the run layer has no box').not.toBeNull();
  const box = found!;

  // Every rAF delta until the layer is idle again (the run's end).
  let done = false;
  const recorded = page
    .evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          let last = -1;
          const step = (t: number) => {
            if (last >= 0 && t > last) out.push(t - last);
            last = t;
            const el = document.querySelector('[data-testid="run-layer"]');
            if (!el || el.getAttribute('data-state') === 'idle') return resolve(out);
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        })
    )
    .finally(() => {
      done = true;
    });

  // Meanwhile the pointer moves along a figure over the layer, one move after another.
  const start = Date.now();
  while (!done) {
    const t = (Date.now() - start) / 1000;
    const x = box.x + box.width * (0.5 + 0.4 * Math.sin((2 * Math.PI * t) / 3.1));
    const y = box.y + box.height * (0.5 + 0.4 * Math.sin((2 * Math.PI * t) / 2.3));
    await page.mouse.move(x, y);
  }
  const deltas = await recorded;
  const { dropped, collected } = await runTotals(page);

  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = pct(sorted, 50);
  const p95 = pct(sorted, 95);
  const line =
    `bench:map case=run dataset=${DATASET} frames=${deltas.length} dropped=${dropped} ` +
    `collected=${collected} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms bar=${BAR_MS}ms ` +
    `${verdict(p95)} dpr=${dpr} renderer="${renderer}"`;
  console.log(line);
  test.info().annotations.push({ type: 'bench:map', description: line });
  expect(p95, line).toBeLessThanOrEqual(BAR_MS);
});

// ---- 2. purchase to ready --------------------------------------------------------------------------

type BuyWin = Window & {
  __buy?: { armed: boolean; seenBusy: boolean; t0: number | null; t1: number | null };
};

test('bench:map: purchase to ready', async ({ browser, baseURL }) => {
  const buyS = readBuyS();
  const samples: number[] = [];
  for (let rep = 0; rep < BUY_REPS; rep++) {
    // A fresh context per sample: an empty cache and storage, as a person's first visit has.
    const ctx = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2
    });
    const page = await ctx.newPage();
    await seedGame(page, { phase: 'runs', runs: 1, units: { home: PRICES[NODE][0] } });
    await page.goto('/');
    await waitMapReady(page);
    await waitFilled(page);
    await waitPhase(page, 'tree');

    const run = page.getByTestId('tree-run');
    await page
      .locator(`[data-testid="tree-node"][data-node="${NODE}"]`)
      .getByTestId('tree-node-open')
      .first()
      .click();
    const buy = page.getByTestId('tree-detail').getByTestId('tree-buy');
    await expect(buy).toBeEnabled();

    // The observer goes in first: t1 is when aria-busy leaves "true" after being "true". It walks
    // every record with its old value, so a busy that turns on and off between two callbacks
    // still counts. `armed` stays false until the press, so no flip before it is taken.
    await page.evaluate(() => {
      const w = window as BuyWin;
      const rec = {
        armed: false,
        seenBusy: false,
        t0: null as number | null,
        t1: null as number | null
      };
      w.__buy = rec;
      const el = document.querySelector('[data-testid="tree-run"]')!;
      const obs = new MutationObserver((records) => {
        if (!rec.armed) return;
        for (const r of records) if (r.oldValue === 'true') rec.seenBusy = true;
        const busy = el.getAttribute('aria-busy') === 'true';
        if (busy) rec.seenBusy = true;
        else if (rec.seenBusy && rec.t1 === null) {
          rec.t1 = performance.now();
          obs.disconnect();
        }
      });
      obs.observe(el, {
        attributes: true,
        attributeFilter: ['aria-busy'],
        attributeOldValue: true
      });
    });
    // With the observer in, Run is not busy before the press (a flip in between is seen above).
    await expect(run).not.toHaveAttribute('aria-busy', 'true');
    // Arming, t0 and the press in one page turn, so no round trip falls between them; the
    // attribute is read again at that moment.
    await page.evaluate(() => {
      const rec = (window as BuyWin).__buy!;
      const b = document.querySelector<HTMLButtonElement>(
        '[data-testid="tree-detail"] [data-testid="tree-buy"]'
      )!;
      rec.seenBusy =
        document.querySelector('[data-testid="tree-run"]')!.getAttribute('aria-busy') === 'true';
      rec.armed = true;
      rec.t0 = performance.now();
      b.click();
    });

    // Run turns busy, or the sample ends (bounded by the test's own timeout); a purchase that
    // never makes Run busy is a broken case.
    await page.waitForFunction(() => {
      const rec = (window as BuyWin).__buy!;
      return rec.seenBusy || rec.t1 !== null;
    });
    const seen = await page.evaluate(() => (window as BuyWin).__buy!.seenBusy);
    expect(seen, `bench: tree-run's aria-busy never turned "true" after buying ${NODE}`).toBe(true);
    await page.waitForFunction(() => (window as BuyWin).__buy!.t1 !== null);
    const { t0, t1 } = await page.evaluate(() => (window as BuyWin).__buy!);
    samples.push(t1! - t0!);
    await ctx.close();
  }

  const median = [...samples].sort((a, b) => a - b)[samples.length >> 1];
  const line =
    `bench:map case=buy-to-ready dataset=${DATASET} node=${NODE} ` +
    `samples=${samples.map((s) => `${s.toFixed(0)}ms`).join(',')} median=${median.toFixed(0)}ms ` +
    `buyS=${(buyS * 1000).toFixed(0)}ms`;
  console.log(line);
  test.info().annotations.push({ type: 'bench:map', description: line });
  expect(samples.filter((s) => Number.isFinite(s))).toHaveLength(BUY_REPS);
});
