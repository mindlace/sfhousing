// The live preview's layer on /sim (sim-ux plan 3, Task 4): full strength while painting, a fade
// on release, and the nearest-first lot pick.
import { describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import type { PackedCell } from '$lib/map/types';
import { FEEDBACK_FADE_MS, PaintFeedback, lotsInView } from './feedback';

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
    lastLayers: () => sets.at(-1)
  };
}

describe('PaintFeedback', () => {
  it('live shows one layer at full strength with no frame loop; a new live replaces it', () => {
    const f = harness();
    expect(f.fb.state).toBe('none');
    f.fb.live(PACK_A);
    expect(f.fb.state).toBe('live');
    expect(f.sets).toEqual([[{ id: 'sim-feedback-1', pack: PACK_A, opacity: 1 }]]);
    expect(f.frames()).toBe(0);
    f.tick(5000); // no timer: it stays until released
    expect(f.sets).toHaveLength(1);
    f.fb.live(PACK_B);
    expect(f.lastLayers()).toEqual([{ id: 'sim-feedback-2', pack: PACK_B, opacity: 1 }]);
    f.fb.live(null);
    expect(f.lastLayers()).toEqual([]);
    expect(f.fb.state).toBe('none');
  });

  it('release fades the opacity linearly, removing the layer at FEEDBACK_FADE_MS', () => {
    const f = harness();
    f.fb.live(PACK_A);
    f.fb.release();
    expect(f.fb.state).toBe('fading');
    f.tick(FEEDBACK_FADE_MS / 4);
    expect(f.lastLayers()![0].opacity).toBeCloseTo(0.75, 1);
    expect(f.lastLayers()![0].id).toBe('sim-feedback-1');
    f.tick(FEEDBACK_FADE_MS / 4);
    expect(f.lastLayers()![0].opacity).toBeCloseTo(0.5, 1);
    const opacities = f.sets.map((l) => l[0].opacity);
    expect(opacities).toEqual([...opacities].sort((a, b) => b - a));
    f.tick(FEEDBACK_FADE_MS / 2);
    expect(f.lastLayers()).toEqual([]);
    expect(f.fb.state).toBe('none');
    expect(f.frames()).toBe(0);
  });

  it('release under reduced motion clears at once', () => {
    const f = harness(true);
    f.fb.live(PACK_A);
    f.fb.release();
    expect(f.lastLayers()).toEqual([]);
    expect(f.fb.state).toBe('none');
    expect(f.frames()).toBe(0);
  });

  it('live during a fade stops it; release with nothing live does nothing', () => {
    const f = harness();
    f.fb.release();
    expect(f.sets).toEqual([]);
    expect(f.fb.state).toBe('none');
    f.fb.live(PACK_A);
    f.fb.release();
    f.tick(300);
    f.fb.live(PACK_B);
    expect(f.fb.state).toBe('live');
    expect(f.frames()).toBe(0);
    expect(f.lastLayers()).toEqual([{ id: 'sim-feedback-2', pack: PACK_B, opacity: 1 }]);
    f.tick(FEEDBACK_FADE_MS * 2);
    expect(f.lastLayers()).toEqual([{ id: 'sim-feedback-2', pack: PACK_B, opacity: 1 }]);
  });

  it('a second release keeps the fade going from where it was', () => {
    const f = harness();
    f.fb.live(PACK_A);
    f.fb.release();
    f.tick(FEEDBACK_FADE_MS / 2);
    f.fb.release();
    f.tick(FEEDBACK_FADE_MS / 2);
    expect(f.lastLayers()).toEqual([]);
    expect(f.fb.state).toBe('none');
  });

  it('clear and destroy clear at once', () => {
    const f = harness();
    f.fb.live(PACK_A);
    f.fb.release();
    f.tick(100);
    f.fb.clear();
    expect(f.lastLayers()).toEqual([]);
    expect(f.fb.state).toBe('none');
    expect(f.frames()).toBe(0);
    f.fb.live(PACK_B);
    f.fb.destroy();
    expect(f.lastLayers()).toEqual([]);
    f.fb.live(PACK_A); // ignored after destroy
    expect(f.lastLayers()).toEqual([]);
    expect(f.fb.state).toBe('none');
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
