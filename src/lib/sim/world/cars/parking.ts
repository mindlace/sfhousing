// Parking demand into start odds (owner rulings R1, R2). At each refresh the car system compares
// each zone's predicted spaces per new market home with month 0's, in whole steps of
// `SPACES_STEP`, and records a shift entry `(zone, month + 1, delta)` when the zone's delta moved.
// `parkingTimeline` lays those entries over a policy timeline as derived frames (the pool-closing
// precedent, `funding/closing.ts`): from an entry's month on, each lot of the zone carries the
// log-odds shift of the parking it no longer has to build (`frame.parking`), which `startRates`
// and the funded market clock add to the market odds. Affordable odds are left alone.
import type { CarData } from '$lib/data/cars-codec';
import * as scenarioCodecModule from '$lib/data/scenario-codec';
import type { CarModel } from '$lib/sim/cars';
import * as financeModule from '$lib/sim/finance';
import type { Prototype } from '$lib/sim/finance';
import type { ParkingShift, PolicyFrame, PolicyTimeline, ZoningView } from '../policy/frame';
import * as internModule from '../policy/intern';
import type { Statics } from '../statics';
import type { CarColumns } from './columns';

// Bound once (docs/dev/world-core.md, Cost).
const { FILL_LEVELS, fillStories } = scenarioCodecModule;
const { PROTOTYPES, prototypeFor, signedOddsShift } = financeModule;
const { frameIdOf, serialOf } = internModule;

const F = FILL_LEVELS.length;
const NP = PROTOTYPES.length;

/** Spaces per home: a zone's shift changes only by whole steps. */
export const SPACES_STEP = 0.01;

export type ParkingType = 'surface' | 'podium' | 'belowGrade';
export type ParkingCosts = NonNullable<CarModel['parking']['costPerSpace']>;

/**
 * The parking a prototype builds: E (under 25 homes) surface, A (up to 6 stories) podium, B to D
 * below grade. The Task 1 source prices types, not prototypes, so the map is this one.
 */
export function parkingTypeOf(p: Prototype): ParkingType {
  if (p.id === 'E') return 'surface';
  if (p.id === 'A') return 'podium';
  return 'belowGrade';
}

/** Per view, each lot's prototype index at its top qualifying fill level; -1 where none. */
const protoMemo = new WeakMap<ZoningView, Int8Array>();

function protoIndexOf(view: ZoningView): Int8Array {
  let out = protoMemo.get(view);
  if (out) return out;
  const parcels = view.parcels;
  const cum = view.pre.sizeCum;
  const n = parcels.count;
  out = new Int8Array(n).fill(-1);
  for (let lot = 0; lot < n; lot++) {
    // The last qualifying level and every level after it are exactly 1; a row with none is all 0.
    let f = 0;
    while (f < F && cum[lot * F + f] !== 1) f++;
    if (f === F) continue;
    const stories = fillStories(FILL_LEVELS[f], parcels.envelopeStories[lot]);
    const id = prototypeFor(stories, parcels.yield[lot * F + f]).id;
    out[lot] = PROTOTYPES.findIndex((p) => p.id === id);
  }
  protoMemo.set(view, out);
  return out;
}

/** The prototype of `lot`'s top qualifying fill level in `view`; null when no level qualifies. */
export function topPrototype(view: ZoningView, lot: number): Prototype | null {
  const i = protoIndexOf(view)[lot];
  return i < 0 ? null : PROTOTYPES[i];
}

/** The shift of `deltaSpaces` more spaces per home on prototype `p`; 0 when its type has no cost. */
function shiftOf(p: Prototype, deltaSpaces: number, cost: ParkingCosts, slope: number): number {
  const c = cost[parkingTypeOf(p)];
  if (c === null) return 0;
  return signedOddsShift(-deltaSpaces * c, 'market', p, slope);
}

/**
 * The log-odds shift of a start on `lot` in `view` when new homes in its zone need `deltaSpaces`
 * more parking spaces each than at month 0: `signedOddsShift(-delta × cost of the prototype's
 * parking type)`, the prototype being that of the lot's top qualifying fill level (start odds are
 * drawn before size, and the top level sets the building type). 0 where no level qualifies or the
 * type has no cost.
 */
