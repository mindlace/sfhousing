// Aalen–Johansen sweep and table extraction (stage-calibration spec §4.4, §6).
import { describe, expect, it } from 'vitest';
import {
  ajSweep,
  ajTable,
  atRisk,
  countAtRisk,
  riskIndex,
  tableMonths
} from '../../lib/fzp-cal/aalen-johansen';
import type { Spell } from '../../lib/fzp-cal/types';
import { mulberry32 } from '../../../src/lib/generator/seed';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import { EXIT_ORDER, type ExitReason } from '../../../src/lib/timelapse/types';

const M = MONTH_DAYS;
const KINDS = ['advance', ...EXIT_ORDER] as const;

let seq = 0;
function spell(a: number, x: number, outcome: Spell['outcome']): Spell {
  seq++;
  return {
    pathway: 'discretionary',
    stage: 'permitFiled',
    a,
    e: 0,
    x,
    outcome,
    projectId: `p${String(seq).padStart(5, '0')}`
  };
}

const floor6 = (v: number) => Math.floor(v * 1e6) / 1e6;

function table(spells: Spell[], kMax = 240, nRiskMin = 1) {
  const sw = ajSweep(spells);
  return { sw, t: ajTable(sw, (j, i) => sw.e[j][i] / sw.n[i], kMax, nRiskMin, spells) };
}

