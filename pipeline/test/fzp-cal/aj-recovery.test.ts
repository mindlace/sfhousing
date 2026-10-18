// Property: Aalen–Johansen with delayed entry recovers a known Transition from censored,
// left-truncated spells, and a naive "dead among ended" estimator does not (spec §6, ruling R9).
import { describe, expect, it } from 'vitest';
import { ajSweep, ajTable } from '../../lib/fzp-cal/aalen-johansen';
import { tailFit } from '../../lib/fzp-cal/tail';
import { LIVE_CAL } from '../../lib/fzp-cal/config';
import type { Spell } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import calibrationSmall from '../../../src/lib/timelapse/fixtures/calibration-small.json';
import { mulberry32 } from '../../../src/lib/generator/seed';
import {
  cumulativeIncidence,
  eventualProbabilities,
  sampleTransition
} from '../../../src/lib/timelapse/model';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import { EXIT_ORDER, type Transition } from '../../../src/lib/timelapse/types';

const small = calibrationSmall.transitions.discretionary.permitFiled as Transition;
const N = 20000;
const ENTRY_FROM = isoToDay('2005-01-01');
const AS_OF = isoToDay('2026-06-30');
const WINDOW = isoToDay('2015-01-01');
const KINDS = ['advance', ...EXIT_ORDER] as const;
type Kind = (typeof KINDS)[number];

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Early advances, late exits (ruling R9), so that censoring removes mostly exits:
 * advance linear to 0.55 by month 12, then flat; expired 0 through month 12, then linear to 0.10
 * by month 24; C(24) = 0.65. Tail advance 0.005, expired 0.02 (rho = 0.025).
 */
const lateExits: Transition = {
  ...small,
  months: 24,
  advance: Array.from({ length: 24 }, (_, i) => round6((0.55 * Math.min(i + 1, 12)) / 12)),
  exit: { expired: Array.from({ length: 24 }, (_, i) => round6((0.1 * Math.max(i - 11, 0)) / 12)) },
  tail: { advance: 0.005, exit: { expired: 0.02 } }
};

/**
 * Entry-day densities over [2005-01-01, asOf), from one uniform u. With a uniform (stationary)
 * entry rate, the spells that end inside the window have exactly the true duration distribution
 * for every duration shorter than the 10 years between 2005 and the window: what censoring at
 * asOf removes, left truncation at 2015 puts back. So "dead among ended" is unbiased there
 * (measured worst miss 0.005 on `lateExits`). A rising entry rate, like a growing pipeline,
 * breaks that balance, and it is the only change from the uniform design.
 */
const uniformEntry = (u: number) => ENTRY_FROM + u * (AS_OF - ENTRY_FROM);
/** Density rising linearly from 0 at 2005-01-01 (inverse CDF of t - 2005 on [0, span)). */
const risingEntry = (u: number) => ENTRY_FROM + Math.sqrt(u) * (AS_OF - ENTRY_FROM);

/** Spells kept by the §4.4 window rule: z >= V and e < asOf, a = max(0, V - e), censored at asOf. */
function synthesise(truth: Transition, entry: (u: number) => number): Spell[] {
  const rand = mulberry32(0x5eed);
  const spells: Spell[] = [];
  while (spells.length < N) {
    const e = Math.floor(entry(rand()));
    const draw = sampleTransition(truth, rand(), 0);
    const z = e + draw.days;
    const censored = z > AS_OF;
    const end = censored ? AS_OF : z;
    if (end < WINDOW) continue;
    spells.push({
      pathway: 'discretionary',
      stage: 'permitFiled',
      a: Math.max(0, WINDOW - e),
      e,
      x: end - e,
      outcome: censored ? 'censored' : draw.kind,
      projectId: `s${String(spells.length).padStart(6, '0')}`
    });
  }
  return spells;
}

function trueAt(truth: Transition, k: number, j: Kind): number {
  const ci = cumulativeIncidence(truth, k);
  return j === 'advance' ? ci.advance : (ci.exit[j] ?? 0);
}

/** The largest |estimate - truth| over months 1..K and every outcome. */
function worstMiss(truth: Transition, K: number, est: (k: number, j: Kind) => number): number {
  let worst = 0;
  for (let k = 1; k <= K; k++) {
    for (const j of KINDS) worst = Math.max(worst, Math.abs(est(k, j) - trueAt(truth, k, j)));
  }
  return worst;
}

function recovery(truth: Transition, entry: (u: number) => number) {
  const spells = synthesise(truth, entry);
  const sw = ajSweep(spells);
  const table = ajTable(sw, undefined, LIVE_CAL.kMax, LIVE_CAL.nRiskMin, spells);
  const fit = tailFit(spells, table.months, LIVE_CAL);
  const est: Transition = {
    ...truth,
    months: table.months,
    advance: table.advance,
    exit: { expired: table.exit.expired },
    tail: { advance: fit.tail.advance, exit: { expired: fit.tail.exit.expired } }
  };
  const ajAt = (k: number, j: Kind) =>
    j === 'advance' ? table.advance[k - 1] : table.exit[j]![k - 1];
  return { spells, sw, table, est, ajAt };
}

describe('Aalen–Johansen recovery: early advances, late exits, rising entries (R9)', () => {
  const { spells, sw, table, est, ajAt } = recovery(lateExits, risingEntry);

  it('samples a censored, left-truncated cohort', () => {
    expect(spells.filter((s) => s.outcome === 'censored').length).toBeGreaterThan(N * 0.05);
    expect(spells.filter((s) => s.a > 0).length).toBeGreaterThan(N * 0.05);
    expect(table.months).toBeGreaterThanOrEqual(24);
    for (const r of EXIT_ORDER) if (r !== 'expired') expect(sw.events[r]).toBe(0);
  });

  it('recovers the cumulative incidence within 0.02 at every month 1..24', () => {
    expect(worstMiss(lateExits, 24, ajAt)).toBeLessThan(0.02);
  });

  it('recovers the eventual shares within 0.02 (table plus fitted tail)', () => {
    const want = eventualProbabilities(lateExits, 0);
    const got = eventualProbabilities(est, 0);
    expect(Math.abs(got.advance - want.advance)).toBeLessThan(0.02);
    expect(Math.abs(got.exit.expired! - want.exit.expired!)).toBeLessThan(0.02);
  });

  it('a naive "dead among ended" estimator misses by more than 0.02 on the same data', () => {
    // F_j(k) ~ #(outcome j with x < k * M) / #(ended spells): censoring and delayed entry ignored
    const ended = spells.filter((s) => s.outcome !== 'censored');
    const naiveAt = (k: number, j: Kind) =>
      ended.filter((s) => s.outcome === j && s.x < k * MONTH_DAYS).length / ended.length;
    expect(worstMiss(lateExits, 24, naiveAt)).toBeGreaterThan(0.02);
  });
});

describe('Aalen–Johansen recovery: calibration-small permitFiled, uniform entries', () => {
  const { table, est, ajAt } = recovery(small, uniformEntry);

  it('recovers the cumulative incidence within 0.02 at every month 1..12', () => {
    expect(table.months).toBeGreaterThanOrEqual(12);
    expect(worstMiss(small, 12, ajAt)).toBeLessThan(0.02);
  });

  it('recovers the eventual shares within 0.02 (table plus fitted tail)', () => {
    const want = eventualProbabilities(small, 0);
    const got = eventualProbabilities(est, 0);
    expect(Math.abs(got.advance - want.advance)).toBeLessThan(0.02);
    expect(Math.abs(got.exit.expired! - want.exit.expired!)).toBeLessThan(0.02);
  });
});
