import type { TimelineScore } from './types';

/** Band quantiles, the representative seed and the host's band accumulator (spec 4.6). */

/** Number of band runs N. Odd, so the median is a single run (spec 4.6). */
export const BAND_RUNS = 101;

type Quantile = TimelineScore['band'][number];

/** Seed of band run `i` (0-based): `i + 1`. */
export function bandSeed(i: number): number {
  return i + 1;
}

/** Nearest-rank quantile of an ascending `sorted` array: `sorted[ceil(q * n) - 1]`. */
export function nearestRank(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  const k = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sorted[k];
}

/**
 * Per-month nearest-rank p10, p50 and p90 over the runs given. Every run is a per-month series
 * of the same length; `[]` when there are no runs. Each month sorts one column of n values in a
 * reused scratch buffer, so the cost is months * n log n with no per-month allocation.
 */
export function quantiles(runs: readonly Int32Array[]): Quantile[] {
  const n = runs.length;
  if (n === 0) return [];
  const months = runs[0].length;
  for (const r of runs) {
    if (r.length !== months) throw new RangeError('band runs differ in length');
  }
  const scratch = new Int32Array(n);
  const out: Quantile[] = new Array(months);
  for (let m = 0; m < months; m++) {
    for (let r = 0; r < n; r++) scratch[r] = runs[r][m];
    scratch.sort();
    out[m] = {
      p10: nearestRank(scratch, 0.1),
      p50: nearestRank(scratch, 0.5),
      p90: nearestRank(scratch, 0.9)
    };
  }
  return out;
}

/**
 * Index (into `finals`) of the representative run: sort by final value, ties by lower index
 * first, take rank `ceil(0.5 * n) - 1` (50 for n = 101).
 */
export function representativeIndex(finals: readonly number[]): number {
  const n = finals.length;
  if (n === 0) throw new RangeError('no runs');
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => finals[a] - finals[b] || a - b);
  return order[Math.ceil(0.5 * n) - 1];
}

export type BandState = {
  readonly total: number;
  /** FZP runs set so far. */
  readonly fzpCount: number;
  /** Completed pairs (`setPair` calls), the timeline's `bandRuns`. */
  readonly pairs: number;
  /** Record FZP run `i`'s `completedNet` series. */
  setFzp(i: number, completedNet: Int32Array): void;
  /** Record pair `i`'s `planEffect.completedNetNew` series and mark the pair done. */
  setPair(i: number, planEffectCompletedNetNew: Int32Array): void;
  /** `completedNet` quantiles over the FZP runs set so far; `[]` before any. */
  band(): Quantile[];
  /** `planEffect.completedNetNew` quantiles over the pairs done so far; `[]` before any. */
  planEffectBand(): Quantile[];
  /**
   * Final-month `completedNet` of the FZP runs set so far, in ascending run index. Only FZP
   * runs contribute. Once all `total` runs are set, position equals run index i, so
   * `representativeIndex(finals())` is the representative's i and `bandSeed(i)` its seed.
   */
  finals(): number[];
};

/** Mutable accumulator the scenario host drives; quantiles are cached until the next set. */
export function createBandState(total: number = BAND_RUNS): BandState {
  const fzp: (Int32Array | undefined)[] = new Array(total);
  const pair: (Int32Array | undefined)[] = new Array(total);
  let fzpCount = 0;
  let pairs = 0;
  let bandCache: Quantile[] | null = null;
  let effectCache: Quantile[] | null = null;

  const check = (i: number): void => {
    if (!Number.isInteger(i) || i < 0 || i >= total) throw new RangeError(`run index ${i}`);
  };
  const present = (a: (Int32Array | undefined)[]): Int32Array[] =>
    a.filter((r): r is Int32Array => r !== undefined);

  return {
    total,
    get fzpCount() {
      return fzpCount;
    },
    get pairs() {
      return pairs;
    },
    setFzp(i, completedNet) {
      check(i);
      if (fzp[i] === undefined) fzpCount++;
      fzp[i] = completedNet;
      bandCache = null;
    },
    setPair(i, planEffectCompletedNetNew) {
      check(i);
      if (pair[i] === undefined) pairs++;
      pair[i] = planEffectCompletedNetNew;
      effectCache = null;
    },
    band() {
      return (bandCache ??= quantiles(present(fzp)));
    },
    planEffectBand() {
      return (effectCache ??= quantiles(present(pair)));
    },
    finals() {
      return present(fzp).map((r) => (r.length > 0 ? r[r.length - 1] : 0));
    }
  };
}
