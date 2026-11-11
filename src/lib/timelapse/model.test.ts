import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../generator/seed';
import { miniCity } from '../sim/scenario/fixtures/mini-parcels';
import { featureValue } from '../data/scenario-codec';
import mini from '../sim/scenario/fixtures/mini-calibration.json';
import small from './fixtures/calibration-small.json';
import { exp, log } from './math';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { arbTransition } from './test/arbitraries';
import {
  CalibrationFormatError,
  binIndex,
  checkPool,
  checkProgramme,
  chanceTable,
  cumulativeIncidence,
  cumulativeTotal,
  eventualProbabilities,
  initiationHazard,
  initiationLogit,
  parseCalibration,
  sampleKind,
  sampleTime,
  sampleTransition,
  typicalMonths
} from './model';
import { MONTH_DAYS, monthsIn, stageDay } from './time';
import { validateInstrument } from '../sim/finance/instruments';
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

describe('initiationLogit', () => {
  it('is the linear predictor of initiationHazard, bit for bit', () => {
    const f = { potentialRatio: 3 } as Record<FeatureId, number>;
    expect(initiationLogit(cal.initiation, f)).toBe(-6 + 0.5);
    expect(1 / (1 + exp(-initiationLogit(cal.initiation, f)))).toBe(
      initiationHazard(cal.initiation, f)
    );
  });

  it('matches initiationHazard on every hostable mini-city row', () => {
    const m = (mini as unknown as Calibration).initiation;
    const { parcels: p } = miniCity();
    let seen = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.hostable[i] !== 1) continue;
      const f = {} as Record<FeatureId, number>;
      for (const term of m.terms) f[term.feature] = featureValue(p, i, term.feature, 'fzp');
      expect(1 / (1 + exp(-initiationLogit(m, f)))).toBe(initiationHazard(m, f));
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
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

  describe('per-transition constants are memoised (T12 perf), outputs unchanged', () => {
    // Several table reasons, a tail-only reason and a zero trailing tail share (tailSlice's last).
    const multi: Transition = {
      ...t,
      exit: { withdrawn: t.exit.expired!.map((x) => x / 2), expired: t.exit.expired },
      tail: { advance: 0.05, exit: { withdrawn: 0.01, cancelled: 0.005, expired: 0 } }
    };
    const cells: Transition[] = [t, multi];
    for (const p of PATHWAYS) {
      for (const s of pathwayStages(p)) {
        const tr = (cal.transitions[p] as Record<string, Transition | undefined>)[s];
        if (tr) cells.push(tr);
      }
    }
    const N = 12000;
    // A fixed mulberry32 stream of (u, m) pairs; m runs to K + 40, so many draws have m >= K.
    function draws(of: Transition[]) {
      const rng = mulberry32(0x5eed);
      const out: { kind: string; days: number }[] = [];
      let tail = 0;
      for (let i = 0; i < N; i++) {
        const tr = of[i % of.length];
        const u = rng();
        const m = Math.floor(rng() * (tr.months + 41));
        if (m >= tr.months) tail++;
        out.push(sampleTransition(tr, u, m));
      }
      return { out, tail };
    }

    it('a used transition and a fresh structurally-equal deep copy give identical draws', () => {
      for (const tr of cells) sampleTransition(tr, 0.5, 0); // first use fills the constants
      const cached = draws(cells);
      const fresh = draws(cells.map((tr) => structuredClone(tr)));
      expect(cached.tail).toBeGreaterThan(N / 4);
      expect(cached.tail).toBeLessThan(N);
      expect(fresh.out).toEqual(cached.out);
    });

    it('calling twice with no mutation gives identical results', () => {
      expect(draws(cells).out).toEqual(draws(cells).out);
    });
  });
});

/** `tr` as the small calibration's discretionary.permitFiled, so `parseCalibration` can judge it. */
function withTransition(tr: Transition): unknown {
  const c = structuredClone(cal) as Calibration;
  c.transitions.discretionary.permitFiled = tr;
  return c;
}

const CAP_MONTH = Math.floor(16777216 / MONTH_DAYS);
const BAD_U = [-0.1, 1, NaN, Infinity];
const BAD_TAU = [-1, NaN, Infinity, 551213];

describe('arbTransition', () => {
  it('generates transitions that parseCalibration accepts', () => {
    const samples = fc.sample(arbTransition(), { numRuns: 200, seed: 0x5eed });
    let tableOnly = 0;
    let tailOnly = 0;
    for (const tr of samples) {
      expect(() => parseCalibration(withTransition(tr))).not.toThrow();
      for (const r of EXIT_ORDER) {
        if (tr.exit[r] !== undefined && tr.tail.exit[r] === undefined) tableOnly++;
        if (tr.exit[r] === undefined && tr.tail.exit[r] !== undefined) tailOnly++;
      }
    }
    expect(tableOnly).toBeGreaterThan(0);
    expect(tailOnly).toBeGreaterThan(0);
  });
});

describe('sampleKind', () => {
  // F_j(x) at real x, linear between table months, from cumulativeIncidence only.
  function at(tr: Transition, x: number) {
    const lo = cumulativeIncidence(tr, Math.floor(x));
    const hi = cumulativeIncidence(tr, Math.ceil(x));
    const a = x - Math.floor(x);
    const exit: Record<string, number> = {};
    for (const r of Object.keys(lo.exit) as (keyof typeof lo.exit)[]) {
      exit[r] = lo.exit[r]! + a * (hi.exit[r]! - lo.exit[r]!);
    }
    return { advance: lo.advance + a * (hi.advance - lo.advance), exit };
  }

  it('splits at the eventual advance share at tau = 0', () => {
    const P = eventualProbabilities(t, 0).advance;
    expect(sampleKind(t, P - 1e-12, 0)).toBe('advance');
    expect(sampleKind(t, P + 1e-12, 0)).toBe('expired');
  });

  it('splits at the conditional advance share at a real-valued tau = 6.4', () => {
    const inf = eventualProbabilities(t, 0).advance;
    const f = at(t, 6.4);
    const C = f.advance + f.exit.expired;
    const threshold = (inf - f.advance) / (1 - C);
    expect(sampleKind(t, threshold - 1e-12, 6.4)).toBe('advance');
    expect(sampleKind(t, threshold + 1e-12, 6.4)).toBe('expired');
  });

  it('uses the tail shares from K on (memoryless)', () => {
    for (const tau of [12, 20.5, 140]) {
      expect(sampleKind(t, 0.05 / 0.06 - 1e-12, tau)).toBe('advance');
      expect(sampleKind(t, 0.05 / 0.06 + 1e-12, tau)).toBe('expired');
      expect(sampleKind(t, 0, tau)).toBe('advance');
      expect(sampleKind(t, 1 - 1e-12, tau)).toBe('expired');
    }
  });

  it('never draws a kind with no remaining mass (Review Focus 2)', () => {
    const flat3 = t.advance.map((_, i) => (i < 2 ? 0.01 * (i + 1) : 0.03));
    const tt: Transition = {
      ...t,
      exit: { withdrawn: flat3 },
      tail: { advance: 0.05, exit: { expired: 0 } }
    };
    expect(() => parseCalibration(withTransition(tt))).not.toThrow();
    const rng = mulberry32(0x5eed);
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) seen.add(sampleKind(tt, rng(), 4.5));
    expect([...seen]).toEqual(['advance']);
    expect(() => sampleTime(tt, 'withdrawn', 0.5, 4.5)).toThrow(RangeError);
    expect(() => sampleTime(t, 'cancelled', 0.5, 0)).toThrow(RangeError);
  });

  it('splits at 0.75 when rho = 1', () => {
    const tt: Transition = { ...t, tail: { advance: 0.75, exit: { expired: 0.25 } } };
    for (const u of [0, 0.5, 0.75 - 1e-12]) expect(sampleKind(tt, u, 20)).toBe('advance');
    for (const u of [0.75 + 1e-12, 0.9, 1 - 1e-12]) expect(sampleKind(tt, u, 20)).toBe('expired');
  });

  it('rejects u outside [0, 1) and tau outside [0, MAX_EVENT_MONTH - 1)', () => {
    for (const u of BAD_U) expect(() => sampleKind(t, u, 0)).toThrow(RangeError);
    for (const tau of BAD_TAU) expect(() => sampleKind(t, 0.5, tau)).toThrow(RangeError);
  });
});

