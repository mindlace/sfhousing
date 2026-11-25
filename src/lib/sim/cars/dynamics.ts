// One zone's month of the car population: homes emptied, households moving out, and arrivals (new
// homes' households and the movers' replacements) choosing cars. State is counts per
// (zone x type x cars); every integer flow is a systematic split or rounding on one uniform, so a
// month is a pure function of the state, the flows and the draws. Pure; relative imports only.
import type { CarData } from '../../data/cars-codec';
import * as choiceModule from './choice';
import * as splitModule from './split';
import * as typesModule from './types';
import type { CarModel } from './types';

// Bound once: under Vite's module runner (the tests and the benches) every use of an imported
// name is a getter call (docs/dev/world-core.md, Cost).
const { carShares, densityOf } = choiceModule;
const { roundSystematic, splitSystematic } = splitModule;
const { CAR_LEVELS, CAR_P, IN_MIX_DRAW, MIXES } = typesModule;
const P_OUT = CAR_P.OUT;
const P_OUT_CARS = CAR_P.OUT_CARS;
const P_IN_TYPES = CAR_P.IN_TYPES;
const P_CHOOSE = CAR_P.CHOOSE;
const P_EMPTY = CAR_P.EMPTY;

const L = CAR_LEVELS;

/** A uniform in (0, 1) for `zone`'s month: `purpose` from `CAR_P`, `index` the type or mix. */
export type CarDraw = (zone: number, purpose: number, index: number) => number;

/** Households per (zone x type x cars) and each (zone x type)'s shares over the car levels. */
export interface CarState {
  zones: number;
  types: number;
  /** zones x types x `CAR_LEVELS`. */
  hh: Int32Array;
  /** zones x types x `CAR_LEVELS`: the choice's shares at the last refresh. */
  table: Float64Array;
}

export interface CarTotals {
  households: number;
  /** 3+ households count `threePlusMean` cars. */
  cars: number;
  carless: number;
}

const shares = new Float64Array(L);

/** Recomputes the choice table at every zone's current density (households per hectare). */
export function refreshTable(s: CarState, m: CarModel, d: CarData): void {
  const T = s.types;
  for (let z = 0; z < s.zones; z++) {
    let n = 0;
    for (let i = z * T * L; i < (z + 1) * T * L; i++) n += s.hh[i];
    const density = densityOf(n, d.areaM2[z]);
    for (let t = 0; t < T; t++) {
      carShares(m, d, z, t, density, shares);
      const at = (z * T + t) * L;
      for (let k = 0; k < L; k++) s.table[at + k] = shares[k];
    }
  }
}

// Scratch, grown to the largest type count seen; nothing here outlives a call.
let cells = new Int32Array(0);
let arrivals = new Int32Array(0);
let byType = new Int32Array(0);
let refill = new Float64Array(0);
const levels = new Int32Array(L);

/**
 * `splitSystematic(n, w.subarray(at, at + 4), u, levels)` without the view: the same arithmetic
 * on the four car levels at `at`.
 */
function splitLevels(n: number, w: Int32Array | Float64Array, at: number, u: number): void {
  const w0 = w[at];
  const w1 = w[at + 1];
  const w2 = w[at + 2];
  const total = w0 + w1 + w2 + w[at + 3];
  if (n > 0 && !(total > 0)) throw new RangeError('splitSystematic: zero total weight');
  const c0 = roundSystematic(n * (w0 / total), u);
  const c1 = roundSystematic(n * ((w0 + w1) / total), u);
  const c2 = roundSystematic(n * ((w0 + w1 + w2) / total), u);
  levels[0] = c0;
  levels[1] = c1 - c0;
  levels[2] = c2 - c1;
  levels[3] = n - c2;
}

function scratch(T: number): void {
  if (arrivals.length >= T) return;
  cells = new Int32Array(T * L);
  arrivals = new Int32Array(T);
  byType = new Int32Array(T);
  refill = new Float64Array(T);
}

/**
 * One zone's month, in order: `lost` households leave in proportion across every type and car
 * level (`EMPTY`, index 0); each type's out-movers, `roundSystematic(households x perMonth)`
 * (`OUT`, index the type), leave in proportion across its car levels (`OUT_CARS`); then arrivals
 * choose cars: `fills[k]` households of mix `MIXES[k]` and as many households as moved out, from
 * the zone's departures by type (each type's households before the moves times its rate), are
 * split into types (`IN_TYPES`, index the mix, `IN_MIX_DRAW` for the movers) and each type's arrivals over the car levels by the table (`CHOOSE`, index the type).
 * Returns the households of `lost` the zone did not have.
 */
