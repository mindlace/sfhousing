import { describe, expect, it } from 'vitest';
import { BASE_HANDS } from '../limits';
import type { Drop } from './drops';
import {
  RING_KEYS,
  RING_KEY_DIR,
  RUN_CAPS,
  RUN_TIMES,
  createRun,
  idle,
  nudgeRing,
  pointRing,
  reproject,
  setBox,
  step,
  sweepHits,
  type RunModel,
  type StepInput
} from './run-model';

function drop(row: number, day: number, homes = 1, x = 400, y = 300, policy = false): Drop {
  return { row, lng: x, lat: y, day, worth: { home: homes }, policy };
}

function input(o: Partial<StepInput> = {}): StepInput {
  return {
    now: 0,
    running: true,
    day: 0,
    drops: [],
    hands: BASE_HANDS,
    auto: false,
    reduced: true,
    project: (x, y) => ({ x, y }),
    ...o
  };
}

function boxed(): RunModel {
  const m = createRun();
  setBox(m, 800, 600);
  return m;
}

describe('run model ring', () => {
  it('createRun: not running, empty lists, zero take, 0 by 0 box, ring at (0, 0)', () => {
    const m = createRun();
    expect(m.running).toBe(false);
    expect(m.drops).toEqual([]);
    expect(m.live).toEqual([]);
    expect(m.counts).toEqual([]);
    expect(m.seen.size).toBe(0);
    expect(m.sweep).toEqual([]);
    expect(m.take).toEqual({ dropped: {}, collected: {} });
    expect(m.highDay).toBe(-Infinity);
    expect(m.cursor).toBe(0);
    expect(m.ringMoved).toBe(false);
    expect(m.box).toEqual({ w: 0, h: 0 });
    expect(m.ring).toEqual({ x: 0, y: 0 });
  });

  it('declares the constants', () => {
    expect(RUN_TIMES).toEqual({
      appearMs: 160,
      fadeMs: 400,
      takenMs: 400,
      countMs: 800,
      minShownMs: 400
    });
    expect(RUN_CAPS).toEqual({ maxDrawn: 240, maxCounts: 40, maxSweep: 32 });
    expect(RING_KEY_DIR.ArrowLeft).toEqual([-1, 0]);
    expect(RING_KEY_DIR.ArrowDown).toEqual([0, 1]);
  });

  it('pointRing clamps to the box', () => {
    const m = createRun();
    setBox(m, 800, 600);
    pointRing(m, { x: -5, y: 700 }, false);
    expect(m.ring).toEqual({ x: 0, y: 600 });
    pointRing(m, { x: 900, y: -1 }, false);
    expect(m.ring).toEqual({ x: 800, y: 0 });
  });

  it('setBox re-clamps the ring', () => {
    const m = createRun();
    setBox(m, 800, 600);
    pointRing(m, { x: 700, y: 500 }, false);
    setBox(m, 400, 300);
    expect(m.ring).toEqual({ x: 400, y: 300 });
  });

  it('setBox from an empty box to one with both sides above 0 centres the ring', () => {
    const a = createRun();
    setBox(a, 800, 600);
    expect(a.ring).toEqual({ x: 400, y: 300 });
    const b = createRun();
    setBox(b, 0, 600);
    setBox(b, 800, 600);
    expect(b.ring).toEqual({ x: 400, y: 300 });
    const c = createRun();
    setBox(c, 800, 0);
    setBox(c, 800, 600);
    expect(c.ring).toEqual({ x: 400, y: 300 });
  });

  it('setBox to a box still empty on one side does not centre', () => {
    const m = createRun();
    setBox(m, 800, 0);
    expect(m.ring).toEqual({ x: 0, y: 0 });
  });

  it('setBox between two non-empty boxes only re-clamps', () => {
    const m = createRun();
    setBox(m, 800, 600);
    pointRing(m, { x: 100, y: 100 }, false);
    setBox(m, 1000, 700);
    expect(m.ring).toEqual({ x: 100, y: 100 });
  });

  it('setBox is not a ring move: a centring or clamp empties sweep and leaves ringMoved', () => {
    const m = createRun();
    setBox(m, 800, 600);
    pointRing(m, { x: 100, y: 100 }, false);
    pointRing(m, { x: 200, y: 200 }, false);
    expect(m.sweep.length).toBeGreaterThan(0);
    expect(m.ringMoved).toBe(true);
    setBox(m, 150, 150);
    expect(m.ring).toEqual({ x: 150, y: 150 });
    expect(m.sweep).toEqual([]);
    expect(m.ringMoved).toBe(true);

    const e = createRun();
    pointRing(e, { x: 5, y: 5 }, false);
    e.ringMoved = false;
    setBox(e, 800, 600);
    expect(e.ring).toEqual({ x: 400, y: 300 });
    expect(e.sweep).toEqual([]);
    expect(e.ringMoved).toBe(false);
  });

  it('after setBox centres from an empty box, sweepHits finds nothing on the corner line', () => {
    const m = createRun();
    setBox(m, 800, 600);
    expect(m.sweep).toEqual([]);
    expect(sweepHits(m.sweep, m.ring, { x: 200, y: 150 }, 10)).toBe(false);
  });

  it('pointRing appends the old centre, or null when fresh, and sets ringMoved', () => {
    const m = createRun();
    setBox(m, 800, 600);
    pointRing(m, { x: 10, y: 20 }, false);
    expect(m.sweep).toEqual([{ x: 400, y: 300 }]);
    expect(m.ringMoved).toBe(true);
    pointRing(m, { x: 30, y: 40 }, true);
    expect(m.sweep).toEqual([{ x: 400, y: 300 }, null]);
    expect(m.ring).toEqual({ x: 30, y: 40 });
  });

  it('sweep holds at most RUN_CAPS.maxSweep (32) entries, oldest dropped first', () => {
    const m = createRun();
    setBox(m, 800, 600);
    for (let i = 1; i <= 40; i++) pointRing(m, { x: i, y: 0 }, false);
    expect(m.sweep.length).toBe(RUN_CAPS.maxSweep);
    expect(m.sweep[0]).toEqual({ x: 8, y: 0 });
    expect(m.sweep[31]).toEqual({ x: 39, y: 0 });
  });

  it('nudgeRing by 16 and by 64 sweeps the ground it crosses', () => {
    expect(RING_KEYS.stepPx).toBe(16);
    expect(RING_KEYS.shiftStepPx).toBe(64);
    const m = createRun();
    setBox(m, 800, 600);
    nudgeRing(m, RING_KEYS.stepPx, 0);
    expect(m.ring).toEqual({ x: 416, y: 300 });
    expect(m.sweep).toEqual([{ x: 400, y: 300 }]);
    nudgeRing(m, 0, -RING_KEYS.shiftStepPx);
    expect(m.ring).toEqual({ x: 416, y: 236 });
    expect(m.sweep[1]).toEqual({ x: 416, y: 300 });
  });

  it('sweepHits: within r of a segment; just outside is not', () => {
    const sweep = [{ x: 0, y: 0 }];
    const ring = { x: 100, y: 0 };
    expect(sweepHits(sweep, ring, { x: 50, y: 9 }, 10)).toBe(true);
    expect(sweepHits(sweep, ring, { x: 50, y: 11 }, 10)).toBe(false);
  });

  it('sweepHits: a null breaks the path; a lone point still counts', () => {
    const sweep = [{ x: 0, y: 0 }, null];
    const ring = { x: 100, y: 0 };
    expect(sweepHits(sweep, ring, { x: 50, y: 0 }, 10)).toBe(false);
    expect(sweepHits(sweep, ring, { x: 0, y: 5 }, 10)).toBe(true);
    expect(sweepHits(sweep, ring, { x: 100, y: 5 }, 10)).toBe(true);
  });
});

