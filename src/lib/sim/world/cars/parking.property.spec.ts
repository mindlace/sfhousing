// Parking into start odds over whole runs (mini and bench cities): month one is today's, the off
// path is the run without cars, a rebuilt plan is the carried one (Review Focus 3, rule 20), the
// skip shortcut holds under large shifts, funding sees a parking change as a policy change and a
// zero shift changes nothing (Review Focus 4), and, on the live city, the shift settles.
import { beforeAll, describe, expect, it } from 'vitest';
import type { CarData } from '$lib/data/cars-codec';
import type { CarModel } from '$lib/sim/cars';
import { benchMarket } from '$lib/sim/scenario/fixtures/bench-finance';
import { seedHash } from '$lib/sim/scenario/rng';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { SimInput } from '$lib/sim/scenario/types';
import { planDueWith } from '../due';
import { createFundingSystem } from '../funding/system';
import { fundedMini, oneMoneyTimeline } from '../funding/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { initDraw, ordinaryStart, skipBound } from '../rates';
import { staticsOf, type Statics } from '../statics';
import { benchInput, liveInput } from '../test/cities.node';
import { miniInput } from '../test/mini';
import { Recorder, runWorld } from '../test/run';
import { expectEqual } from '../test/same.node';
import { changingAt, frameOf, marketAt } from '../test/timeline';
import type { CarSystem, StepSink, World, WorldEvent } from '../types';
import { withFunding } from '../world';
import { carColumnsOf } from './columns';
import { SPACES_STEP, parkingTimeline, type ParkingCosts } from './parking';
import { createCarSystem } from './system';
import { LIVE_BANDS, carCity, type CarCityOpts } from './test/city';

const SEEDS = [1, 2, 3, 4, 5];
const MONTHS = 480;
const COSTS: ParkingCosts = { surface: 20_000, podium: 50_000, belowGrade: 120_000 };

interface City {
  input: SimInput;
  statics: Statics;
  timeline: PolicyTimeline;
  opts: CarCityOpts;
}

/** `plain` with a market model, so frames without money have a slope. */
const sloped = (plain: SimInput): SimInput => ({
  ...plain,
  calibration: { ...plain.calibration, market: benchMarket() }
});

function cityOf(name: string, plain: SimInput, opts: CarCityOpts): City {
  const input = sloped(plain);
  // Interned ids, as compiled frames have: a parking frame's id never meets a hand-made one.
  const f = frameOf(input, { id: frameIdOf(`parking.property|${name}|f`) });
  // A market change at month 121 replans every free lot.
  const g = frameOf(input, {
    id: frameIdOf(`parking.property|${name}|g`),
    market: marketAt(input, input.asOf) + 0.3
  });
  return { input, statics: staticsOf(input), timeline: changingAt(121, f, g, null), opts };
}

function carsOf(
  input: SimInput,
  opts: CarCityOpts,
  costs: ParkingCosts | null
): { data: CarData; model: CarModel } {
  const city = carCity(input, opts);
  return {
    data: city.data,
    model: { ...city.model, parking: { ...city.model.parking, costPerSpace: costs } }
  };
}

function runWith(c: City, seed: number, sys: CarSystem | null, through = MONTHS, every = 0) {
  const api = withFunding(null, sys);
  const rec = new Recorder();
  const w = runWorld(c.statics, c.timeline, seed, through, rec, {
    plan: api.planDue,
    step: api.step,
    create: api.createWorld,
    ...(every > 0 ? { rebuildEvery: every } : {})
  });
  return { w, events: rec.events };
}

/** A car system whose zones start with `offset` more (or fewer) base spaces than they predict. */
function offsetSystem(inner: CarSystem, offset: (z: number) => number): CarSystem {
  return {
    create(w, s) {
      inner.create(w, s);
      const c = w.cars!;
      for (let z = 0; z < c.zones; z++) c.base[z] += offset(z);
    },
    onEvent: (w, s, e) => inner.onEvent(w, s, e),
    step: (ctx) => inner.step(ctx),
    timelineOf: (w, s, t) => inner.timelineOf(w, s, t)
  };
}