describe('ajSweep and ajTable', () => {
  /*
   * Golden 7-spell example (spec §6). Spells (a, x, outcome) in days, M = MONTH_DAYS:
   *   1 (0, 40, advance)   2 (0, 70, censored)   3 (0, 70, withdrawn)   4 (10, 100, advance)
   *   5 (0, 120, expired)  6 (0, 150, censored)  7 (0, 200, censored)
   * Event durations d = 40, 70, 100, 120; n(d) = #(a <= d) - #(x < d):
   *   n(40) = 7 - 0 = 7; n(70) = 7 - 1 = 6 (the censoring at 70 is still at risk: events first);
   *   n(100) = 7 - 3 = 4 (spell 4 entered at 10, so it is counted from 40 on); n(120) = 7 - 4 = 3.
   * Sweep from S = 1, F = 0:
   *   d=40  advance  : F_adv = 1/7,                    S = 6/7
   *   d=70  withdrawn: F_w   = 6/7 * 1/6 = 1/7,         S = 6/7 * 5/6 = 5/7
   *   d=100 advance  : F_adv = 1/7 + 5/7 * 1/4 = 9/28,  S = 5/7 * 3/4 = 15/28
   *   d=120 expired  : F_exp = 15/28 * 1/3 = 5/28,      S = 15/28 * 2/3 = 5/14
   * Table value at month k = F after every event with d < k*M (M ~ 30.44):
   *   k=1 (d < 30.4): all 0;  k=2 (< 60.9): advance 1/7;  k=3 (< 91.3): + withdrawn 1/7;
   *   k=4..6 (< 121.7 ...): advance 9/28, withdrawn 1/7, expired 5/28.
   * months: the largest k <= 240 with n(k*M) >= 1. n(6M = 182.6) = 7 - 6 = 1; n(7M = 213.1) = 0,
   * and n stays 0 beyond, so months = 6. Values floored to 1e-6:
   *   1/7 = 0.142857..., 9/28 = 0.321428..., 5/28 = 0.178571....
   */
  const golden = [
    spell(0, 40, 'advance'),
    spell(0, 70, 'censored'),
    spell(0, 70, 'withdrawn'),
    spell(10, 100, 'advance'),
    spell(0, 120, 'expired'),
    spell(0, 150, 'censored'),
    spell(0, 200, 'censored')
  ];

  it('golden 7-spell sweep: event durations, risk sets, counts', () => {
    const sw = ajSweep(golden);
    expect(sw.d).toEqual([40, 70, 100, 120]);
    expect(sw.n).toEqual([7, 6, 4, 3]);
    expect(sw.e.advance).toEqual([1, 0, 1, 0]);
    expect(sw.e.withdrawn).toEqual([0, 1, 0, 0]);
    expect(sw.e.expired).toEqual([0, 0, 0, 1]);
    expect(sw.e.disapproved).toEqual([0, 0, 0, 0]);
    expect(sw.e.cancelled).toEqual([0, 0, 0, 0]);
    expect(sw.spells).toBe(7);
    expect(sw.events).toEqual({
      advance: 2,
      withdrawn: 1,
      disapproved: 0,
      cancelled: 0,
      expired: 1
    });
  });

  it('golden 7-spell table: months 6 and the exact floored values', () => {
    const { t } = table(golden);
    expect(t.months).toBe(6);
    expect(t.advance).toEqual([0, 0.142857, 0.142857, 0.321428, 0.321428, 0.321428]);
    expect(t.exit.withdrawn).toEqual([0, 0, 0.142857, 0.142857, 0.142857, 0.142857]);
    expect(t.exit.expired).toEqual([0, 0, 0, 0.178571, 0.178571, 0.178571]);
    expect(t.exit.disapproved).toEqual([0, 0, 0, 0, 0, 0]);
    expect(t.exit.cancelled).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.keys(t.exit)).toEqual(EXIT_ORDER);
    expect(t.S).toBeCloseTo(5 / 14, 12);
  });

  it('months is capped at kMax and needs n(k*M) >= nRiskMin', () => {
    expect(table(golden, 4).t.months).toBe(4);
    expect(table(golden, 4).t.advance).toHaveLength(4);
    // n(k*M) >= 3 holds for k <= 3 (n(3M = 91.3) = 7 - 3 = 4; n(4M = 121.7) = 7 - 5 = 2, and
    // n only falls after that)
    expect(table(golden, 240, 3).t.months).toBe(3);
    expect(table(golden, 240, 8).t.months).toBe(0);
    expect(table(golden, 240, 8).t.advance).toEqual([]);
  });

  it('an advance at x = 0 lands in advance[0]', () => {
    const spells = [spell(0, 0, 'advance'), spell(0, 3 * M, 'censored')];
    const { sw, t } = table(spells);
    expect(sw.d).toEqual([0]);
    expect(sw.n).toEqual([2]);
    expect(t.advance[0]).toBe(0.5);
  });

  it('with no censoring it equals the empirical incidence', () => {
    const rand = mulberry32(11);
    const spells: Spell[] = [];
    for (let i = 0; i < 400; i++) {
      const kind = KINDS[Math.floor(rand() * KINDS.length)];
      spells.push(spell(0, Math.floor(rand() * 600), kind));
    }
    spells.push(spell(0, 600, 'advance')); // keeps n(k*M) >= 1 through month 19
    const { t } = table(spells);
    expect(t.months).toBe(19);
    const N = spells.length;
    for (let k = 1; k <= t.months; k++) {
      for (const j of KINDS) {
        const emp = spells.filter((s) => s.outcome === j && s.x < k * M).length / N;
        const got = j === 'advance' ? t.advance[k - 1] : t.exit[j]![k - 1];
        expect(Math.abs(got - floor6(emp))).toBeLessThanOrEqual(1.000001e-6);
      }
    }
    expect(t.S).toBeCloseTo(0, 12);
  });

  it('all spells censored gives zeros', () => {
    const spells = [10, 50, 90, 200, 400].map((x) => spell(0, x, 'censored'));
    const { sw, t } = table(spells);
    expect(sw.d).toEqual([]);
    expect(t.months).toBe(13);
    expect(t.advance.every((v) => v === 0)).toBe(true);
    for (const r of EXIT_ORDER) expect(t.exit[r]!.every((v) => v === 0)).toBe(true);
    expect(t.S).toBe(1);
  });

  it('random spells with delayed entry: monotone and advance + sum(exit) <= 1', () => {
    const rand = mulberry32(0x5eed);
    const outcomes: Spell['outcome'][] = [...KINDS, 'censored', 'censored'];
    const spells: Spell[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(rand() * 3000);
      const a = rand() < 0.3 ? Math.floor(rand() * x) : 0;
      spells.push(spell(a, x, outcomes[Math.floor(rand() * outcomes.length)]));
    }
    const { t } = table(spells, 240, 5);
    expect(t.months).toBeGreaterThan(12);
    for (let k = 0; k < t.months; k++) {
      let c = t.advance[k];
      for (const r of EXIT_ORDER) c += t.exit[r as ExitReason]![k];
      expect(c).toBeLessThanOrEqual(1);
      if (k > 0) {
        expect(t.advance[k]).toBeGreaterThanOrEqual(t.advance[k - 1]);
        for (const r of EXIT_ORDER) expect(t.exit[r]![k]).toBeGreaterThanOrEqual(t.exit[r]![k - 1]);
      }
    }
  });

  it('the hazard hook replaces e_j/n and is not capped', () => {
    const sw = ajSweep(golden);
    const half = ajTable(sw, (j, i) => (0.5 * sw.e[j][i]) / sw.n[i], 240, 1, golden);
    // d=40: F_adv = 1/14, S = 13/14
    expect(half.advance[1]).toBe(floor6(1 / 14));
    const big = ajTable(
      sw,
      (j) => (j === 'advance' ? 0.8 : j === 'withdrawn' ? 0.3 : 0),
      240,
      1,
      golden
    );
    // d=40: F_adv = 0.8, F_w = 0.3, S = 1 - 1.1 = -0.1: no cap inside ajTable (the caller's job).
    // d=70: F_adv = 0.8 + (-0.1)(0.8) = 0.72. Four events: S = (-0.1)^4 = 1e-4.
    expect(big.advance[1]).toBe(0.8);
    expect(big.exit.withdrawn![1]).toBe(0.3);
    expect(big.advance[2]).toBe(0.72);
    expect(big.S).toBeCloseTo(1e-4, 15);
  });

  it('is independent of input order', () => {
    const rev = [...golden].reverse();
    expect(ajSweep(rev)).toEqual(ajSweep(golden));
  });
});

