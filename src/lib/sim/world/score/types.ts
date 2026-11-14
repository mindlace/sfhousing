import type { ParcelId } from '$lib/data/parcel';
import type { limitStatements } from '$lib/sim/finance';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { Massing, Schedule, TargetProgressAt, TimelineScore } from '$lib/sim/scenario/types';
import type { ProjectsFile, QualityRuleRef } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { PoolKind, TierUnits } from '$lib/timelapse/types';
import type { FinanceFrame } from '../policy/frame';
import type { Statics } from '../statics';
import type { World, WorldEvent } from '../types';

/** Today's `TimelineScore['shown']` entry. */
export type MonthRow = TimelineScore['shown'][number];

export interface PlanRow {
  entitledNew: number;
  completedNetNew: number;
}

/** One month's entry of every per-month series in today's `TimelineScore['money']`. */
export interface MoneyRow {
  pools: {
    id: string;
    label: string;
    kind: PoolKind;
    received: number;
    committed: number;
    out: number;
    spent: number;
    repaid: number;
    lost: number;
    lostCredit: number;
  }[];
  fundedHomes: number;
  /** Homes in 'displaced' events by each event's own day (rule 2). */
  displacedHomes: number;
  /**
   * The displaced homes of funded projects completed by this month (rule 12): the term of the
   * `perAddedHome` and `displacedShare` denominators, paired with `fundedHomes`, which also counts
   * at completion.
   */
  displacedHomesCompleted: number;
  publicSpent: number;
}

/**
 * Today's `TimelineScore['money']`, its series cut at `filledThrough`, with rule 12's figures read
 * at `filledThrough`: today's `perAddedHome` and `displacedShare` over `displacedHomesCompleted`.
 */
export type MoneyView = NonNullable<TimelineScore['money']> & {
  /** `MoneyRow.displacedHomesCompleted` by month. */
  displacedHomesCompleted: number[];
  /** Public money per added home at `filledThrough`, all money and the City's; null as today's. */
  perAddedHome: { all: number | null; city: number | null };
  /** Displaced homes (of completed funded projects) over funded homes at `filledThrough`. */
  displacedShare: number | null;
};

/** The score numbers for a run of final months, one entry per calendar month from `from`. */
export interface SeriesChunk {
  from: number;
  mean: MonthRow[];
  sd: MonthRow[];
  /** World 1 ("this city"). */
  shown: MonthRow[];
  planEffect: { mean: PlanRow; sd: PlanRow }[];
  money: MoneyRow[] | null;
  tiers: TierUnits[] | null;
}

/**
 * One world's series as plain data that `structuredClone` copies. Per-row columns are indexed by
 * the world's project row and grow as rows start; per-month arrays hold `SERIES_FIELDS` entries
 * per calendar month (pipeline, new, entitledNew, exited, `inProgress` in LIVE order, then the
 * funded homes, the displaced homes by event day and those of completed funded projects, then the
 * homes by income tier in `TIER_FIELDS` order). Every funded world files money and tiers; a chunk
 * carries world 1's.
 */
export interface WorldSeriesData {
  version: 5;
  /** The last model month passed to `stepped`; 0 before any. */
  stepped: number;
  /** `finalThrough()`. */
  final: number;
  /** The last month whose prefix sums are in `sum`, -1 when none. */
  summed: number;
  /** One past the highest row started. */
  rows: number;
  /** Funded rows whose step was stepped with their completion filed and no `'award'` (a feed bug). */
  unawarded: number;
  /** LIVE index of the open span, -1 none, -2 not started. */
  stage: Int8Array;
  /** Start day of the open span. */
  since: Int32Array;
  /** Current units (0 for a master). */
  units: Int32Array;
  /** A simulated row's entitled day after the dataset date, else `NO_DAY`. */
  entitled: Int32Array;
  /** A master's units of phases not yet filed. */
  pending: Int32Array;
  /** A master's filed phases, bit `phase - 1` of each (a phase files once). */
  filed: Int32Array;
  /**
   * A funded row's award day (its `'award'` event), else `NO_DAY`; `NO_DAY + 1` while a row that
   * completed first awaits it, `NO_DAY + 2` once its step was stepped without it.
   */
  award: Int32Array;
  /** A funded row's displaced homes before its completion (rule 12). */
  disp: Int32Array;
  /** A funded row's completion day, else `NO_DAY`. */
  done: Int32Array;
  /** Per-month deltas. */
  delta: Int32Array;
  /** Per-month prefix sums through `summed`. */
  sum: Int32Array;
}

/** One world's series by calendar month, fed by the runner. */
export interface WorldSeries {
  add(e: WorldEvent, world: World, statics: Statics): void;
  /** Called after each step with the model month just stepped. */
  stepped(month: number): void;
  finalThrough(): number;
  rows(from: number, through: number): MonthRow[];
  data(): WorldSeriesData;
}

/** World 1's money inputs. */
export interface MoneyFeed {
  ledger: LedgerEvent[];
  finance: FinanceFrame;
  world: World;
  statics: Statics;
}

/** What the page needs once. */
export interface ScoreStatics {
  asOf: Day;
  /** `months[i]` is the first day of calendar month i, from the dataset date's month. */
  months: Day[];
  /** The last calendar month whose last day is at or before the last day of model month `windowMonths`. */
  lastIndex: number;
  baseline: ProjectsFile['rhnaCompletedNet'];
  tierBaseline: TierUnits | null;
  phasing: TimelineScore['phasing'];
  references: TimelineScore['references'];
  compare: 'plan' | 'preFzp';
  limits: ReturnType<typeof limitStatements> | null;
  /** Each debt pool's terms as plain data (rule 12's `owed`); null without finance. */
  debts: { pool: string; debt: { rate: number; termYears: number } }[] | null;
}

/** What the page reads; every series has `filledThrough + 1` entries. */
export interface TimelineView {
  months: Day[];
  lastIndex: number;
  /** -1 before the first chunk. */
  filledThrough: number;
  mean: MonthRow[];
  band: { lo: number; hi: number }[];
  shown: MonthRow[];
  planEffect: PlanRow[];
  planEffectBand: { lo: PlanRow; hi: PlanRow }[];
  targets: TargetProgressAt[];
  tierTargets: TargetProgressAt[] | null;
  money: MoneyView | null;
  tiers: TierUnits[] | null;
  baseline: TimelineScore['baseline'];
  phasing: TimelineScore['phasing'];
  references: TimelineScore['references'];
  compare: 'plan' | 'preFzp';
}

/** What `cardAt` needs beyond the world. */
export interface CardDeps {
  qualityRules: Map<string, QualityRuleRef>;
  building(s: Schedule, k: number): Massing;
  logOnce(key: string, msg: string): void;
  record(parcelId: ParcelId): {
    neighborhood: string;
    landUse: string;
    eligible: boolean;
    underwater?: true;
    existingUnits: number;
  } | null;
  /**
   * The stories the lot can build under `allowed`, for the lot-limits line of an eligible,
   * unprotected lot: the host's generate call (`simKey` memo) on the lot's record, else
   * `lotBuildableStories(polygon, allowed, existingUnits)`. The card has no polygon or generator.
   */
  buildable(parcelId: ParcelId, allowed: number, existingUnits: number): number;
}
