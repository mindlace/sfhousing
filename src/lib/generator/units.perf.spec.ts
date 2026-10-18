import { describe, expect, it } from 'vitest';
import { generateForUnits } from './units';
import { pipelineSynth, type PipelineCase } from './fixtures/pipeline-synth';

describe('generateForUnits performance budget (§4.7)', () => {
  it(
    '2,000 pipeline projects: mean ≤ 0.4 ms, p99 ≤ 4 ms, total ≤ 1,000 ms',
    { timeout: 120_000 },
    () => {
      const cases = pipelineSynth(20261016);
      expect(cases).toHaveLength(2000);
      const call = (c: PipelineCase) =>
        generateForUnits(c.parcels, c.units, c.maxStories, c.seed, c.stories);
      for (let i = 0; i < 200; i++) call(cases[i]); // warm-up
      const times: number[] = [];
      let built = 0;
      for (const c of cases) {
        const t0 = performance.now();
        const b = call(c);
        times.push(performance.now() - t0);
        if (b) built++;
      }
      const total = times.reduce((s, t) => s + t, 0);
      const mean = total / times.length;
      const p99 = [...times].sort((a, b) => a - b)[Math.ceil(0.99 * times.length) - 1];
      console.log(
        `[perf] generateForUnits 2,000 projects: mean ${mean.toFixed(3)} ms, ` +
          `p99 ${p99.toFixed(2)} ms, total ${total.toFixed(0)} ms, ${built} built`
      );
      expect(mean).toBeLessThanOrEqual(0.4);
      expect(p99).toBeLessThanOrEqual(4);
      expect(total).toBeLessThanOrEqual(1000);
      expect(built).toBeGreaterThanOrEqual(0.9 * cases.length);
    }
  );
});
