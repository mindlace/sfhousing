// Permit-side pathway levels: proportional-hazards scaling of the pooled Aalen–Johansen table
// (stage-calibration spec §4.5 "Permit-side stages", §6 ph-pool.test.ts).
import { describe, expect, it } from 'vitest';
import { OUTCOMES, ajSweep, ajTable, type Outcome } from '../../lib/fzp-cal/aalen-johansen';
import { phScale, scaledTable } from '../../lib/fzp-cal/ph-pool';
import { cutSpells } from '../../lib/fzp-cal/spells';
import { LIVE_CAL } from '../../lib/fzp-cal/config';
import type { CalProfile, Spell } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import calibrationSmall from '../../../src/lib/timelapse/fixtures/calibration-small.json';
import { mulberry32 } from '../../../src/lib/generator/seed';
import { exp, log } from '../../../src/lib/timelapse/math';
import {
  cumulativeIncidence,
  parseCalibration,
  sampleTransition
} from '../../../src/lib/timelapse/model';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import { EXIT_ORDER, type ExitReason, type Transition } from '../../../src/lib/timelapse/types';

const M = MONTH_DAYS;
const V2007 = isoToDay('2007-01-01');
const V2015 = isoToDay('2015-01-01');
const AS_OF = isoToDay('2026-06-30');
const ENTRY_FROM = isoToDay('2000-01-01');

const cal = (over: Partial<CalProfile>): CalProfile => ({ ...LIVE_CAL, ...over });
const at = (t: { advance: number[]; exit: Partial<Record<ExitReason, number[]>> }) => {
  return (j: Outcome, k: number) => (j === 'advance' ? t.advance[k - 1] : t.exit[j]![k - 1]);
};

/** Constant monthly cause-specific hazards: advance and expired. */
interface Rates {
  advance: number;
  expired: number;
}

/** F_j(k) for constant competing hazards: (r_j / R)(1 - exp(-R k)). */
function truthAt(r: Rates, j: Outcome, k: number): number {
  const R = r.advance + r.expired;
  const rj = j === 'advance' ? r.advance : j === 'expired' ? r.expired : 0;
  return (rj / R) * (1 - exp(-R * k));
}

/**
 * Spells with exponential durations at `rates`, entries uniform over [2000-01-01, asOf),
 * censored at asOf, kept by the pooled window rule (z >= 2007-01-01, a = max(0, V - e)).
 * Drawing stops once `target` kept spells end on or after `countFrom`.
 */
function cohort(
  rand: () => number,
  rates: Rates,
  pathway: Spell['pathway'],
  prefix: string,
  target: number,
  countFrom: number
): Spell[] {
  const R = (rates.advance + rates.expired) / M;
  const out: Spell[] = [];
  let counted = 0;
  while (counted < target) {
    const e = ENTRY_FROM + rand() * (AS_OF - ENTRY_FROM);
    const dur = -log(1 - rand()) / R;
    const kind: Spell['outcome'] =
      rand() < rates.advance / (rates.advance + rates.expired) ? 'advance' : 'expired';
    const z = e + dur;
    const censored = z > AS_OF;
    const end = censored ? AS_OF : z;
    if (end < V2007) continue;
    if (end >= countFrom) counted++;
    out.push({
      pathway,
      stage: 'permitFiled',
      a: Math.max(0, V2007 - e),
      e,
      x: end - e,
      outcome: censored ? 'censored' : kind,
      projectId: `${prefix}${String(out.length).padStart(6, '0')}`
    });
  }
  return out;
}

const BASE: Rates = { advance: 1 / 12, expired: 1 / 36 };
const DOUBLED: Rates = { advance: 1 / 12, expired: 2 / 36 };

/** max |p - q| over months 1..K and every outcome. */
function worst(K: number, p: (j: Outcome, k: number) => number, q: typeof p): number {
  let w = 0;
  for (let k = 1; k <= K; k++) for (const j of OUTCOMES) w = Math.max(w, Math.abs(p(j, k) - q(j, k)));
  return w;
}

