// Height-limit build budgets (height-lids plan, Task 7; final review I2): the staged city build
// and lid build run in the worker's slices, each step given the host's whole slice plan
// (SLICE_PLAN_MS, 45 ms). No step may pass the macrotask limit (SLICE_MS, 50 ms): the 5 ms
// between them are the tolerance for a unit longer than any before it. The lid build's set-up
// (its lots, its raster) is a job of its own and must fit the plan too. Each build must finish
// within its total. Fails above budget. Timing-sensitive: run it alone
// (`vitest run --project server src/lib/map/height/height.bench.spec.ts`) for the numbers.
import { describe, expect, it } from 'vitest';
import { SLICE_MS, SLICE_PLAN_MS } from '$lib/sim/scenario/scenario-host';
import { createCityBuild, type StagedBuild } from './city';
import { createLidBuild, type LidInput } from './lids';
import { cityInputOf, lidLotsOf, scene, synthBlocks, toLngLat } from './test/fixtures';

const STEP_MS = SLICE_PLAN_MS;
const STEP_MAX_MS = SLICE_MS;
const TIMEOUT = 120_000;

/** Wall time of each step(SLICE_PLAN_MS) until done. */
function stepTimes<T>(b: StagedBuild<T>): number[] {
  const now = () => performance.now();
  const out: number[] = [];
  for (;;) {
    const t0 = now();
    const done = b.step(STEP_MS, now);
    out.push(now() - t0);
    if (done) return out;
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fmt = (xs: number[]) =>
  `${xs.length} steps, max ${Math.max(...xs).toFixed(1)} ms, total ${sum(xs).toFixed(1)} ms`;

describe('height build budgets', () => {
  it(
    'city build on 150,000 synthetic lots: every step(45) returns within 50 ms; total ≤ 600 ms',
    { timeout: TIMEOUT },
    () => {
      const lots = synthBlocks(-4500, -3000, 9000, 6000);
      expect(lots.length).toBeGreaterThan(145_000);
      const input = cityInputOf(lots);
      stepTimes(createCityBuild(input)); // warm the JIT
      const t = stepTimes(createCityBuild(input));
      console.log(`[perf] city build, ${lots.length} lots: ${fmt(t)}`);
      expect(Math.max(...t)).toBeLessThanOrEqual(STEP_MAX_MS);
      expect(sum(t)).toBeLessThanOrEqual(600);
    }
  );

  it(
    'lid build over a 3 km × 3 km view of ≈ 25,000 synthetic 25 ft lots: set-up ≤ 45 ms, every step(45) ≤ 50 ms; total ≤ 400 ms',
    { timeout: TIMEOUT },
    () => {
      const lots = synthBlocks(-1500, -1500, 3000, 3000);
      expect(lots.length).toBeGreaterThan(24_000);
      const sc = scene(lots);
      const input: LidInput = {
        ...sc.input,
        lots: lidLotsOf(lots).lots,
        bbox: [...toLngLat(-1500, -1500), ...toLngLat(1500, 1500)]
      };
      stepTimes(createLidBuild(input)); // warm the JIT
      // the host's set-up job: gather the view's lots (rings to lng/lat) and allocate the raster
      lidLotsOf(lots);
      const s0 = performance.now();
      const gathered = lidLotsOf(lots).lots;
      const b = createLidBuild({ ...input, lots: gathered });
      const setup = performance.now() - s0;
      const t = stepTimes(b);
      const l = b.result();
      console.log(
        `[perf] lid build, ${lots.length} lots, ${b.frame.cols}×${b.frame.rows} cells: ` +
          `set-up ${setup.toFixed(1)} ms, ${fmt(t)}; ` +
          `${l.pieces.stories.length} pieces, ${l.faces.length} faces, ` +
          `${l.rims.starts.length - 1} rims, ${l.walls.count} walls, ${l.labels.text.length} labels`
      );
      expect(setup).toBeLessThanOrEqual(SLICE_PLAN_MS);
      expect(Math.max(...t)).toBeLessThanOrEqual(STEP_MAX_MS);
      expect(sum(t)).toBeLessThanOrEqual(400);
    }
  );
});