export function lotShift(
  view: ZoningView,
  lot: number,
  deltaSpaces: number,
  cost: ParkingCosts,
  slope: number
): number {
  const p = topPrototype(view, lot);
  return p === null ? 0 : shiftOf(p, deltaSpaces, cost, slope);
}

/** The frame's slope: its money's when it has money, else the calibration's; 0 with neither. */
export function slopeOf(frame: PolicyFrame): number {
  return frame.finance?.slope ?? frame.calibration.market?.slope.perCostShare ?? 0;
}

/** `delta` in whole steps: `round((spaces - base) / SPACES_STEP)`. */
export function stepsOf(spaces: number, base: number): number {
  return Math.round((spaces - base) / SPACES_STEP);
}

/** Grows the shift columns to hold `n` entries (doubling). */
function room(c: CarColumns, n: number): void {
  if (c.shiftZone.length >= n) return;
  let cap = Math.max(64, c.shiftZone.length * 2);
  while (cap < n) cap *= 2;
  const zone = new Int32Array(cap);
  const month = new Int32Array(cap);
  const spaces = new Float64Array(cap);
  zone.set(c.shiftZone);
  month.set(c.shiftMonth);
  spaces.set(c.shiftSpaces);
  c.shiftZone = zone;
  c.shiftMonth = month;
  c.shiftSpaces = spaces;
}

/**
 * The refresh of model month `month` (after month 0): for each zone whose quantised delta
 * `round((spaces - base) / SPACES_STEP) × SPACES_STEP` differs from its last entry's (0 before
 * any), an entry `(zone, month + 1, delta)`.
 */
export function pushShifts(c: CarColumns, month: number): void {
  const Z = c.zones;
  const last = new Int32Array(Z);
  for (let i = 0; i < c.shiftN; i++)
    last[c.shiftZone[i]] = Math.round(c.shiftSpaces[i] / SPACES_STEP);
  for (let z = 0; z < Z; z++) {
    const steps = stepsOf(c.spaces[z], c.base[z]);
    if (steps === last[z]) continue;
    room(c, c.shiftN + 1);
    c.shiftZone[c.shiftN] = z;
    c.shiftMonth[c.shiftN] = month + 1;
    c.shiftSpaces[c.shiftN] = steps * SPACES_STEP;
    c.shiftN++;
  }
}

/** A zone's lots, ascending: `lots[start[z] .. start[z + 1])`; `index[lot]`: its position there. */
interface ZoneLots {
  start: Int32Array;
  lots: Int32Array;
  index: Int32Array;
}

const zoneLotsMemo = new WeakMap<CarData, ZoneLots>();

function zoneLotsOf(data: CarData): ZoneLots {
  let hit = zoneLotsMemo.get(data);
  if (hit) return hit;
  const Z = data.zones.length;
  const lotZone = data.lotZone;
  const start = new Int32Array(Z + 1);
  for (let lot = 0; lot < lotZone.length; lot++) if (lotZone[lot] >= 0) start[lotZone[lot] + 1]++;
  for (let z = 0; z < Z; z++) start[z + 1] += start[z];
  const at = start.slice(0, Z);
  const lots = new Int32Array(start[Z]);
  const index = new Int32Array(lotZone.length).fill(-1);
  for (let lot = 0; lot < lotZone.length; lot++) {
    const z = lotZone[lot];
    if (z >= 0) {
      index[lot] = at[z] - start[z];
      lots[at[z]++] = lot;
    }
  }
  hit = { start, lots, index };
  zoneLotsMemo.set(data, hit);
  return hit;
}

/**
 * The parking states of one world's entries: one per distinct entry month, ascending. Everything a
 * state holds is per zone (controller's ruling: no per-lot array per refresh).
 */
interface State {
  month: number;
  /** Each zone's delta in whole steps, in force from `month`. */
  steps: Int32Array;
  /** The zones whose delta changed at `month`, ascending. */
  changed: Int32Array;
  /** `steps` joined, made when a frame id first needs it. */
  key: string | null;
  /** Derived frames by base frame. */
  frames: Map<PolicyFrame, PolicyFrame>;
  /** zones x prototypes: the shift of each zone's delta on each prototype, by slope. */
  tables: Map<number, Float64Array>;
}

