import { describe, expect, it } from 'vitest';
import {
  RING_KEYS,
  RING_KEY_DIR,
  RUN_CAPS,
  RUN_TIMES,
  createRun,
  nudgeRing,
  pointRing,
  setBox,
  sweepHits
} from './run-model';

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
