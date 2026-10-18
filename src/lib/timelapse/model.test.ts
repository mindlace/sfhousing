import { describe, expect, it } from 'vitest';
import small from './fixtures/calibration-small.json';
import { exp, log } from './math';
import {
  binIndex,
  cumulativeIncidence,
  cumulativeTotal,
  eventualProbabilities,
  initiationHazard
} from './model';
import { EXIT_ORDER, type Calibration, type FeatureId, type Transition } from './types';

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

// Printed from the first run; pins the bit-exact math.ts evaluation.
const GOLDEN = {
  advance13: 0.615,
  expired13: 0.10300000000000001,
  advance24: 0.7310199212964368,
  expired24: 0.12620398425928736
};