/** What one view holds, for tests: its states and the numbers their typed arrays hold. */
export interface ParkingRetained {
  states: number;
  numbers: number;
}

const EMPTY = new Int32Array(0);
const views = new WeakMap<PolicyTimeline, WeakMap<CarColumns, PolicyTimeline>>();
const retained = new WeakMap<PolicyTimeline, () => ParkingRetained>();

/** The states a parking view holds and the numbers in their typed arrays; null for another timeline. */
export function parkingRetained(t: PolicyTimeline): ParkingRetained | null {
  return retained.get(t)?.() ?? null;
}

/**
 * `base` with the parking shift entries of `cols` laid over it (rulings R1, R2). A month with no
 * entry in force gives the base frame itself; from an entry's month on, the frame is the base
 * frame with `parking` set (each lot's shift is its zone's delta on the lot's prototype,
 * `lotShift`, on the frame's view and slope; held per zone, never as a per-lot array) and an id of
 * its own (`frameIdOf` of the base id, the car data and costs, and every zone's delta).
 * `changes()` is the base's changes plus each entry's month (up to `readyThrough()`).
 * `touched(c)`: null when the base's is; otherwise, ascending, the base's touched lots, the lots
 * of the zones whose delta changed in `c`, and, at a base change with parking in force, every lot
 * whose shift differs from the month before (a new view or slope). One view per (base, cols),
 * memoised; it reads the entries as they grow (an entry is always for a month after the one the
 * world last stepped, so no frame already read changes).
 */
export function parkingTimeline(
  base: PolicyTimeline,
  cols: CarColumns,
  data: CarData,
  model: CarModel,
  statics: Statics
): PolicyTimeline {
  const cost = model.parking.costPerSpace;
  if (cost === null) return base;
  let byCols = views.get(base);
  if (!byCols) views.set(base, (byCols = new WeakMap()));
  const hit = byCols.get(cols);
  if (hit) return hit;
  const view = buildView(base, cols, data, cost, statics);
  byCols.set(cols, view);
  return view;
}

