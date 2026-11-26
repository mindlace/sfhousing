// A weighted multinomial logit fitted by Newton-Raphson with step halving: the car-ownership
// choice's estimator (spec "Choice model"). Level 0 is the base; each other level has its own
// coefficient per feature. exp and log come from math.ts (fdlibm) so a refit is byte-identical
// across engines.
import { exp, log } from '../../../src/lib/timelapse/math';

export interface MnlOpts {
  /** Newton iterations at most (default 100). */
  maxIter?: number;
  /** Stop when every step in the scaled coefficients is below this (default 1e-10). */
  tol?: number;
  /** A fixed utility per record and level 1..levels-1 (n x (levels - 1)), added to the fit's. */
  offset?: Float64Array;
  /**
   * The sample size the standard errors are stated at: the weights are rescaled to sum to it.
   * Default: the number of records with a positive weight (survey weights scale the likelihood,
   * not the information).
   */
  seN?: number;
}

export interface MnlFit {
  /** (levels - 1) x nFeat, level-major: coef[(k - 1) * nFeat + f]. */
  coef: Float64Array;
  se: Float64Array;
  /** Weighted log-likelihood at the estimate. */
  logLik: number;
  iterations: number;
}

/**
 * Fit a multinomial logit. `x` is n x nFeat row-major (a constant is a column of ones), `choice`
 * the chosen level of each record, `weight` its weight (zero drops it). Features are scaled to unit
 * weighted RMS for the solve and the estimate is scaled back. Throws when the information matrix
 * is singular (a feature that never varies for some level, or collinear features).
 */
export function fitMnl(
  x: Float64Array,
  nFeat: number,
  choice: Uint8Array,
  weight: Float64Array,
  levels: number,
  opts: MnlOpts
): MnlFit {
  const n = choice.length;
  if (x.length !== n * nFeat) throw new RangeError('fitMnl: x is not n x nFeat');
  if (weight.length !== n) throw new RangeError('fitMnl: weight is not n long');
  const L1 = levels - 1;
  if (opts.offset && opts.offset.length !== n * L1)
    throw new RangeError('fitMnl: offset is not n x (levels - 1)');
  const P = L1 * nFeat;
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-10;

  // Feature scales.
  const scale = new Float64Array(nFeat);
  let sumW = 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const w = weight[i];
    if (!(w > 0)) continue;
    sumW += w;
    used++;
    for (let f = 0; f < nFeat; f++) scale[f] += w * x[i * nFeat + f] * x[i * nFeat + f];
  }
  if (!(sumW > 0)) throw new RangeError('fitMnl: no record has a positive weight');
  for (let f = 0; f < nFeat; f++) scale[f] = scale[f] > 0 ? Math.sqrt(scale[f] / sumW) : 1;
  const xs = new Float64Array(n * nFeat);
  for (let i = 0; i < n; i++)
    for (let f = 0; f < nFeat; f++) xs[i * nFeat + f] = x[i * nFeat + f] / scale[f];

  const beta = new Float64Array(P);
  const prob = new Float64Array(levels);
  const util = new Float64Array(levels);

  /** Log-likelihood; with `grad`/`info` also the gradient and the information (-Hessian). */
  const evaluate = (b: Float64Array, grad?: Float64Array, info?: Float64Array): number => {
    if (grad) grad.fill(0);
    if (info) info.fill(0);
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const w = weight[i];
      if (!(w > 0)) continue;
      util[0] = 0;
      let max = 0;
      for (let k = 1; k < levels; k++) {
        let u = opts.offset ? opts.offset[i * L1 + k - 1] : 0;
        const base = (k - 1) * nFeat;
        for (let f = 0; f < nFeat; f++) u += b[base + f] * xs[i * nFeat + f];
        util[k] = u;
        if (u > max) max = u;
      }
      let total = 0;
      for (let k = 0; k < levels; k++) {
        prob[k] = exp(util[k] - max);
        total += prob[k];
      }
      for (let k = 0; k < levels; k++) prob[k] /= total;
      const c = choice[i];
      ll += w * (util[c] - max - log(total));
      if (!grad || !info) continue;
      for (let k = 1; k < levels; k++) {
        const r = (c === k ? 1 : 0) - prob[k];
        const base = (k - 1) * nFeat;
        for (let f = 0; f < nFeat; f++) grad[base + f] += w * r * xs[i * nFeat + f];
        for (let j = 1; j < levels; j++) {
          const h = w * prob[k] * ((k === j ? 1 : 0) - prob[j]);
          if (h === 0) continue;
          const bj = (j - 1) * nFeat;
          for (let f = 0; f < nFeat; f++) {
            const hf = h * xs[i * nFeat + f];
            const row = (base + f) * P + bj;
            for (let g = 0; g < nFeat; g++) info[row + g] += hf * xs[i * nFeat + g];
          }
        }
      }
    }
    return ll;
  };

  const grad = new Float64Array(P);
  const info = new Float64Array(P * P);
  const chol = new Float64Array(P * P);
  const step = new Float64Array(P);
  const trial = new Float64Array(P);
  let ll = evaluate(beta, grad, info);
  let iterations = 0;
  for (; iterations < maxIter;) {
    iterations++;
    cholesky(info, P, chol);
    solveCholesky(chol, P, grad, step);
    let t = 1;
    for (let h = 0; h < 40; h++) {
      for (let p = 0; p < P; p++) trial[p] = beta[p] + t * step[p];
      if (evaluate(trial) >= ll - 1e-12 * Math.abs(ll)) break;
      t /= 2;
    }
    let maxStep = 0;
    for (let p = 0; p < P; p++) {
      maxStep = Math.max(maxStep, Math.abs(trial[p] - beta[p]));
      beta[p] = trial[p];
    }
    ll = evaluate(beta, grad, info);
    if (maxStep < tol) break;
  }

  // Standard errors from the information at the estimate, with the weights rescaled to seN.
  cholesky(info, P, chol);
  const seN = opts.seN ?? used;
  const e = new Float64Array(P);
  const col = new Float64Array(P);
  const coef = new Float64Array(P);
  const se = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    e.fill(0);
    e[p] = 1;
    solveCholesky(chol, P, e, col);
    const f = p % nFeat;
    coef[p] = beta[p] / scale[f];
    se[p] = Math.sqrt((col[p] * sumW) / seN) / scale[f];
  }
  return { coef, se, logLik: ll, iterations };
}

/** Lower Cholesky factor of a symmetric positive definite P x P matrix; throws if singular. */
function cholesky(a: Float64Array, P: number, out: Float64Array): void {
  out.fill(0);
  let diagMax = 0;
  for (let i = 0; i < P; i++) diagMax = Math.max(diagMax, a[i * P + i]);
  for (let i = 0; i < P; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * P + j];
      for (let k = 0; k < j; k++) s -= out[i * P + k] * out[j * P + k];
      if (i === j) {
        if (!(s > 1e-12 * diagMax))
          throw new RangeError(
            'fitMnl: singular information (a feature that never varies, or collinear features)'
          );
        out[i * P + i] = Math.sqrt(s);
      } else out[i * P + j] = s / out[j * P + j];
    }
  }
}

/** Solve (L L^T) x = b. */
function solveCholesky(l: Float64Array, P: number, b: Float64Array, x: Float64Array): void {
  for (let i = 0; i < P; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * P + k] * x[k];
    x[i] = s / l[i * P + i];
  }
  for (let i = P - 1; i >= 0; i--) {
    let s = x[i];
    for (let k = i + 1; k < P; k++) s -= l[k * P + i] * x[k];
    x[i] = s / l[i * P + i];
  }
}
