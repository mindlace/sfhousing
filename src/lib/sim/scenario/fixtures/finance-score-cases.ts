/**
 * finance-score's hand-built cases (spec 6, "Fixtures"): completed schedules, a hand-built
 * `TierCtx` whose programmes carry test instruments and `tiers`, and `TEST_TERMS`. Every value
 * here is a test value, not data. The hand-built ledgers (`MONEY_CASES`) close the file.
 */
import { dayOf } from '../dates';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type {
  IncomeTier,
  Instrument,
  Pool,
  Programme,
  ResolvedTerms,
  TierUnits
} from '$lib/timelapse/types';
import type { BundleItem } from '../../finance';
import type { TierCtx } from '../finance-score';
import type { LedgerEvent } from '../money';
import { monthsOf } from '../score';
import type { Schedule, SimInput } from '../types';

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

// ---- Money (spec 4.4, test 16): hand-built ledgers on one year of months ----

type Finance = NonNullable<SimInput['finance']>;

export const MONEY_ASOF = dayOf(2027, 1, 1);
export const MONEY_HORIZON = dayOf(2027, 12, 31);
/** The 12 months of 2027. */
export const MONEY_MONTHS: Day[] = monthsOf(MONEY_ASOF, MONEY_HORIZON);

/** A capped `generalRevenue` pool with no inflows (the ledgers carry the `in` events). */
export function moneyPool(id: string, over: Partial<Pool> = {}): Pool {
  return {
    id,
    kind: 'generalRevenue',
    label: `Pool ${id}`,
    inflows: [],
    uncapped: false,
    debt: null,
    leverage: 1,
    ...over
  };
}

const INSTRUMENTS: Record<Instrument['kind'], Instrument> = {
  grant: { kind: 'grant', share: 0.3 },
  loan: { kind: 'loan', costShare: 0.5, rate: 0.03, requiredReturn: null },
  guarantee: { kind: 'guarantee', costShare: 0.5, reserve: 0.5 }
};

/** A programme of `kind` on `pool`, offered from `MONEY_ASOF` (test values). */
export function moneyProgramme(id: string, pool: string, kind: Instrument['kind']): Programme {
  return {
    id,
    label: `Programme ${id}`,
    pool,
    reach: 'market',
    instrument: INSTRUMENTS[kind],
    from: MONEY_ASOF,
    to: null,
    minHomes: 0,
    tiers: null
  };
}

/** One ledger event. */
export const ev = (
  day: Day,
  pool: string,
  programme: string | null,
  kind: LedgerEvent['kind'],
  dollars: number
): LedgerEvent => ({ day, pool, programme, kind, dollars });

export interface MoneyCase {
  finance: Finance;
  ledger: LedgerEvent[];
}

function moneyCase(
  pools: Pool[],
  programmes: Programme[],
  ledger: LedgerEvent[],
  off: Finance['off'] = [],
  lossOnExit = 1
): MoneyCase {
  const terms = { ...TEST_TERMS, lossOnExit };
  return { finance: { pools, programmes, off, slope: 1, terms }, ledger };
}

const d = (m: number, day: number) => dayOf(2027, m, day);

/**
 * The hand ledgers of test 16, one pool per lifecycle unless named, each in the engine's order
 * within a day (`finance-engine.md`, "Order within a day"). λ (`lossOnExit`) is 1 except where a
 * case says otherwise; the dollars are written out, not derived.
 */