describe.each([
  ['mini', () => miniInput(), { zones: 3, noZoneEvery: 11 }],
  ['bench', () => benchInput(), { zones: 60, noZoneEvery: 97, perMonth: 0.008 }]
] as const)('parking on the %s city', (name, inputOf, opts) => {
  let c: City;
  beforeAll(() => {
    c = cityOf(name, inputOf(), opts);
  });
  /** The link on, real costs, zones pushed off their base so entries come at every refresh. */
  const linked = () => {
    const { data, model } = carsOf(c.input, c.opts, COSTS);
    return offsetSystem(createCarSystem(data, model), (z) => (z % 2 === 0 ? 0.4 : -0.3));
  };

  it('month one: with the link on, events through month 13 equal the run without cars', () => {
    for (const seed of SEEDS) {
      const on = runWith(c, seed, linked(), 13);
      expect(on.w.cars!.shiftN).toBeGreaterThan(0);
      expectEqual(on.events, runWith(c, seed, null, 13).events, `seed ${seed}`);
    }
  }, 300_000);

  it('the link reaches the starts: with it on the run differs after month 13', () => {
    const on = runWith(c, 1, linked(), 240);
    const without = runWith(c, 1, null, 240);
    const starts = (e: { kind: string; month: number }[]) =>
      e.filter((x) => x.kind === 'start' && x.month > 13).length;
    expect(starts(on.events)).not.toBe(starts(without.events));
  }, 300_000);

  it('off path: costPerSpace null gives every event of the run without cars, 480 months', () => {
    for (const seed of SEEDS) {
      const { data, model } = carsOf(c.input, c.opts, null);
      const sys = createCarSystem(data, model);
      const off = runWith(
        c,
        seed,
        offsetSystem(sys, () => 0.4)
      );
      expect(off.w.cars!.shiftN).toBe(0);
      expect(off.w.cars!.spaces.some((v) => v > 0)).toBe(true);
      expect(sys.timelineOf(off.w, c.statics, c.timeline)).toBe(c.timeline);
      expectEqual(off.events, runWith(c, seed, null).events, `seed ${seed}`);
    }
  }, 300_000);

  it('Review Focus 3: a clone at month 200 with a rebuilt plan steps as the carried run', () => {
    for (const seed of name === 'mini' ? SEEDS : [1, 2]) {
      const api = withFunding(null, linked());
      const nowhere: StepSink = { event() {} };
      const w = api.createWorld(c.statics, c.timeline, seed, nowhere);
      const due = api.planDue(w, c.statics, c.timeline, seed, MONTHS);
      for (let m = 1; m <= 200; m++) api.step(w, due, c.statics, c.timeline, seed, nowhere);
      const copy: World = structuredClone(w);
      const copyDue = api.planDue(copy, c.statics, c.timeline, seed, MONTHS);
      const a: WorldEvent[] = [];
      const b: WorldEvent[] = [];
      for (let m = 201; m <= MONTHS; m++) {
        api.step(w, due, c.statics, c.timeline, seed, { event: (e) => a.push(e) });
        api.step(copy, copyDue, c.statics, c.timeline, seed, { event: (e) => b.push(e) });
      }
      expect(w.cars!.shiftN).toBeGreaterThan(0);
      expect(a.length).toBeGreaterThan(0);
      expectEqual(b, a, `seed ${seed}`);
      expectEqual(copy, w, `seed ${seed}`);
    }
  }, 300_000);

  it('rule 20: a plan rebuilt every 12 months gives the carried run’s events', () => {
    for (const seed of [1, 4]) {
      const a = runWith(c, seed, linked());
      const b = runWith(c, seed, linked(), MONTHS, 12);
      expect(a.w.cars!.shiftN).toBeGreaterThan(0);
      expectEqual(b.events, a.events, `seed ${seed}`);
      expectEqual(b.w.cars, a.w.cars, `seed ${seed}`);
    }
  }, 300_000);
});

