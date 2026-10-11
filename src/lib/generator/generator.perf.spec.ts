import { describe, expect, it } from 'vitest';
import { generate } from './generate';
import { fnv1a32 } from './seed';
import { synthParcels } from './fixtures/synth';

describe('generation performance budget (§4.12)', () => {
  it('150k synthetic parcels in ≤ 2,500 ms', { timeout: 120_000 }, () => {
    const cases = synthParcels(150_000, 42);
    const seeds = cases.map((c) => fnv1a32(c.parcel.id));
    for (let i = 0; i < 2000; i++)
      generate(cases[i].parcel, { maxStories: cases[i].S }, seeds[i], 'max');
    const t0 = performance.now();
    let built = 0;
    for (let i = 0; i < cases.length; i++) {
      if (generate(cases[i].parcel, { maxStories: cases[i].S }, seeds[i], 'max')) built++;
    }
    const ms = performance.now() - t0;
    console.log(`[perf] 150k parcels: ${ms.toFixed(0)} ms, ${built} built`);
    expect(built).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(2500);
  });

  it('500 parcels in ≤ 30 ms (median of 5)', () => {
    const cases = synthParcels(500, 7);
    const seeds = cases.map((c) => fnv1a32(c.parcel.id));
    const once = () => {
      const t0 = performance.now();
      for (let i = 0; i < cases.length; i++)
        generate(cases[i].parcel, { maxStories: cases[i].S }, seeds[i], 'max');
      return performance.now() - t0;
    };
    once(); // warm-up
    const runs = [once(), once(), once(), once(), once()].sort((a, b) => a - b);
    console.log(`[perf] 500 parcels median: ${runs[2].toFixed(1)} ms`);
    expect(runs[2]).toBeLessThanOrEqual(30);
  });
});