const FAR = 10;
const far = (row: number, day: number, homes = 1): Drop => drop(row, day, homes, FAR, FAR);

describe('run model start', () => {
  it('a running step starts the run: zero take, ring centred, every drop at or before day appears', () => {
    const m = boxed();
    step(m, input({ drops: [drop(1, 0)] }));
    step(m, input({ running: false, now: 10 }));
    pointRing(m, { x: 20, y: 20 }, false);
    expect(m.take).toEqual({ dropped: { home: 1 }, collected: { home: 1 } });

    const drops = [drop(1, 5), far(2, 10), drop(3, 20)];
    const r = step(m, input({ now: 100, day: 10, drops }));
    expect(r.started).toBe(true);
    expect(r.appeared).toBe(2);
    expect(m.running).toBe(true);
    expect(m.ring).toEqual({ x: 400, y: 300 });
    expect(m.drops).toBe(drops);
    expect(m.cursor).toBe(2);
    expect(m.highDay).toBe(10);
    expect(m.live.map((l) => l.drop.row)).toEqual([1, 2]);
    expect(m.take).toEqual({ dropped: { home: 2 }, collected: { home: 1 } });
    expect(m.sweep).toEqual([]);
  });

  it('a run started on an empty box gets its ring at the centre when the first size arrives', () => {
    const m = createRun();
    const r = step(m, input());
    expect(r.started).toBe(true);
    expect(m.ring).toEqual({ x: 0, y: 0 });
    setBox(m, 800, 600);
    expect(m.ring).toEqual({ x: 400, y: 300 });
  });
});

