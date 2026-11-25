// Parking into start odds, piece by piece on the mini city: the prototype's parking type, a lot's
// shift and its sign, the derived timeline (changes, touched, frames and their ids), the off path,
// and one spaces table per refresh month.
import { describe, expect, it } from 'vitest';
import { PROTOTYPES, costPerHome, signedOddsShift } from '$lib/sim/finance';
import { benchMarket } from '$lib/sim/scenario/fixtures/bench-finance';
import type { CarModel } from '$lib/sim/cars';
import { addProject, pushRev } from '../columns';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { startRates } from '../rates';
import { staticsOf } from '../statics';
import { miniInput } from '../test/mini';
import { frameOf, oneFrame } from '../test/timeline';
import { ORIGIN_SIM, type StepSink, type World } from '../types';
import { withFunding } from '../world';
import { carColumnsOf, type CarColumns } from './columns';
import {
  SPACES_STEP,
  lotShift,
  parkingTimeline,
  parkingTypeOf,
  slopeOf,
  topPrototype,
  type ParkingCosts
} from './parking';
import { createCarSystem } from './system';
import { carCity } from './test/city';

// The mini city with a market model, so frames without money have a slope.
const input = {
  ...miniInput(),
  calibration: { ...miniInput().calibration, market: benchMarket() }
};
const statics = staticsOf(input);
const N = statics.parcelId.length;
const COSTS: ParkingCosts = { surface: 20_000, podium: 50_000, belowGrade: 120_000 };
const f1 = frameOf(input, { id: frameIdOf('parking.spec|f1') });
const f2 = frameOf(input, { id: frameIdOf('parking.spec|f2'), market: f1.market + 0.2 });
const nowhere: StepSink = { event() {} };

function cityWith(costPerSpace: ParkingCosts | null) {
  const city = carCity(input, { zones: 3, noZoneEvery: 9 });
  const model: CarModel = {
    ...city.model,
    parking: { ...city.model.parking, costPerSpace }
  };
  return { data: city.data, model };
}

/** Columns with the entries `(zone, month, steps)` (steps of `SPACES_STEP`). */
function colsWith(entries: [number, number, number][]): CarColumns {
  const { data, model } = cityWith(COSTS);
  const c = carColumnsOf(data, model);
  c.shiftN = entries.length;
  c.shiftZone = Int32Array.from(entries.map((e) => e[0]));
  c.shiftMonth = Int32Array.from(entries.map((e) => e[1]));
  c.shiftSpaces = Float64Array.from(entries.map((e) => e[2] * SPACES_STEP));
  return c;
}

/** `before` through month `m - 1`, `after` from `m`, with the given `touched`. */
function baseChanging(m: number, touched: Int32Array | null): PolicyTimeline {
  return {
    frameAt: (k) => (k >= m ? f2 : f1),
    changes: () => [m],
    touched: () => touched,
    readyThrough: () => Number.MAX_SAFE_INTEGER
  };
}

const { data, model } = cityWith(COSTS);
const zoneLots = (z: number) => {
  const out: number[] = [];
  for (let lot = 0; lot < N; lot++) if (data.lotZone[lot] === z) out.push(lot);
  return out;
};

describe('parkingTypeOf', () => {
  it('maps E to surface, A to podium, B to D below grade', () => {
    const got = Object.fromEntries(PROTOTYPES.map((p) => [p.id, parkingTypeOf(p)]));
    expect(got).toEqual({
      A: 'podium',
      B: 'belowGrade',
      C: 'belowGrade',
      D: 'belowGrade',
      E: 'surface'
    });
  });
});

