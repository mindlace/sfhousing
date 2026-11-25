// The car population's columns on the world (`world.cars`), and what a step reports of them.
// Typed arrays and numbers only: `structuredClone(world)` copies them.
import type { CarData } from '$lib/data/cars-codec';
import * as carsModule from '$lib/sim/cars';
import type { CarModel, CarState, CarTotals } from '$lib/sim/cars';
import type { World } from '../types';

// Bound once (docs/dev/world-core.md, Cost).
const { CAR_LEVELS, MIXES, totals, typeCount, zoneCarsPerHousehold } = carsModule;

export interface CarColumns extends CarState {
  /** The model's cars per 3+ household, so the columns alone give totals. */
  threePlusMean: number;
  /** The month the table was last computed (0: `create`). */
  tableMonth: number;
  /** zones x `MIXES.length`: homes completed, not yet filled. */
  pendFill: Int32Array;
  /** zones: homes lost at construction starts, not yet emptied. */
  pendLost: Int32Array;
  /** Homes completed or lost with no zone (a lot in no zone, a row with no lots), cumulative. */
  unplaced: number;
  /** Households to remove beyond a zone's households, cumulative. */
  unmatched: number;
  /** zones: `predictedSpaces` at the last refresh. */
  spaces: Float64Array;
  /** zones: `predictedSpaces` at month 0. */
  base: Float64Array;
  /** The model month whose starts `startHomes` and `startSpaces` sum (0: none yet). */
  startMonth: number;
  /** Homes of the placed projects started in `startMonth`. */
  startHomes: number;
  /** Their homes times their predicted spaces per home. */
  startSpaces: number;
  /** Parking shift entries (Task 9): `shiftN` used, by zone, month and spaces per home. */
  shiftN: number;
  shiftZone: Int32Array;
  shiftMonth: Int32Array;
  shiftSpaces: Float64Array;
}

/** The car columns at the dataset date: the start households, nothing pending. */
export function carColumnsOf(data: CarData, model: CarModel): CarColumns {
  const Z = data.zones.length;
  const T = typeCount(model.bands);
  if (data.types !== T) {
    throw new Error(`cars: the data has ${data.types} household types, the model ${T}`);
  }
  return {
    zones: Z,
    types: T,
    threePlusMean: model.threePlusMean,
    hh: Int32Array.from(data.households),
    table: new Float64Array(Z * T * CAR_LEVELS),
    tableMonth: 0,
    pendFill: new Int32Array(Z * MIXES.length),
    pendLost: new Int32Array(Z),
    unplaced: 0,
    unmatched: 0,
    spaces: new Float64Array(Z),
    base: new Float64Array(Z),
    startMonth: 0,
    startHomes: 0,
    startSpaces: 0,
    shiftN: 0,
    shiftZone: new Int32Array(0),
    shiftMonth: new Int32Array(0),
    shiftSpaces: new Float64Array(0)
  };
}

export interface CarSnapshot extends CarTotals {
  /**
   * The homes-weighted mean predicted spaces per home over the projects started in the month last
   * stepped; null when none started.
   */
  spacesPerHome: number | null;
  /** Cars per household by zone; NaN for a zone with no households. */
  zones: Float32Array;
}

/** The car population after the month last stepped; null without a car system. */
export function carSnapshotOf(world: World): CarSnapshot | null {
  const c = world.cars;
  if (!c) return null;
  const zones = new Float32Array(c.zones);
  zoneCarsPerHousehold(c, c, zones);
  return {
    ...totals(c, c),
    spacesPerHome:
      c.startMonth === world.month && c.startMonth > 0 && c.startHomes > 0
        ? c.startSpaces / c.startHomes
        : null,
    zones
  };
}
