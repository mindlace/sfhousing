// sampler.ts replays T12 `sampleTransition` from cached constants: it must give the same kind and
// days, bit for bit, on every transition of every fixture calibration, at the months elapsed the
// engine uses, for draws at random and at every slice and month boundary (and the doubles next
// to them), and it must reject what `sampleTransition` rejects.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cumulativeTotal, parseCalibration, sampleTransition } from '$lib/timelapse/model';
import { EXIT_ORDER, PATHWAYS, type Calibration, type Transition } from '$lib/timelapse/types';
import { P, draw } from './rng';
import { drawn, sample } from './sampler';

const root = new URL('../../../../', import.meta.url);
const FIXTURES = [
  'src/lib/sim/scenario/fixtures/mini-calibration.json',
  'src/lib/timelapse/fixtures/calibration-small.json',
  'e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json',
  'pipeline/test/fixtures/mini/golden/scenarios/fzp/calibration.json'
];

const calibration = (path: string): Calibration =>
  parseCalibration(JSON.parse(readFileSync(new URL(path, root), 'utf8')));

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
/** The double `steps` ulps away from x (x > 0). */
function ulps(x: number, steps: number): number {
  f64[0] = x;
  i64[0] += BigInt(steps);
  return f64[0];
}

/** Uniforms for transition t at `m` months survived: random, extreme and around boundaries. */
function uniforms(t: Transition, m: number, salt: number): number[] {
  const out = [0, 0.5 / 4294967296, 1 - 0.5 / 4294967296, ulps(1, -1)];
  for (let k = 0; k < 1500; k++) out.push(draw(salt, m, k, P.STAGE, 0));
  // every month boundary C(k), inside and past the table, mapped to u at m (exactly at m = 0)
  const cm = cumulativeTotal(t, m);
  const bounds: number[] = [];
  for (let k = 1; k <= t.months + 40; k++) bounds.push(cumulativeTotal(t, k));
  // the advance / exit split inside each table month
  for (let k = 1; k <= t.months; k++) bounds.push(cumulativeTotal(t, k - 1) + t.advance[k - 1]);
  // the kind splits inside each tail month: [C(k − 1), C(k)) by the tail shares, in order
  const rates = [t.tail.advance, ...EXIT_ORDER.map((r) => t.tail.exit[r] ?? 0)];
  const rho = rates.reduce((a, b) => a + b, 0);
  for (let k = t.months + 1; k <= t.months + 40; k++) {
    const lo = cumulativeTotal(t, k - 1);
    const hi = cumulativeTotal(t, k);
    let acc = 0;
    for (const r of rates) bounds.push(lo + (hi - lo) * (acc += r / rho));
  }
  for (const b of bounds) {
    const u = (b - cm) / (1 - cm);
    for (let s = -2; s <= 2; s++) {
      const v = u > 0 ? ulps(u, s) : u;
      if (v >= 0 && v < 1) out.push(v);
    }
  }
  return out;
}

const transitionsOf = (cal: Calibration) =>
  PATHWAYS.flatMap((p) =>
    Object.entries(cal.transitions[p]).map(([s, t]) => ({ name: `${p} ${s}`, t: t! }))
  );

describe('sample (sampler.ts) equals T12 sampleTransition', () => {
  for (const path of FIXTURES) {
    it(`on every transition of ${path}`, () => {
      const cal = calibration(path);
      const mismatches: string[] = [];
      let checked = 0;
      transitionsOf(cal).forEach(({ name, t }, n) => {
        const K = t.months;
        for (const m of [...new Set([0, 1, Math.max(0, K - 1), K, K + 1, K + 7])]) {
          for (const u of uniforms(t, m, n + 1)) {
            const want = sampleTransition(t, u, m);
            sample(t, u, m);
            checked++;
            if (drawn.kind !== want.kind || drawn.days !== want.days) {
              if (mismatches.length < 5)
                mismatches.push(
                  `${name} m=${m} u=${u}: ${drawn.kind} ${drawn.days} vs ` +
                    `${want.kind} ${want.days}`
                );
            }
          }
        }
      });
      expect(mismatches).toEqual([]);
      expect(checked).toBeGreaterThan(10_000);
    });
  }

  it('rejects what sampleTransition rejects', () => {
    const t = transitionsOf(calibration(FIXTURES[0]))[0].t;
    for (const [u, m] of [
      [1, 0],
      [-0.1, 0],
      [Number.NaN, 0],
      [0.5, 1.5],
      [0.5, -1]
    ]) {
      expect(() => sampleTransition(t, u, m)).toThrow(RangeError);
      expect(() => sample(t, u, m)).toThrow(RangeError);
    }
  });
});