describe('lotShift', () => {
  const view = f1.view;
  const slope = slopeOf(f1);
  const placed = Array.from({ length: N }, (_, i) => i).filter((l) => topPrototype(view, l));

  it('has a slope and lots with a qualifying level', () => {
    expect(slope).toBeGreaterThan(0);
    expect(placed.length).toBeGreaterThan(0);
  });

  it('is signedOddsShift of minus delta times the cost of the top prototype’s parking', () => {
    for (const lot of placed) {
      const p = topPrototype(view, lot)!;
      const want = signedOddsShift(-0.25 * COSTS[parkingTypeOf(p)]!, 'market', p, slope);
      expect(lotShift(view, lot, 0.25, COSTS, slope)).toBe(want);
    }
  });

  it('is positive when fewer spaces are needed, negative when more', () => {
    const lot = placed[0];
    expect(lotShift(view, lot, -0.1, COSTS, slope)).toBeGreaterThan(0);
    expect(lotShift(view, lot, 0.1, COSTS, slope)).toBeLessThan(0);
    const p = topPrototype(view, lot)!;
    expect(lotShift(view, lot, -0.1, COSTS, slope)).toBeCloseTo(
      (slope * 0.1 * COSTS[parkingTypeOf(p)]!) / costPerHome('market', p),
      12
    );
  });

  it('is 0 where no level qualifies and for a type with no cost', () => {
    const none = Array.from({ length: N }, (_, i) => i).find((l) => !topPrototype(view, l));
    if (none !== undefined) expect(lotShift(view, none, -1, COSTS, slope)).toBe(0);
    const noCost: ParkingCosts = { surface: null, podium: null, belowGrade: null };
    for (const lot of placed) expect(lotShift(view, lot, -1, noCost, slope)).toBe(0);
  });
});