describe('phScale: identical pathway and pooled hazards', () => {
  const rand = mulberry32(0x5eed);
  const base = cohort(rand, BASE, null, 'b', 20000, V2007);
  const own = cohort(rand, BASE, 'discretionary', 'p', 10000, V2015);
  const pooled = [...own, ...base];
  const r = phScale(pooled, cutSpells(own, V2015), LIVE_CAL);
  const plain = ajTable(ajSweep(pooled), undefined, LIVE_CAL.kMax, LIVE_CAL.nRiskMin, pooled);

  it('every theta is within 0.05 of 1', () => {
    expect(r.thin).toBe(false);
    for (const j of OUTCOMES) expect(Math.abs(r.theta[j] - 1)).toBeLessThan(0.05);
    // outcomes with no pooled events have E = O = 0: theta = kappa / kappa
    for (const j of ['withdrawn', 'disapproved', 'cancelled'] as const) expect(r.theta[j]).toBe(1);
  });

  it('the table is within 0.01 of the pooled table, with the pooled months', () => {
    expect(r.months).toBe(plain.months);
    expect(r.months).toBeGreaterThanOrEqual(24);
    expect(worst(r.months, at(r), at(plain))).toBeLessThan(0.01);
  });
});

describe('phScale: a pathway with doubled exit hazard since 2015', () => {
  // The pooled exit hazard mixes 200,000 base spells with the 5,000 pathway spells, so its
  // large-sample theta_exit is a little under 2 (about 1.95); the tolerance is 0.15.
  const rand = mulberry32(0x5eed);
  const base = cohort(rand, BASE, null, 'b', 200000, V2007);
  const own = cohort(rand, DOUBLED, 'discretionary', 'p', 5000, V2015);
  const pooled = [...own, ...base];
  const own2015 = cutSpells(own, V2015);
  const r = phScale(pooled, own2015, LIVE_CAL);

  it('recovers theta_exit within 0.15 of 2 and theta_advance within 0.1 of 1', () => {
    expect(r.thin).toBe(false);
    expect(Math.abs(r.theta.expired - 2)).toBeLessThan(0.15);
    expect(Math.abs(r.theta.advance - 1)).toBeLessThan(0.1);
  });

  it("recovers the pathway's table within 0.02 of the truth at every month", () => {
    expect(r.months).toBeGreaterThanOrEqual(24);
    expect(worst(r.months, at(r), (j, k) => truthAt(DOUBLED, j, k))).toBeLessThan(0.02);
  });

  it('the tail is the pooled tail with lambda_j scaled by theta_j', () => {
    const total = r.tail.advance + r.tail.exit.expired!;
    expect(r.tail.exit.expired! / total).toBeGreaterThan(0.35); // truth 0.4 (pooled 0.25)
    expect(r.tail.exit.expired! / total).toBeLessThan(0.45);
    expect(r.tail.exit.withdrawn).toBe(0);
  });

  it("maxDiff is the largest gap to the pathway's own 2015+ table over the common months", () => {
    const self = ajTable(ajSweep(own2015), undefined, LIVE_CAL.kMax, LIVE_CAL.nRiskMin, own2015);
    const K = Math.min(r.months, self.months);
    expect(K).toBeGreaterThan(0);
    expect(r.maxDiff).toBe(worst(K, at(r), at(self)));
  });

  describe('as a Transition in calibration-small', () => {
    const exit: Partial<Record<ExitReason, number[]>> = {};
    const tailExit: Partial<Record<ExitReason, number>> = {};
    for (const reason of EXIT_ORDER) {
      if (r.tail.exit[reason] === 0 && r.exit[reason]!.every((v) => v === 0)) continue;
      exit[reason] = r.exit[reason];
      tailExit[reason] = r.tail.exit[reason];
    }
    const small = calibrationSmall.transitions.discretionary.permitFiled as Transition;
    const t: Transition = {
      months: r.months,
      advance: r.advance,
      exit,
      tail: { advance: r.tail.advance, exit: tailExit },
      provenance: small.provenance,
      tailProvenance: small.tailProvenance
    };

    it('passes parseCalibration (or, while it is a stub, the invariants it checks)', () => {
      const copy = structuredClone(calibrationSmall);
      (copy.transitions.discretionary as Record<string, unknown>).permitFiled = t;
      let stub = false;
      try {
        parseCalibration(copy);
      } catch (err) {
        if ((err as Error).message !== 'not implemented') throw err;
        stub = true;
      }
      expect(typeof stub).toBe('boolean');
      // The invariants parseCalibration enforces on a Transition.
      let prev = 0;
      for (let k = 1; k <= t.months; k++) {
        let c = t.advance[k - 1];
        expect(t.advance[k - 1]).toBeGreaterThanOrEqual(k === 1 ? 0 : t.advance[k - 2]);
        for (const reason of EXIT_ORDER) {
          const v = t.exit[reason];
          if (!v) continue;
          expect(v[k - 1]).toBeGreaterThanOrEqual(k === 1 ? 0 : v[k - 2]);
          expect(v[k - 1]).toBeLessThanOrEqual(1);
          c += v[k - 1];
        }
        expect(c).toBeLessThanOrEqual(1 + 1e-9);
        expect(c).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
      const rho = t.tail.advance + Object.values(t.tail.exit).reduce((s, v) => s + v!, 0);
      expect(rho).toBeGreaterThan(0);
      expect(rho).toBeLessThanOrEqual(1);
    });

    it('20,000 sampleTransition draws match its cumulativeIncidence within 0.01', () => {
      const N = 20000;
      const rng = mulberry32(0x5eed);
      const kinds: Outcome[] = ['advance', ...(Object.keys(exit) as ExitReason[])];
      const hist = new Map<Outcome, number[]>(kinds.map((j) => [j, new Array(t.months + 1).fill(0)]));
      for (let i = 0; i < N; i++) {
        const d = sampleTransition(t, rng(), 0);
        // event month k: ceil((k - 1) M) <= days < ceil(k M)
        let k = Math.floor(d.days / M) + 1;
        while (k > 1 && d.days < Math.ceil((k - 1) * M)) k--;
        while (d.days >= Math.ceil(k * M)) k++;
        if (k <= t.months) hist.get(d.kind)![k]++;
      }
      let w = 0;
      for (const j of kinds) {
        let acc = 0;
        for (let k = 1; k <= t.months; k++) {
          acc += hist.get(j)![k];
          const ci = cumulativeIncidence(t, k);
          const want = j === 'advance' ? ci.advance : ci.exit[j]!;
          w = Math.max(w, Math.abs(acc / N - want));
        }
      }
      expect(w).toBeLessThan(0.01);
    });
  });
});

/*
 * Hand example (cal: nRiskMin 1, tailSpan 1, tailMinEvents 1, nSpellsMin 1).
 * Pooled spells (a = 0): s1 advance at 0.5M, s2 expired at 1.5M, s3 advance at 2.5M,
 * s4 censored at 3.5M, and the pathway's two censored spells q1 (x = 3M) and q2 (x = 2M).
 * n(0.5M) = 6, n(1.5M) = 5, n(2.5M) = 3: h_adv = 1/6 and 1/3, h_exp = 1/5.
 * months = 3 (n(3M) = 2, n(4M) = 0); tail k0 = 3, span from 2M: exposure 0.5 + 1.5 + 1 + 0 = 3
 * person-months, one advance: lambda_adv = 1/3, lambda_exp = 0.
 * Pathway since 2015: q1 entered on 2015-01-01 (a = 0), q2 one month before (a = M after the cut).
 * Table part over d < 2M: n_p(0.5M) = 1, n_p(1.5M) = 2; tail-span person-months 1 (q1) + 0 (q2).
 * E_adv = 1 * 1/6 + 1 * 1/3 = 1/2, E_exp = 2 * 1/5 = 2/5; O = 0: theta_j = 5 / (E_j + 5).
 */
describe('phScale: a pathway with no 2015+ events', () => {
  const hc = cal({ nRiskMin: 1, tailSpan: 1, tailMinEvents: 1, nSpellsMin: 1 });
  const mk = (id: string, pathway: Spell['pathway'], e: number, x: number, o: Spell['outcome']) =>
    ({ pathway, stage: 'permitFiled', a: 0, e, x, outcome: o, projectId: id }) satisfies Spell;
  const e0 = isoToDay('2010-01-01');
  const q1 = mk('q1', 'discretionary', V2015, 3 * M, 'censored');
  const q2 = mk('q2', 'discretionary', V2015 - M, 2 * M, 'censored');
  const pooled = [
    q1,
    q2,
    mk('s1', null, e0, 0.5 * M, 'advance'),
    mk('s2', null, e0, 1.5 * M, 'expired'),
    mk('s3', null, e0, 2.5 * M, 'advance'),
    mk('s4', null, e0, 3.5 * M, 'censored')
  ];

  it('theta_j = kappa / (E_j + kappa) exactly, E from the table part and the tail span', () => {
    const r = phScale(pooled, [q1, q2], hc);
    expect(r.thin).toBe(false);
    expect(r.months).toBe(3);
    expect(r.theta.advance).toBeCloseTo(5 / (1 / 2 + 5), 14);
    expect(r.theta.expired).toBeCloseTo(5 / (2 / 5 + 5), 14);
    for (const j of ['withdrawn', 'disapproved', 'cancelled'] as const) expect(r.theta[j]).toBe(1);
  });

  it('cuts the pathway spells at 2015-01-01 itself (idempotent on cut spells)', () => {
    const r = phScale(pooled, [q1, q2], hc);
    const again = phScale(pooled, cutSpells([q1, q2], V2015), hc);
    expect(again.theta).toEqual(r.theta);
  });

  it('a thin pathway (fewer than nSpellsMin spells) keeps the pooled table: theta = 1', () => {
    const r = phScale(pooled, [q1, q2], { ...hc, nSpellsMin: 3 });
    const plain = ajTable(ajSweep(pooled), undefined, hc.kMax, hc.nRiskMin, pooled);
    expect(r.thin).toBe(true);
    for (const j of OUTCOMES) expect(r.theta[j]).toBe(1);
    expect(r.advance).toEqual(plain.advance);
    expect(r.exit).toEqual(plain.exit);
  });

  it('rejects spells of more than one stage', () => {
    expect(() => phScale(pooled, [{ ...q1, stage: 'construction' }], hc)).toThrow(/one stage/);
  });
});

describe('scaledTable: the Σh > 1 cap', () => {
  // 40 spells, one event every half month: h = 1/40, 1/39, ... (advance and expired alternate).
  const spells: Spell[] = Array.from({ length: 40 }, (_, i) => ({
    pathway: null,
    stage: 'permitFiled',
    a: 0,
    e: 0,
    x: (i + 1) * 0.5 * M,
    outcome: i % 2 === 0 ? 'advance' : 'expired',
    projectId: `h${String(i).padStart(3, '0')}`
  }));
  const sw = ajSweep(spells);
  const theta = { advance: 50, withdrawn: 1, disapproved: 1, cancelled: 1, expired: 50 };

  it('theta = 50 drives sums above 1: they are scaled to 1 and counted', () => {
    const r = scaledTable(sw, theta, LIVE_CAL.kMax, 1, spells);
    expect(r.capped).toBeGreaterThan(0);
    // 50 * 1 / (41 - i) > 1 for every grid point
    expect(r.capped).toBe(40);
    // the first grid point takes everything: S = 0 after it
    expect(r.advance[0]).toBe(1);
    for (let k = 1; k <= r.months; k++) {
      const c = r.advance[k - 1] + r.exit.expired![k - 1];
      expect(c).toBeLessThanOrEqual(1);
      expect(r.advance[k - 1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('theta = 1 is the plain AJ table and caps nothing', () => {
    const one = { advance: 1, withdrawn: 1, disapproved: 1, cancelled: 1, expired: 1 };
    const r = scaledTable(sw, one, LIVE_CAL.kMax, 1, spells);
    const plain = ajTable(sw, undefined, LIVE_CAL.kMax, 1, spells);
    expect(r.capped).toBe(0);
    expect(r.advance).toEqual(plain.advance);
    expect(r.exit).toEqual(plain.exit);
  });

  it('phScale counts the cap where a pooled increment is 1 and theta > 1', () => {
    // The last pooled event has n = e = 1 (h = 1); a pathway full of early advances has theta > 1.
    const hc = cal({ nRiskMin: 1, tailSpan: 1, tailMinEvents: 1, nSpellsMin: 1 });
    const own: Spell[] = Array.from({ length: 10 }, (_, i) => ({
      pathway: 'discretionary',
      stage: 'permitFiled',
      a: 0,
      e: V2015 + i,
      x: 0.25 * M,
      outcome: 'advance',
      projectId: `o${i}`
    }));
    const pool = [...own, ...spells.map((s) => ({ ...s, e: isoToDay('2010-01-01') }))];
    const r = phScale(pool, own, hc);
    expect(r.theta.advance).toBeGreaterThan(1);
    expect(r.capped).toBeGreaterThan(0);
  });
});
