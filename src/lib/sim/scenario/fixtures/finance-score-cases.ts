/**
 * finance-score's hand-built cases (spec 6, "Fixtures"): completed schedules, a hand-built
 * `TierCtx` whose programmes carry test instruments and `tiers`, and `TEST_TERMS`. Every value
 * here is a test value, not data. Later tasks add the hand-built ledgers and pools.
 */
import { dayOf } from '../dates';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { IncomeTier, ResolvedTerms, TierUnits } from '$lib/timelapse/types';
import type { BundleItem } from '../../finance';
import type { TierCtx } from '../finance-score';
import type { Schedule } from '../types';

/** A `ResolvedTerms` with every term set (test values, not sourced). */
export const TEST_TERMS: ResolvedTerms = {
  constructionRate: 0.085,
  constructionYears: 2,
  requiredReturn: 0.06,
  guaranteeRateCut: 0.01,
  lossOnExit: 1,
  custom: []
};

/** The uncovered cost per affordable home the hand shares are written over (F4, tier 2). */
export const TOTAL = 861525;

const DAY0 = dayOf(2027, 1, 1);

/** `T(vl, lo, mo, am, un)`: a `TierUnits`. */
export const T = (
  veryLow: number,
  low: number,
  moderate: number,
  aboveModerate: number,
  unrecorded: number
): TierUnits => ({ veryLow, low, moderate, aboveModerate, unrecorded });

/**
 * A completed schedule (default simulated, 10 homes at 4 stories). `units` lists the revisions'
 * units in order (a day apart); `stories` is the start revision's stories.
 */
export function schedule(
  over: Partial<Schedule> & { units?: number[]; stories?: number | null } = {}
): Schedule {
  const { units = [10], stories = 4, ...rest } = over;
  return {
    projectId: 'sim:case:0',
    origin: 'simulated',
    parcelIds: [],
    pathway: 'discretionary',
    entered: { construction: DAY0 + 10 },
    end: { kind: 'complete', day: DAY0 + 500 },
    revisions: units.map((u, i) => ({
      day: DAY0 + i,
      units: u,
      stories: i === 0 ? stories : null
    })),
    existingUnits: 0,
    multiPhase: false,
    phase: null,
    ...rest
  };
}

/** A funded affordable schedule paid by `programmes` (the dollars are not read by `tiersOf`). */
export function affordable(programmes: string[], units: number, stories = 4): Schedule {
  return schedule({
    projectId: `sim:aff-${programmes.join('-')}:${units}`,
    units: [units],
    stories,
    kind: 'affordable',
    funding: {
      programmes,
      applied: DAY0,
      granted: 0,
      lent: 0,
      guaranteed: 0,
      displaced: 0,
      certain: true
    }
  });
}

/** A pipeline schedule with id `projectId` and final units the last of `units`. */
export function pipeline(projectId: string, units: number[]): Schedule {
  return schedule({ projectId, origin: 'pipeline', units, stories: null });
}

export const MARKET = {
  m9: schedule({ units: [9] }),
  m10: schedule({ units: [10] }),
  m25: schedule({ units: [25] }),
  m130: schedule({ units: [130] }),
  revised: schedule({ units: [40, 24] }),
  funded: schedule({
    units: [30],
    funding: {
      programmes: ['a'],
      applied: DAY0,
      granted: 1,
      lent: 0,
      guaranteed: 0,
      displaced: 0,
      certain: false
    }
  })
};

export const AFFORDABLE_CASES = {
  one: affordable(['mohcd'], 100),
  worked: affordable(['a', 'b'], 101),
  tie: affordable(['vl', 'lo'], 3),
  loans: affordable(['loan1', 'loan2'], 4),
  nullTiers: affordable(['a', 'nul'], 100),
  noFunding: schedule({ units: [12], kind: 'affordable' }),
  emptyProgrammes: affordable([], 12),
  unknown: affordable(['zz'], 12)
};

