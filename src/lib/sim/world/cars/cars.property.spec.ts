// The car system over whole runs: it only observes (every event equals the run without cars),
// one seed gives one population whatever the event order, a copy steps like its original, and a
// rebuilt plan gives what a carried one does (rule 20). Mini and bench cities, seeds 1 to 5.
import { beforeAll, describe, expect, it } from 'vitest';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import type { LedgerEvent } from '$lib/sim/world/types';
import type { SimInput } from '$lib/sim/scenario/types';
import { createFundingSystem } from '../funding/system';
import { fundedMini, oneMoneyTimeline } from '../funding/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { benchInput } from '../test/cities.node';
import { miniInput } from '../test/mini';
import { Recorder, runWorld } from '../test/run';
import { expectEqual } from '../test/same.node';
import { changingAt, frameOf, marketAt, oneFrame } from '../test/timeline';
import type { CarSystem, StepSink, World, WorldEvent } from '../types';
import { withFunding } from '../world';
import { createCarSystem } from './system';
import { carCity, type CarCityOpts } from './test/city';

const SEEDS = [1, 2, 3, 4, 5];
const MONTHS = 480;

interface City {
  name: string;
  input: SimInput;
  statics: Statics;
  timeline: PolicyTimeline;
  opts: CarCityOpts;
}

function cityOf(name: string, input: SimInput, opts: CarCityOpts): City {
  const f = frameOf(input);
  // A market change at month 121 replans every free lot.
  const g = frameOf(input, { id: 1, market: marketAt(input, input.asOf) + 0.3 });
  return {
    name,
    input,
    statics: staticsOf(input),
    timeline: changingAt(121, f, g, new Int32Array(0)),
    opts
  };
}

function runWith(c: City, seed: number, sys: CarSystem | null, through = MONTHS) {
  const api = withFunding(null, sys);
  const rec = new Recorder();
  const w = runWorld(c.statics, c.timeline, seed, through, rec, {
    plan: api.planDue,
    step: api.step,
    create: api.createWorld
  });
  return { w, events: rec.events };
}

/** A car system that feeds each batch of events (all since its last step) in a shuffled order. */
function shuffling(inner: CarSystem, seed: number): CarSystem {
  let held: WorldEvent[] = [];
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return {
    create: (w, st) => inner.create(w, st),
    onEvent(_w, _st, e) {
      held.push(e);
    },
    step(ctx) {
      const batch = held;
      held = [];
      for (let i = batch.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [batch[i], batch[j]] = [batch[j], batch[i]];
      }
      for (const e of batch) inner.onEvent(ctx.world, ctx.statics, e);
      inner.step(ctx);
    },
    timelineOf: (w, st, t) => inner.timelineOf(w, st, t)
  };
}