describe('run model appearing', () => {
  it('a drop appears in the step whose day reaches its day, not before, counted once', () => {
    const m = boxed();
    const drops = [far(1, 10, 3), far(2, 20)];
    expect(step(m, input({ day: 5, drops })).appeared).toBe(0);
    expect(m.take.dropped).toEqual({});
    expect(step(m, input({ day: 10, drops })).appeared).toBe(1);
    expect(m.take.dropped).toEqual({ home: 3 });
    expect(m.live[0].worth).toBe(3);
    expect(step(m, input({ day: 10, drops })).appeared).toBe(0);
    expect(m.take.dropped).toEqual({ home: 3 });
    expect(step(m, input({ day: 20, drops })).appeared).toBe(1);
    expect(m.take.dropped).toEqual({ home: 4 });
  });

  it('endMs is now + max(lingerMs, 400)', () => {
    const a = boxed();
    step(a, input({ now: 1000, drops: [far(1, 0)], hands: { ...BASE_HANDS, lingerMs: 4000 } }));
    expect(a.live[0]).toMatchObject({ bornMs: 1000, endMs: 5000, takenMs: null });
    expect(a.live[0].at).toEqual({ x: FAR, y: FAR });
    const b = boxed();
    step(b, input({ now: 1000, drops: [far(1, 0)], hands: { ...BASE_HANDS, lingerMs: 100 } }));
    expect(b.live[0].endMs).toBe(1400);
  });

  it('a drop with no point is counted and collected only by auto', () => {
    const m = boxed();
    const drops = [drop(1, 0)];
    const r = step(m, input({ drops, project: () => null }));
    expect(r.appeared).toBe(1);
    expect(r.collected).toBe(0);
    expect(m.live[0].at).toBeNull();
    expect(m.take).toEqual({ dropped: { home: 1 }, collected: {} });
    expect(step(m, input({ drops, auto: true, project: () => null })).collected).toBe(1);
    expect(m.take.collected).toEqual({ home: 1 });
    expect(m.counts).toEqual([]);
  });
});