describe('weighted spells (ruling R13)', () => {
  const golden = [
    spell(0, 40, 'advance'),
    spell(0, 70, 'censored'),
    spell(0, 70, 'withdrawn'),
    spell(10, 100, 'advance'),
    spell(0, 120, 'expired'),
    spell(0, 150, 'censored'),
    spell(0, 200, 'censored')
  ];

  it('every w = 1 gives the unweighted golden sweep and table bit for bit', () => {
    const ones = golden.map((s) => ({ ...s, w: 1 }));
    expect(ajSweep(ones)).toEqual(ajSweep(golden));
    expect(table(ones).t).toEqual(table(golden).t);
    const rand = mulberry32(0x5eed);
    const outcomes: Spell['outcome'][] = [...KINDS, 'censored', 'censored'];
    const many: Spell[] = [];
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(rand() * 3000);
      const a = rand() < 0.3 ? Math.floor(rand() * x) : 0;
      many.push(spell(a, x, outcomes[Math.floor(rand() * outcomes.length)]));
    }
    const manyOnes = many.map((s) => ({ ...s, w: 1 }));
    expect(ajSweep(manyOnes)).toEqual(ajSweep(many));
    expect(table(manyOnes, 240, 5).t).toEqual(table(many, 240, 5).t);
  });

  /*
   * The golden spells with the first advance (x = 40) weighted 2: total weight 8.
   *   n(40) = 8, n(70) = 8 - 2 = 6, n(100) = 8 - 4 = 4, n(120) = 3; e_adv = 2, 0, 1, 0.
   *   d=40  F_adv = 2/8 = 0.25,                S = 0.75
   *   d=70  F_w   = 0.75/6 = 0.125,            S = 0.625
   *   d=100 F_adv = 0.25 + 0.625/4 = 0.40625,  S = 0.46875
   *   d=120 F_exp = 0.46875/3 = 0.15625,       S = 0.3125
   * months: n(6M) = 8 - 7 = 1, n(7M) = 0, so 6. The floored table values are exact.
   */
  it('a weight scales the spell its at-risk contribution and its event', () => {
    const w = golden.map((s, i) => (i === 0 ? { ...s, w: 2 } : s));
    const sw = ajSweep(w);
    expect(sw.n).toEqual([8, 6, 4, 3]);
    expect(sw.e.advance).toEqual([2, 0, 1, 0]);
    expect(sw.events.advance).toBe(3);
    // the observed, unweighted count the ladder's N_EVENTS_MIN reads (ruling R18)
    expect(sw.observed).toEqual({
      advance: 2,
      withdrawn: 1,
      disapproved: 0,
      cancelled: 0,
      expired: 1
    });
    expect(sw.spells).toBe(7);
    const { t } = table(w);
    expect(t.months).toBe(6);
    expect(t.advance).toEqual([0, 0.25, 0.25, 0.40625, 0.40625, 0.40625]);
    expect(t.exit.withdrawn).toEqual([0, 0, 0.125, 0.125, 0.125, 0.125]);
    expect(t.exit.expired).toEqual([0, 0, 0, 0.15625, 0.15625, 0.15625]);
    expect(t.S).toBeCloseTo(0.3125, 15);
  });

  /*
   * nRiskMin 3: unweighted n(3M = 91.3) = 4 and n(4M = 121.7) = 7 - 5 = 2, so months = 3.
   * With the censored spell at 200 weighted 5, the weighted risk set at 4M is 1 + 5 = 6 >= 3 (and
   * at 6M it is 5): weights would lengthen the table to 6 months, and must not (ruling R18).
   */
  it('weights never lengthen the table: N_RISK_MIN counts observed records (ruling R18)', () => {
    const w = golden.map((s, i) => (i === 6 ? { ...s, w: 5 } : s));
    const idx = riskIndex(w);
    expect(atRisk(idx, 4 * M)).toBe(6);
    expect(countAtRisk(idx, 4 * M)).toBe(2);
    expect(tableMonths(w, 240, 3)).toBe(3);
    expect(tableMonths(golden, 240, 3)).toBe(3);
    expect(table(w, 240, 3).t.months).toBe(3);
  });
});