export const MONEY_CASES = {
  /** loan lost after construction began, λ = 0.25: repay 450,000 then loss 150,000 */
  loanLost: moneyCase(
    [moneyPool('p-loan')],
    [moneyProgramme('l', 'p-loan', 'loan')],
    [
      ev(d(1, 1), 'p-loan', null, 'in', 1_000_000),
      ev(d(2, 10), 'p-loan', 'l', 'commit', 600_000),
      ev(d(4, 5), 'p-loan', 'l', 'spend', 600_000),
      ev(d(7, 20), 'p-loan', 'l', 'repay', 450_000),
      ev(d(7, 20), 'p-loan', 'l', 'loss', 150_000)
    ],
    [],
    0.25
  ),
  /** a grant committed then paid at construction start; the project completes */
  grantSpent: moneyCase(
    [moneyPool('p-grant')],
    [moneyProgramme('g', 'p-grant', 'grant')],
    [
      ev(d(1, 1), 'p-grant', null, 'in', 1_000_000),
      ev(d(3, 3), 'p-grant', 'g', 'commit', 400_000),
      ev(d(6, 10), 'p-grant', 'g', 'spend', 400_000)
    ]
  ),
  /** a loan lent at construction start and repaid at completion */
  loanRepaid: moneyCase(
    [moneyPool('p-loan')],
    [moneyProgramme('l', 'p-loan', 'loan')],
    [
      ev(d(1, 1), 'p-loan', null, 'in', 1_000_000),
      ev(d(2, 1), 'p-loan', 'l', 'commit', 500_000),
      ev(d(3, 15), 'p-loan', 'l', 'spend', 500_000),
      ev(d(10, 1), 'p-loan', 'l', 'repay', 500_000)
    ]
  ),
  /** a guarantee reserve held and freed at completion */
  guaranteeCompleted: moneyCase(
    [moneyPool('p-guar')],
    [moneyProgramme('h', 'p-guar', 'guarantee')],
    [
      ev(d(1, 1), 'p-guar', null, 'in', 1_000_000),
      ev(d(2, 20), 'p-guar', 'h', 'commit', 250_000),
      ev(d(9, 30), 'p-guar', 'h', 'release', 250_000)
    ]
  ),
  /**
   * A guarantee lost on a pool that held all it received: `release H` before `loss H` on one day
   * (the engine's order), so the available money is 0 at every month end, never negative.
   */
  guaranteeLostFull: moneyCase(
    [moneyPool('p-guar')],
    [moneyProgramme('h', 'p-guar', 'guarantee')],
    [
      ev(d(1, 1), 'p-guar', null, 'in', 300_000),
      ev(d(3, 1), 'p-guar', 'h', 'commit', 300_000),
      ev(d(5, 15), 'p-guar', 'h', 'release', 300_000),
      ev(d(5, 15), 'p-guar', 'h', 'loss', 300_000)
    ]
  ),
  /** a grant paid, then lost when the project exits during construction (a mark: spent stays) */
  grantLost: moneyCase(
    [moneyPool('p-grant')],
    [moneyProgramme('g', 'p-grant', 'grant')],
    [
      ev(d(1, 1), 'p-grant', null, 'in', 1_000_000),
      ev(d(2, 5), 'p-grant', 'g', 'commit', 200_000),
      ev(d(3, 5), 'p-grant', 'g', 'spend', 200_000),
      ev(d(8, 8), 'p-grant', 'g', 'loss', 200_000)
    ]
  ),
  /** the project exits before construction: the commitment is released */
  releaseBefore: moneyCase(
    [moneyPool('p-grant')],
    [moneyProgramme('g', 'p-grant', 'grant')],
    [
      ev(d(1, 1), 'p-grant', null, 'in', 1_000_000),
      ev(d(3, 10), 'p-grant', 'g', 'commit', 350_000),
      ev(d(5, 20), 'p-grant', 'g', 'release', 350_000)
    ]
  ),
  /**
   * A commit on a day the pool is off (M1, open with the partner: a partly covered application can
   * commit from a pool inside its `off` span); the series are as for any commit.
   */
  commitWhileOff: moneyCase(
    [moneyPool('p-off')],
    [moneyProgramme('g', 'p-off', 'grant')],
    [
      ev(d(1, 1), 'p-off', null, 'in', 1_000_000),
      ev(d(3, 15), 'p-off', 'g', 'commit', 450_000),
      ev(d(6, 1), 'p-off', 'g', 'spend', 450_000)
    ],
    [{ pool: 'p-off', from: d(3, 1), to: d(4, 30) }]
  ),
  /** one pool serving a grant `g` and a loan `l`; both lost in June (λ = 1, so no repay) */
  mixed: moneyCase(
    [moneyPool('p-mixed')],
    [moneyProgramme('g', 'p-mixed', 'grant'), moneyProgramme('l', 'p-mixed', 'loan')],
    [
      ev(d(1, 1), 'p-mixed', null, 'in', 2_000_000),
      ev(d(2, 1), 'p-mixed', 'g', 'commit', 300_000),
      ev(d(2, 1), 'p-mixed', 'l', 'commit', 500_000),
      ev(d(3, 10), 'p-mixed', 'g', 'spend', 300_000),
      ev(d(3, 10), 'p-mixed', 'l', 'spend', 500_000),
      ev(d(6, 12), 'p-mixed', 'g', 'loss', 300_000),
      ev(d(6, 12), 'p-mixed', 'l', 'loss', 500_000)
    ]
  ),
  /** an `in` five days before `MONEY_ASOF` (before `months[0]`) lands in month 0 */
  beforeMonths: moneyCase(
    [moneyPool('p-early')],
    [],
    [ev(MONEY_ASOF - 5, 'p-early', null, 'in', 100_000), ev(d(2, 1), 'p-early', null, 'in', 50_000)]
  ),
  /** a release on `MONEY_HORIZON + 1` is dropped: the commitment stays at month 11 */
  afterHorizon: moneyCase(
    [moneyPool('p-late')],
    [moneyProgramme('g', 'p-late', 'grant')],
    [
      ev(d(1, 1), 'p-late', null, 'in', 1_000_000),
      ev(d(12, 1), 'p-late', 'g', 'commit', 100_000),
      ev(MONEY_HORIZON + 1, 'p-late', 'g', 'release', 100_000)
    ]
  ),
  /** an uncapped `federal` pool: commits and spends, never an `in` */
  uncapped: moneyCase(
    [moneyPool('fed', { kind: 'federal', uncapped: true })],
    [moneyProgramme('fg', 'fed', 'grant')],
    [ev(d(2, 1), 'fed', 'fg', 'commit', 700_000), ev(d(4, 1), 'fed', 'fg', 'spend', 700_000)]
  )
} satisfies Record<string, MoneyCase>;