describe('run model collecting', () => {
  it('collects a drop within radiusPx of the ring once; one just outside is not', () => {
    const m = boxed();
    const drops = [drop(1, 0, 1, 448, 300), drop(2, 0, 1, 449, 300)];
    expect(step(m, input({ drops })).collected).toBe(1);
    expect(m.live.find((l) => l.drop.row === 1)?.takenMs).toBe(0);
    expect(m.live.find((l) => l.drop.row === 2)?.takenMs).toBeNull();
    expect(step(m, input({ drops, now: 10 })).collected).toBe(0);
    expect(m.take.collected).toEqual({ home: 1 });
  });

  it('collects a drop the swept path crossed between two steps', () => {
    const m = boxed();
    const drops = [drop(1, 1, 1, 250, 300), drop(2, 1, 1, 250, 400)];
    step(m, input({ drops }));
    pointRing(m, { x: 100, y: 300 }, false);
    const r = step(m, input({ drops, day: 1 }));
    expect(r.collected).toBe(1);
    expect(m.live.find((l) => l.drop.row === 1)?.takenMs).toBe(0);
  });

  it('a path broken by fresh does not join its two sides', () => {
    const m = boxed();
    const drops = [drop(1, 1, 1, 250, 300)];
    step(m, input({ drops }));
    pointRing(m, { x: 100, y: 300 }, true);
    expect(step(m, input({ drops, day: 1 })).collected).toBe(0);
  });

  it('a drop appearing under a still ring is collected in that step', () => {
    const m = boxed();
    const drops = [drop(1, 1)];
    step(m, input({ drops }));
    const r = step(m, input({ drops, day: 1 }));
    expect(r.appeared).toBe(1);
    expect(r.collected).toBe(1);
    expect(m.take.collected).toEqual({ home: 1 });
  });

  it('collecting sets takenMs = now, endMs = now + 400, and adds a FloatCount at its point', () => {
    const m = boxed();
    step(m, input({ now: 2000, drops: [drop(1, 0, 2, 410, 300)] }));
    expect(m.live[0]).toMatchObject({ takenMs: 2000, endMs: 2400 });
    expect(m.counts).toEqual([{ x: 410, y: 300, worth: 2, bornMs: 2000 }]);
  });

  it('auto collects every drop as it appears, off-map ones included', () => {
    const m = boxed();
    const drops = [drop(1, 0, 1, 10, 10), drop(2, 0, 1, -5, 0), drop(3, 0, 1, 700, 500)];
    const project = (x: number, y: number) => (x < 0 ? null : { x, y });
    const r = step(m, input({ drops, auto: true, project }));
    expect(r.collected).toBe(3);
    expect(m.take.collected).toEqual({ home: 3 });
    expect(m.counts.length).toBe(2);
  });

  it('turning auto on collects every live drop', () => {
    const m = boxed();
    const drops = [far(1, 0), far(2, 0), far(3, 0)];
    expect(step(m, input({ drops })).collected).toBe(0);
    expect(step(m, input({ drops, now: 10, auto: true })).collected).toBe(3);
    expect(m.take.collected).toEqual({ home: 3 });
  });

  it('a fading drop can be collected until its endMs', () => {
    const a = boxed();
    step(a, input({ drops: [far(1, 0)] }));
    expect(step(a, input({ now: 3999, drops: a.drops, auto: true })).collected).toBe(1);
    const b = boxed();
    step(b, input({ drops: [far(1, 0)] }));
    const r = step(b, input({ now: 4000, drops: b.drops, auto: true }));
    expect(r.collected).toBe(0);
    expect(r.removed).toBe(1);
    expect(b.take.collected).toEqual({});
  });

  it('empties sweep and clears ringMoved after the collect pass', () => {
    const m = boxed();
    step(m, input());
    pointRing(m, { x: 100, y: 100 }, false);
    expect(m.sweep.length).toBe(1);
    expect(step(m, input({ now: 10 })).dirty).toBe(true);
    expect(m.sweep).toEqual([]);
    expect(m.ringMoved).toBe(false);
  });
});

