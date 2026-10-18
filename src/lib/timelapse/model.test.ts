import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../generator/seed';
import small from './fixtures/calibration-small.json';
import { exp, log } from './math';
import { readFileSync } from 'node:fs';
import {
  CalibrationFormatError,
  binIndex,
  chanceTable,
  cumulativeIncidence,
  cumulativeTotal,
  eventualProbabilities,
  initiationHazard,
  parseCalibration,
  sampleTransition,
  typicalMonths
} from './model';
import { MONTH_DAYS, monthsIn } from './time';
import {
  EXIT_ORDER,
  PATHWAYS,
  pathwayStages,
  type Calibration,
  type FeatureId,
  type Transition
} from './types';

const cal = small as unknown as Calibration;
const t = cal.transitions.discretionary.permitFiled as Transition;

// Closed form for k > K = 12 with C(K) = 0.7 and rho = 0.06 (tail advance 0.05, expired 0.01).
function closedForm(k: number) {
  const K = 12;
  const rho = 0.05 + 0.01;
  const survive = 1 - 0.7;
  const decay = 1 - exp((k - K) * log(1 - rho));
  return {
    advance: 0.6 + survive * (0.05 / rho) * decay,
    expired: 0.1 + survive * (0.01 / rho) * decay
  };
}

describe('binIndex', () => {
  it('counts edges <= x, minus one, clamped', () => {
    const edges = [0, 2, 5];
    expect(binIndex(edges, -1)).toBe(0);
    expect(binIndex(edges, 0)).toBe(0);
    expect(binIndex(edges, 1.99)).toBe(0);
    expect(binIndex(edges, 2)).toBe(1);
    expect(binIndex(edges, 5)).toBe(2);
    expect(binIndex(edges, 99)).toBe(2);
  });
});

describe('initiationHazard', () => {
  it('is the logistic of intercept plus the binned coefficient', () => {
    const f = { potentialRatio: 3 } as Record<FeatureId, number>;
    expect(initiationHazard(cal.initiation, f)).toBe(1 / (1 + exp(-(-6 + 0.5))));
  });

  it('sums the terms in array order', () => {
    const m = {
      ...cal.initiation,
      terms: [
        { feature: 'potentialRatio' as const, bins: [0, 2, 5], coef: [0, 0.5, 1] },
        { feature: 'existingUnits' as const, bins: [0, 10], coef: [0.25, -0.75] }
      ]
    };
    const f = { potentialRatio: 6, existingUnits: 12 } as Record<FeatureId, number>;
    expect(initiationHazard(m, f)).toBe(1 / (1 + exp(-(-6 + 1 + -0.75))));
  });
});

// Printed from the first run; pins the bit-exact math.ts evaluation.
const GOLDEN = {
  advance13: 0.615,
  expired13: 0.10300000000000001,
  advance24: 0.7310199212964368,
  expired24: 0.12620398425928736
};

