import { describe, expect, it } from 'vitest';
import {
  BAND_RUNS,
  bandSeed,
  createBandState,
  nearestRank,
  quantiles,
  representativeIndex
} from './band';

/** Run `i` has the constant value `v(i)` in every one of `months` months, plus a month offset. */
function constRuns(n: number, v: (i: number) => number, months = 3): Int32Array[] {
  return Array.from({ length: n }, (_, i) => {
    const a = new Int32Array(months);
    for (let m = 0; m < months; m++) a[m] = v(i) + m * 1000;
    return a;
  });
}

describe('constants and seeds', () => {
  it('uses 101 runs and seeds i + 1', () => {
    expect(BAND_RUNS).toBe(101);
    expect(bandSeed(0)).toBe(1);
    expect(bandSeed(100)).toBe(101);
  });
});

describe('nearestRank', () => {
  it('is sorted[ceil(q * n) - 1]', () => {
    const sorted = Array.from({ length: 101 }, (_, i) => i * 10);
    expect(nearestRank(sorted, 0.1)).toBe(100);
    expect(nearestRank(sorted, 0.5)).toBe(500);
    expect(nearestRank(sorted, 0.9)).toBe(900);
    const s16 = Array.from({ length: 16 }, (_, i) => i);
    expect(nearestRank(s16, 0.1)).toBe(1);
    expect(nearestRank(s16, 0.5)).toBe(7);
    expect(nearestRank(s16, 0.9)).toBe(14);
  });

  it('stays in range at the extremes', () => {
    expect(nearestRank([5], 0.1)).toBe(5);
    expect(nearestRank([5, 6], 1)).toBe(6);
    expect(nearestRank([5, 6], 0)).toBe(5);
  });
});

describe('quantiles', () => {
  it('gives sorted[10], [50], [90] per month at n = 101', () => {
    // shuffled order: value = (i * 37) % 101 is a permutation of 0..100
    const runs = constRuns(101, (i) => ((i * 37) % 101) * 7 - 300);
    const q = quantiles(runs);
    expect(q).toHaveLength(3);
    for (let m = 0; m < 3; m++) {
      expect(q[m]).toEqual({
        p10: 10 * 7 - 300 + m * 1000,
        p50: 50 * 7 - 300 + m * 1000,
        p90: 90 * 7 - 300 + m * 1000
      });
    }
  });

  it('gives indices 1, 7 and 14 at n = 16', () => {
    const runs = constRuns(16, (i) => ((i * 5) % 16) * 3, 2);
    expect(quantiles(runs)[1]).toEqual({
      p10: 1 * 3 + 1000,
      p50: 7 * 3 + 1000,
      p90: 14 * 3 + 1000
    });
  });

  it('ranks each month independently', () => {
    const a = Int32Array.from([1, 9]);
    const b = Int32Array.from([5, 5]);
    const c = Int32Array.from([9, 1]);
    expect(quantiles([a, b, c])).toEqual([
      { p10: 1, p50: 5, p90: 9 },
      { p10: 1, p50: 5, p90: 9 }
    ]);
  });

  it('handles negative values and does not mutate its inputs', () => {
    const runs = constRuns(5, (i) => 2 - i * 3, 1);
    const copy = runs.map((r) => Int32Array.from(r));
    expect(quantiles(runs)[0]).toEqual({ p10: -10, p50: -4, p90: 2 });
    expect(runs).toEqual(copy);
  });

  it('is [] when no runs are given', () => {
    expect(quantiles([])).toEqual([]);
  });
});

describe('representativeIndex', () => {
  it('is the rank-50 run by final value at n = 101', () => {
    const finals = Array.from({ length: 101 }, (_, i) => ((i * 37) % 101) * 5);
    const idx = representativeIndex(finals);
    expect(finals[idx]).toBe(50 * 5);
    expect(idx).toBe(finals.indexOf(250));
  });

  it('breaks a tie at rank 50 by the lower index', () => {
    // 50 values below 100, then ranks 50 and 51 tie at 100 (indices 70 and 20), 49 values above
    const tied = [70, 20];
    const finals: number[] = [];
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 101; i++) {
      if (tied.includes(i)) finals.push(100);
      else finals.push(lo < 50 ? lo++ : 200 + hi++);
    }
    expect(representativeIndex(finals)).toBe(20);
  });

  it('uses ceil(0.5 n) - 1 for partial n', () => {
    expect(representativeIndex([30, 10, 20, 40])).toBe(2); // n=4 -> rank 1 -> value 20
    expect(representativeIndex([7])).toBe(0);
  });

  it('picks index 50 when all finals are equal at n = 101', () => {
    expect(representativeIndex(new Array<number>(101).fill(7))).toBe(50);
  });

  it('throws on no runs', () => {
    expect(() => representativeIndex([])).toThrow(RangeError);
  });
});

