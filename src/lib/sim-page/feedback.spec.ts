// Paint feedback (map overlays plan 2, Task 6): the fade curve, the layer's lifetime, the rule
// trigger and the nearest-first lot pick.
import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import type { LeverLookups } from '$lib/sim/levers/apply';
import type { PackedCell } from '$lib/map/types';
import {
  FEEDBACK_FADE_MS,
  FEEDBACK_HOLD_MS,
  PaintFeedback,
  RuleFeedbackTrigger,
  feedbackOpacity,
  lotsInView,
  mergeLots
} from './feedback';
import type { LeverStatus } from './lever-status';

const PACK_A = { cellId: 'preview', parcelIds: ['a'] } as unknown as PackedCell;
const PACK_B = { cellId: 'preview', parcelIds: ['b'] } as unknown as PackedCell;

interface FakeLayer {
  id: string;
  pack: PackedCell;
  opacity: number;
}

/** A fake clock and frame loop: `tick(ms)` runs a frame every 16 ms up to `ms` later. */
function harness(reduced = false) {
  let clock = 0;
  let seq = 0;
  const frames = new Map<number, () => void>();
  const sets: FakeLayer[][] = [];
  const fb = new PaintFeedback({
    set: (layers) => sets.push(layers as unknown as FakeLayer[]),
    layer: (pack, opacity, id) => ({ id, pack, opacity }) as unknown as Layer,
    now: () => clock,
    raf: (cb) => {
      frames.set(++seq, cb);
      return seq;
    },
    cancelRaf: (h) => void frames.delete(h),
    reducedMotion: () => reduced
  });
  return {
    fb,
    sets,
    frames: () => frames.size,
    tick(ms: number) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + 16);
        const due = [...frames];
        frames.clear();
        for (const [, cb] of due) cb();
      }
    },
    lastLayers: () => sets.at(-1),
    lastPack: () => sets.at(-1)?.[0]?.pack
  };
}

const current = (rev: number): LeverStatus => ({
  kind: 'current',
  rev,
  lookups: {} as LeverLookups,
  capacity: {} as LeverCapacity
});

describe('feedbackOpacity', () => {
  it('holds, fades and removes', () => {
    expect(feedbackOpacity(0, false)).toBe(1);
    expect(feedbackOpacity(FEEDBACK_HOLD_MS, false)).toBe(1);
    expect(feedbackOpacity(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS / 2, false)).toBeCloseTo(0.5, 6);
    expect(feedbackOpacity(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS, false)).toBeNull();
    expect(feedbackOpacity(FEEDBACK_HOLD_MS + 1, true)).toBe(1);
    expect(feedbackOpacity(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS, true)).toBeNull();
  });
});

describe('PaintFeedback', () => {
  it('a new show replaces the old; the layer is cleared at the end', () => {
    const f = harness();
    f.fb.show(PACK_A);
    f.tick(300);
    f.fb.show(PACK_B);
    expect(f.lastPack()).toBe(PACK_B);
    f.tick(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS);
    expect(f.lastLayers()).toEqual([]);
    expect(f.frames()).toBe(0);
  });

  it('fades through the layer opacity, ids sim-feedback-<n>', () => {
    const f = harness();
    f.fb.show(PACK_A);
    expect(f.lastLayers()).toEqual([{ id: 'sim-feedback-1', pack: PACK_A, opacity: 1 }]);
    f.tick(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS / 2);
    const o = f.lastLayers()![0].opacity;
    expect(o).toBeGreaterThan(0.4);
    expect(o).toBeLessThan(0.6);
    f.fb.show(PACK_B);
    expect(f.lastLayers()![0].id).toBe('sim-feedback-2');
  });

  it('under reduced motion: one full-strength layer, then cleared', () => {
    const f = harness(true);
    f.fb.show(PACK_A);
    f.tick(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS - 20);
    expect(f.sets).toEqual([[{ id: 'sim-feedback-1', pack: PACK_A, opacity: 1 }]]);
    f.tick(40);
    expect(f.lastLayers()).toEqual([]);
  });

  it('show(null) and destroy clear at once', () => {
    const f = harness();
    f.fb.show(PACK_A);
    f.fb.show(null);
    expect(f.lastLayers()).toEqual([]);
    expect(f.frames()).toBe(0);
    f.fb.show(PACK_B);
    f.fb.destroy();
    expect(f.lastLayers()).toEqual([]);
    f.fb.show(PACK_A); // ignored after destroy
    expect(f.lastLayers()).toEqual([]);
  });
});

describe('RuleFeedbackTrigger', () => {
  it('the rule trigger fires once, on a current above the save', () => {
    const t = new RuleFeedbackTrigger();
    t.status({ kind: 'resolving', rev: 4, done: 0, total: 0, failedCells: [] });
    t.saved('r1');
    expect(t.status(current(4))).toBeNull(); // the revision sent before the save
    t.status({ kind: 'resolving', rev: 5, done: 0, total: 0, failedCells: [] });
    expect(t.status(current(5))).toBe('r1');
    expect(t.status(current(6))).toBeNull();
  });

  it('reset disarms; off is ignored', () => {
    const t = new RuleFeedbackTrigger();
    t.status(current(2));
    t.saved('r1');
    expect(t.status({ kind: 'off' })).toBeNull();
    t.reset();
    expect(t.status(current(3))).toBeNull();
  });
});

describe('lotsInView', () => {
  it('nearest first: lotsInView keeps in-view lots, nearest the centre, up to max', () => {
    const pts = new Float64Array([0.5, 0.5, 0.1, 0.1, 2, 2, 0.45, 0.5]);
    expect(lotsInView(['a', 'b', 'out', 'c'], pts, [0, 0, 1, 1], [0.5, 0.5], 2)).toEqual([
      'a',
      'c'
    ]);
    expect(lotsInView(['a', 'b', 'out', 'c'], pts, [0, 0, 1, 1], [0.5, 0.5], 9)).toEqual([
      'a',
      'c',
      'b'
    ]);
  });
});

describe('mergeLots', () => {
  it('each lot once with its point; failed and unknown results skipped', () => {
    const m = mergeLots([
      { ok: true, lots: ['a', 'b'], points: new Float64Array([1, 2, 3, 4]) },
      undefined,
      { ok: false, reason: 'data-missing', message: 'x' },
      { ok: true, lots: ['b', 'c'], points: new Float64Array([9, 9, 5, 6]) }
    ]);
    expect(m.lots).toEqual(['a', 'b', 'c']);
    expect([...m.points]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
