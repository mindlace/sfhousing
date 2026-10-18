/**
 * Ridge-penalised IRLS for the initiation hazard (stage-calibration spec §4.6 "Fit"): a binomial
 * logit on (events, exposure) cells, one Bernoulli trial per parcel-month. The design is the
 * intercept, a full one-hot per term and one nuisance column `basis`; the ridge ½λΣβ² applies to
 * the bin coefficients only. Newton steps are solved by a dense Cholesky in fixed column order and
 * step-halved until the penalised log-likelihood does not fall: with rare events and a thin
 * high-hazard bin the full first step overshoots (the live panel after the hostable_base
 * decoupling diverged to hazard 0 in every cell without it). A converged fit is checked by
 * `checkLogitFit` before it is returned.
 */
import { exp, log } from '../../../src/lib/timelapse/math';
import type { FitCell } from './panel';
import { CalibrationError } from './types';

const MAX_ITER = 100;
const STEP_TOL = 1e-9;
/**
 * A Cholesky pivot at or below this fraction of its diagonal is an aliased column (an exact
 * linear combination of earlier columns, or a column with no data): its step is fixed at 0, which
 * solves the system with that column dropped. Only reachable with λ = 0 or an unpenalised column;
 * the intercept, and the basis column when basis-1 cells exist, are never dropped (that is a
 * degenerate fit, a `CalibrationError`).
 */
const PIVOT_TOL = 1e-10;
/** Step-halvings tried before a Newton step that lowers the objective is an error (t ≥ 2^-30). */
const MAX_HALVINGS = 30;
/** Relative slack on "the objective did not fall": rounding in Σ over ~25k cells. */
const OBJ_TOL = 1e-12;
/**
 * |coefficient| above this on the logit scale is a degenerate fit (a monthly hazard below 2e-22 or
 * above 1 − 2e-22): tier 4 sanity bound, far outside any parcel-month hazard.
 */
export const COEF_MAX = 50;
/** A converged fit's penalised score per column, relative to 1 + Σevents: at most this. */
const SCORE_TOL = 1e-6;

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

/** log(1 + exp(z)) for z ≤ 0, accurate for tiny exp(z) (log1p by Goldberg's correction). */
function log1pExp(z: number): number {
  const e = exp(z);
  const u = 1 + e;
  return u === 1 ? e : (log(u) * e) / (u - 1);
}

/** log(1 + exp(z)) without overflow. */
function softplus(z: number): number {
  return z > 0 ? z + log1pExp(-z) : log1pExp(z);
}

/** The design layout of `nBins`: each term's first column, the basis column, the width. */
function layout(nBins: number[]): { offset: number[]; basisCol: number; p: number } {
  const offset: number[] = [];
  let p = 1;
  for (const n of nBins) {
    if (!Number.isInteger(n) || n < 1) throw new CalibrationError(`IRLS: bad bin count ${n}`);
    offset.push(p);
    p += n;
  }
  return { offset, basisCol: p, p: p + 1 };
}

/** A cell's linear predictor under the coefficient vector `beta`. */
function cellZ(beta: Float64Array, c: FitCell, offset: number[], basisCol: number): number {
  let z = beta[0];
  for (let t = 0; t < offset.length; t++) z += beta[offset[t] + c.bins[t]];
  return c.basis === 1 ? z + beta[basisCol] : z;
}

/**
 * The penalised log-likelihood Σ (events·z − exposure·log(1 + e^z)) − ½λΣ_bins β², summed in
 * cell order then column order.
 */
function objective(
  sorted: FitCell[],
  offset: number[],
  basisCol: number,
  beta: Float64Array,
  lambda: number
): number {
  let ll = 0;
  for (const c of sorted) {
    const z = cellZ(beta, c, offset, basisCol);
    ll += c.events * z - c.exposure * softplus(z);
  }
  let pen = 0;
  for (let j = 1; j < basisCol; j++) pen += beta[j] * beta[j];
  return ll - 0.5 * lambda * pen;
}

/**
 * Rejects a degenerate fit with a `CalibrationError` ("IRLS: degenerate fit (…)"): a non-finite
 * coefficient, one with |β| > COEF_MAX, or a penalised score Σ(events − exposure·μ) − λβ over any
 * column (intercept, each bin, basis) above SCORE_TOL·(1 + Σevents). At a true optimum every score
 * is 0; in particular the intercept and basis scores are the per-basis back-cast identity (V28).
 */