function buildView(
  base: PolicyTimeline,
  cols: CarColumns,
  data: CarData,
  cost: ParkingCosts,
  statics: Statics
): PolicyTimeline {
  const Z = cols.zones;
  const N = statics.parcelId.length;
  const lotZone = data.lotZone;
  const zl = zoneLotsOf(data);
  const sysKey = `${serialOf(data)}|${cost.surface},${cost.podium},${cost.belowGrade}`;
  const states: State[] = [];
  let read = 0;

  /** Folds entries not yet read into `states` (entries come in month order). */
  const sync = (): void => {
    if (read === cols.shiftN) return;
    while (read < cols.shiftN) {
      const month = cols.shiftMonth[read];
      const prev = states.length > 0 ? states[states.length - 1] : null;
      if (prev !== null && month < prev.month) {
        throw new Error(`parking: entry ${read} for month ${month} after month ${prev.month}`);
      }
      let s = prev;
      const zones: number[] = [];
      if (prev === null || prev.month !== month) {
        s = {
          month,
          steps: prev === null ? new Int32Array(Z) : prev.steps.slice(),
          changed: EMPTY,
          key: null,
          frames: new Map(),
          tables: new Map()
        };
        states.push(s);
      } else for (const z of prev.changed) zones.push(z);
      while (read < cols.shiftN && cols.shiftMonth[read] === month) {
        const z = cols.shiftZone[read];
        s!.steps[z] = Math.round(cols.shiftSpaces[read] / SPACES_STEP);
        zones.push(z);
        read++;
      }
      s!.changed = Int32Array.from(new Set(zones)).sort();
      s!.key = null;
      s!.frames.clear();
      s!.tables.clear();
    }
  };

  /** The state in force in month `k`: the last whose month is `<= k`; -1 for none. */
  const stateAt = (k: number): number => {
    sync();
    let lo = 0;
    let hi = states.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (states[mid].month <= k) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };

  /** One shift per (zone, prototype): `lotShift`'s arithmetic. */
  const tableOf = (s: State, slope: number): Float64Array => {
    let out = s.tables.get(slope);
    if (out) return out;
    out = new Float64Array(Z * NP);
    for (let z = 0; z < Z; z++) {
      const delta = s.steps[z] * SPACES_STEP;
      for (let i = 0; i < NP; i++) out[z * NP + i] = shiftOf(PROTOTYPES[i], delta, cost, slope);
    }
    s.tables.set(slope, out);
    return out;
  };

  const zoneOf = (lot: number): number => (lot < lotZone.length ? lotZone[lot] : -1);
  const zoneLots = (z: number): Int32Array => zl.lots.subarray(zl.start[z], zl.start[z + 1]);
  const indexInZone = (lot: number): number => zl.index[lot];

  const derive = (frame: PolicyFrame, si: number): PolicyFrame => {
    const s = states[si];
    let out = s.frames.get(frame);
    if (out) return out;
    if (s.key === null) s.key = s.steps.join(',');
    const slope = slopeOf(frame);
    const table = tableOf(s, slope);
    const proto = protoIndexOf(frame.view);
    const steps = s.steps;
    const parking: ParkingShift = {
      shift(lot) {
        const z = zoneOf(lot);
        const i = proto[lot];
        return z < 0 || i < 0 ? 0 : table[z * NP + i];
      },
      zoneOf,
      indexInZone,
      zoneLots,
      zoneKey: (z) => (steps[z] === 0 ? null : `${sysKey}|${z}|${steps[z]}|${slope}`)
    };
    out = { ...frame, id: frameIdOf(`parking|${sysKey}|${frame.id}|${s.key}`), parking };
    s.frames.set(frame, out);
    return out;
  };

  const frameAt = (k: number): PolicyFrame => {
    const frame = base.frameAt(k);
    const si = stateAt(k);
    return si < 0 ? frame : derive(frame, si);
  };

  let seenBase: number[] = [];
  let seenReady = -1;
  let seenStates = -1;
  let result: number[] = [];
  let baseSet = new Set<number>();
  const changes = (): number[] => {
    sync();
    const b = base.changes();
    const ready = base.readyThrough();
    let same = b.length === seenBase.length && ready === seenReady && states.length === seenStates;
    for (let i = 0; same && i < b.length; i++) same = b[i] === seenBase[i];
    if (!same) {
      const all = new Set(b);
      for (const s of states) if (s.month <= ready) all.add(s.month);
      result = [...all].sort((x, y) => x - y);
      baseSet = new Set(b);
      seenBase = [...b];
      seenReady = ready;
      seenStates = states.length;
    }
    return result;
  };

  const touched = (k: number): Int32Array | null => {
    changes();
    const inBase = baseSet.has(k);
    const si = stateAt(k);
    const inPark = si >= 0 && states[si].month === k;
    if (!inBase && !inPark) return EMPTY;
    let mark: Uint8Array | null = null;
    const add = (lot: number) => {
      mark ??= new Uint8Array(N);
      mark[lot] = 1;
    };
    if (inBase) {
      const bt = base.touched(k);
      if (bt === null) return null;
      for (const lot of bt) add(lot);
      if (si >= 0 && k > 1) {
        const a = frameAt(k - 1).parking;
        const b = frameAt(k).parking!;
        for (let lot = 0; lot < N; lot++) if ((a ? a.shift(lot) : 0) !== b.shift(lot)) add(lot);
      }
    }
    if (inPark) {
      for (const z of states[si].changed) {
        for (let i = zl.start[z]; i < zl.start[z + 1]; i++) add(zl.lots[i]);
      }
    }
    if (mark === null) return EMPTY;
    const m: Uint8Array = mark;
    let n = 0;
    for (let lot = 0; lot < N; lot++) n += m[lot];
    const out = new Int32Array(n);
    for (let lot = 0, j = 0; lot < N; lot++) if (m[lot] === 1) out[j++] = lot;
    return out;
  };

  const view: PolicyTimeline = {
    frameAt,
    changes,
    touched,
    readyThrough: () => base.readyThrough()
  };
  retained.set(view, () => {
    sync();
    let numbers = 0;
    for (const s of states) {
      numbers += s.steps.length + s.changed.length;
      for (const t of s.tables.values()) numbers += t.length;
    }
    return { states: states.length, numbers };
  });
  return view;
}
