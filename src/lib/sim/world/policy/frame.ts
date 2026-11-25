import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { StageScale } from '$lib/sim/levers/timers';
import type { Precompute } from '$lib/sim/scenario/input';
import type { Day } from '$lib/timelapse/time';
import type { Calibration, Pool, Programme, ResolvedTerms } from '$lib/timelapse/types';

/** The lot table and start rates under the zoning in force. */
export interface ZoningView {
  parcels: ScenarioParcels;
  pre: Precompute;
}

/** Everything the step reads for one month. */
export interface PolicyFrame {
  /** Same for two frames, from any compile in one worker, exactly when their content is equal, `finance.arrivals` apart. */
  id: number;
  view: ZoningView;
  /** Serves rows in flight, masters and phases. */
  calibration: Calibration;
  /** Route shares and the Local Program switch; serves a project when its route is drawn. */
  newCalibration: Calibration;
  /** Scales a project's time in a stage, times every `speedNew` scale that applies; clamped to `[MIN_SCALE, MAX_SCALE]`. */
  speed: StageScale;
  /** Applies to a project whose `from` is before the day it filed (or which is not yet filed). */
  speedNew: { from: Day; scale: StageScale }[];
  /** The shift in the log-odds of starting. */
  market: number;
  finance: FinanceFrame | null;
  /**
   * A log-odds shift per lot added to `z + market` for market starts (the parking a start no longer
   * builds, `world/cars/parking.ts`); absent or null for none. Affordable odds ignore it.
   */
  parking?: ParkingShift | null;
}

/**
 * A parking shift on start odds, held per zone (no per-lot array): each lot's shift is its zone's
 * on the lot's prototype. `rates.ts` reads it through `rateOf`.
 */
export interface ParkingShift {
  /** The lot's log-odds shift (0 for a lot in no zone or with no qualifying level). */
  shift(lot: number): number;
  /** The lot's zone; -1 for none. */
  zoneOf(lot: number): number;
  /** The lot's position in `zoneLots(zoneOf(lot))`. */
  indexInZone(lot: number): number;
  /** The zone's lots, ascending. */
  zoneLots(zone: number): Int32Array;
  /**
   * A key of the zone's shifts: in one view, equal keys give equal shifts on every lot of the zone.
   * Null when every lot of the zone has shift 0.
   */
  zoneKey(zone: number): string | null;
}

/** The money side of one month's frame. */
export interface FinanceFrame {
  /** Same ids in the same order in every frame of one timeline; the definition in force that month. */
  pools: Pool[];
  /** Same ids in the same order in every frame of one timeline; the definition in force that month. */
  programmes: Programme[];
  /** 1 when programme g is in force on the first day of this month and its pool is not switched off that day. */
  offered: Uint8Array;
  slope: number;
  terms: ResolvedTerms;
  /** Money reaching each pool on a day of this month (month 1 also holds the dataset date); the step reads inflows only from here. */
  arrivals: { pool: number; day: Day; dollars: number }[];
}

/** The policy frames of one run, month by month. */
export interface PolicyTimeline {
  /** Synchronous for 1 <= month <= `readyThrough()`. */
  frameAt(month: number): PolicyFrame;
  /** Ascending months whose frame id differs from the month before. */
  changes(): number[];
  /** For a month in `changes()`, the lot rows whose zoning view row differs from the month before (empty when zoning did not change; null when every lot may differ). */
  touched(month: number): Int32Array | null;
  readyThrough(): number;
}