describe('run model fading and ending', () => {
  it('an uncollected drop leaves at endMs; a collected one 400 ms after; a count after 800 ms', () => {
    const a = boxed();
    step(a, input({ drops: [far(1, 0)] }));
    expect(step(a, input({ now: 3999, drops: a.drops })).removed).toBe(0);
    expect(a.live.length).toBe(1);
    expect(step(a, input({ now: 4000, drops: a.drops })).removed).toBe(1);
    expect(a.live.length).toBe(0);

    const b = boxed();
    step(b, input({ drops: [drop(1, 0)] }));
    expect(step(b, input({ now: 399, drops: b.drops })).removed).toBe(0);
    expect(step(b, input({ now: 400, drops: b.drops })).removed).toBe(1);
    expect(b.live.length).toBe(0);
    expect(b.counts.length).toBe(1);
    expect(step(b, input({ now: 799, drops: b.drops })).removed).toBe(0);
    expect(step(b, input({ now: 800, drops: b.drops })).removed).toBe(1);
    expect(b.counts.length).toBe(0);
  });

  it('counts never exceed 40', () => {
    const m = boxed();
    const drops = Array.from({ length: 50 }, (_, i) => drop(i + 1, 0, i + 1));
    expect(step(m, input({ drops })).collected).toBe(50);
    expect(m.counts.length).toBe(RUN_CAPS.maxCounts);
    expect(m.counts[0].worth).toBe(11);
    expect(m.counts[39].worth).toBe(50);
  });

  it('a burst of 500 drops in one step counts 500 and auto collects all 500', () => {
    const m = boxed();
    const drops = Array.from({ length: 500 }, (_, i) => far(i + 1, 100));
    step(m, input({ drops, day: 50 }));
    const r = step(m, input({ drops, day: 100, auto: true }));
    expect(r.appeared).toBe(500);
    expect(r.collected).toBe(500);
    expect(m.take).toEqual({ dropped: { home: 500 }, collected: { home: 500 } });
  });

  it('the ending step counts the drops due through its day, collects under the ring or auto, reports ended', () => {
    const drops = [far(1, 95), drop(2, 100), far(3, 101)];
    const m = boxed();
    step(m, input({ drops, day: 90 }));
    const r = step(m, input({ drops, day: 100, running: false }));
    expect(r.ended).toBe(true);
    expect(r.appeared).toBe(2);
    expect(r.collected).toBe(1);
    expect(m.running).toBe(false);
    expect(m.take).toEqual({ dropped: { home: 2 }, collected: { home: 1 } });

    const a = boxed();
    step(a, input({ drops, day: 90 }));
    expect(step(a, input({ drops, day: 100, running: false, auto: true })).collected).toBe(2);
    expect(a.take).toEqual({ dropped: { home: 2 }, collected: { home: 2 } });
  });

  it('ending sets each uncollected endMs to min(its own, now + 400), or now under reduced', () => {
    const a = boxed();
    step(a, input({ drops: [far(1, 0)] }));
    pointRing(a, { x: 600, y: 600 }, false);
    step(a, input({ now: 1000, running: false, reduced: false }));
    expect(a.live[0].endMs).toBe(1400);
    expect(a.sweep).toEqual([]);

    const b = boxed();
    step(b, input({ drops: [far(1, 0)] }));
    const d = b.live[0];
    const r = step(b, input({ now: 1000, running: false, reduced: true }));
    expect(d.endMs).toBe(1000);
    expect(r.removed).toBe(1);
    expect(b.live.length).toBe(0);

    const c = boxed();
    step(c, input({ drops: [far(1, 0)], hands: { ...BASE_HANDS, lingerMs: 100 } }));
    expect(c.live[0].endMs).toBe(400);
    step(c, input({ now: 300, running: false, reduced: false }));
    expect(c.live[0].endMs).toBe(400);
  });

  it('ending leaves a collected drop its endMs; a later step drops and collects nothing', () => {
    const m = boxed();
    const drops = [drop(1, 0), drop(2, 5)];
    step(m, input({ drops }));
    expect(m.live[0].endMs).toBe(400);
    step(m, input({ drops, now: 100, running: false, reduced: false }));
    expect(m.live[0].endMs).toBe(400);
    const r = step(m, input({ drops, now: 200, day: 5, running: false, auto: true }));
    expect(r.appeared).toBe(0);
    expect(r.collected).toBe(0);
    expect(m.take).toEqual({ dropped: { home: 1 }, collected: { home: 1 } });
  });

  it('a stop on a never-started model, and a second stop, report ended false and change no take', () => {
    const m = boxed();
    const r = step(m, input({ running: false, drops: [drop(1, 0)] }));
    expect(r.ended).toBe(false);
    expect(r.started).toBe(false);
    expect(m.take).toEqual({ dropped: {}, collected: {} });

    step(m, input({ drops: [drop(1, 0)] }));
    expect(step(m, input({ now: 10, running: false })).ended).toBe(true);
    const r2 = step(m, input({ now: 20, running: false, day: 50, drops: [drop(9, 0)] }));
    expect(r2.ended).toBe(false);
    expect(m.take).toEqual({ dropped: { home: 1 }, collected: { home: 1 } });
  });
});

