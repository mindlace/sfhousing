// Acceptance "reproduces observed per-stage death rates", through the whole engine (spec §6):
// synthetic pipeline cohorts in every stage of the mini calibration, compared with T12
// `cumulativeIncidence` only (no second incidence implementation).
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cumulativeIncidence, parseCalibration } from '$lib/timelapse/model';
import type { InFlightProject } from '$lib/timelapse/projects';
import { MONTH_DAYS, monthsIn } from '$lib/timelapse/time';
import {
  EXIT_ORDER,
  PATHWAYS,
  type Calibration,
  type ExitReason,
  type Pathway,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import { nextStage } from './engine';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_AS_OF } from './fixtures/mini-projects';
import { simulate } from './simulate';
import type { Schedule, SimInput } from './types';

const AS_OF = MINI_AS_OF;
const N = 20000;
const HORIZON = AS_OF + 400 * 365;
const M_IN_FLIGHT = 6;

const cal: Calibration = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const parcels = miniCity().parcels;

type Kind = 'advance' | ExitReason;

const kindsOf = (t: Transition): Kind[] => [
  'advance',
  ...EXIT_ORDER.filter((r) => t.exit[r] !== undefined || t.tail.exit[r] !== undefined)
];
const F = (t: Transition, k: number, j: Kind): number => {
  const c = cumulativeIncidence(t, k);
  return j === 'advance' ? c.advance : (c.exit[j] ?? 0);
};

/** The leaving event of the cohort's stage: advance (next entry) or an exit from it. */
function leave(s: Schedule, stage: Stage): { kind: Kind; day: number } | null {
  const d = s.entered[nextStage(s.pathway, stage)];
  if (d !== undefined) return { kind: 'advance', day: d };
  if (s.end.kind === 'exit' && s.end.stage === stage) return { kind: s.end.reason, day: s.end.day };
  return null;
}

function cohort(p: Pathway, stage: Stage, entered: number): { kind: Kind; day: number }[] {
  const projects: InFlightProject[] = Array.from({ length: N }, (_, i) => ({
    id: `PRJ:inc-${p}-${stage}-${i}`,
    label: null,
    parcelIds: [],
    pathway: p,
    stage,
    history: { [stage]: entered },
    units: 10,
    existingUnits: 0,
    stories: null,
    storiesTier: null,
    multiPhase: false,
    phases: null,
    sources: [],
    quality: []
  }));
  const input: SimInput = { parcels, projects, calibration: cal, asOf: AS_OF };
  return simulate(input, 20261018, HORIZON).map((s) => {
    const ev = leave(s, stage);
    if (ev === null) throw new Error(`${s.projectId} never left ${stage}`);
    return ev;
  });
}

const cases = PATHWAYS.flatMap((p) =>
  (Object.keys(cal.transitions[p]) as Exclude<Stage, 'complete'>[]).map(
    (stage) => [p, stage, cal.transitions[p][stage]!] as const
  )
);

const within = (got: number, expected: number) => {
  const se = Math.sqrt((Math.max(expected, 0) * Math.max(1 - expected, 0)) / N);
  // 4·SE, plus one project's worth for incidences so small that SE rounds to nothing.
  return Math.abs(got - expected) <= 4 * se + 1 / N;
};

let warn: MockInstance<typeof console.warn>;
beforeAll(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warn.mockRestore());

describe('stage incidence through simulate', () => {
  it('covers all 16 mini transitions', () => {
    expect(cases).toHaveLength(16);
  });

  it.each(cases)('fresh %s %s entries on asOf match cumulativeIncidence', (p, stage, t) => {
    const events = cohort(p, stage, AS_OF);
    expect(events.every((ev) => ev.day > AS_OF)).toBe(true);
    const bad: string[] = [];
    for (const k of [1, 3, 6, 12, 24, t.months, t.months + 12]) {
      for (const j of kindsOf(t)) {
        const expected = F(t, k, j);
        const got = events.filter((ev) => ev.kind === j && monthsIn(AS_OF, ev.day) < k).length / N;
        if (!within(got, expected)) bad.push(`${j} by month ${k}: ${got} vs ${expected}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it.each(cases)(
    `%s %s projects ${M_IN_FLIGHT} months in match the survival-conditional incidence`,
    (p, stage, t) => {
      // Entered exactly 6 whole months (by the day) before asOf: conditioning on survival to asOf
      // is conditioning on survival to month 6.
      const e = AS_OF - Math.ceil(M_IN_FLIGHT * MONTH_DAYS);
      expect(monthsIn(e, AS_OF)).toBe(M_IN_FLIGHT);
      const events = cohort(p, stage, e);
      expect(events.every((ev) => ev.day > AS_OF)).toBe(true);
      const kinds = kindsOf(t);
      const C = kinds.reduce((acc, j) => acc + F(t, M_IN_FLIGHT, j), 0);
      const bad: string[] = [];
      const ks = [7, 9, 12, 18, 30, t.months + 6, t.months + 12].filter((k) => k > M_IN_FLIGHT);
      for (const k of ks) {
        for (const j of kinds) {
          const expected = (F(t, k, j) - F(t, M_IN_FLIGHT, j)) / (1 - C);
          const got = events.filter((ev) => ev.kind === j && monthsIn(e, ev.day) < k).length / N;
          if (!within(got, expected)) bad.push(`${j} by month ${k}: ${got} vs ${expected}`);
        }
      }
      expect(bad).toEqual([]);
    }
  );
});
