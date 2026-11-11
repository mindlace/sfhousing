/**
 * The paired sampler's marginals (paired-draw fix, acceptance 1 and 6): N = 400,000 draws per
 * (cell, tau) against the table's per-kind conditional cumulative incidence, built only from
 * `cumulativeIncidence` and `eventualProbabilities(t, 0)`. The bound is noise-scaled:
 * tol(F) = 5 sqrt(F(1 - F) / N) + 1e-4. A failure reports its deviation in sigma units.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../generator/seed';
import {
  cumulativeIncidence,
  eventualProbabilities,
  parseCalibration,
  sampleKind,
  sampleTime
} from './model';
import { monthsIn } from './time';
import { PATHWAYS, pathwayStages, type Calibration, type Transition } from './types';

const N = 400000;
const MONTHS = 36;

const sigma = (F: number) => Math.sqrt((F * (1 - F)) / N);
const tol = (F: number) => 5 * sigma(F) + 1e-4;

function load(path: string): Calibration {
  return parseCalibration(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')));
}

const SOURCES: [string, Calibration][] = [
  ['small', load('./fixtures/calibration-small.json')],
  ['fixture-0', load('../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json')]
];

const cells: { name: string; t: Transition }[] = [];
for (const [name, c] of SOURCES) {
  for (const p of PATHWAYS) {
    for (const s of pathwayStages(p)) {
      const t = (c.transitions[p] as Record<string, Transition | undefined>)[s];
      if (t) cells.push({ name: `${name} ${p}.${s}`, t });
    }
  }
}

/** Kinds in sampler order (advance, then the transition's reasons in EXIT_ORDER) and F_j(k). */
function reference(t: Transition) {
  const kinds = ['advance', ...Object.keys(cumulativeIncidence(t, 0).exit)];
  const F = (k: number) => {
    const r = cumulativeIncidence(t, k);
    return kinds.map((j) => (j === 'advance' ? r.advance : (r.exit as Record<string, number>)[j]));
  };
  const e = eventualProbabilities(t, 0);
  const inf = kinds.map((j) =>
    j === 'advance' ? e.advance : (e.exit as Record<string, number>)[j]
  );
  const at = (x: number) => {
    const lo = F(Math.floor(x));
    const hi = F(Math.ceil(x));
    const a = x - Math.floor(x);
    return lo.map((v, i) => v + a * (hi[i] - v));
  };
  return { kinds, F, inf, at };
}

type Miss = { kind: string; month: number | 'eventual'; got: number; want: number; sigmas: number };

function check(
  misses: Miss[],
  kind: string,
  month: number | 'eventual',
  got: number,
  want: number
) {
  if (Math.abs(got - want) > tol(want)) {
    const s = sigma(want);
    misses.push({ kind, month, got, want, sigmas: s > 0 ? Math.abs(got - want) / s : Infinity });
  }
}

describe('sampleKind and sampleTime marginals (acceptance 1)', () => {
  for (const { name, t } of cells) {
    for (const tau of [0, 6, 6.4, t.months + 1]) {
      it(`${name} at tau = ${tau}`, () => {
        const { kinds, F, inf, at } = reference(t);
        const counts = kinds.map(() => new Array<number>(MONTHS + 2).fill(0));
        const totals = kinds.map(() => 0);
        const rng = mulberry32(0x5eed);
        for (let i = 0; i < N; i++) {
          const uKind = rng();
          const uTime = rng();
          const kind = sampleKind(t, uKind, tau);
          const d = sampleTime(t, kind, uTime, tau);
          const j = kinds.indexOf(kind);
          totals[j]++;
          const month = monthsIn(0, d) + 1;
          if (month <= MONTHS) counts[j][month]++;
        }
        const Ft = at(tau);
        const survive = 1 - Ft.reduce((a, b) => a + b, 0);
        const misses: Miss[] = [];
        for (let j = 0; j < kinds.length; j++) {
          let cum = 0;
          for (let k = 1; k <= MONTHS; k++) {
            cum += counts[j][k];
            const want = Math.max(0, F(k)[j] - Ft[j]) / survive;
            check(misses, kinds[j], k, cum / N, want);
          }
          check(misses, kinds[j], 'eventual', totals[j] / N, (inf[j] - Ft[j]) / survive);
        }
        expect(misses).toEqual([]);
      });
    }
  }
});

describe("sampleTime(t, 'advance', u, 0) follows the advance column (acceptance 6)", () => {
  let checked = 0;
  for (const { name, t } of cells) {
    it(name, () => {
      const { F, inf } = reference(t);
      if (inf[0] === 0) {
        expect(inf[0]).toBe(0);
        return;
      }
      checked++;
      const counts = new Array<number>(MONTHS + 2).fill(0);
      const rng = mulberry32(0x5eed);
      for (let i = 0; i < N; i++) {
        const month = monthsIn(0, sampleTime(t, 'advance', rng(), 0)) + 1;
        if (month <= MONTHS) counts[month]++;
      }
      const misses: Miss[] = [];
      let cum = 0;
      for (let k = 1; k <= MONTHS; k++) {
        cum += counts[k];
        check(misses, 'advance', k, cum / N, F(k)[0] / inf[0]);
      }
      expect(misses).toEqual([]);
    });
  }

  it('checked at least one cell', () => {
    expect(checked).toBeGreaterThan(0);
  });
});
