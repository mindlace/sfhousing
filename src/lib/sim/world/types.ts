import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { Pathway, ProjectKind, Stage } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import type { PolicyFrame, PolicyTimeline, ZoningView } from './policy/frame';
import type { Statics } from './statics';

/** The code constants of the columns (spec S1). */
export const NO_DAY = -0x80000000;
export const ORIGIN_PIPELINE = 0;
export const ORIGIN_PHASE = 1;
export const ORIGIN_MASTER = 2;
export const ORIGIN_SIM = 3;
export const LOT_HELD = 0;
export const LOT_FREE = 1;
export const LOT_LIVE = 2;
export const LOT_DONE = 3;
export const END_ALIVE = 0;
export const END_COMPLETE = 1;
export const END_EXIT = 2;
export const END_ENTITLED = 3;
export const RULE_NONE = 0;
export const RULE_PIPELINE = 1;
export const RULE_SIM = 2;
export const NO_STOP = 255;

export type Column = Int32Array | Uint32Array | Uint8Array | Float64Array | number[] | string[];

/** Columns the funding side fills (`world-funding` narrows these); empty until then. */
export interface LineColumns {
  n: number;
  [column: string]: Column | number;
}

export interface PoolColumns {
  n: number;
  [column: string]: Column | number;
}

/** One row per lot that has left its starting state (S1, rule 4). */
export interface LotColumns {
  n: number;
  /** Statics row, ascending. */
  lot: Int32Array;
  /** `LOT_*`. */
  state: Uint8Array;
  /** Attempt. */
  k: Int32Array;
  /** Day it became free. */
  r: Int32Array;
  holders: Int32Array;
  /** Latest holder exit; the dataset date when none. */
  lastExit: Int32Array;
  blocked: Uint8Array;
  demolished: Uint8Array;
  /** Live simulated row, -1 when none. */
  project: Int32Array;
}

/** One row per project, master and phase; a row never moves (S7). */
export interface ProjectColumns {
  n: number;
  origin: Uint8Array;
  /** `statics.projects` index, or the lot for a simulated row. */
  src: Int32Array;
  /** Phase index (1-based), or attempt k. */
  sub: Int32Array;
  stream: Uint32Array;
  /** `PATHWAYS` index. */
  pathway: Uint8Array;
  isNew: Uint8Array;
  /** Filing day; `NO_DAY` = not yet. */
  filed: Int32Array;
  certain: Uint8Array;
  rule: Uint8Array;
  /** `STAGE_ORDER` index. */
  stage: Uint8Array;
  stopAt: Uint8Array;
  /** 0 advance, 1 + `EXIT_ORDER` index. */
  outcome: Uint8Array;
  length: Float64Array;
  used: Float64Array;
  anchor: Int32Array;
  speed: Float64Array;
  leave: Int32Array;
  endKind: Uint8Array;
  endDay: Int32Array;
  endStage: Uint8Array;
  /** 7 per row, `NO_DAY` when not entered. */
  entered: Int32Array;
  units: Int32Array;
  /** NaN = null. */
  stories: Float64Array;
  existing: Int32Array;
  yieldCap: Int32Array;
  envelope: Int32Array;
  level: Uint8Array;
  env: Int32Array;
  top: Int32Array;
  /** `FILL_LEVELS.length` per row. */
  yields: Int32Array;
  /** 0 = none. */
  phaseNext: Int32Array;
  phaseDay: Int32Array;
  /** 0 market, 1 affordable. */
  kind: Uint8Array;
  funded: Uint8Array;
  applied: Int32Array;
  granted: Float64Array;
  lent: Float64Array;
  guaranteed: Float64Array;
  /** Ids joined with ','. */
  programmes: string[];
  revLast: Int32Array;
  /** Rows used in the revision side table (like `n`). */
  revN: number;
  revDay: Int32Array;
  revUnits: Int32Array;
  revStories: Float64Array;
  revPrev: Int32Array;
  /** Rows used in the displacement side table (like `n`). */
  dispN: number;
  dispRow: Int32Array;
  dispDay: Int32Array;
  dispUnits: Int32Array;
}

/** The whole state of one run between steps; `structuredClone(world)` is a full copy (S1). */
export interface World {
  month: number;
  frame: number;
  lots: LotColumns;
  projects: ProjectColumns;
  line: LineColumns;
  pools: PoolColumns;
}