describe('the skip shortcut under large positive shifts (bench city)', () => {
  const input = benchInput();
  const c = cityOf('bench-skip', input, { zones: 60 });
  const big: ParkingCosts = { surface: 200_000, podium: 300_000, belowGrade: 400_000 };
  const { data, model } = carsOf(input, { zones: 60 }, big);
  // Every zone needs a whole space less from month 14, two from month 50: shifts of about +1 to +2.
  const cols = carColumnsOf(data, model);
  const Z = data.zones.length;
  cols.shiftN = 2 * Z;
  cols.shiftZone = Int32Array.from({ length: 2 * Z }, (_, i) => i % Z);
  cols.shiftMonth = Int32Array.from({ length: 2 * Z }, (_, i) => (i < Z ? 14 : 50));
  cols.shiftSpaces = Float64Array.from({ length: 2 * Z }, (_, i) =>
    i < Z ? -100 * SPACES_STEP : -200 * SPACES_STEP
  );
  const t = parkingTimeline(c.timeline, cols, data, model, c.statics);
  const THROUGH = 240;

  it('the shifts are large and positive', () => {
    const pk = t.frameAt(50).parking!;
    let max = 0;
    for (const v of pk) {
      expect(v).toBeGreaterThanOrEqual(0);
      max = Math.max(max, v);
    }
    expect(max).toBeGreaterThan(1);
    expect(t.changes()).toEqual([14, 50, 121]);
  });

  it('no lot above its bound starts by `through`', () => {
    const sh = seedHash(3);
    let wrong = 0;
    let skipped = 0;
    for (const month of [1, 14, 49, 50, 121, 200]) {
      const bound = skipBound(c.statics, t, month, THROUGH);
      for (let lot = 0; lot < c.statics.parcelId.length; lot++) {
        if (!(initDraw(c.statics, sh, lot, 0) > bound[lot])) continue;
        skipped++;
        const s = ordinaryStart(c.statics, t, month, sh, lot, c.statics.asOf, 0);
        if (s !== null && s.month <= THROUGH) wrong++;
      }
    }
    expect(skipped).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  }, 300_000);

  it('the carried run (whole-city replan with the bound) equals plans without the shortcut', () => {
    for (const seed of [1, 3]) {
      const a = new Recorder();
      runWorld(c.statics, t, seed, THROUGH, a);
      const b = new Recorder();
      runWorld(c.statics, t, seed, THROUGH, b, {
        plan: (w, s, tl, sd, th) => planDueWith(w, s, tl, sd, th, { skip: false }),
        rebuildEvery: 12
      });
      expect(a.events.length).toBeGreaterThan(0);
      expectEqual(b.events, a.events, `seed ${seed}`);
    }
  }, 300_000);
});

describe('Review Focus 4: funded mini, parking frames with a zero shift', () => {
  const input = fundedMini();
  const statics = staticsOf(input);
  const timeline = oneMoneyTimeline(input, miniFinance(input.asOf));
  const THROUGH = 240;
  const zero: ParkingCosts = { surface: 0, podium: 0, belowGrade: 0 };

  function run(cars: CarSystem | null, seed: number) {
    const events: (WorldEvent & { month: number })[] = [];
    const ledger: LedgerEvent[] = [];
    let month = 0;
    const out: StepSink = {
      event: (e) => events.push({ ...e, month }),
      ledger: (e) => ledger.push(e)
    };
    const api = withFunding(createFundingSystem(), cars);
    const w = api.createWorld(statics, timeline, seed, out);
    const due = api.planDue(w, statics, timeline, seed, THROUGH);
    for (let m = 1; m <= THROUGH; m++) {
      month = m;
      api.step(w, due, statics, timeline, seed, out);
    }
    return { w, events, ledger };
  }

  it('frames change at the entries, funding’s policyChanged runs, and nothing else moves', () => {
    for (const seed of [1, 2, 3]) {
      const { data, model } = carsOf(input, { zones: 3 }, zero);
      const inner = createCarSystem(data, model);
      let viewed: PolicyTimeline | null = null;
      const sys = offsetSystem(inner, (z) => (z === 1 ? -0.25 : 0.35));
      const watch: CarSystem = {
        ...sys,
        timelineOf(w, s, t) {
          viewed = sys.timelineOf(w, s, t);
          return viewed;
        }
      };
      const changed = { n: 0 };
      const fund = createFundingSystem();
      const counting = {
        ...fund,
        policyChanged(ctx: Parameters<typeof fund.policyChanged>[0]) {
          if (ctx.month === 14) changed.n++;
          fund.policyChanged(ctx);
        }
      };
      const events: (WorldEvent & { month: number })[] = [];
      const ledger: LedgerEvent[] = [];
      let month = 0;
      const out: StepSink = {
        event: (e) => events.push({ ...e, month }),
        ledger: (e) => ledger.push(e)
      };
      const api = withFunding(counting, watch);
      const w = api.createWorld(statics, timeline, seed, out);
      const due = api.planDue(w, statics, timeline, seed, THROUGH);
      for (let m = 1; m <= THROUGH; m++) {
        month = m;
        api.step(w, due, statics, timeline, seed, out);
      }
      expect(w.cars!.shiftN).toBeGreaterThan(0);
      expect(viewed!.changes()).toContain(14);
      expect(viewed!.frameAt(14).id).not.toBe(timeline.frameAt(14).id);
      expect(viewed!.frameAt(14).parking!.every((v) => v === 0)).toBe(true);
      expect(changed.n).toBe(1);
      const a = run(null, seed);
      expectEqual(events, a.events, `seed ${seed}`);
      expectEqual(ledger, a.ledger, `seed ${seed}`);
    }
  }, 300_000);
});

