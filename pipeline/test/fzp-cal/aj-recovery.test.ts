// Property: Aalen–Johansen with delayed entry recovers a known Transition from censored,
// left-truncated spells (stage-calibration spec §6).
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
import { EXIT_ORDER, type Transition } from '../../../src/lib/timelapse/types';

const truth = calibrationSmall.transitions.discretionary.permitFiled as Transition;
const N = 20000;
const ENTRY_FROM = isoToDay('2005-01-01');
const AS_OF = isoToDay('2026-06-30');
const WINDOW = isoToDay('2015-01-01');
const KINDS = ['advance', ...EXIT_ORDER] as const;

/** Spells kept by the §4.4 window rule: z >= V and e < asOf, a = max(0, V - e), censored at asOf. */
function synthesise(): Spell[] {
  const rand = mulberry32(0x5eed);
  const spells: Spell[] = [];
  while (spells.length < N) {
    const e = ENTRY_FROM + Math.floor(rand() * (AS_OF - ENTRY_FROM));
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

const spells = synthesise();
const sw = ajSweep(spells);
const table = ajTable(sw, undefined, LIVE_CAL.kMax, LIVE_CAL.nRiskMin, spells);

function trueAt(k: number, j: (typeof KINDS)[number]): number {
  const ci = cumulativeIncidence(truth, k);
  return j === 'advance' ? ci.advance : (ci.exit[j] ?? 0);
}

describe('Aalen–Johansen recovery', () => {
  it('samples a censored, left-truncated cohort', () => {
    const censored = spells.filter((s) => s.outcome === 'censored').length;
    const truncated = spells.filter((s) => s.a > 0).length;
    expect(censored).toBeGreaterThan(N * 0.05);
    expect(truncated).toBeGreaterThan(N * 0.05);
    expect(table.months).toBeGreaterThanOrEqual(12);
  });

  it('recovers the cumulative incidence within 0.02 at every month 1..12', () => {
    let worst = 0;
    for (let k = 1; k <= 12; k++) {
      for (const j of KINDS) {
        const est = j === 'advance' ? table.advance[k - 1] : table.exit[j]![k - 1];
        worst = Math.max(worst, Math.abs(est - trueAt(k, j)));
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('recovers the eventual shares within 0.02 (table plus fitted tail)', () => {
    const fit = tailFit(spells, table.months, LIVE_CAL);
    const est: Transition = {
      ...truth,
      months: table.months,
      advance: table.advance,
      exit: { expired: table.exit.expired },
      tail: { advance: fit.tail.advance, exit: { expired: fit.tail.exit.expired } }
    };
    const want = eventualProbabilities(truth, 0);
    const got = eventualProbabilities(est, 0);
    expect(Math.abs(got.advance - want.advance)).toBeLessThan(0.02);
    expect(Math.abs(got.exit.expired! - want.exit.expired!)).toBeLessThan(0.02);
    for (const r of EXIT_ORDER) if (r !== 'expired') expect(sw.events[r]).toBe(0);
  });
});