describe('sampleTime', () => {
  it('starts at day 0 for u = 0 on a fresh stage', () => {
    expect(sampleTime(t, 'advance', 0, 0)).toBe(0);
  });

  it('property: an integer day, from stageDay(tau), below 2^24, non-decreasing in uTime', () => {
    const u = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
    expect(() =>
      fc.assert(
        fc.property(arbTransition(), u, u, u, u, (tr, r, uKind, u1, u2) => {
          const tau = r * (tr.months + 30);
          const kind = sampleKind(tr, uKind, tau);
          const d = sampleTime(tr, kind, u1, tau);
          if (!Number.isInteger(d) || d < stageDay(tau) || d >= 16777216) return false;
          const [lo, hi] = u1 <= u2 ? [u1, u2] : [u2, u1];
          return sampleTime(tr, kind, lo, tau) <= sampleTime(tr, kind, hi, tau);
        }),
        { numRuns: 500, seed: 0x5eed }
      )
    ).not.toThrow();
  });

  it('ignores the kind from K on', () => {
    const rng = mulberry32(0x5eed);
    let bad = 0;
    for (const tau of [12, 13.7, 60]) {
      for (let i = 0; i < 1000; i++) {
        const u = rng();
        if (sampleTime(t, 'advance', u, tau) !== sampleTime(t, 'expired', u, tau)) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('stays finite and Float32-exact on a flat tail (Review Focus 3)', () => {
    const flat: Transition = { ...t, tail: { advance: 1e-20, exit: {} } };
    for (const tau of [0, 13]) {
      const d = sampleTime(flat, 'advance', 0.9, tau);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeLessThan(16777216);
      expect(Math.fround(d)).toBe(d);
      expect(monthsIn(0, d) + 1).toBe(CAP_MONTH);
    }
  });

  it('puts every event in the next month when rho = 1', () => {
    const tt: Transition = { ...t, tail: { advance: 0.75, exit: { expired: 0.25 } } };
    for (const u of [0, 0.5, 1 - 1e-12]) {
      expect(monthsIn(0, sampleTime(tt, 'advance', u, 20))).toBe(20);
      expect(monthsIn(0, sampleTime(tt, 'expired', u, 20))).toBe(20);
    }
  });

  it('keeps the tail kind split in the cap month for a very slow tail (rho = 1e-6)', () => {
    const slow: Transition = { ...t, tail: { advance: 0.8e-6, exit: { expired: 0.2e-6 } } };
    for (const tau of [0, 12]) {
      const rng = mulberry32(0x5eed);
      let atCap = 0;
      let advance = 0;
      for (let i = 0; i < 100000; i++) {
        const kind = sampleKind(slow, rng(), tau);
        const d = sampleTime(slow, kind, rng(), tau);
        if (monthsIn(0, d) + 1 !== CAP_MONTH) continue;
        atCap++;
        if (kind === 'advance') advance++;
      }
      expect(atCap).toBeGreaterThan(10000);
      expect(Math.abs(advance / atCap - 0.8)).toBeLessThanOrEqual(0.02);
    }
  });

  describe('deep in the tail (R8 analogue)', () => {
    const probe: Transition = { ...t, tail: { advance: 0.2, exit: { expired: 0.05 } } };
    for (const tau of [120, 140]) {
      it(`tau = ${tau}: month floor(tau) + 1 holds rho of the events, days spread`, () => {
        const rng = mulberry32(0x5eed);
        const N = 100000;
        let first = 0;
        const days = new Set<number>();
        for (let i = 0; i < N; i++) {
          const d = sampleTime(probe, 'advance', rng(), tau);
          if (monthsIn(0, d) + 1 === Math.floor(tau) + 1) {
            first++;
            days.add(d);
          }
        }
        expect(Math.abs(first / N - 0.25)).toBeLessThanOrEqual(0.01);
        expect(days.size).toBeGreaterThanOrEqual(25);
      });
    }
  });

  it('rejects u outside [0, 1), tau outside [0, MAX_EVENT_MONTH - 1) and unknown kinds', () => {
    for (const u of BAD_U) {
      expect(() => sampleTime(t, 'advance', u, 0)).toThrow(RangeError);
      expect(() => sampleTime(t, 'advance', u, 20)).toThrow(RangeError);
    }
    for (const tau of BAD_TAU) expect(() => sampleTime(t, 'advance', 0.5, tau)).toThrow(RangeError);
  });

  describe('per-transition constants are memoised, outputs unchanged', () => {
    const cells: Transition[] = [];
    for (const c of [cal, mini as unknown as Calibration]) {
      for (const p of PATHWAYS) {
        for (const s of pathwayStages(p)) {
          const tr = (c.transitions[p] as Record<string, Transition | undefined>)[s];
          if (tr) cells.push(tr);
        }
      }
    }
    function draws(of: Transition[]) {
      const rng = mulberry32(0x5eed);
      const out: [string, number][] = [];
      for (let i = 0; i < 12000; i++) {
        const tr = of[i % of.length];
        const uKind = rng();
        const uTime = rng();
        const tau = rng() * (tr.months + 41);
        const kind = sampleKind(tr, uKind, tau);
        out.push([kind, sampleTime(tr, kind, uTime, tau)]);
      }
      return out;
    }

    it('a used transition and a structuredClone give identical draws', () => {
      for (const tr of cells) sampleTime(tr, sampleKind(tr, 0.5, 0), 0.5, 0);
      const cached = draws(cells);
      expect(draws(cells.map((tr) => structuredClone(tr)))).toEqual(cached);
      expect(draws(cells)).toEqual(cached);
    });
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
  it("accepts fixture-0's calibration.json (stage-calibration spec §4.12)", () => {
    const file = new URL(
      '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json',
      import.meta.url
    );
    const parsed = parseCalibration(JSON.parse(readFileSync(file, 'utf8')));
    expect(parsed.size.fillLevels).toHaveLength(5);
    expect(Object.keys(parsed.transitions)).toEqual([...PATHWAYS]);
  });

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
      'two revisions at one stage',
      (c) => c.revision.at.push(structuredClone(c.revision.at[0])),
      'revision.at[1].stage'
    ],
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

  describe('market', () => {
    const src = (extra: object = {}) => ({
      tier: 2,
      label: 'x',
      sources: [{ label: 's', url: 'https://x.org' }],
      method: 'm',
      n: 5,
      window: ['2023-01-01', '2025-12-31'],
      ...extra
    });
    const liveMarket = (): any => ({
      today: {
        all: -0.643571,
        private: Number(log(116 / 245.521).toPrecision(6)),
        years: [2023, 2025],
        observed: { all: 129, private: 116 },
        implied: 245.521,
        provenance: src()
      },
      crossCheck: { logOdds: -0.5, provenance: { ...prov, tier: 3 } },
      slope: {
        perCostShare: 1.2,
        provenance: src(),
        crossChecks: {
          costCoefficient: -0.4,
          priceCoefficient: 0.7,
          provenance: { ...prov, tier: 3 }
        }
      }
    });
    const fixtureMarket = (): any => ({
      today: {
        all: -0.693147,
        private: -0.798508,
        years: [2023, 2025],
        observed: { all: 10, private: 9 },
        implied: 20,
        provenance: prov
      },
      crossCheck: { logOdds: 0, provenance: prov },
      slope: {
        perCostShare: 1,
        provenance: prov,
        crossChecks: { costCoefficient: 0, priceCoefficient: 0, provenance: prov }
      }
    });
    const withMarket = (m: unknown): any => ({ ...clone(), market: m });

    it('accepts live, fixture and absent market, and unknown top-level keys', () => {
      for (const m of [liveMarket(), fixtureMarket()]) {
        const c = withMarket(m);
        expect(parseCalibration(c)).toBe(c);
      }
      const c = { ...clone(), market: liveMarket(), somethingNew: 1 };
      expect(parseCalibration(c)).toBe(c);
      expect(parseCalibration(clone()).market).toBeUndefined();
    });

    const missing = (path: string[]) => (m: any) => {
      let o = m;
      for (const k of path.slice(0, -1)) o = o[k];
      delete o[path[path.length - 1]];
    };
    const extra = (path: string[]) => (m: any) => {
      let o = m;
      for (const k of path) o = o[k];
      o.extra = 1;
    };
    const mcases: [string, (m: any) => void, string, string][] = [
      ['market not an object', (m) => m, 'market', 'expected an object'],
      ...['today', 'crossCheck', 'slope'].map((k): [string, (m: any) => void, string, string] => [
        `missing ${k}`,
        missing([k]),
        `market.${k}`,
        'missing'
      ]),
      ...(
        [
          ['today', 'all'],
          ['today', 'private'],
          ['today', 'years'],
          ['today', 'observed'],
          ['today', 'implied'],
          ['today', 'provenance'],
          ['today', 'observed', 'all'],
          ['today', 'observed', 'private'],
          ['crossCheck', 'logOdds'],
          ['crossCheck', 'provenance'],
          ['slope', 'perCostShare'],
          ['slope', 'provenance'],
          ['slope', 'crossChecks'],
          ['slope', 'crossChecks', 'costCoefficient'],
          ['slope', 'crossChecks', 'priceCoefficient'],
          ['slope', 'crossChecks', 'provenance']
        ] as string[][]
      ).map((p): [string, (m: any) => void, string, string] => [
        `missing ${p.join('.')}`,
        missing(p),
        `market.${p.join('.')}`,
        'missing'
      ]),
      ...(
        [
          [],
          ['today'],
          ['today', 'observed'],
          ['crossCheck'],
          ['slope'],
          ['slope', 'crossChecks']
        ] as string[][]
      ).map((p): [string, (m: any) => void, string, string] => [
        `extra key at ${p.join('.') || 'market'}`,
        extra(p),
        `market${p.map((k) => `.${k}`).join('')}.extra`,
        'unexpected key'
      ]),
      [
        'years gap 1',
        (m) => (m.today.years = [2023, 2024]),
        'market.today.years',
        'expected [first, first + 2], got [2023,2024]'
      ],
      [
        'observed.all 1.5',
        (m) => (m.today.observed.all = 1.5),
        'market.today.observed.all',
        'expected a positive integer, got 1.5'
      ],
      [
        'observed.private 0',
        (m) => (m.today.observed.private = 0),
        'market.today.observed.private',
        'expected a positive integer, got 0'
      ],
      [
        'observed.private 130',
        (m) => (m.today.observed.private = 130),
        'market.today.observed.private',
        'expected at most 129, got 130'
      ],
      [
        'implied 0',
        (m) => (m.today.implied = 0),
        'market.today.implied',
        'expected a positive number, got 0'
      ],
      [
        'all off by 2e-5',
        (m) => (m.today.all += 2e-5),
        'market.today.all',
        `expected ln(observed.all ÷ implied) = ${log(129 / 245.521)}, got ${-0.643571 + 2e-5}`
      ],
      [
        'all NaN',
        (m) => (m.today.all = NaN),
        'market.today.all',
        'expected a number in [-10, 10], got NaN'
      ],
      [
        'all 11',
        (m) => {
          m.today.observed = { all: 59874, private: 100 };
          m.today.implied = 59874 / exp(11);
          m.today.all = 11;
        },
        'market.today.all',
        'expected a number in [-10, 10], got 11'
      ],
      [
        'perCostShare 0',
        (m) => (m.slope.perCostShare = 0),
        'market.slope.perCostShare',
        'expected a positive number, got 0'
      ],
      [
        'today.provenance.sources []',
        (m) => (m.today.provenance.sources = []),
        'market.today.provenance.sources',
        'expected at least one source'
      ]
    ];

    it.each(mcases)('rejects %s', (_name, mutate, path, message) => {
      let m = liveMarket();
      if (_name === 'market not an object') m = 42;
      else mutate(m);
      const e = rejection(withMarket(m));
      expect(e.path).toBe(path);
      expect(e.message).toBe(`${path}: ${message}`);
    });
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

  it('AC-7: model.ts imports only ./types, ./time, ./math and ../sim/finance/{instruments,debt}, and no zod', () => {
    const src = readFileSync(new URL('./model.ts', import.meta.url), 'utf8');
    const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const sp of specifiers)
      expect(sp).toMatch(/^(\.\/(types|time|math)|\.\.\/sim\/finance\/(instruments|debt))$/);
    expect(src).not.toContain('zod');
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('affordableRoutes and baselineFunding', () => {
  const clone = (): any => structuredClone(cal);
  const prov = {
    tier: 4,
    label: 'x',
    sources: [{ label: 's', url: 'https://x.org' }],
    method: 'm'
  };
  const asOf = cal.asOf;

  function fallbackRoutes(): any {
    return {
      discretionary: 0.6,
      streamlined: 0.3,
      permitOnly: 0.1,
      provenance: prov
    };
  }

  function fixtureFunding(): any {
    const city = [
      ['city-debt', 'goBond', 1500000],
      ['city-ocoh', 'dedicatedTax', 1200000],
      ['city-general-fund', 'generalRevenue', 1000000],
      ['city-impact-fees', 'dedicatedTax', 1000000],
      ['city-housing-trust-fund', 'generalRevenue', 800000],
      ['city-redevelopment', 'dedicatedTax', 500000]
    ] as const;
    const pools: any[] = city.map(([id, kind, dollarsPerYear]) => ({
      id,
      kind,
      label: id,
      inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear }],
      uncapped: false,
      debt: id === 'city-debt' ? { rate: 0.06, termYears: 20 } : null,
      leverage: 1
    }));
    pools.push({
      id: 'state',
      kind: 'state',
      label: 'state',
      inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 3000000 }],
      uncapped: false,
      debt: null,
      leverage: 1
    });
    pools.push({
      id: 'federal-tax-credits',
      kind: 'federal',
      label: 'federal',
      inflows: [],
      uncapped: true,
      debt: null,
      leverage: 1
    });
    const shares = [0.119804, 0.072329, 0.054619, 0.051791, 0.040778, 0.00893, 0.137419, 0.51433];
    return {
      pools,
      programmes: pools.map((p, i) => ({
        id: `baseline-${p.id}`,
        label: `${p.label}: grant`,
        pool: p.id,
        reach: 'affordable',
        instrument: { kind: 'grant', share: shares[i] },
        from: asOf,
        to: null,
        minHomes: 2,
        tiers: { veryLow: 0.428572, low: 0.428571, moderate: 0.142857, aboveModerate: 0 }
      })),
      provenance: Array.from({ length: pools.length + 1 }, () => prov),
      check: { impliedHomesPerYear: 20, observedHomesPerYear: 25, provenance: prov }
    };
  }

  function rejection(c: unknown): CalibrationFormatError {
    try {
      parseCalibration(c);
    } catch (e) {
      expect(e).toBeInstanceOf(CalibrationFormatError);
      return e as CalibrationFormatError;
    }
    throw new Error('expected parseCalibration to throw');
  }

  it('accepts the small calibration without the keys, with both, and without market', () => {
    expect(parseCalibration(cal)).toBe(cal);
    const both = {
      ...clone(),
      affordableRoutes: fallbackRoutes(),
      baselineFunding: fixtureFunding()
    };
    expect(parseCalibration(both)).toBe(both);
    const noMarket = { ...clone(), baselineFunding: fixtureFunding() };
    expect(noMarket.market).toBeUndefined();
    expect(parseCalibration(noMarket)).toBe(noMarket);
  });

  const cases: [string, (c: any) => void, string, string][] = [
    [
      'debt on a general-fund pool',
      (c) => (c.baselineFunding.pools[2].debt = { rate: 0.06, termYears: 20 }),
      'baselineFunding.pools[2].debt',
      'expected null debt for kind generalRevenue'
    ],
    [
      'inflow on the federal pool',
      (c) => (c.baselineFunding.pools[7].inflows = [{ kind: 'once', day: asOf, dollars: 1 }]),
      'baselineFunding.pools[7].inflows',
      'expected no inflows on an uncapped pool'
    ],
    [
      'pool id with the u- prefix',
      (c) => (c.baselineFunding.pools[0].id = 'u-city'),
      'baselineFunding.pools[0].id',
      'expected a baseline id not starting u-, got u-city'
    ],
    [
      'pool id off the pattern',
      (c) => (c.baselineFunding.pools[0].id = 'City-debt'),
      'baselineFunding.pools[0].id',
      'expected an id matching ^[a-z0-9][a-z0-9-]{0,39}$, got City-debt'
    ],
    [
      'duplicate pool id',
      (c) => (c.baselineFunding.pools[1].id = 'city-debt'),
      'baselineFunding.pools[1].id',
      'expected a unique id, got city-debt'
    ],
    [
      'a pool with no debt key',
      (c) => delete c.baselineFunding.pools[0].debt,
      'baselineFunding.pools[0].debt',
      'missing'
    ],
    [
      'an unknown pool key',
      (c) => (c.baselineFunding.pools[0].extra = 1),
      'baselineFunding.pools[0].extra',
      'unexpected key'
    ],
    [
      'a market programme with no tiers key',
      (c) => {
        c.baselineFunding.programmes[0].reach = 'market';
        delete c.baselineFunding.programmes[0].tiers;
      },
      'baselineFunding.programmes[0].tiers',
      'missing'
    ],
    [
      'a stray key on a once inflow',
      (c) =>
        (c.baselineFunding.pools[0].inflows = [{ kind: 'once', day: asOf, dollars: 1, extra: 1 }]),
      'baselineFunding.pools[0].inflows[0].extra',
      'unexpected key'
    ],
    [
      'goBond without debt',
      (c) => (c.baselineFunding.pools[0].debt = null),
      'baselineFunding.pools[0].debt',
      'expected debt for kind goBond'
    ],
    [
      'programme naming no pool',
      (c) => (c.baselineFunding.programmes[0].pool = 'nowhere'),
      'baselineFunding.programmes[0].pool',
      'expected a pool id, got nowhere'
    ],
    [
      'baseline loan programme',
      (c) =>
        (c.baselineFunding.programmes[0].instrument = {
          kind: 'loan',
          costShare: 0.5,
          rate: 0.02,
          requiredReturn: null
        }),
      'baselineFunding.programmes[0].instrument',
      'expected a grant, got loan'
    ],
    [
      'null tiers on an affordable programme',
      (c) => (c.baselineFunding.programmes[0].tiers = null),
      'baselineFunding.programmes[0].tiers',
      'expected tiers for reach affordable'
    ],
    [
      'tiers summing to 0.9',
      (c) =>
        (c.baselineFunding.programmes[0].tiers = {
          veryLow: 0.4,
          low: 0.4,
          moderate: 0.1,
          aboveModerate: 0
        }),
      'baselineFunding.programmes[0].tiers',
      'expected values summing to 1, got 0.9'
    ],
    [
      'eight provenances',
      (c) => c.baselineFunding.provenance.pop(),
      'baselineFunding.provenance',
      "expected 9 entries (one per pool, then the programmes' tiers and minHomes), got 8"
    ],
    [
      'affordableRoutes summing to 0.9',
      (c) => (c.affordableRoutes.discretionary = 0.5),
      'affordableRoutes',
      'expected values summing to 1, got 0.9'
    ]
  ];

  it.each(cases)('rejects %s', (_name, mutate, path, message) => {
    const c = { ...clone(), affordableRoutes: fallbackRoutes(), baselineFunding: fixtureFunding() };
    mutate(c);
    const e = rejection(c);
    expect(e.path).toBe(path);
    expect(e.message).toBe(`${path}: ${message}`);
  });

  describe('checkPool', () => {
    const bond = (): any => ({
      id: 'u-bond',
      kind: 'goBond',
      label: 'A bond',
      inflows: [{ kind: 'once', day: asOf, dollars: 5 }],
      uncapped: false,
      debt: { rate: 0.05, termYears: 30 },
      leverage: 1
    });
    const msg = (f: () => void): string => {
      try {
        f();
      } catch (e) {
        return (e as CalibrationFormatError).message;
      }
      return 'no throw';
    };

    it('accepts a u- pool with valid debt', () => {
      expect(() => checkPool(bond(), 'p')).not.toThrow();
    });

    it("rejects out-of-bounds debt with validateDebt's text", () => {
      const a = bond();
      a.debt.rate = 0.26;
      expect(msg(() => checkPool(a, 'p'))).toBe(
        'p.debt: A borrowing rate is above 0% and at most 25%.'
      );
      const b = bond();
      b.debt.termYears = 41;
      expect(msg(() => checkPool(b, 'p'))).toBe(
        'p.debt: A borrowing term is a whole number of years from 1 to 40.'
      );
    });

    it('rejects leverage other than 1 unless the kind is bank', () => {
      const a = bond();
      a.leverage = 2;
      expect(msg(() => checkPool(a, 'p'))).toBe(
        'p.leverage: expected 1 unless kind is bank, got 2'
      );
      const b = { ...bond(), kind: 'bank', debt: null, leverage: 2 };
      expect(() => checkPool(b, 'p')).not.toThrow();
    });
  });

  describe('checkProgramme', () => {
    const loan = (): any => ({
      id: 'u-bond',
      label: 'Loans',
      pool: 'a',
      reach: 'market',
      instrument: { kind: 'loan', costShare: 0.5, rate: 0.02, requiredReturn: null },
      from: asOf,
      to: null,
      minHomes: 0,
      tiers: null
    });
    const ids = new Set(['a']);

    it('accepts a u- loan with minHomes 0', () => {
      expect(() => checkProgramme(loan(), 'q', ids)).not.toThrow();
    });

    it("rejects with validateInstrument's exact text", () => {
      const p = loan();
      p.instrument.requiredReturn = 0.3;
      const want = validateInstrument(p.instrument);
      expect(want).not.toBeNull();
      expect(() => checkProgramme(p, 'q', ids)).toThrow(`q.instrument: ${want}`);
    });

    it('rejects a key another instrument kind owns', () => {
      const grant = loan();
      grant.instrument = { kind: 'grant', share: 0.5, costShare: 0.5 };
      expect(() => checkProgramme(grant, 'q', ids)).toThrow(
        'q.instrument.costShare: unexpected key'
      );
      const guarantee = loan();
      guarantee.instrument = { kind: 'guarantee', costShare: 0.5, reserve: 0.1, rate: 0.02 };
      expect(() => checkProgramme(guarantee, 'q', ids)).toThrow(
        'q.instrument.rate: unexpected key'
      );
      const short = loan();
      delete short.instrument.requiredReturn;
      expect(() => checkProgramme(short, 'q', ids)).toThrow('q.instrument.requiredReturn: missing');
    });

    it('rejects minHomes 10001', () => {
      const p = loan();
      p.minHomes = 10001;
      expect(() => checkProgramme(p, 'q', ids)).toThrow(
        'q.minHomes: expected a whole number from 0 to 10000, got 10001'
      );
    });
  });
});
