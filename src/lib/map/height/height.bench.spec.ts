// Height-limit build budgets (height-lids plan, Task 7): the staged city build and lid build must
// each run in slices that fit a worker macrotask (every step(30) within 45 ms) and finish within
// their totals. Fails above budget. Timing-sensitive: run it alone
// (`vitest run --project server src/lib/map/height/height.bench.spec.ts`) for the numbers.
import { describe, expect, it } from 'vitest';
import { createCityBuild, type StagedBuild } from './city';
import { createLidBuild, type LidInput } from './lids';
import { cityInputOf, lidLotsOf, scene, synthBlocks, toLngLat } from './test/fixtures';

const STEP_MS = 30;
const STEP_MAX_MS = 45;
const TIMEOUT = 120_000;

/** Wall time of each step(STEP_MS) until done. */
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
    'city build on 150,000 synthetic lots: every step(30) returns within 45 ms; total ≤ 600 ms',
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
    'lid build over a 3 km × 3 km view of ≈ 25,000 synthetic 25 ft lots: every step(30) ≤ 45 ms; total ≤ 400 ms',
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
      const b = createLidBuild(input);
      const t = stepTimes(b);
      const l = b.result();
      console.log(
        `[perf] lid build, ${lots.length} lots, ${b.frame.cols}×${b.frame.rows} cells: ${fmt(t)}; ` +
          `${l.pieces.stories.length} pieces, ${l.faces.length} faces, ` +
          `${l.rims.starts.length - 1} rims, ${l.walls.count} walls, ${l.labels.text.length} labels`
      );
      expect(Math.max(...t)).toBeLessThanOrEqual(STEP_MAX_MS);
      expect(sum(t)).toBeLessThanOrEqual(400);
    }
  );
});