describe('run model going back and new arrays', () => {
  it('a feed day going back drops nothing again and lowers no count', () => {
    const m = boxed();
    const drops = [far(1, 10), far(2, 20)];
    step(m, input({ drops, day: 20 }));
    const ends = m.live.map((l) => l.endMs);
    const r = step(m, input({ drops, day: 5, now: 100 }));
    expect(r.appeared).toBe(0);
    expect(m.highDay).toBe(20);
    expect(m.take.dropped).toEqual({ home: 2 });
    expect(m.live.map((l) => l.endMs)).toEqual(ends);
    expect(step(m, input({ drops, day: 20, now: 200 })).appeared).toBe(0);
  });

  it('a NaN day keeps highDay and drops nothing; the next real day drops what is due', () => {
    const m = boxed();
    const drops = [far(1, 10), far(2, 20)];
    step(m, input({ drops, day: 10 }));
    expect(step(m, input({ drops, day: NaN })).appeared).toBe(0);
    expect(m.highDay).toBe(10);
    expect(step(m, input({ drops, day: 20 })).appeared).toBe(1);
  });

  it('a new drops array counts no row twice and drops new rows past highDay when reached', () => {
    const m = boxed();
    step(m, input({ drops: [far(1, 10), far(2, 20)], day: 10 }));
    const b = [far(2, 20), far(1, 30, 5), far(3, 40)];
    expect(step(m, input({ drops: b, day: 15 })).appeared).toBe(0);
    expect(m.drops).toBe(b);
    expect(m.cursor).toBe(0);
    expect(step(m, input({ drops: b, day: 30 })).appeared).toBe(1);
    expect(m.take.dropped).toEqual({ home: 2 });
    expect(step(m, input({ drops: b, day: 40 })).appeared).toBe(1);
    expect(m.take.dropped).toEqual({ home: 3 });
  });

  it('a shown drop keeps its state and times in a new array', () => {
    const m = boxed();
    step(m, input({ drops: [far(1, 10), drop(2, 10)], day: 10 }));
    const before = m.live.map((l) => ({ ...l }));
    const b = [drop(1, 10, 7, 500, 500), drop(2, 10, 9, 100, 100)];
    step(m, input({ drops: b, day: 10, now: 100 }));
    expect(m.live.map((l) => ({ ...l }))).toEqual(before);
    expect(m.live[0].drop.worth).toEqual({ home: 1 });
    expect(m.take).toEqual({ dropped: { home: 2 }, collected: { home: 1 } });
  });

  it('a shown drop whose row is gone stays until its endMs; the take does not go down', () => {
    const m = boxed();
    step(m, input({ drops: [far(1, 10)], day: 10 }));
    step(m, input({ drops: [], day: 10, now: 100 }));
    expect(m.live.length).toBe(1);
    expect(m.take.dropped).toEqual({ home: 1 });
    expect(step(m, input({ drops: [], day: 10, now: 200, auto: true })).collected).toBe(1);
    expect(m.take).toEqual({ dropped: { home: 1 }, collected: { home: 1 } });
  });

  it('a row not yet shown appears at its new day; one now missing never appears', () => {
    const m = boxed();
    step(m, input({ drops: [far(1, 10), far(2, 20), far(3, 30)], day: 5 }));
    const b = [far(1, 10), far(2, 25)];
    expect(step(m, input({ drops: b, day: 20 })).appeared).toBe(1);
    expect(step(m, input({ drops: b, day: 25 })).appeared).toBe(1);
    expect(step(m, input({ drops: b, day: 40 })).appeared).toBe(0);
    expect(m.take.dropped).toEqual({ home: 2 });
    expect(m.seen.has(3)).toBe(false);
  });

  it('a step while not running only removes what has ended', () => {
    const fresh = boxed();
    const r0 = step(fresh, input({ running: false, day: 100, drops: [drop(1, 0)], auto: true }));
    expect(r0).toEqual({
      started: false,
      ended: false,
      appeared: 0,
      collected: 0,
      removed: 0,
      dirty: false
    });
    expect(fresh.live).toEqual([]);

    const m = boxed();
    step(m, input({ drops: [far(1, 0)] }));
    step(m, input({ now: 100, running: false, reduced: false }));
    const r = step(m, input({ now: 300, running: false, drops: [drop(5, 0)], auto: true }));
    expect(r.appeared).toBe(0);
    expect(r.collected).toBe(0);
    expect(r.removed).toBe(0);
    expect(step(m, input({ now: 500, running: false })).removed).toBe(1);
    expect(m.take).toEqual({ dropped: { home: 1 }, collected: {} });
  });
});

