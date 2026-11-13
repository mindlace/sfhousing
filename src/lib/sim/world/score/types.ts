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
  displacedHomes: number;
  publicSpent: number;
}

/** Today's `TimelineScore['money']`, its series cut at `filledThrough`. */
export type MoneyView = NonNullable<TimelineScore['money']>;

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

/** Plain data that `structuredClone` copies; the series task fills it in. */
export interface WorldSeriesData {
  version: 1;
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
}