describe('parkingTimeline', () => {
  it('returns the base when the model has no costs', () => {
    const base = oneFrame(f1);
    const off = cityWith(null);
    expect(parkingTimeline(base, colsWith([[0, 14, -3]]), off.data, off.model, statics)).toBe(base);
  });

  it('adds each entry’s month to the base’s changes', () => {
    const cols = colsWith([
      [0, 14, -3],
      [2, 14, 4],
      [1, 26, -1]
    ]);
    const t = parkingTimeline(baseChanging(20, new Int32Array(0)), cols, data, model, statics);
    expect(t.changes()).toEqual([14, 20, 26]);
  });

  it('touched for a parking-only change is exactly the changed zones’ lots, ascending', () => {
    const cols = colsWith([
      [0, 14, -3],
      [2, 14, 4],
      [1, 26, -1]
    ]);
    const t = parkingTimeline(oneFrame(f1), cols, data, model, statics);
    expect([...t.touched(14)!]).toEqual([...zoneLots(0), ...zoneLots(2)]);
    expect([...t.touched(26)!]).toEqual(zoneLots(1));
    expect([...t.touched(15)!]).toEqual([]);
  });

  it('a base change with touched null stays null, with or without a parking change', () => {
    const cols = colsWith([
      [0, 14, -3],
      [1, 20, 2]
    ]);
    expect(parkingTimeline(baseChanging(20, null), cols, data, model, statics).touched(20)).toBe(
      null
    );
    expect(parkingTimeline(baseChanging(30, null), cols, data, model, statics).touched(30)).toBe(
      null
    );
  });

  it('a base change and a parking change in one month touch the union (P8)', () => {
    // Zone 2's lots from the base (a zoning change), zone 1's from parking; the base frame only
    // moves the market, so no lot's shift differs through it.
    const baseLots = Int32Array.from(zoneLots(2).slice(0, 3));
    const cols = colsWith([
      [0, 14, -3],
      [1, 20, 2]
    ]);
    const t = parkingTimeline(baseChanging(20, baseLots), cols, data, model, statics);
    const want = [...new Set([...baseLots, ...zoneLots(1)])].sort((a, b) => a - b);
    expect([...t.touched(20)!]).toEqual(want);
  });

  it('a base change that moves the slope touches the lots whose shift moved', () => {
    const steeper: PolicyFrame = {
      ...f1,
      id: frameIdOf('parking.spec|steeper'),
      calibration: {
        ...f1.calibration,
        market: {
          ...f1.calibration.market!,
          slope: { ...f1.calibration.market!.slope, perCostShare: slopeOf(f1) * 2 }
        }
      }
    };
    const base: PolicyTimeline = {
      frameAt: (k) => (k >= 30 ? steeper : f1),
      changes: () => [30],
      touched: () => new Int32Array(0),
      readyThrough: () => Number.MAX_SAFE_INTEGER
    };
    const t = parkingTimeline(base, colsWith([[0, 14, -3]]), data, model, statics);
    const moved = zoneLots(0).filter((l) => t.frameAt(30).parking![l] !== 0);
    expect(moved.length).toBeGreaterThan(0);
    expect([...t.touched(30)!]).toEqual(moved);
  });

  it('gives the base frame before any entry, and one object per month and state after', () => {
    const cols = colsWith([
      [0, 14, -3],
      [1, 26, 2]
    ]);
    const base = baseChanging(20, new Int32Array(0));
    const t = parkingTimeline(base, cols, data, model, statics);
    expect(t.frameAt(13)).toBe(f1);
    expect(t.frameAt(14)).toBe(t.frameAt(14));
    expect(t.frameAt(14)).toBe(t.frameAt(19));
    expect(t.frameAt(14).parking).toBeInstanceOf(Float64Array);
    expect(t.frameAt(14).id).not.toBe(f1.id);
    expect(t.frameAt(20).id).not.toBe(f2.id);
    expect(t.frameAt(20).id).not.toBe(t.frameAt(14).id);
    expect(t.frameAt(26).id).not.toBe(t.frameAt(25).id);
    // The same base, the same entries: the same view, frames and ids.
    expect(parkingTimeline(base, cols, data, model, statics)).toBe(t);
    const again = parkingTimeline(
      base,
      colsWith([
        [0, 14, -3],
        [1, 26, 2]
      ]),
      data,
      model,
      statics
    );
    expect(again.frameAt(26).id).toBe(t.frameAt(26).id);
  });

  it('each lot’s parking is lotShift of its zone’s delta on the frame’s view and slope', () => {
    const cols = colsWith([
      [0, 14, -3],
      [1, 14, 5]
    ]);
    const t = parkingTimeline(oneFrame(f1), cols, data, model, statics);
    const pk = t.frameAt(14).parking!;
    const delta = [-3 * SPACES_STEP, 5 * SPACES_STEP, 0];
    let pos = 0;
    let neg = 0;
    for (let lot = 0; lot < N; lot++) {
      const z = data.lotZone[lot];
      const want = z < 0 ? 0 : lotShift(f1.view, lot, delta[z], COSTS, slopeOf(f1));
      expect(pk[lot]).toBe(want);
      if (z === 0 && pk[lot] > 0) pos++;
      if (z === 1 && pk[lot] < 0) neg++;
    }
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeGreaterThan(0);
    // The shift reaches start rates: a lot with a shift gets a different rate.
    const lot = zoneLots(0).find((l) => pk[l] > 0 && f1.view.pre.logit[l] !== -Infinity)!;
    const plain = startRates(f1.view, f1.market)[lot];
    const parked = startRates(f1.view, f1.market, pk)[lot];
    expect(parked).toBeLessThan(plain);
    expect(startRates(f1.view, f1.market, pk)).toBe(startRates(f1.view, f1.market, pk));
  });
});

