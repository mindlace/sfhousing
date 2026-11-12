// bench:map run switch (docs/dev/map-perf.md "Run slider switch"): how long /sim takes to show
// another of the band's runs after `selectRank`, on today's reroll path. Run it live
// (`SFH_BENCH_DATASET=<v>`) for the real-SF numbers; fixture-0 is a smoke check only.
//
// Each switch is one in-page evaluate: stamp t0, read `installs`, call `selectRank`, then poll every
// frame. `first` is the first frame with a cell installed and the timeline answered; `full` is the
// first frame with the run complete and no install pending.
import { expect, test, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../../src/lib/fzp/debug';
import { medianRank } from '../../src/lib/sim/scenario/band';
import { startRun } from '../helpers/run';
import { gotoHydrated, jumpAndIdle, type Win } from '../helpers/sharing';
import { pct } from './bench-util';

type BenchWin = Win & { __sfhFzp?: SfhFzpDebug };

const SWITCHES = 10;
/** The spec's ceiling for a whole switch at the default camera, ms. */
const FULL_CEILING_MS = 3000;
const DOWNTOWN = {
  center: [-122.401, 37.789] as [number, number],
  zoom: 15.5,
  pitch: 55,
  bearing: 0
};

const CAMERAS = ['default', 'zoomed'] as const;
const MOVES = ['one tick', 'Best↔Worst'] as const;
type Move = (typeof MOVES)[number];

/** The ranks position of switch `i`: one tick alternates the median and the next, else ends. */
function position(move: Move, n: number, i: number): number {
  const mid = medianRank(n);
  if (move === 'one tick') return i % 2 === 0 ? mid : mid + 1;
  return i % 2 === 0 ? 0 : n - 1;
}

async function switchOnce(page: Page, pos: number): Promise<{ first: number; full: number }> {
  return page.evaluate(
    (p) =>
      new Promise<{ first: number; full: number }>((resolve, reject) => {
        const w = window as BenchWin;
        const fzp = w.__sfhFzp!;
        const map = w.__sfhMap!;
        const t0 = performance.now();
        const installs0 = map.timelineSnapshot()!.installs;
        fzp.selectRank(p);
        let first = -1;
        const frame = (now: number) => {
          const snap = map.timelineSnapshot()!;
          const trace = fzp.switchTrace;
          if (first < 0 && snap.installs > installs0 && trace?.answeredAt != null) first = now;
          if (trace?.completeAt != null && snap.pending === 0) {
            resolve({ first: (first < 0 ? now : first) - t0, full: now - t0 });
            return;
          }
          if (now - t0 > 60_000) {
            reject(new Error('switch did not complete in 60 s'));
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    pos
  );
}

for (const camera of CAMERAS)
  for (const move of MOVES)
    test(`bench:map: run switch ${camera} camera, ${move}`, async ({ page }) => {
      await gotoHydrated(page, '/sim');
      await page.waitForFunction(
        () =>
          (window as BenchWin).__sfhFzp?.phase === 'ready' && !!(window as BenchWin).__sfhMap?.map,
        undefined,
        { timeout: 60_000 }
      );
      await startRun(page);
      if (camera === 'zoomed') await jumpAndIdle(page, DOWNTOWN);
      await page.waitForFunction(
        () => {
          const w = window as BenchWin;
          const snap = w.__sfhMap!.timelineSnapshot();
          return w.__sfhFzp!.ranks !== null && !!snap && snap.cells > 0 && snap.pending === 0;
        },
        undefined,
        { timeout: 120_000 }
      );
      const n = await page.evaluate(() => (window as BenchWin).__sfhFzp!.ranks!.length);
      const env = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        const renderer =
          gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return { renderer, dpr: devicePixelRatio };
      });

      const firsts: number[] = [];
      const fulls: number[] = [];
      for (let i = 0; i < SWITCHES; i++) {
        const r = await switchOnce(page, position(move, n, i));
        firsts.push(r.first);
        fulls.push(r.full);
      }
      firsts.sort((a, b) => a - b);
      fulls.sort((a, b) => a - b);
      const dataset = process.env.SFH_BENCH_DATASET ?? 'fixture-0';
      const f = (x: number) => x.toFixed(0);
      console.log(
        `run switch [${camera} / ${move}] dataset=${dataset} runs=${n} renderer=${env.renderer} ` +
          `dpr=${env.dpr} first p50/p95=${f(pct(firsts, 50))}/${f(pct(firsts, 95))} ms ` +
          `full p50/p95=${f(pct(fulls, 50))}/${f(pct(fulls, 95))} ms`
      );
      if (camera === 'default') expect(pct(fulls, 95)).toBeLessThanOrEqual(FULL_CEILING_MS);
    });