export function stepZone(
  s: CarState,
  m: CarModel,
  d: CarData,
  zone: number,
  fills: Int32Array,
  lost: number,
  draw: CarDraw
): number {
  const T = s.types;
  scratch(T);
  const hh = s.hh;
  const base = zone * T * L;
  const end = base + T * L;
  let short = 0;
  if (lost > 0) {
    let total = 0;
    for (let i = base; i < end; i++) total += hh[i];
    if (lost >= total) {
      short = lost - total;
      hh.fill(0, base, end);
    } else {
      const out = cells.subarray(0, T * L);
      splitSystematic(lost, hh.subarray(base, end), draw(zone, P_EMPTY, 0), out);
      for (let i = 0; i < T * L; i++) hh[base + i] -= out[i];
    }
  }
  const perMonth = m.moves.perMonth;
  let moved = 0;
  for (let t = 0; t < T; t++) {
    const at = base + t * L;
    const n0 = hh[at] + hh[at + 1] + hh[at + 2] + hh[at + 3];
    // The refill's weights: the zone's expected departures by type (rate times households), so
    // arrivals replace departures type for type and the zone keeps its composition.
    const r = perMonth[t];
    refill[t] = n0 * (r > 0 ? r : 0);
    if (n0 === 0) continue;
    if (!(r > 0)) continue;
    const n = Math.min(n0, roundSystematic(n0 * r, draw(zone, P_OUT, t)));
    if (n <= 0) continue;
    moved += n;
    if (n === n0) {
      hh.fill(0, at, at + L);
      continue;
    }
    splitLevels(n, hh, at, draw(zone, P_OUT_CARS, t));
    for (let k = 0; k < L; k++) hh[at + k] -= levels[k];
  }
  arrivals.fill(0, 0, T);
  const out = byType.subarray(0, T);
  for (let k = 0; k < MIXES.length; k++) {
    const n = fills[k];
    if (n <= 0) continue;
    splitSystematic(n, m.newHomes.mix[MIXES[k]], draw(zone, P_IN_TYPES, k), out);
    for (let t = 0; t < T; t++) arrivals[t] += out[t];
  }
  if (moved > 0) {
    // moved > 0 means some type with households has a positive rate: the weights sum above 0.
    splitSystematic(moved, refill.subarray(0, T), draw(zone, P_IN_TYPES, IN_MIX_DRAW), out);
    for (let t = 0; t < T; t++) arrivals[t] += out[t];
  }
  const table = s.table;
  for (let t = 0; t < T; t++) {
    const n = arrivals[t];
    if (n === 0) continue;
    const at = base + t * L;
    splitLevels(n, table, at, draw(zone, P_CHOOSE, t));
    for (let k = 0; k < L; k++) hh[at + k] += levels[k];
  }
  return short;
}

/** Citywide totals; `m` may be the model or anything carrying its `threePlusMean`. */
export function totals(s: CarState, m: Pick<CarModel, 'threePlusMean'>): CarTotals {
  const hh = s.hh;
  let one = 0;
  let two = 0;
  let three = 0;
  let carless = 0;
  for (let i = 0; i < hh.length; i += L) {
    carless += hh[i];
    one += hh[i + 1];
    two += hh[i + 2];
    three += hh[i + 3];
  }
  const households = carless + one + two + three;
  return { households, cars: one + 2 * two + m.threePlusMean * three, carless };
}

/** Cars per household by zone; NaN for a zone with no households. */
export function zoneCarsPerHousehold(
  s: CarState,
  m: Pick<CarModel, 'threePlusMean'>,
  out: Float32Array
): void {
  const T = s.types;
  const hh = s.hh;
  for (let z = 0; z < s.zones; z++) {
    let n = 0;
    let cars = 0;
    for (let i = z * T * L; i < (z + 1) * T * L; i += L) {
      n += hh[i] + hh[i + 1] + hh[i + 2] + hh[i + 3];
      cars += hh[i + 1] + 2 * hh[i + 2] + m.threePlusMean * hh[i + 3];
    }
    out[z] = n > 0 ? cars / n : NaN;
  }
}

/** Supply over use times the mean cars per household of a type `mix` (T weights) in `zone`. */
export function spacesOfMix(
  s: CarState,
  m: CarModel,
  zone: number,
  mix: ArrayLike<number>
): number {
  const T = s.types;
  const table = s.table;
  const three = m.threePlusMean;
  let cars = 0;
  for (let t = 0; t < T; t++) {
    const w = mix[t];
    if (w === 0) continue;
    const at = (zone * T + t) * L;
    cars += w * (table[at + 1] + 2 * table[at + 2] + three * table[at + 3]);
  }
  return m.parking.supplyOverUse * cars;
}

/** Parking spaces per new market home in `zone`, by the table: the market new-home mix. */
export function predictedSpaces(s: CarState, m: CarModel, d: CarData, zone: number): number {
  void d;
  return spacesOfMix(s, m, zone, m.newHomes.mix.market);
}

/** Parking spaces per new affordable home in `zone`: the tier mixes by `affordableTiers`. */
export function affordableSpaces(s: CarState, m: CarModel, zone: number): number {
  const a = m.newHomes.affordableTiers;
  const mix = m.newHomes.mix;
  return (
    a.veryLow * spacesOfMix(s, m, zone, mix.veryLow) +
    a.low * spacesOfMix(s, m, zone, mix.low) +
    a.moderate * spacesOfMix(s, m, zone, mix.moderate)
  );
}