describe('run model dirty and idle', () => {
  it('dirty is false for a running step with nothing new under reduced motion', () => {
    const m = boxed();
    const drops = [far(1, 0), far(2, 10)];
    expect(step(m, input({ drops })).dirty).toBe(true);
    expect(step(m, input({ drops, day: 5, now: 100 })).dirty).toBe(false);
  });

  it('dirty is true while a drop animates with motion', () => {
    const m = boxed();
    const drops = [far(1, 0)];
    step(m, input({ drops, reduced: false }));
    expect(step(m, input({ drops, now: 100, reduced: false })).dirty).toBe(true);
    expect(step(m, input({ drops, now: 100, reduced: true })).dirty).toBe(false);
    expect(step(m, input({ drops, now: 200, reduced: false })).dirty).toBe(false);
    expect(step(m, input({ drops, now: 3700, reduced: false })).dirty).toBe(true);
  });

  it('idle is true only once not running with nothing left', () => {
    const m = boxed();
    expect(idle(m)).toBe(true);
    step(m, input({ drops: [far(1, 0)] }));
    expect(idle(m)).toBe(false);
    step(m, input({ now: 100, running: false, reduced: false }));
    expect(m.running).toBe(false);
    expect(idle(m)).toBe(false);
    step(m, input({ now: 500, running: false }));
    expect(idle(m)).toBe(true);
  });

  it('reproject sets each live point from project again', () => {
    const m = boxed();
    step(m, input({ drops: [far(1, 0), drop(2, 0, 1, 700, 500)] }));
    reproject(m, (x, y) => ({ x: x + 5, y: y + 1 }));
    expect(m.live.map((l) => l.at)).toEqual([
      { x: 15, y: 11 },
      { x: 705, y: 501 }
    ]);
    reproject(m, () => null);
    expect(m.live.map((l) => l.at)).toEqual([null, null]);
  });
});