describe('createBandState', () => {
  it('defaults to BAND_RUNS and starts empty', () => {
    const s = createBandState();
    expect(s.total).toBe(BAND_RUNS);
    expect(s.fzpCount).toBe(0);
    expect(s.pairs).toBe(0);
    expect(s.band()).toEqual([]);
    expect(s.planEffectBand()).toEqual([]);
    expect(() => s.finals()).toThrow(RangeError);
    expect(() => s.representativeSeed()).toThrow(RangeError);
  });

  it('computes band over the FZP runs set so far', () => {
    const s = createBandState();
    const runs = constRuns(16, (i) => ((i * 5) % 16) * 3, 2);
    runs.forEach((r, i) => s.setFzp(i, r));
    expect(s.fzpCount).toBe(16);
    expect(s.band()).toEqual(quantiles(runs));
    expect(s.pairs).toBe(0);
    expect(s.planEffectBand()).toEqual([]);
  });

  it('counts pairs only from setPair, and builds planEffectBand from them', () => {
    const s = createBandState();
    const eff = constRuns(16, (i) => ((i * 5) % 16) * 3, 2);
    for (let i = 0; i < 4; i++) s.setPair(i, eff[i]);
    expect(s.pairs).toBe(4);
    expect(s.fzpCount).toBe(0);
    expect(s.planEffectBand()).toEqual(quantiles(eff.slice(0, 4)));
    expect(s.band()).toEqual([]);
    for (let i = 4; i < 16; i++) s.setPair(i, eff[i]);
    expect(s.planEffectBand()).toEqual(quantiles(eff));
  });

  it('refreshes after further sets and counts a re-set index once', () => {
    const s = createBandState(5);
    s.setFzp(0, Int32Array.of(10));
    expect(s.band()).toEqual([{ p10: 10, p50: 10, p90: 10 }]);
    s.setFzp(0, Int32Array.of(20));
    expect(s.fzpCount).toBe(1);
    expect(s.band()).toEqual([{ p10: 20, p50: 20, p90: 20 }]);
    s.setFzp(1, Int32Array.of(0));
    expect(s.band()).toEqual([{ p10: 0, p50: 0, p90: 20 }]);
    s.setPair(2, Int32Array.of(3));
    s.setPair(2, Int32Array.of(4));
    expect(s.pairs).toBe(1);
  });

  it('exposes FZP final values only, in index order, for the representative', () => {
    const s = createBandState(101);
    const runs = constRuns(101, (i) => ((i * 37) % 101) * 5);
    // pair series with unrelated big values must not leak into finals
    for (let i = 100; i >= 0; i--) {
      s.setFzp(i, runs[i]);
      s.setPair(i, Int32Array.of(999999, 999999, 999999));
    }
    const finals = s.finals();
    expect(finals).toHaveLength(101);
    expect(finals[3]).toBe(runs[3][2]);
    const rep = representativeIndex(finals);
    expect(finals[rep]).toBe(50 * 5 + 2000);
    expect(s.representativeSeed()).toBe(bandSeed(rep));
    expect(runs[rep][2]).toBe(finals[rep]);
    // final p50 equals the representative's final value
    const band = s.band();
    expect(band[band.length - 1].p50).toBe(finals[rep]);
  });

  it('refuses finals and representativeSeed until all runs are set', () => {
    const s = createBandState(4);
    for (let i = 0; i < 3; i++) s.setFzp(i, Int32Array.of(i));
    expect(() => s.finals()).toThrow(RangeError);
    expect(() => s.representativeSeed()).toThrow(RangeError);
    s.setFzp(3, Int32Array.of(-5));
    expect(s.finals()).toEqual([0, 1, 2, -5]);
    // sorted: -5 (i=3), 0, 1, 2 -> rank ceil(2)-1 = 1 -> i = 0 -> seed 1
    expect(s.representativeSeed()).toBe(1);
  });

  it('puts a non-zero representative at its run index, not its position', () => {
    const s = createBandState(3);
    s.setFzp(2, Int32Array.of(5));
    s.setFzp(1, Int32Array.of(9));
    s.setFzp(0, Int32Array.of(1));
    // finals [1, 9, 5] -> sorted 1, 5, 9 -> median is run 2 -> seed 3
    expect(s.representativeSeed()).toBe(bandSeed(2));
  });

  it('validates series length at set time', () => {
    const s = createBandState(4);
    expect(() => s.setFzp(0, new Int32Array(0))).toThrow(RangeError);
    expect(() => s.setPair(0, new Int32Array(0))).toThrow(RangeError);
    s.setFzp(0, Int32Array.of(1, 2));
    expect(() => s.setFzp(1, Int32Array.of(1))).toThrow(RangeError);
    expect(s.fzpCount).toBe(1);
    expect(s.band()).toHaveLength(2);
    s.setPair(0, Int32Array.of(1, 2, 3));
    expect(() => s.setPair(1, Int32Array.of(1, 2))).toThrow(RangeError);
    expect(s.pairs).toBe(1);
    expect(s.planEffectBand()).toHaveLength(3);
  });

  it('rejects out-of-range indices', () => {
    const s = createBandState(3);
    expect(() => s.setFzp(3, Int32Array.of(1))).toThrow(RangeError);
    expect(() => s.setPair(-1, Int32Array.of(1))).toThrow(RangeError);
  });
});
