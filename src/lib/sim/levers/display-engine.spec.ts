/**
 * Paired-draw fix, acceptance 7: the display view of a timer (`rescaleTransition`, behind the
 * lookups, typical months, timeline and card) agrees with what the engine does
 * (`scaledTransition` on the unscaled transition) within the month grid. For every fixture-0 cell
 * and s in {0.5, 2}, N = 100,000 engine draws from a fresh stage (0 days survived) against r =
 * rescaleTransition(t, s):
 *
 *   |P_emp(kind = j, month <= k) - F_j^r(k)| <= tol_j,  k = 1..r.months
 *   tol_j = 4 sqrt(0.25 / N) + ((s + 1) / 30) maxInc_j
 *
 * The first term is sampling (4 sigma at the worst case p = 0.5). The second is day rounding: the
 * engine floors s d with d an integer day, and month boundaries fall on whole days, so a boundary
 * moves by up to s + 1 days, about (s + 1) / 30 of a month of column j's largest monthly
 * increment maxInc_j in r. The eventual shares are within 4 sqrt(0.25 / N). r's tail past K' is
 * not compared: that is where `rescaleTransition`'s K' truncation lives.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '$lib/generator/seed';
import { cumulativeIncidence, eventualProbabilities, parseCalibration } from '$lib/timelapse/model';
import { monthsIn } from '$lib/timelapse/time';
import { PATHWAYS, pathwayStages, type Calibration, type Transition } from '$lib/timelapse/types';
import { scaledTransition } from '../scenario/engine';
import { rescaleTransition } from './timers';

const N = 100000;
const SAMPLING = 4 * Math.sqrt(0.25 / N);

const fixture0: Calibration = parseCalibration(
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json',
        import.meta.url
      ),
      'utf8'
    )
  )
);

const cells: { name: string; t: Transition }[] = [];
for (const p of PATHWAYS) {
  for (const s of pathwayStages(p)) {
    const t = (fixture0.transitions[p] as Record<string, Transition | undefined>)[s];
    if (t) cells.push({ name: `${p}.${s}`, t });
  }
}

/** r's kinds (advance, then its exit reasons), F_j^r(k) and the eventual shares. */
function display(r: Transition) {
  const kinds = ['advance', ...Object.keys(cumulativeIncidence(r, 0).exit)];
  const F = (k: number) => {
    const c = cumulativeIncidence(r, k);
    return kinds.map((j) => (j === 'advance' ? c.advance : (c.exit as Record<string, number>)[j]));
  };
  const e = eventualProbabilities(r, 0);
  const inf = kinds.map((j) =>
    j === 'advance' ? e.advance : ((e.exit as Record<string, number>)[j] ?? 0)
  );
  return { kinds, F, inf };
}

type Miss = { kind: string; month: number | 'eventual'; got: number; want: number; tol: number };

describe('the display view agrees with the engine (acceptance 7)', () => {
  it('has fixture-0 cells', () => {
    expect(cells.length).toBeGreaterThan(10);
  });

  for (const { name, t } of cells) {
    for (const s of [0.5, 2]) {
      it(`${name} at s = ${s}`, () => {
        const r = rescaleTransition(t, s);
        const { kinds, F, inf } = display(r);
        const K = r.months;
        const counts = kinds.map(() => new Array<number>(K + 1).fill(0));
        const totals = kinds.map(() => 0);
        const rng = mulberry32(0x5eed);
        for (let i = 0; i < N; i++) {
          const uKind = rng();
          const uTime = rng();
          const { kind, days } = scaledTransition(t, uKind, uTime, 0, s);
          const j = kinds.indexOf(kind);
          if (j < 0) throw new Error(`the engine drew ${kind}, not an outcome of r`);
          totals[j]++;
          const month = monthsIn(0, days) + 1;
          if (month <= K) counts[j][month]++;
        }
        const table = Array.from({ length: K + 1 }, (_, k) => F(k));
        const misses: Miss[] = [];
        for (let j = 0; j < kinds.length; j++) {
          let maxInc = 0;
          for (let k = 1; k <= K; k++) maxInc = Math.max(maxInc, table[k][j] - table[k - 1][j]);
          const tol = SAMPLING + ((s + 1) / 30) * maxInc;
          let cum = 0;
          for (let k = 1; k <= K; k++) {
            cum += counts[j][k];
            const got = cum / N;
            const want = table[k][j];
            if (Math.abs(got - want) > tol)
              misses.push({ kind: kinds[j], month: k, got, want, tol });
          }
          const got = totals[j] / N;
          if (Math.abs(got - inf[j]) > SAMPLING) {
            misses.push({ kind: kinds[j], month: 'eventual', got, want: inf[j], tol: SAMPLING });
          }
        }
        expect(misses.slice(0, 10)).toEqual([]);
      });
    }
  }
});