const tiersAll = (t: IncomeTier): Record<IncomeTier, number> => ({
  veryLow: 0,
  low: 0,
  moderate: 0,
  aboveModerate: 0,
  [t]: 1
});

type CaseProgramme = { item: BundleItem; tiers: Record<IncomeTier, number> | null };

const grant = (share: number, tiers: Record<IncomeTier, number> | null): CaseProgramme => ({
  item: { instrument: { kind: 'grant', share }, poolKind: 'generalRevenue' },
  tiers
});
/** A loan above the construction rate with no lower required return: grant-equivalent 0. */
const loan = (tiers: Record<IncomeTier, number>): CaseProgramme => ({
  item: {
    instrument: { kind: 'loan', costShare: 0.5, rate: 0.09, requiredReturn: null },
    poolKind: 'generalRevenue'
  },
  tiers
});

/**
 * The hand-built `TierCtx`: every programme on a `generalRevenue` pool (one tier, so the hand
 * weights hold), `TEST_TERMS`, `affordable` and `weights` empty (a new map on every call).
 */
export function caseCtx(affordableHomes: [string, number][] = []): TierCtx {
  return {
    affordable: new Map(affordableHomes),
    programmes: new Map<string, CaseProgramme>([
      ['a', grant(600000 / TOTAL, { veryLow: 0.6, low: 0.4, moderate: 0, aboveModerate: 0 })],
      ['b', grant(200000 / TOTAL, { veryLow: 0.2, low: 0.5, moderate: 0.3, aboveModerate: 0 })],
      ['vl', grant(0.3, tiersAll('veryLow'))],
      ['lo', grant(0.3, tiersAll('low'))],
      ['loan1', loan(tiersAll('veryLow'))],
      ['loan2', loan(tiersAll('low'))],
      ['nul', grant(200000 / TOTAL, null)],
      [
        'mohcd',
        grant(1, { veryLow: 0.483439, low: 0.433384, moderate: 0.076402, aboveModerate: 0.006775 })
      ],
      ['tiny', grant(1e-9, tiersAll('moderate'))]
    ]),
    terms: TEST_TERMS,
    weights: new Map()
  };
}

/** The ids of `caseCtx()`'s programmes. */
export const CASE_PROGRAMMES = [
  'a',
  'b',
  'vl',
  'lo',
  'loan1',
  'loan2',
  'nul',
  'mohcd',
  'tiny'
] as const;

/** A minimal `projects.json` row (the fields `tierContext` reads are the point). */
export function project(over: Partial<InFlightProject> & { id: string }): InFlightProject {
  return {
    label: null,
    parcelIds: [],
    pathway: 'discretionary',
    stage: 'filed',
    history: {},
    units: 100,
    existingUnits: 0,
    affordableHomes: null,
    stories: null,
    storiesTier: null,
    multiPhase: false,
    phases: null,
    sources: [],
    quality: [],
    ...over
  };
}

const phase = (units: number) => ({
  units,
  parcelIds: [],
  plannedPermitFiled: null,
  source: null
});

function absent(p: InFlightProject): InFlightProject {
  const { affordableHomes: _, ...rest } = p;
  return rest;
}

/** Pipeline rows: `affordableHomes` null, absent, 0, 30 of 100, 120 of 100; masters. */
export const PROJECTS: InFlightProject[] = [
  project({ id: 'PRJ:null', affordableHomes: null }),
  absent(project({ id: 'PRJ:absent' })),
  project({ id: 'PRJ:zero', affordableHomes: 0 }),
  project({ id: 'PRJ:thirty', affordableHomes: 30 }),
  project({ id: 'PRJ:over', affordableHomes: 120 }),
  project({
    id: 'PRJ:master',
    units: 301,
    affordableHomes: 50,
    multiPhase: true,
    phases: [phase(100), phase(100), phase(101)]
  }),
  project({ id: 'PRJ:unenriched', units: 100, affordableHomes: 40, multiPhase: true, phases: null })
];