// The loop the spec warns of: starts move households, households move parking demand, demand
// moves starts. On the live city, per refresh: the zones whose delta changed, the citywide mean
// and max |shift| over lots with a shift, and the starts so far with the link on and off. Prints;
// asserts only that every shift is finite and that the shift settles (no growth without bound).
const LIVE = process.env.SFH_WORLD_LIVE ?? null;

describe.skipIf(LIVE === null)('parking convergence, live city', () => {
  it('prints each refresh; the shift stays finite and settles', async () => {
    const input = sloped(await liveInput(LIVE!));
    const statics = staticsOf(input);
    const f = frameOf(input, { id: frameIdOf('parking.live|f') });
    const timeline: PolicyTimeline = {
      frameAt: () => f,
      changes: () => [],
      touched: () => new Int32Array(0),
      readyThrough: () => Number.MAX_SAFE_INTEGER
    };
    // Hand-built data of the live build's size; the costs are the live build's (2026 dollars).
    const costs: ParkingCosts = { surface: null, podium: 48_756, belowGrade: 120_083 };
    const { data, model } = carsOf(input, { zones: 580, bands: LIVE_BANDS }, costs);
    const seed = 1;
    const run = (link: boolean) => {
      const sys = createCarSystem(data, model, { link });
      const api = withFunding(null, sys);
      const startsAt: number[] = [];
      let starts = 0;
      const out: StepSink = { event: (e) => void (e.kind === 'start' && starts++) };
      const w = api.createWorld(statics, timeline, seed, out);
      const t0 = performance.now();
      const due = api.planDue(w, statics, timeline, seed, MONTHS);
      for (let m = 1; m <= MONTHS; m++) {
        api.step(w, due, statics, timeline, seed, out);
        startsAt.push(starts);
      }
      return { w, sys, startsAt, ms: performance.now() - t0 };
    };
    const on = run(true);
    const off = run(false);
    const c = on.w.cars!;
    const t = on.sys.timelineOf(on.w, statics, timeline);
    const rows: { month: number; zones: number; mean: number; max: number }[] = [];
    for (let month = 13; month <= MONTHS; month += model.refreshMonths) {
      let zones = 0;
      for (let i = 0; i < c.shiftN; i++) if (c.shiftMonth[i] === month + 1) zones++;
      const pk = month + 1 <= MONTHS ? t.frameAt(month + 1).parking : null;
      let sum = 0;
      let n = 0;
      let max = 0;
      if (pk) {
        for (const v of pk) {
          expect(Number.isFinite(v)).toBe(true);
          if (v === 0) continue;
          sum += Math.abs(v);
          n++;
          max = Math.max(max, Math.abs(v));
        }
      }
      rows.push({ month, zones, mean: n > 0 ? sum / n : 0, max });
      console.log(
        `refresh ${month}: zones changed ${zones}, mean |shift| ${(n > 0 ? sum / n : 0).toFixed(4)}, ` +
          `max ${max.toFixed(4)}, starts on ${on.startsAt[month - 1]} off ${off.startsAt[month - 1]}`
      );
    }
    console.log(
      `window ${MONTHS} months, plan and steps: link on ${on.ms.toFixed(0)} ms, ` +
        `off ${off.ms.toFixed(0)} ms (ballpark; not a quiet-machine figure)`
    );
    expect(rows.length).toBeGreaterThan(30);
    expect(on.ms > 0 && off.ms > 0).toBe(true);
    // Settles: the last decade's largest shift is no more than twice the first decade's (a loop
    // that fed itself would keep growing).
    const decade = (from: number, to: number) =>
      Math.max(...rows.filter((r) => r.month >= from && r.month < to).map((r) => r.max));
    expect(decade(361, 481)).toBeLessThanOrEqual(2 * Math.max(decade(13, 133), 1e-9));
    expect(Number.isFinite(decade(361, 481))).toBe(true);
  }, 1_200_000);
});