/** What a step reports (S7). */
export type WorldEvent =
  | { kind: 'start'; row: number; day: Day }
  | { kind: 'enter'; row: number; day: Day; stage: Stage }
  | { kind: 'revise'; row: number; day: Day; units: number; stories: number | null }
  | { kind: 'end'; row: number; day: Day; how: 'complete' | 'exit' | 'entitled' }
  | { kind: 'phaseFiled'; row: number; day: Day; phase: number }
  | { kind: 'award'; row: number; day: Day }
  | { kind: 'displaced'; row: number; lot: number; day: Day; units: number };

export interface StepSink {
  event(e: WorldEvent): void;
  ledger?(e: LedgerEvent): void;
}

/** What is due in which model month (S11). An entity is a lot (its row) or a project (`-1 - row`). */
export interface Due {
  take(month: number): Int32Array;
  put(entity: number, month: number): void;
  drop(entity: number): void;
}

/** A start the funding side decides (S12); `pathway` null means the route is drawn as usual. */
export interface FundedStart {
  kind: ProjectKind;
  view: ZoningView;
  f: number;
  units: number;
  stories: number;
  applied: Day;
  programmes: string[];
  granted: number;
  lent: number;
  guaranteed: number;
  certain: boolean;
  pathway: Pathway | null;
}

/** What a hook is handed during a step (S12). `frame` is `timeline.frameAt(month)`. */
export interface StepCtx {
  world: World;
  /**
   * The due list. Inside a step only the core takes from it (`take` throws), and once the month
   * has been taken (system 3 on) nothing can be put in it or in an earlier month (`put` throws).
   * Putting a free lot at a month no later than the one it is due in is safe: when that month is
   * taken the core plans the lot again.
   */
  due: Due;
  statics: Statics;
  timeline: PolicyTimeline;
  frame: PolicyFrame;
  month: number;
  seed: number;
  out: StepSink;
  firstDay: Day;
  lastDay: Day;
  /**
   * Begins a project on `lot` (rule 17) and returns its row. Throws unless the lot has no row or
   * is `LOT_FREE`. With `funded` null, `day` must be the lot's ordinary start; returns -1 when no
   * size level gains a home (the lot becomes `LOT_DONE` and no row is made). With `funded`, `day`
   * must fall in this month and no programme id may be empty or hold ',' (ids are stored joined
   * with ','); a funded start always makes a row.
   */
  startProject(lot: number, day: Day, funded: FundedStart | null): number;
  /**
   * Adds `units` displaced homes on `day` to funded row `row`, a start on `lot`, and sends
   * `'displaced'`. Throws unless `row` is a funded start on `lot` and `day` falls in this month.
   */
  displace(row: number, lot: number, day: Day, units: number): void;
}

/**
 * The hook `world-funding` plugs into `world-core` (S12); see `withFunding` in `world.ts` for when
 * each is called. None is called in a month whose frame has `finance` null.
 */
export interface FundingSystem {
  /** At the end of `createWorld`, with `frameAt(1)`. */
  create(world: World, statics: Statics, frame: PolicyFrame): void;
  /** System 1, after the core's own replanning, when the frame id differs from last month's. */
  policyChanged(ctx: StepCtx): void;
  /** System 2. */
  moneyIn(ctx: StepCtx): void;
  /**
   * Just after it is sent: each event of system 3, and each event of systems 5 and 6 (a start and
   * its chain to the month's end), except the `'start'` of a project this funding system started
   * itself through `ctx.startProject`, with a `FundedStart` or with null; a start the core makes
   * in that start's chain (a lot freed and started again) is passed. It must not call
   * `startProject` during system 3 (it throws there).
   */
  onProjectEvent(ctx: StepCtx, e: WorldEvent): void;
  /** System 4, every month, with the due free lots whose `planLot` is this month, in rank order. */
  apply(ctx: StepCtx, lots: Int32Array): void;
  /** System 5. */
  serve(ctx: StepCtx): void;
  /** System 7. */
  shadow(ctx: StepCtx): void;
  /**
   * The first model month in which the lot will apply, or 0. Asked whenever the core plans a free
   * lot in a funded month (and in system 4 for each due lot); the lot is put at the earlier of
   * this and its ordinary start. An answer before the first month in which the lot can still apply
   * (`ctx.month` before system 4 has run, `ctx.month + 1` after) counts as 0.
   */
  planLot(ctx: StepCtx, lot: number): number;
}
