import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { rect, type Polygon } from './fixtures/district';
import { generate } from './generate';
import type { GeneratedBuilding } from './types';
import { generateForUnits } from './units';

// Large-site massing §6 perf budgets. 50 ha is the spec's p99 case; 265 ha is the Shipyard phase,
// the worst real case. The `generate` budget on 265 ha is the plan's call for the paint brush.

const parcel = (polygon: Polygon): ParcelRecord => ({
  id: 'PERF',
  polygon,
  labelPoint: [-122.39, 37.73],
  areaM2: 0,
  existingUnits: 0,
  existingFloorAreaM2: 0,
  existingHeightM: 0,
  landUse: 'X',
  eligible: true,
  neighborhood: 'X'
});

const ha50 = parcel(rect(1000, 500));
const ha265 = parcel(rect(1630, 1630));
const U = 3454;
const WARMUP = 20;

/** Per-call times over `seeds`, after `WARMUP` calls; asserts every call massed a district. */
function time(call: (seed: number) => GeneratedBuilding | null, seeds: number): number[] {
  for (let i = 0; i < WARMUP; i++) call(1000 + i);
  const times: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = performance.now();
    const b = call(seed);
    times.push(performance.now() - t0);
    expect(b?.lots?.length ?? 0).toBeGreaterThan(1);
  }
  return times.sort((a, b) => a - b);
}

const p99 = (sorted: number[]) => sorted[Math.ceil(0.99 * sorted.length) - 1];
const max = (sorted: number[]) => sorted[sorted.length - 1];

describe('district performance budget (large-site massing §6)', () => {
  it('generateForUnits on 50 ha, U 3,454: p99 ≤ 50 ms over 50 seeds', { timeout: 120_000 }, () => {
    const t = time((seed) => generateForUnits(ha50, U, 40, seed), 50);
    console.log(`[perf] district 50 ha generateForUnits: p99 ${p99(t).toFixed(1)} ms`);
    expect(p99(t)).toBeLessThanOrEqual(50);
  });

  it(
    'generateForUnits on 265 ha, U 3,454: max ≤ 250 ms over 10 seeds',
    { timeout: 120_000 },
    () => {
      const t = time((seed) => generateForUnits(ha265, U, 40, seed), 10);
      console.log(`[perf] district 265 ha generateForUnits: max ${max(t).toFixed(1)} ms`);
      expect(max(t)).toBeLessThanOrEqual(250);
    }
  );

  it('generate on 265 ha at S 8: max ≤ 500 ms over 5 seeds', { timeout: 120_000 }, () => {
    const t = time((seed) => generate(ha265, { maxStories: 8 }, seed, 'max'), 5);
    console.log(`[perf] district 265 ha generate S 8: max ${max(t).toFixed(1)} ms`);
    expect(max(t)).toBeLessThanOrEqual(500);
  });
});
