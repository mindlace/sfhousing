// The due list (spec S11, rules 19-21, "Tests that must pass": copies and rule 20's two-way
// test): a carried list and a rebuilt one agree, a window extended in steps misses nothing, a copy
// steps like its original, the skip shortcut changes nothing, and no frame past `readyThrough` is
// read. Bench city, a frame change at month 121 with a market shift and a speed change.
import { beforeAll, describe, expect, it } from 'vitest';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { SimInput } from '$lib/sim/scenario/types';
import { planDue, planDueWith, type DueList } from './due';
import type { PolicyFrame, PolicyTimeline } from './policy/frame';
import { lotEntity, ordinaryStart, skipBound } from './rates';
import { staticsOf, type Statics } from './statics';
import { benchInput } from './test/cities.node';
import { Recorder, horizonMonth, runWorld } from './test/run';
import { changingAt, everyStage, frameOf, limited, marketAt } from './test/timeline';
import type { Due, StepSink, World } from './types';
import { createWorld, step } from './world';

const M = 121;
const SEEDS = [1, 2, 3, 4, 5];
const NOWHERE: StepSink = { event() {} };

type Events = Recorder['events'];

describe('the due list, bench city with a frame change at month 121', () => {
  let input: SimInput;
  let statics: Statics;
  let t: PolicyTimeline;
  let H: number;
  beforeAll(() => {
    input = benchInput();
    statics = staticsOf(input);
    const f: PolicyFrame = frameOf(input);
    const g = frameOf(input, {
      id: 1,
      market: marketAt(input, input.asOf) + 0.4,
      speed: everyStage(0.7)
    });
    t = changingAt(M, f, g, new Int32Array(0));
    H = horizonMonth(input.asOf);
  });

  function run(
    seed: number,
    opts: Parameters<typeof runWorld>[5] = {},
    timeline: PolicyTimeline = t,
    through: number = H
  ): { w: World; events: Events } {
    const rec = new Recorder();
    const w = runWorld(statics, timeline, seed, through, rec, opts);
    return { w, events: rec.events };
  }

  it.each(SEEDS)(
    'a carried due list and one rebuilt every 12 months give the same events (seed %i)',
    (seed) => {
      const a = run(seed);
      expect(a.events.some((e) => e.month >= M)).toBe(true);
      expect(run(seed, { rebuildEvery: 12 }).events).toEqual(a.events);
    }
  );

  it.each(SEEDS)('a window extended in steps misses nothing (seed %i)', (seed) => {
    const through = 480;
    // planDue through month 60 at the start, then through 480 once month 60 is stepped.
    const plan: typeof planDue = (w, s, tl, sd) =>
      planDue(w, s, tl, sd, w.month < 60 ? 60 : through);
    const b = run(seed, { rebuildEvery: 60, plan }, t, through);
    expect(b.events).toEqual(run(seed, {}, t, through).events);
  });

  it.each(SEEDS)(
    'a copy stepped with a rebuilt due list gives the same events (seed %i)',
    (seed) => {
      const end = 240;
      const at = [60, 120, 180];
      const rec = new Recorder();
      const w = createWorld(statics, t, seed, rec);
      const due = planDue(w, statics, t, seed, H);
      const copies: { from: number; w: World; due: DueList }[] = [];
      for (let m = 1; m <= end; m++) {
        if (at.includes(m - 1)) {
          const c = structuredClone(w);
          copies.push({ from: m - 1, w: c, due: planDue(c, statics, t, seed, H) });
        }
        rec.month = m;
        step(w, due, statics, t, seed, rec);
      }
      expect(copies).toHaveLength(3);
      for (const c of copies) {
        const crec = new Recorder();
        for (let m = c.from + 1; m <= end; m++) {
          crec.month = m;
          step(c.w, c.due, statics, t, seed, crec);
        }
        const after = rec.events.filter((e) => e.month > c.from);
        expect(after.length).toBeGreaterThan(0);
        expect(crec.events, `copy at ${c.from}`).toEqual(after);
        expect(c.w, `copy at ${c.from}`).toEqual(w);
      }
    }
  );

  it.each(SEEDS)('the skip shortcut changes no event (seed %i)', (seed) => {
    // `planDueWith(skip: false)`, wrapped so `step`'s whole-city replan (which skips only on a
    // `DueList`) skips nothing either.
    const plan: typeof planDue = (w, s, tl, sd, through) => {
      const d = planDueWith(w, s, tl, sd, through, { skip: false });
      const wrapped: Due = {
        take: (m) => d.take(m),
        put: (e, m) => d.put(e, m),
        drop: (e) => d.drop(e)
      };
      return wrapped as DueList;
    };
    expect(run(seed, { plan }).events).toEqual(run(seed).events);
  });

  it.each(SEEDS)('the skip bound passes only lots that start past through (seed %i)', (seed) => {
    const sh = seedHash(seed);
    let skipped = 0;
    let kept = 0;
    for (const [month, through] of [
      [1, 60],
      [M, 200],
      [M + 30, H]
    ]) {
      const bound = skipBound(statics, t, month, through);
      expect(bound).toHaveLength(statics.parcelId.length);
      for (let lot = 0; lot < statics.parcelId.length; lot++) {
        const u = drawOn(streamOf(sh, lotEntity(statics, lot), 0), P.INIT, 0);
        const s = ordinaryStart(statics, t, month, sh, lot, statics.asOf, 0);
        if (u > bound[lot]) {
          skipped++;
          if (s !== null) expect(s.month, `lot ${lot}`).toBeGreaterThan(through);
        } else if (s !== null && s.month <= through) kept++;
      }
    }
    expect(skipped).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it.each(SEEDS)('never reads a frame past readyThrough (seed %i)', (seed) => {
    let ready = 1;
    const lim = limited(t, () => ready);
    const stepAhead: typeof step = (w, ...rest) => {
      ready = w.month + 1;
      step(w, ...rest);
    };
    const b = run(seed, { step: stepAhead }, lim);
    expect(b.events).toEqual(run(seed).events);
  });

  it('step refuses a month the timeline has not reached', () => {
    const w = createWorld(statics, t, 1, NOWHERE);
    const due = planDue(w, statics, t, 1, H);
    expect(() =>
      step(
        w,
        due,
        statics,
        limited(t, () => 0),
        1,
        NOWHERE
      )
    ).toThrow(RangeError);
    expect(w.month).toBe(0);
  });
});
