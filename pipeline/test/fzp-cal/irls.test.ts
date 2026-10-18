// Ridge IRLS for the initiation logit (spec §4.6 "Fit", §6 irls.test.ts).
import { describe, expect, it } from 'vitest';
import {
  checkLogitFit,
  compareCells,
  fitLogit,
  linearPredictor,
  logistic
} from '../../lib/fzp-cal/irls';
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

/**
 * Rare events with a thin high-hazard bin beside a large near-zero-event bin (the live panel's
 * shape after the hostable_base decoupling, two terms): the undamped Newton step overshoots from
 * the null start and diverged to hazard 0 or 1 in every cell.
 */
function rareEventCells(): FitCell[] {
  const pr = [
    [17533585, 44],
    [1984832, 188],
    [5126810, 175],
    [5141817, 172],
    [1592899, 147],
    [577017, 76],
    [958216, 285]
  ];
  const is = [
    [827923, 464],
    [613657, 101],
    [7612573, 234],
    [13205063, 200],
    [7908023, 65],
    [2747937, 23]
  ];
  const total = 32915176;
  const base = 1087 / total;
  const cells: FitCell[] = [];
  for (let a = 0; a < pr.length; a++) {
    for (let b = 0; b < is.length; b++) {
      const exposure = (pr[a][0] * is[b][0]) / total;
      const rate = (pr[a][1] / pr[a][0]) * (is[b][1] / is[b][0]) / base;
      for (const basis of [0, 1] as const) {
        const e = Math.round(exposure * (basis ? 0.42 : 0.58));
        cells.push(cell([a, b], e, Math.round(e * rate * (basis ? 0.85 : 1.1)), basis));
      }
    }
  }
  return cells.sort(compareCells);
}

describe('fitLogit step control and degenerate-fit guard (fix-v28)', () => {
  const nBins = [7, 6];
  const cells = rareEventCells();

  it('converges on rare events with a thin high-hazard bin; per-basis back-cast within 2%', () => {
    const fit = fitLogit(cells, nBins, 1);
    const obs = [0, 0];
    const pred = [0, 0];
    for (const c of cells) {
      obs[c.basis] += c.events;
      pred[c.basis] += c.exposure * logistic(linearPredictor(fit, c.bins, c.basis));
    }
    for (const b of [0, 1]) {
      expect(obs[b]).toBeGreaterThan(0);
      expect(Math.abs(pred[b] - obs[b])).toBeLessThanOrEqual(0.02 * obs[b]);
    }
    expect(fit.intercept).toBeGreaterThan(-15);
    expect(fit.intercept).toBeLessThan(-5);
    expect(Math.abs(fit.basis)).toBeLessThan(2);
    for (const v of fit.coef.flat()) expect(Math.abs(v)).toBeLessThan(10);
  });

  it('checkLogitFit rejects the degenerate live fit (hazard 0 everywhere): CalibrationError', () => {
    // The shape of the fit the undamped IRLS returned on 2026-10-17-4000b4e3: intercept and
    // basis frozen at absurd values, so every cell's hazard is 0.
    const degenerate = {
      intercept: -198743000000000,
      coef: nBins.map((n) => new Array<number>(n).fill(50)),
      basis: -61090.7,
      iterations: 6
    };
    expect(() => checkLogitFit(cells, nBins, 1, degenerate)).toThrow(CalibrationError);
    expect(() => checkLogitFit(cells, nBins, 1, degenerate)).toThrow('IRLS: degenerate fit');
    const nan = { ...fitLogit(cells, nBins, 1), basis: Number.NaN };
    expect(() => checkLogitFit(cells, nBins, 1, nan)).toThrow('IRLS: degenerate fit');
  });

  it('checkLogitFit rejects a finite fit whose intercept score is not zero', () => {
    const good = fitLogit(cells, nBins, 1);
    expect(() => checkLogitFit(cells, nBins, 1, good)).not.toThrow();
    const shifted = { ...good, intercept: good.intercept - 3 };
    expect(() => checkLogitFit(cells, nBins, 1, shifted)).toThrow('IRLS: degenerate fit');
  });
});
