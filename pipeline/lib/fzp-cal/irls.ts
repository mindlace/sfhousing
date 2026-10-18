/**
 * Ridge-penalised IRLS for the initiation hazard (stage-calibration spec §4.6 "Fit"): a binomial
 * logit on (events, exposure) cells, one Bernoulli trial per parcel-month. The design is the
 * intercept, a full one-hot per term and one nuisance column `basis`; the ridge ½λΣβ² applies to
 * the bin coefficients only. Newton steps are solved by a dense Cholesky in fixed column order.
 */
import { exp, log } from '../../../src/lib/timelapse/math';
import type { FitCell } from './panel';
import { CalibrationError } from './types';

const MAX_ITER = 100;
const STEP_TOL = 1e-9;
/**
 * A Cholesky pivot at or below this fraction of its diagonal is an aliased column (an exact
 * linear combination of earlier columns, or a column with no data): its step is fixed at 0, which
 * solves the system with that column dropped. Only reachable with λ = 0 or an unpenalised column.
 */
const PIVOT_TOL = 1e-10;

export interface LogitFit {
  intercept: number;
  /** per term, one coefficient per bin */
  coef: number[][];
  basis: number;
  iterations: number;
}

/** The documented cell order: bin tuple lexicographically, then basis, exposure, events. */
export function compareCells(a: FitCell, b: FitCell): number {
  const n = Math.min(a.bins.length, b.bins.length);
  for (let i = 0; i < n; i++) if (a.bins[i] !== b.bins[i]) return a.bins[i] - b.bins[i];
  if (a.bins.length !== b.bins.length) return a.bins.length - b.bins.length;
  if (a.basis !== b.basis) return a.basis - b.basis;
  if (a.exposure !== b.exposure) return a.exposure - b.exposure;
  return a.events - b.events;
}

/** The linear predictor of `bins` and `basis` under a fit. */
export function linearPredictor(fit: LogitFit, bins: number[], basis: 0 | 1): number {
  let z = fit.intercept;
  for (let t = 0; t < bins.length; t++) z += fit.coef[t][bins[t]];
  return basis === 1 ? z + fit.basis : z;
}

/** The logistic function through the deterministic `exp`. */
export function logistic(z: number): number {
  return 1 / (1 + exp(-z));
}

/**
 * Solves H x = g for symmetric positive semi-definite H (lower triangle used) by Cholesky in
 * column order; an aliased column (pivot under PIVOT_TOL of its diagonal) gets x = 0.
 */
function choleskySolve(h: Float64Array[], g: Float64Array): Float64Array {
  const p = g.length;
  const l = Array.from({ length: p }, () => new Float64Array(p));
  const dropped = new Uint8Array(p);
  for (let j = 0; j < p; j++) {
    let s = h[j][j];
    for (let k = 0; k < j; k++) s -= l[j][k] * l[j][k];
    if (!(s > PIVOT_TOL * h[j][j])) {
      dropped[j] = 1;
      continue;
    }
    const d = Math.sqrt(s);
    l[j][j] = d;
    for (let i = j + 1; i < p; i++) {
      let v = h[i][j];
      for (let k = 0; k < j; k++) v -= l[i][k] * l[j][k];
      l[i][j] = v / d;
    }
  }
  const z = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    if (dropped[j]) continue;
    let v = g[j];
    for (let k = 0; k < j; k++) v -= l[j][k] * z[k];
    z[j] = v / l[j][j];
  }
  const x = new Float64Array(p);
  for (let j = p - 1; j >= 0; j--) {
    if (dropped[j]) continue;
    let v = z[j];
    for (let k = j + 1; k < p; k++) v -= l[k][j] * x[k];
    x[j] = v / l[j][j];
  }
  return x;
}

/**
 * Fits the ridge logit. `cells[c].bins[t]` indexes term t's `nBins[t]` bins. The cells are sorted
 * by `compareCells` (a copy is sorted here as well, so every input order gives the same bits).
 * Starts from intercept = logit(Σevents/Σexposure) with `basis` and the bins at 0; stops when
 * max|Δ| < 1e-9; more than 100 iterations is a `CalibrationError`.
 */
export function fitLogit(cells: FitCell[], nBins: number[], lambda: number): LogitFit {
  const sorted = [...cells].sort(compareCells);
  const offset: number[] = [];
  let p = 1;
  for (const n of nBins) {
    if (!Number.isInteger(n) || n < 1) throw new CalibrationError(`IRLS: bad bin count ${n}`);
    offset.push(p);
    p += n;
  }
  const basisCol = p;
  p += 1;

  let events = 0;
  let exposure = 0;
  for (const c of sorted) {
    if (c.bins.length !== nBins.length) {
      throw new CalibrationError(`IRLS: cell has ${c.bins.length} terms, expected ${nBins.length}`);
    }
    for (let t = 0; t < nBins.length; t++) {
      const b = c.bins[t];
      if (!Number.isInteger(b) || b < 0 || b >= nBins[t]) {
        throw new CalibrationError(`IRLS: bin ${b} out of range for term ${t}`);
      }
    }
    if (!(c.exposure >= 0) || !(c.events >= 0) || c.events > c.exposure) {
      throw new CalibrationError('IRLS: cell needs 0 <= events <= exposure');
    }
    events += c.events;
    exposure += c.exposure;
  }
  if (!(events > 0 && events < exposure)) {
    throw new CalibrationError('IRLS: needs 0 < total events < total exposure');
  }

  const beta = new Float64Array(p);
  beta[0] = log(events / (exposure - events));
  const idx = new Array<number>(nBins.length + 2);
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const h = Array.from({ length: p }, () => new Float64Array(p));
    const g = new Float64Array(p);
    for (const c of sorted) {
      let m = 0;
      idx[m++] = 0;
      for (let t = 0; t < nBins.length; t++) idx[m++] = offset[t] + c.bins[t];
      if (c.basis === 1) idx[m++] = basisCol;
      let z = 0;
      for (let a = 0; a < m; a++) z += beta[idx[a]];
      const mu = logistic(z);
      const w = c.exposure * mu * (1 - mu);
      const r = c.events - c.exposure * mu;
      for (let a = 0; a < m; a++) {
        const ia = idx[a];
        g[ia] += r;
        const row = h[ia];
        for (let b = 0; b <= a; b++) row[idx[b]] += w;
      }
    }
    for (let j = 1; j < basisCol; j++) {
      h[j][j] += lambda;
      g[j] -= lambda * beta[j];
    }
    const delta = choleskySolve(h, g);
    let maxStep = 0;
    let finite = true;
    for (let j = 0; j < p; j++) {
      beta[j] += delta[j];
      const s = Math.abs(delta[j]);
      if (!Number.isFinite(beta[j])) finite = false;
      if (s > maxStep) maxStep = s;
    }
    if (!finite) break;
    if (maxStep < STEP_TOL) {
      return {
        intercept: beta[0],
        coef: nBins.map((n, t) => Array.from(beta.subarray(offset[t], offset[t] + n))),
        basis: beta[basisCol],
        iterations: iter
      };
    }
  }
  throw new CalibrationError('IRLS did not converge');
}