describe('cumulativeIncidence', () => {
  it('is zero at month 0', () => {
    expect(cumulativeIncidence(t, 0)).toEqual({ advance: 0, exit: { expired: 0 } });
  });

  it('returns the table values for k = 1..K', () => {
    for (let k = 1; k <= 12; k++) {
      const r = cumulativeIncidence(t, k);
      expect(r.advance).toBe(t.advance[k - 1]);
      expect(r.exit.expired).toBe(t.exit.expired![k - 1]);
    }
  });

  it('extends past K by the closed form (goldens and formula)', () => {
    const r13 = cumulativeIncidence(t, 13);
    const r24 = cumulativeIncidence(t, 24);
    expect(r13.advance).toBeCloseTo(closedForm(13).advance, 15);
    expect(r13.exit.expired).toBeCloseTo(closedForm(13).expired, 15);
    expect(r24.advance).toBeCloseTo(closedForm(24).advance, 15);
    expect(r24.exit.expired).toBeCloseTo(closedForm(24).expired, 15);
    expect(r13.advance).toBe(GOLDEN.advance13);
    expect(r13.exit.expired).toBe(GOLDEN.expired13);
    expect(r24.advance).toBe(GOLDEN.advance24);
    expect(r24.exit.expired).toBe(GOLDEN.expired24);
  });

  it('advance plus exits equals C(k) for k in 0..60', () => {
    for (let k = 0; k <= 60; k++) {
      const r = cumulativeIncidence(t, k);
      const sum = r.advance + Object.values(r.exit).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(cumulativeTotal(t, k), 12);
    }
    expect(cumulativeTotal(t, 0)).toBe(0);
    expect(cumulativeTotal(t, 12)).toBe(0.6 + 0.1);
  });

  it('is non-decreasing and stays below the eventual probability', () => {
    const eventual = eventualProbabilities(t, 0);
    let prev = cumulativeIncidence(t, 0);
    for (let k = 1; k <= 60; k++) {
      const r = cumulativeIncidence(t, k);
      expect(r.advance).toBeGreaterThanOrEqual(prev.advance);
      expect(r.exit.expired!).toBeGreaterThanOrEqual(prev.exit.expired!);
      expect(r.advance).toBeLessThan(eventual.advance);
      expect(r.exit.expired!).toBeLessThan(eventual.exit.expired!);
      prev = r;
    }
    const far = cumulativeIncidence(t, 600);
    expect(Math.abs(far.advance - eventual.advance)).toBeLessThan(1e-6);
    expect(Math.abs(far.exit.expired! - eventual.exit.expired!)).toBeLessThan(1e-6);
  });

  it('reports a reason that exists only in the tail as zero until the table ends', () => {
    const tt: Transition = {
      ...t,
      tail: { advance: 0.05, exit: { expired: 0.01, cancelled: 0.01 } }
    };
    for (let k = 0; k <= 12; k++) {
      expect(cumulativeIncidence(tt, k).exit.cancelled).toBe(0);
    }
    expect(cumulativeIncidence(tt, 13).exit.cancelled).toBeGreaterThan(0);
  });

  it('orders exit keys by EXIT_ORDER', () => {
    const tt: Transition = {
      ...t,
      exit: { expired: t.exit.expired, withdrawn: t.exit.expired },
      tail: { advance: 0.05, exit: { disapproved: 0.01, expired: 0.01 } }
    };
    const keys = Object.keys(cumulativeIncidence(tt, 5).exit);
    expect(keys).toEqual(EXIT_ORDER.filter((e) => keys.includes(e)));
    expect(keys).toEqual(['withdrawn', 'disapproved', 'expired']);
    expect(Object.keys(cumulativeIncidence(tt, 5))).toEqual(['advance', 'exit']);
    expect(Object.keys(eventualProbabilities(tt, 5).exit)).toEqual([
      'withdrawn',
      'disapproved',
      'expired'
    ]);
  });

  it('rejects negative and non-integer months', () => {
    expect(() => cumulativeIncidence(t, -1)).toThrow(RangeError);
    expect(() => cumulativeIncidence(t, 1.5)).toThrow(RangeError);
  });
});