describe.each([
  ['mini', () => miniInput(), { zones: 3, noZoneEvery: 11 }],
  ['bench', () => benchInput(), { zones: 60, noZoneEvery: 97, perMonth: 0.008 }]
] as const)('the car system on the %s city', (name, inputOf, opts) => {
  let c: City;
  beforeAll(() => {
    c = cityOf(name, inputOf(), opts);
  });
  const sysOf = (link?: boolean) => {
    const { data, model } = carCity(c.input, c.opts);
    return createCarSystem(data, model, link === undefined ? {} : { link });
  };

  it('only observes: with link false every event over 480 months equals the run without cars', () => {
    let changed = 0;
    for (const seed of SEEDS) {
      const without = runWith(c, seed, null);
      const off = runWith(c, seed, sysOf(false));
      expectEqual(off.events, without.events, `seed ${seed}`);
      const { w } = off;
      const start = carCity(c.input, c.opts).data.households;
      const sum = (a: Int32Array) => a.reduce((x, y) => x + y, 0);
      // Homes were completed and lost: the population is not the start one's size.
      if (sum(w.cars!.hh) !== sum(start)) changed++;
      expect(w.cars!.hh.every((v) => v >= 0)).toBe(true);
      expect(w.cars!.pendFill.some((v) => v > 0) || w.cars!.unplaced > 0).toBe(true);
    }
    expect(changed).toBe(SEEDS.length);
  });

  it('with the link on (no parking frames yet) the events are the same too', () => {
    const without = runWith(c, 2, null);
    expectEqual(runWith(c, 2, sysOf()).events, without.events);
  });

  it('one seed twice gives equal car columns; another seed differs', () => {
    const a = runWith(c, 3, sysOf(), 240).w.cars;
    expectEqual(runWith(c, 3, sysOf(), 240).w.cars, a);
    expect(runWith(c, 4, sysOf(), 240).w.cars!.hh).not.toEqual(a!.hh);
  });

  it('a month’s events fed in a shuffled order give equal counts', () => {
    for (const seed of [1, 5]) {
      const a = runWith(c, seed, sysOf(), 240).w.cars!;
      const b = runWith(c, seed, shuffling(sysOf(), seed * 7919), 240).w.cars!;
      expectEqual(
        { hh: b.hh, unplaced: b.unplaced, unmatched: b.unmatched, table: b.table },
        { hh: a.hh, unplaced: a.unplaced, unmatched: a.unmatched, table: a.table },
        `seed ${seed}`
      );
    }
  });

  it('a structuredClone at month 60 stepped to 120 equals the original stepped to 120', () => {
    const sys = sysOf();
    const api = withFunding(null, sys);
    const nowhere: StepSink = { event() {} };
    const seed = 2;
    const w = api.createWorld(c.statics, c.timeline, seed, nowhere);
    const due = api.planDue(w, c.statics, c.timeline, seed, 120);
    for (let m = 1; m <= 60; m++) api.step(w, due, c.statics, c.timeline, seed, nowhere);
    const copy: World = structuredClone(w);
    const copyDue = api.planDue(copy, c.statics, c.timeline, seed, 120);
    for (let m = 61; m <= 120; m++) {
      api.step(w, due, c.statics, c.timeline, seed, nowhere);
      api.step(copy, copyDue, c.statics, c.timeline, seed, nowhere);
    }
    expect(copy.month).toBe(120);
    expect(copy.cars!.hh.length).toBeGreaterThan(0);
    expectEqual(copy, w);
  });

  it('a due list rebuilt every 12 months gives the carried run’s events and cars (rule 20)', () => {
    const api = withFunding(null, sysOf());
    for (const seed of [1, 4]) {
      const recA = new Recorder();
      const a = runWorld(c.statics, c.timeline, seed, MONTHS, recA, {
        plan: api.planDue,
        step: api.step,
        create: api.createWorld
      });
      const recB = new Recorder();
      const b = runWorld(c.statics, c.timeline, seed, MONTHS, recB, {
        plan: api.planDue,
        step: api.step,
        create: api.createWorld,
        rebuildEvery: 12
      });
      expectEqual(recB.events, recA.events, `seed ${seed}`);
      expect(a.cars).toBeDefined();
      expectEqual(b.cars, a.cars, `seed ${seed}`);
    }
  });
});

describe('the car system beside funding (mini city with money)', () => {
  const input = fundedMini();
  const statics = staticsOf(input);
  const timeline = oneMoneyTimeline(input, miniFinance(input.asOf));
  const THROUGH = 240;

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

  it('every event a step sends reaches onEvent, funded starts and their chains included', () => {
    const { data, model } = carCity(input, { zones: 3 });
    const inner = createCarSystem(data, model);
    const fed: WorldEvent[] = [];
    const cars: CarSystem = {
      create: (w, s) => inner.create(w, s),
      onEvent(w, s, e) {
        fed.push(e);
        inner.onEvent(w, s, e);
      },
      step: (ctx) => inner.step(ctx),
      timelineOf: (w, s, t) => inner.timelineOf(w, s, t)
    };
    const got = run(cars, 1);
    const stepped = got.events.filter((e) => e.month > 0).map(({ month: _m, ...e }) => e);
    expect(got.events.some((e) => e.kind === 'award')).toBe(true);
    expect(fed).toEqual(stepped);
  });

  it('with funding, events and ledger equal the run without cars', () => {
    for (const seed of [1, 2, 3]) {
      const { data, model } = carCity(input, { zones: 3 });
      const a = run(null, seed);
      const b = run(createCarSystem(data, model, { link: false }), seed);
      expectEqual(b.events, a.events, `seed ${seed}`);
      expectEqual(b.ledger, a.ledger, `seed ${seed}`);
    }
  });
});

describe('without a car system', () => {
  it('the world has no cars and the run is the plain one', () => {
    const input = miniInput();
    const statics = staticsOf(input);
    const t = oneFrame(frameOf(input));
    const rec = new Recorder();
    const w = runWorld(statics, t, 1, 60, rec);
    expect(w.cars).toBeUndefined();
    const api = withFunding(null, null);
    const rec2 = new Recorder();
    runWorld(statics, t, 1, 60, rec2, {
      plan: api.planDue,
      step: api.step,
      create: api.createWorld
    });
    expectEqual(rec2.events, rec.events);
  });
});