export function checkLogitFit(
  cells: FitCell[],
  nBins: number[],
  lambda: number,
  fit: LogitFit
): void {
  const { offset, basisCol, p } = layout(nBins);
  const beta = new Float64Array(p);
  beta[0] = fit.intercept;
  for (let t = 0; t < nBins.length; t++) {
    if (fit.coef[t]?.length !== nBins[t]) {
      throw new CalibrationError(`IRLS: degenerate fit (term ${t} has the wrong bin count)`);
    }
    for (let b = 0; b < nBins[t]; b++) beta[offset[t] + b] = fit.coef[t][b];
  }
  beta[basisCol] = fit.basis;
  for (let j = 0; j < p; j++) {
    if (!(Math.abs(beta[j]) <= COEF_MAX)) {
      throw new CalibrationError(
        `IRLS: degenerate fit (coefficient ${j} = ${beta[j]}, |β| above ${COEF_MAX} or not finite)`
      );
    }
  }
  const sorted = [...cells].sort(compareCells);
  const score = new Float64Array(p);
  let events = 0;
  for (const c of sorted) {
    const r = c.events - c.exposure * logistic(cellZ(beta, c, offset, basisCol));
    events += c.events;
    score[0] += r;
    for (let t = 0; t < nBins.length; t++) score[offset[t] + c.bins[t]] += r;
    if (c.basis === 1) score[basisCol] += r;
  }
  for (let j = 1; j < basisCol; j++) score[j] -= lambda * beta[j];
  const tol = SCORE_TOL * (1 + events);
  for (let j = 0; j < p; j++) {
    if (!(Math.abs(score[j]) <= tol)) {
      const name = j === 0 ? 'intercept' : j === basisCol ? 'basis' : `bin column ${j}`;
      throw new CalibrationError(
        `IRLS: degenerate fit (${name} score ${score[j]}, above ${tol}: fitted events do not match observed)`
      );
    }
  }
}

/**
 * Solves H x = g for symmetric positive semi-definite H (lower triangle used) by Cholesky in
 * column order; an aliased column (pivot under PIVOT_TOL of its diagonal) gets x = 0 and is
 * flagged in `dropped`.
 */
function choleskySolve(
  h: Float64Array[],
  g: Float64Array
): { x: Float64Array; dropped: Uint8Array } {
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
  return { x, dropped };
}

/**
 * Fits the ridge logit. `cells[c].bins[t]` indexes term t's `nBins[t]` bins. The cells are sorted
 * by `compareCells` (a copy is sorted here as well, so every input order gives the same bits).
 * Starts from intercept = logit(Σevents/Σexposure) with `basis` and the bins at 0; stops when the
 * Newton step has max|Δ| < 1e-9; more than 100 iterations is a `CalibrationError`. A larger step
 * is halved until the penalised log-likelihood does not fall (a full step that does not lower it
 * is taken as is, so a well-behaved fit is unchanged bit for bit). A dropped intercept or basis
 * pivot, no ascent within MAX_HALVINGS, and a converged fit failing `checkLogitFit` are each a
 * `CalibrationError`.
 */
export function fitLogit(cells: FitCell[], nBins: number[], lambda: number): LogitFit {
  const sorted = [...cells].sort(compareCells);
  const { offset, basisCol, p } = layout(nBins);

  let events = 0;
  let exposure = 0;
  let hasBasis = false;
  for (const c of sorted) {
    if (c.basis === 1 && c.exposure > 0) hasBasis = true;
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
  const trial = new Float64Array(p);
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
    const { x: delta, dropped } = choleskySolve(h, g);
    if (dropped[0] || (dropped[basisCol] && hasBasis)) {
      throw new CalibrationError(
        `IRLS: degenerate fit (the ${dropped[0] ? 'intercept' : 'basis'} column has no weight at iteration ${iter})`
      );
    }
    let maxStep = 0;
    let finite = true;
    for (let j = 0; j < p; j++) {
      const s = Math.abs(delta[j]);
      if (!Number.isFinite(s)) finite = false;
      if (s > maxStep) maxStep = s;
    }
    if (!finite) break;
    if (maxStep < STEP_TOL) {
      for (let j = 0; j < p; j++) beta[j] += delta[j];
      const fit: LogitFit = {
        intercept: beta[0],
        coef: nBins.map((n, t) => Array.from(beta.subarray(offset[t], offset[t] + n))),
        basis: beta[basisCol],
        iterations: iter
      };
      checkLogitFit(sorted, nBins, lambda, fit);
      return fit;
    }
    // Step-halving: the largest t = 2^-k whose step does not lower the penalised log-likelihood.
    const before = objective(sorted, offset, basisCol, beta, lambda);
    const floor = before - OBJ_TOL * (1 + Math.abs(before));
    let t = 1;
    let accepted = false;
    for (let k = 0; k <= MAX_HALVINGS; k++) {
      for (let j = 0; j < p; j++) trial[j] = beta[j] + t * delta[j];
      const after = objective(sorted, offset, basisCol, trial, lambda);
      if (after >= floor) {
        accepted = true;
        break;
      }
      t *= 0.5;
    }
    if (!accepted) {
      throw new CalibrationError(
        `IRLS: no Newton step of size at least 2^-${MAX_HALVINGS} improves the fit at iteration ${iter}`
      );
    }
    beta.set(trial);
  }
  throw new CalibrationError('IRLS did not converge');
}
