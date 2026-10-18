// Ridge IRLS for the initiation logit (spec §4.6 "Fit", §6 irls.test.ts).
import { describe, expect, it } from 'vitest';
import { compareCells, fitLogit, linearPredictor } from '../../lib/fzp-cal/irls';
import type { FitCell } from '../../lib/fzp-cal/panel';
import { CalibrationError } from '../../lib/fzp-cal/types';
import { mulberry32 } from '../../../src/lib/generator/seed';
import { exp, log } from '../../../src/lib/timelapse/math';

const logit = (q: number) => log(q / (1 - q));
const cell = (bins: number[], exposure: number, events: number, basis: 0 | 1 = 0): FitCell => ({
  bins,
  basis,
  exposure,
  events
});

/** Every bin tuple of `nBins`, in lexicographic order. */
function tuples(nBins: number[]): number[][] {
  let out: number[][] = [[]];
  for (const n of nBins) out = out.flatMap((t) => Array.from({ length: n }, (_, b) => [...t, b]));
  return out;
}

/** Cells drawn from a known logit: `perCell` Bernoulli parcel-months per tuple and basis. */
function simulate(
  nBins: number[],
  intercept: number,
  coef: number[][],
  basisShift: number | null,
  perCell: number,
  seed: number
): FitCell[] {
  const rnd = mulberry32(seed);
  const cells: FitCell[] = [];
  for (const bins of tuples(nBins)) {
    for (const basis of basisShift === null ? [0 as const] : [0 as const, 1 as const]) {
      let z = intercept;
      bins.forEach((b, t) => (z += coef[t][b]));
      if (basis === 1) z += basisShift as number;
      const q = 1 / (1 + exp(-z));
      let events = 0;
      for (let k = 0; k < perCell; k++) if (rnd() < q) events++;
      cells.push(cell(bins, perCell, events, basis));
    }
  }
  return cells.sort(compareCells);
}

describe('fitLogit', () => {
  it('one binary feature, lambda = 0: each group recovers its closed-form log-odds', () => {
    const cells = [cell([0], 5000, 400), cell([1], 3000, 75)];
    const fit = fitLogit(cells, [2], 0);
    expect(Math.abs(fit.intercept + fit.coef[0][0] - logit(400 / 5000))).toBeLessThan(1e-9);
    expect(Math.abs(fit.intercept + fit.coef[0][1] - logit(75 / 3000))).toBeLessThan(1e-9);
    expect(fit.iterations).toBeLessThanOrEqual(100);
  });

  it('recovers known coefficients from 2M simulated parcel-months within 0.05', () => {
    const nBins = [3, 2];
    const coef = [
      [0, 0.5, -0.4],
      [0, 0.8]
    ];
    const cells = simulate(nBins, -3, coef, null, Math.round(2_000_000 / 6), 0x5eed);
    expect(cells.reduce((a, c) => a + c.exposure, 0)).toBeGreaterThanOrEqual(1_999_998);
    const fit = fitLogit(cells, nBins, 1);
    for (let t = 0; t < nBins.length; t++) {
      for (let b = 1; b < nBins[t]; b++) {
        const est = fit.coef[t][b] - fit.coef[t][0];
        expect(Math.abs(est - (coef[t][b] - coef[t][0]))).toBeLessThan(0.05);
      }
    }
    for (const bins of tuples(nBins)) {
      const truth = -3 + coef[0][bins[0]] + coef[1][bins[1]];
      expect(Math.abs(linearPredictor(fit, bins, 0) - truth)).toBeLessThan(0.05);
    }
  });

  it('full one-hot plus ridge solves where lambda = 0 alone is singular', () => {
    // Two terms whose bins coincide: every column pair is aliased without the ridge.
    const cells = [cell([0, 0], 1000, 30), cell([1, 1], 1000, 60)];
    const fit = fitLogit(cells, [2, 2], 1);
    for (const v of [fit.intercept, fit.basis, ...fit.coef.flat()]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(fit.coef[0][0]).toBeCloseTo(fit.coef[1][0], 9);
    expect(fit.coef[0][1]).toBeCloseTo(fit.coef[1][1], 9);
  });

  it('perfect separation with lambda = 0 does not converge: CalibrationError', () => {
    const cells = [cell([0], 1000, 50), cell([1], 1000, 0)];
    expect(() => fitLogit(cells, [2], 0)).toThrow(CalibrationError);
    expect(() => fitLogit(cells, [2], 0)).toThrow('IRLS did not converge');
  });

  it('shuffled input cells, after the documented sort, give byte-identical output', () => {
    const nBins = [3, 2];
    const cells = simulate(
      nBins,
      -2.5,
      [
        [0, 0.3, -0.2],
        [0, 0.4]
      ],
      0.6,
      20_000,
      7
    );
    const base = JSON.stringify(fitLogit(cells, nBins, 1));
    const rnd = mulberry32(99);
    for (let rep = 0; rep < 3; rep++) {
      const shuffled = [...cells];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(JSON.stringify(fitLogit(shuffled.sort(compareCells), nBins, 1))).toBe(base);
      expect(JSON.stringify(fitLogit(shuffled, nBins, 1))).toBe(base);
    }
  });

  it('the basis column is unpenalised and recovers a known measurement offset', () => {
    const nBins = [2];
    const cells = simulate(nBins, -3, [[0, 0.5]], 0.7, 400_000, 3);
    const fit = fitLogit(cells, nBins, 1);
    expect(Math.abs(fit.basis - 0.7)).toBeLessThan(0.05);
  });
});