describe('the car system’s parking', () => {
  const timeline = oneFrame(f1);

  function steppedTo(months: number, costs: ParkingCosts | null, link?: boolean) {
    const city = cityWith(costs);
    const sys = createCarSystem(city.data, city.model, link === undefined ? {} : { link });
    const api = withFunding(null, sys);
    const w = api.createWorld(statics, timeline, 3, nowhere);
    // Zone 0 needs fewer spaces than at month 0, zone 1 more.
    w.cars!.base[0] += 0.5;
    w.cars!.base[1] -= 0.5;
    const due = api.planDue(w, statics, timeline, 3, months + 12);
    for (let m = 1; m <= months; m++) api.step(w, due, statics, timeline, 3, nowhere);
    return { sys, w, data: city.data };
  }

  it('off path: with costPerSpace null timelineOf is the identity and no entry is made', () => {
    const { sys, w } = steppedTo(40, null);
    expect(sys.timelineOf(w, statics, timeline)).toBe(timeline);
    expect(w.cars!.shiftN).toBe(0);
    expect(w.cars!.tableMonth).toBe(37);
    expect(w.cars!.spaces.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
  });

  it('off path: with link false the same, costs or not', () => {
    const { sys, w } = steppedTo(40, COSTS, false);
    expect(sys.timelineOf(w, statics, timeline)).toBe(timeline);
    expect(w.cars!.shiftN).toBe(0);
    expect(w.cars!.spaces.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
  });

  it('a zone below its base gets a positive shift on its lots, above a negative one', () => {
    const { sys, w, data: d } = steppedTo(13, COSTS);
    const c = w.cars!;
    expect(c.shiftN).toBeGreaterThan(0);
    const entry = (z: number) => {
      for (let i = 0; i < c.shiftN; i++) if (c.shiftZone[i] === z) return i;
      return -1;
    };
    expect(c.shiftMonth[entry(0)]).toBe(14);
    expect(c.shiftSpaces[entry(0)]).toBeLessThan(0);
    expect(c.shiftSpaces[entry(1)]).toBeGreaterThan(0);
    const t = sys.timelineOf(w, statics, timeline);
    expect(t.frameAt(13)).toBe(f1);
    const pk = t.frameAt(14).parking!;
    let pos = 0;
    let neg = 0;
    for (let lot = 0; lot < N; lot++) {
      if (d.lotZone[lot] === 0) expect(pk[lot]).toBeGreaterThanOrEqual(0);
      if (d.lotZone[lot] === 1) expect(pk[lot]).toBeLessThanOrEqual(0);
      if (d.lotZone[lot] === 0 && pk[lot] > 0) pos++;
      if (d.lotZone[lot] === 1 && pk[lot] < 0) neg++;
    }
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeGreaterThan(0);
  });

  it('entries are made only when a zone’s quantised delta moves', () => {
    const { w } = steppedTo(40, COSTS);
    const c = w.cars!;
    const last = new Map<number, number>();
    for (let i = 0; i < c.shiftN; i++) {
      const z = c.shiftZone[i];
      const steps = c.shiftSpaces[i] / SPACES_STEP;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
      expect(Math.round(steps)).not.toBe(last.get(z) ?? 0);
      expect([14, 26, 38]).toContain(c.shiftMonth[i]);
      last.set(z, Math.round(steps));
    }
  });

  it('in a refresh month a start before the car step reads the month’s new table', () => {
    const city = cityWith(COSTS);
    const sys = createCarSystem(city.data, city.model);
    const api = withFunding(null, sys);
    const w: World = api.createWorld(statics, timeline, 5, nowhere);
    const due = api.planDue(w, statics, timeline, 5, 40);
    for (let m = 1; m <= 12; m++) api.step(w, due, statics, timeline, 5, nowhere);
    expect(w.cars!.tableMonth).toBe(0);
    // A copy that sees a start first, as system 3 would send it.
    const early: World = structuredClone(w);
    const lot = city.data.lotZone.findIndex((z) => z === 2);
    const row = addProject(early.projects);
    early.projects.origin[row] = ORIGIN_SIM;
    early.projects.src[row] = lot;
    early.projects.units[row] = 30;
    pushRev(early.projects, row, statics.asOf + 400, 30, null);
    sys.onEvent(early, statics, { kind: 'start', row, day: statics.asOf + 400 });
    const e = early.cars!;
    expect(e.tableMonth).toBe(13);
    expect(e.startSpaces).toBe(30 * e.spaces[2]);
    // The world without that start refreshes in its car step: the same table, the same entries.
    api.step(w, due, statics, timeline, 5, nowhere);
    const c = w.cars!;
    expect(c.tableMonth).toBe(13);
    expect([...c.table]).toEqual([...e.table]);
    expect([...c.spaces]).toEqual([...e.spaces]);
    expect(c.shiftN).toBe(e.shiftN);
  });
});