describe('eventualProbabilities', () => {
  it('sums to 1 whatever the months elapsed', () => {
    for (const m of [0, 6, 12, 30]) {
      const r = eventualProbabilities(t, m);
      expect(r.advance + Object.values(r.exit).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  it('is memoryless from K onward', () => {
    for (const m of [12, 13, 30]) {
      const r = eventualProbabilities(t, m);
      expect(Math.abs(r.advance - 0.05 / 0.06)).toBeLessThan(1e-15);
      expect(Math.abs(r.exit.expired! - 0.01 / 0.06)).toBeLessThan(1e-15);
    }
  });

  it('matches the definition inside the table', () => {
    const m = 6;
    const inf = eventualProbabilities(t, 0);
    const at = cumulativeIncidence(t, m);
    const denom = 1 - cumulativeTotal(t, m);
    expect(eventualProbabilities(t, m).advance).toBeCloseTo((inf.advance - at.advance) / denom, 12);
  });
});

describe('sampleTransition', () => {
  const M = MONTH_DAYS;
  // Least k > m with C(k) > c, by linear scan over cumulativeIncidence (independent of the sampler).
  function eventMonthByScan(tt: Transition, c: number, m: number): number {
    const total = (k: number) => {
      const r = cumulativeIncidence(tt, k);
      return r.advance + Object.values(r.exit).reduce((a, b) => a + b, 0);
    };
    let k = m + 1;
    while (total(k) <= c) k++;
    return k;
  }

  it('u = 0 at month 0 advances in the first month', () => {
    const r = sampleTransition(t, 0, 0);
    expect(r.kind).toBe('advance');
    expect(r.days).toBeGreaterThanOrEqual(0);
    expect(r.days).toBeLessThanOrEqual(Math.ceil(M) - 1);
  });

  it('u near 1 lands in the tail, split by p_j / rho', () => {
    const u = 1 - 1e-12;
    const r = sampleTransition(t, u, 0);
    const k = monthsIn(0, r.days) + 1;
    expect(k).toBeGreaterThan(12);
    const lo = cumulativeTotal(t, k - 1);
    const hi = cumulativeTotal(t, k);
    expect(lo).toBeLessThanOrEqual(u);
    expect(u).toBeLessThan(hi);
    const advanceTop = lo + (hi - lo) * (0.05 / 0.06);
    expect(r.kind).toBe(u < advanceTop ? 'advance' : 'expired');
  });

  it('never places the event before the months already elapsed', () => {
    for (const u of [0, 0.5, 0.999]) {
      expect(sampleTransition(t, u, 30).days).toBeGreaterThanOrEqual(Math.ceil(30 * M));
    }
  });

  it('agrees with cumulativeIncidence on the event month for 10,000 random draws', () => {
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < 10000; i++) {
      const u = rng();
      const m = Math.floor(rng() * 41);
      const r = sampleTransition(t, u, m);
      const cm = cumulativeTotal(t, m);
      const k = eventMonthByScan(t, cm + (1 - cm) * u, m);
      expect(monthsIn(0, r.days)).toBe(k - 1);
      expect(r.days).toBeGreaterThanOrEqual(Math.ceil(m * M));
      expect(Number.isInteger(r.days)).toBe(true);
      expect(['advance', 'expired']).toContain(r.kind);
    }
  });

  it('splits a table month by the increments of F_j, advance first', () => {
    // Month 1 holds [0, 0.058333): advance [0, 0.05), then expired [0.05, 0.058333).
    expect(sampleTransition(t, 0.0499, 0).kind).toBe('advance');
    expect(sampleTransition(t, 0.0501, 0).kind).toBe('expired');
    expect(monthsIn(0, sampleTransition(t, 0.0501, 0).days)).toBe(0);
    // The day within the month is uniform: phi = 0.5 of the advance slice is mid-month.
    expect(sampleTransition(t, 0.025, 0).days).toBe(Math.floor(0.5 * Math.ceil(M)));
  });

  it('stays finite when rho = 1 (log(1 - rho) = -Infinity)', () => {
    const tt: Transition = { ...t, tail: { advance: 0.75, exit: { expired: 0.25 } } };
    expect(tt.tail.advance + tt.tail.exit.expired!).toBe(1);
    for (const u of [0.71, 0.9, 1 - 1e-12]) {
      expect(monthsIn(0, sampleTransition(tt, u, 0).days)).toBe(12);
    }
    expect(cumulativeTotal(tt, 20)).toBe(1);
    for (const u of [0, 0.5, 0.74, 0.76, 1 - 1e-12]) {
      const r = sampleTransition(tt, u, 20);
      expect(monthsIn(0, r.days)).toBe(20);
      expect(r.kind).toBe(u < 0.75 ? 'advance' : 'expired');
    }
  });

  it('rejects u outside [0, 1) and non-finite u', () => {
    for (const u of [-0.1, 1, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => sampleTransition(t, u, 0)).toThrow(RangeError);
      expect(() => sampleTransition(t, u, 20)).toThrow(RangeError);
    }
  });

  describe('deep in the tail (ruling R8: relative to m by memorylessness)', () => {
    // Fixture table with tail advance 0.2 / expired 0.05: rho = 0.25, advance share 0.8.
    const probe: Transition = { ...t, tail: { advance: 0.2, exit: { expired: 0.05 } } };
    const N = 100000;
    for (const m of [120, 140]) {
      it(`m = ${m}: month m+1 has mass rho, kinds split p_j / rho, days spread`, () => {
        const gap = 1 - cumulativeTotal(probe, m);
        if (m === 120) expect(gap > 1e-15 && gap < 1e-14).toBe(true);
        else expect(gap).toBe(0);
        const rng = mulberry32(0x5eed);
        let first = 0;
        let firstAdvance = 0;
        let fifth = 0;
        let fifthAdvance = 0;
        const firstDays = new Set<number>();
        for (let i = 0; i < N; i++) {
          const r = sampleTransition(probe, rng(), m);
          const k = monthsIn(0, r.days) + 1;
          expect(k).toBeGreaterThan(m);
          if (k === m + 1) {
            first++;
            if (r.kind === 'advance') firstAdvance++;
            firstDays.add(r.days);
          } else if (k === m + 5) {
            fifth++;
            if (r.kind === 'advance') fifthAdvance++;
          }
        }
        expect(Math.abs(first / N - 0.25)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(firstAdvance / first - 0.8)).toBeLessThanOrEqual(0.02);
        expect(Math.abs(fifthAdvance / fifth - 0.8)).toBeLessThanOrEqual(0.02);
        expect(firstDays.size).toBeGreaterThanOrEqual(25);
      });
    }

    it('agrees with the literal spec §4.2 path for m = 13..20 on the same u', () => {
      // Reference: c = C(m) + (1 - C(m)) u, k by linear scan of cumulativeTotal, tail slice.
      function literal(u: number, m: number) {
        const cm = cumulativeTotal(t, m);
        const c = cm + (1 - cm) * u;
        let k = m + 1;
        while (cumulativeTotal(t, k) <= c) k++;
        const lo = cumulativeTotal(t, k - 1);
        const hi = cumulativeTotal(t, k);
        const top = lo + (hi - lo) * (0.05 / 0.06);
        const [kind, slo, shi] = c < top ? ['advance', lo, top] : ['expired', top, hi];
        const phi = (c - (slo as number)) / ((shi as number) - (slo as number));
        const first = Math.ceil((k - 1) * M);
        const end = Math.ceil(k * M);
        return { kind, days: Math.min(first + Math.floor(phi * (end - first)), end - 1) };
      }
      // Verified bit-for-bit: all 16,000 draws give the same kind and the same day.
      const rng = mulberry32(0x5eed);
      for (let m = 13; m <= 20; m++) {
        for (let i = 0; i < 2000; i++) {
          const u = rng();
          expect(sampleTransition(t, u, m)).toEqual(literal(u, m));
        }
      }
    });
  });

  it('stays finite when the tail cannot be resolved in double precision', () => {
    // rho so small that 1 - rho rounds to 1: C is flat past K, so the event month is capped.
    const flat: Transition = { ...t, tail: { advance: 1e-20, exit: {} } };
    for (const m of [0, 13]) {
      const r = sampleTransition(flat, 0.9, m);
      expect(r.kind).toBe('advance');
      expect(monthsIn(0, r.days) + 1).toBe(Math.floor(16777216 / M));
      expect(r.days).toBeLessThan(16777216);
      expect(Math.fround(r.days)).toBe(r.days);
    }
    // u = 1 - 2^-53 with C(m) > 0 would make the literal c round to exactly 1; still finite.
    const top = 1 - 1 / 9007199254740992;
    for (const m of [13, 40]) {
      const cm = cumulativeTotal(t, m);
      expect(cm + (1 - cm) * top).toBe(1);
      const s = sampleTransition(t, top, m);
      expect(Number.isFinite(s.days)).toBe(true);
      expect(s.days).toBeLessThan(16777216);
      expect(s.days).toBeGreaterThanOrEqual(Math.ceil(m * M));
    }
  });

  it('cap-month draws keep the tail kind split for a flat or very slow multi-kind tail', () => {
    // rho = 1e-6 (advance share 0.8): G(cap) is about 0.42, so many draws land on the cap month.
    const slow: Transition = { ...t, tail: { advance: 0.8e-6, exit: { expired: 0.2e-6 } } };
    const cap = Math.floor(16777216 / M);
    for (const m of [0, 12]) {
      const rng = mulberry32(0x5eed);
      let atCap = 0;
      let advance = 0;
      for (let i = 0; i < 100000; i++) {
        const r = sampleTransition(slow, rng(), m);
        if (monthsIn(0, r.days) + 1 !== cap) continue;
        atCap++;
        if (r.kind === 'advance') advance++;
      }
      expect(atCap).toBeGreaterThan(10000);
      expect(Math.abs(advance / atCap - 0.8)).toBeLessThanOrEqual(0.02);
    }
  });

  it('maps every month day range back to that month, up to the Float32-exact cap', () => {
    let bad = 0;
    const cap = Math.floor(16777216 / M);
    for (let k = 1; k <= cap; k++) {
      const first = Math.ceil((k - 1) * M);
      const last = Math.ceil(k * M) - 1;
      if (monthsIn(0, first) !== k - 1 || monthsIn(0, last) !== k - 1) bad++;
    }
    expect(bad).toBe(0);
  });

  it('rejects negative and non-integer months elapsed', () => {
    expect(() => sampleTransition(t, 0.5, -1)).toThrow(RangeError);
    expect(() => sampleTransition(t, 0.5, 2.5)).toThrow(RangeError);
  });
});

describe('chanceTable', () => {
  const T = cal.transitions;
  const adv = (p: 'permitOnly' | 'discretionary', st: string, m = 0) =>
    eventualProbabilities((T[p] as Record<string, Transition>)[st], m).advance;

  it('is the product of eventual advance probabilities along a permitOnly chain', () => {
    const chain =
      adv('permitOnly', 'preApplication') *
      (adv('permitOnly', 'permitFiled') *
        (adv('permitOnly', 'permitIssued') * (adv('permitOnly', 'construction') * 1)));
    const table = chanceTable(cal);
    expect(table.permitOnly.preApplication![0]).toBe(Math.fround(chain));
    expect(table.permitOnly.construction![0]).toBe(
      Math.fround(eventualProbabilities(T.permitOnly.construction!, 0).advance)
    );
  });

  it('runs a discretionary chain through filed and entitled', () => {
    const stages = ['preApplication', 'filed', 'entitled', 'permitFiled', 'permitIssued'];
    let next = adv('discretionary', 'construction');
    for (let i = stages.length - 1; i >= 0; i--) {
      next = adv('discretionary', stages[i]) * next;
    }
    expect(chanceTable(cal).discretionary.preApplication![0]).toBe(Math.fround(next));
  });

  it('has 241 months per array and no filed/entitled on permitOnly', () => {
    const table = chanceTable(cal);
    for (const p of PATHWAYS) {
      for (const arr of Object.values(table[p])) {
        expect(arr).toBeInstanceOf(Float32Array);
        expect(arr).toHaveLength(241);
      }
    }
    expect(Object.keys(table.permitOnly)).toEqual([
      'preApplication',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
    expect(Object.keys(table.discretionary)).not.toContain('complete');
  });

  it('index 240 is the tail value times the next stage chance, and beyond-K is flat', () => {
    const table = chanceTable(cal);
    const tf = T.discretionary.permitFiled!;
    const next0 = adv('discretionary', 'permitIssued') * adv('discretionary', 'construction');
    const tailAdvance = 0.05 / (0.05 + 0.01);
    expect(table.discretionary.permitFiled![240]).toBe(
      Math.fround(eventualProbabilities(tf, 240).advance * next0)
    );
    expect(table.discretionary.permitFiled![240]).toBeCloseTo(tailAdvance * next0, 6);
    expect(table.discretionary.permitFiled![tf.months]).toBe(table.discretionary.permitFiled![240]);
    expect(table.discretionary.permitFiled![0]).toBe(
      Math.fround(eventualProbabilities(tf, 0).advance * next0)
    );
  });

  it('has exactly the occupiable stages of each pathway, in order', () => {
    const table = chanceTable(cal);
    for (const p of PATHWAYS) {
      expect(Object.keys(table[p])).toEqual(pathwayStages(p).filter((s) => s !== 'complete'));
    }
  });

  it('returns fresh objects on every call', () => {
    const a = chanceTable(cal);
    const b = chanceTable(cal);
    expect(a).not.toBe(b);
    expect(a.permitOnly).not.toBe(b.permitOnly);
    expect(a.permitOnly.construction).not.toBe(b.permitOnly.construction);
    a.permitOnly.construction![0] = 0;
    expect(b.permitOnly.construction![0]).toBeGreaterThan(0);
  });
});

describe('typicalMonths', () => {
  it('finds the median month inside the table', () => {
    // C(k) = k * (0.05 + 0.10 / 12): C(8) = 0.467, C(9) = 0.525.
    expect(typicalMonths(cal).discretionary.permitFiled).toBe(9);
  });

  it('solves the tail in closed form when C(K) < 0.5', () => {
    // months 1, C(1) = 0.12, rho = 0.12: least k with 1 - 0.88^k >= 0.5 is 6.
    expect(typicalMonths(cal).discretionary.filed).toBe(6);
    expect(cumulativeTotal(cal.transitions.discretionary.filed!, 5)).toBeLessThan(0.5);
    expect(cumulativeTotal(cal.transitions.discretionary.filed!, 6)).toBeGreaterThanOrEqual(0.5);
  });

  it('is the least k with C(k) >= 0.5 for every cell, and a fresh object per call', () => {
    const tm = typicalMonths(cal);
    for (const p of PATHWAYS) {
      for (const [st, tr] of Object.entries(cal.transitions[p])) {
        const k = (tm[p] as Record<string, number>)[st];
        expect(cumulativeTotal(tr, k)).toBeGreaterThanOrEqual(0.5);
        expect(cumulativeTotal(tr, k - 1)).toBeLessThan(0.5);
      }
    }
    expect(typicalMonths(cal)).not.toBe(tm);
  });

  it('returns the first table month when C(K) crosses exactly at the median', () => {
    const exact: Transition = {
      ...t,
      months: 1,
      advance: [0.5],
      exit: {},
      tail: { advance: 0.1, exit: {} }
    };
    expect(typicalMonths(wrap(exact)).discretionary.filed).toBe(1);
  });

  it('is capped at the last representable event month for a flat tail', () => {
    const flat: Transition = {
      ...t,
      months: 1,
      advance: [0.1],
      exit: {},
      tail: { advance: 1e-20, exit: {} }
    };
    expect(typicalMonths(wrap(flat)).discretionary.filed).toBe(Math.floor(16777216 / MONTH_DAYS));
  });
});

function wrap(tr: Transition): Calibration {
  return {
    ...cal,
    transitions: { ...cal.transitions, discretionary: { filed: tr } }
  } as Calibration;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('parseCalibration', () => {
  const clone = (): any => structuredClone(cal);
  const disc = (c: any): any => c.transitions.discretionary.permitFiled;
  const prov = {
    tier: 4,
    label: 'x',
    sources: [{ label: 's', url: 'https://x.org' }],
    method: 'm'
  };

  function rejection(c: unknown): CalibrationFormatError {
    try {
      parseCalibration(c);
    } catch (e) {
      expect(e).toBeInstanceOf(CalibrationFormatError);
      return e as CalibrationFormatError;
    }
    throw new Error('expected parseCalibration to throw');
  }

  it('accepts the small fixture, returns it, and does not mutate it', () => {
    const before = JSON.stringify(cal);
    expect(parseCalibration(cal)).toBe(cal);
    expect(JSON.stringify(cal)).toBe(before);
  });

  it('starts every message with the path', () => {
    const c = clone();
    disc(c).advance[3] = 2;
    const e = rejection(c);
    expect(e.path).toBe('transitions.discretionary.permitFiled.advance[3]');
    expect(e.message.startsWith(`${e.path}: `)).toBe(true);
    expect(e.name).toBe('CalibrationFormatError');
  });

  it('rejects a non-object at the root', () => {
    expect(rejection(42).path).toBe('$');
    expect(rejection(null).path).toBe('$');
    expect(rejection([]).path).toBe('$');
  });

  const cases: [string, (c: any) => void, string][] = [
    ['schema 2', (c) => (c.schema = 2), 'schema'],
    ['asOf 1.5', (c) => (c.asOf = 1.5), 'asOf'],
    // transitions: shape
    [
      'sum above 1',
      (c) => {
        for (let k = 5; k < 12; k++) {
          disc(c).advance[k] = 0.95;
          disc(c).exit.expired[k] = 0.1;
        }
      },
      'transitions.discretionary.permitFiled'
    ],
    [
      'decreasing advance',
      (c) => (disc(c).advance[4] = 0.01),
      'transitions.discretionary.permitFiled.advance[4]'
    ],
    ['short array', (c) => disc(c).advance.pop(), 'permitFiled.advance'],
    ['long exit array', (c) => disc(c).exit.expired.push(0.1), 'permitFiled.exit.expired'],
    ['value above 1', (c) => (disc(c).advance[11] = 1.5), 'permitFiled.advance[11]'],
    ['non-finite value', (c) => (disc(c).advance[0] = null), 'permitFiled.advance[0]'],
    ['months 0', (c) => (disc(c).months = 0), 'permitFiled.months'],
    ['months 241', (c) => (disc(c).months = 241), 'permitFiled.months'],
    ['fractional months', (c) => (disc(c).months = 12.5), 'permitFiled.months'],
    ['unknown exit reason', (c) => (disc(c).exit.vanished = [0.1]), 'permitFiled.exit.vanished'],
    [
      'C(K) too close to 1',
      (c) => {
        for (let k = 8; k < 12; k++) disc(c).advance[k] = 1 - 5e-7;
        disc(c).exit = {};
        disc(c).tail.exit = {};
      },
      'transitions.discretionary.permitFiled'
    ],
    [
      'tail all zeros',
      (c) => (disc(c).tail = { advance: 0, exit: { expired: 0 } }),
      'permitFiled.tail'
    ],
    ['tail above 1', (c) => (disc(c).tail.advance = 1.5), 'permitFiled.tail'],
    ['negative tail value', (c) => (disc(c).tail.exit.expired = -0.01), 'permitFiled.tail.exit'],
    ['non-finite tail value', (c) => (disc(c).tail.advance = 'x'), 'permitFiled.tail.advance'],
    [
      'unknown tail reason',
      (c) => (disc(c).tail.exit.vanished = 0.1),
      'permitFiled.tail.exit.vanished'
    ],
    ['missing tailProvenance', (c) => delete disc(c).tailProvenance, 'permitFiled.tailProvenance'],
    // transitions: pairs
    [
      'missing permitOnly.construction',
      (c) => delete c.transitions.permitOnly.construction,
      'transitions.permitOnly.construction'
    ],
    [
      'extra permitOnly.filed',
      (c) => (c.transitions.permitOnly.filed = disc(c)),
      'transitions.permitOnly.filed'
    ],
    [
      'stage complete',
      (c) => (c.transitions.permitOnly.complete = disc(c)),
      'transitions.permitOnly.complete'
    ],
    ['missing pathway', (c) => delete c.transitions.streamlined, 'transitions.streamlined'],
    // initiation
    ['initiation kind', (c) => (c.initiation.kind = 'probit'), 'initiation.kind'],
    ['initiation intercept', (c) => (c.initiation.intercept = null), 'initiation.intercept'],
    [
      'initiation unknown feature',
      (c) => (c.initiation.terms[0].feature = 'colour'),
      'initiation.terms[0].feature'
    ],
    [
      'initiation empty bins',
      (c) => {
        c.initiation.terms[0].bins = [];
        c.initiation.terms[0].coef = [];
      },
      'initiation.terms[0].bins'
    ],
    [
      'initiation unsorted bins',
      (c) => (c.initiation.terms[0].bins = [0, 5, 2]),
      'initiation.terms[0].bins'
    ],
    [
      'initiation repeated bins',
      (c) => (c.initiation.terms[0].bins = [0, 2, 2]),
      'initiation.terms[0].bins'
    ],
    ['initiation coef length', (c) => c.initiation.terms[0].coef.pop(), 'initiation.terms[0].coef'],
    [
      'initiation non-finite coef',
      (c) => (c.initiation.terms[0].coef[1] = 'x'),
      'initiation.terms[0].coef[1]'
    ],
    // size
    ['fillLevels not ending at 1', (c) => (c.size.fillLevels = [0.5, 0.9]), 'size.fillLevels'],
    ['fillLevels descending', (c) => (c.size.fillLevels = [0.5, 0.25, 1]), 'size.fillLevels'],
    ['fillLevels empty', (c) => (c.size.fillLevels = []), 'size.fillLevels'],
    ['fillLevels zero', (c) => (c.size.fillLevels = [0, 1]), 'size.fillLevels'],
    [
      'probs length 4',
      (c) => (c.size.byEnvelope[0].probs = [0.25, 0.25, 0.25, 0.25]),
      'size.byEnvelope[0].probs'
    ],
    [
      'probs sum 0.99',
      (c) => (c.size.byEnvelope[0].probs = [0.1, 0.2, 0.3, 0.2, 0.19]),
      'size.byEnvelope[0].probs'
    ],
    [
      'probs negative',
      (c) => (c.size.byEnvelope[0].probs = [-0.1, 0.4, 0.3, 0.2, 0.2]),
      'size.byEnvelope[0].probs[0]'
    ],
    ['byEnvelope empty', (c) => (c.size.byEnvelope = []), 'size.byEnvelope'],
    [
      'byEnvelope descending',
      (c) =>
        (c.size.byEnvelope = [
          { maxStoriesUpTo: 99, probs: [0.2, 0.2, 0.2, 0.2, 0.2] },
          { maxStoriesUpTo: 9, probs: [0.2, 0.2, 0.2, 0.2, 0.2] }
        ]),
      'size.byEnvelope[1].maxStoriesUpTo'
    ],
    // revision
    [
      'revision edges without 1',
      (c) => (c.revision.at[0].ratio.edges = [0.5, 2]),
      'revision.at[0].ratio.edges'
    ],
    [
      'revision edges unsorted',
      (c) => (c.revision.at[0].ratio.edges = [2, 1, 0.5]),
      'revision.at[0].ratio.edges'
    ],
    [
      'revision probs length',
      (c) => (c.revision.at[0].ratio.probs = [1]),
      'revision.at[0].ratio.probs'
    ],
    [
      'revision probs sum',
      (c) => (c.revision.at[0].ratio.probs = [0.5, 0.4]),
      'revision.at[0].ratio.probs'
    ],
    [
      'revision at construction',
      (c) => (c.revision.at[0].stage = 'construction'),
      'revision.at[0].stage'
    ],
    ['revision at complete', (c) => (c.revision.at[0].stage = 'complete'), 'revision.at[0].stage'],
    ['revision at unknown stage', (c) => (c.revision.at[0].stage = 'x'), 'revision.at[0].stage'],
    [
      'revision probability',
      (c) => (c.revision.at[0].probability = 1.1),
      'revision.at[0].probability'
    ],
    // pathway mixes
    ['pathwayForNew sum 0.9', (c) => (c.pathwayForNew.permitOnly = 0), 'pathwayForNew'],
    ['ppaShare 1.2', (c) => (c.ppaShare.permitOnly = 1.2), 'ppaShare.permitOnly'],
    // provenance
    [
      'http url',
      (c) => (c.pathwayForNew.provenance.sources[0].url = 'http://x.org'),
      'pathwayForNew.provenance.sources[0].url'
    ],
    [
      'tier 2 without window',
      (c) => (disc(c).provenance = { ...prov, tier: 2, n: 5 }),
      'permitFiled.provenance.window'
    ],
    [
      'tier 0 without n',
      (c) => (disc(c).provenance = { ...prov, tier: 0, window: ['2010-01-01', '2020-01-01'] }),
      'permitFiled.provenance.n'
    ],
    ['tier 5', (c) => (disc(c).provenance.tier = 5), 'permitFiled.provenance.tier'],
    ['empty label', (c) => (disc(c).provenance.label = ''), 'permitFiled.provenance.label'],
    ['empty method', (c) => (disc(c).provenance.method = ''), 'permitFiled.provenance.method'],
    ['no sources', (c) => (disc(c).provenance.sources = []), 'permitFiled.provenance.sources'],
    [
      'missing streamlinedForLocalProgram',
      (c) => delete c.streamlinedForLocalProgram,
      'streamlinedForLocalProgram'
    ],
    ['missing phaseGap provenance', (c) => delete c.phaseGap.provenance, 'phaseGap.provenance'],
    // phaseGap
    ['phaseGap empty', (c) => (c.phaseGap.days = []), 'phaseGap.days'],
    ['phaseGap descending', (c) => (c.phaseGap.days = [3, 2]), 'phaseGap.days'],
    ['phaseGap zero', (c) => (c.phaseGap.days = [0]), 'phaseGap.days'],
    ['phaseGap fractional', (c) => (c.phaseGap.days = [1.5]), 'phaseGap.days']
  ];

  it.each(cases)('rejects %s', (_name, mutate, path) => {
    const c = clone();
    mutate(c);
    const e = rejection(c);
    expect(e.message).toContain(path);
    expect(e.path).toContain(path);
  });

  it('accepts equal phase gaps (empirical ties)', () => {
    const c = clone();
    c.phaseGap.days = [30, 30, 60];
    expect(parseCalibration(c)).toBe(c);
  });

  it('accepts a tail summing to exactly 1', () => {
    const c = clone();
    disc(c).tail = { advance: 0.75, exit: { expired: 0.25 } };
    expect(parseCalibration(c)).toBe(c);
  });

  it('A2: accepts valid fill levels that differ from FILL_LEVELS', () => {
    const c = clone();
    c.size.fillLevels = [0.5, 1];
    c.size.byEnvelope = [
      { maxStoriesUpTo: 9, probs: [0.4, 0.6] },
      { maxStoriesUpTo: 99, probs: [0.5, 0.5] }
    ];
    expect(parseCalibration(c)).toBe(c);
  });

  it('AC-7: model.ts imports only ./types, ./time and ./math, and no zod', () => {
    const src = readFileSync(new URL('./model.ts', import.meta.url), 'utf8');
    const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const sp of specifiers) expect(sp).toMatch(/^\.\/(types|time|math)$/);
    expect(src).not.toContain('zod');
  });
});
