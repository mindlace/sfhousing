// The live preview while painting on /sim (sim-ux plan 3, Task 4): a paint preview shows the
// buildings of the stroke's lots nearest the ring; a barrier drops what is still on its way; every
// rev is answered, so BrushController never waits on one.
import { describe, expect, it, vi } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import type { PackedCell } from '$lib/map/types';
import type { PlanOp } from '$lib/plan';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import type { BrushLotsResult, PreviewResult } from '$lib/sim/scenario/types';
import { StrokePreview } from './stroke-preview';

const PACK = { cellId: 'preview', parcelIds: ['a'] } as unknown as PackedCell;
const PACK_2 = { cellId: 'preview', parcelIds: ['b'] } as unknown as PackedCell;

const paintOp = (end = -122.41, stories = 8): PlanOp => ({
  kind: 'paint',
  stories,
  radiusM: 30,
  path: [
    [-122.42, 37.76],
    [end, 37.76]
  ],
  id: 's1'
});
const eraseOp: PlanOp = { kind: 'erase', radiusM: 20, path: [[-122.42, 37.76]], id: 'e1' };

const found: BrushLotsResult = {
  ok: true,
  lots: ['a', 'b', 'c'],
  points: Float64Array.from([1, 1, 2, 2, 3, 3])
};

/** A promise and its resolver. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets every pending then-callback run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const lotAsks: { q: BrushQuery; d: ReturnType<typeof deferred<BrushLotsResult>> }[] = [];
  const buildAsks: {
    lots: ParcelId[];
    stories: number;
    d: ReturnType<typeof deferred<PreviewResult>>;
  }[] = [];
  const live = vi.fn<(p: PackedCell | null) => void>();
  const release = vi.fn();
  const clear = vi.fn();
  const answered = vi.fn<(rev: number) => void>();
  const nearest = vi.fn((lots: readonly ParcelId[], _points: Float64Array, _at: [number, number]) =>
    lots.slice(0, 2)
  );
  const sp = new StrokePreview({
    resolve: (q) => {
      const d = deferred<BrushLotsResult>();
      lotAsks.push({ q, d });
      return d.promise;
    },
    buildings: (lots, stories) => {
      const d = deferred<PreviewResult>();
      buildAsks.push({ lots, stories, d });
      return d.promise;
    },
    nearest,
    live,
    release,
    clear,
    answered
  });
  return {
    sp,
    live,
    release,
    clear,
    answered,
    nearest,
    lotAsks,
    buildAsks,
    /** Answers the latest lot query, then (once asked) the latest buildings request. */
    async answerLots(r: BrushLotsResult = found) {
      await flush();
      lotAsks.at(-1)!.d.resolve(r);
      await flush();
    },
    async answerBuildings(pack: PackedCell | null = PACK) {
      buildAsks.at(-1)!.d.resolve({ ok: true, pack, built: 1, missing: 0 });
      await flush();
    }
  };
}

describe('StrokePreview', () => {
  it('a paint preview shows the buildings of the stroke lots nearest the ring and answers its rev', async () => {
    const h = harness();
    const rev = h.sp.preview(paintOp(-122.41, 8));
    expect(typeof rev).toBe('number');
    await h.answerLots();
    expect(h.lotAsks).toHaveLength(1);
    expect(h.lotAsks[0].q).toEqual({
      kind: 'freehand',
      strokes: [{ path: paintOp().path, radiusM: 30 }]
    });
    // nearest the ring: the path's last point
    expect(h.nearest).toHaveBeenCalledWith(found.lots, found.points, [-122.41, 37.76]);
    expect(h.buildAsks).toHaveLength(1);
    expect(h.buildAsks[0]).toMatchObject({ lots: ['a', 'b'], stories: 8 });
    expect(h.answered).not.toHaveBeenCalled(); // not until the buildings come back
    await h.answerBuildings();
    expect(h.live).toHaveBeenCalledWith(PACK);
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
  });

  it('a later preview replaces the buildings showing', async () => {
    const h = harness();
    h.sp.preview(paintOp());
    await h.answerLots();
    await h.answerBuildings(PACK);
    const rev = h.sp.preview(paintOp(-122.4));
    await h.answerLots();
    await h.answerBuildings(PACK_2);
    expect(h.live).toHaveBeenLastCalledWith(PACK_2);
    expect(h.answered).toHaveBeenLastCalledWith(rev);
    expect(h.clear).not.toHaveBeenCalled();
  });

  it('an answer after a barrier is dropped, and still answered', async () => {
    const h = harness();
    const rev = h.sp.preview(paintOp());
    await flush();
    h.sp.barrier(true);
    h.lotAsks.at(-1)!.d.resolve(found);
    await flush();
    expect(h.buildAsks).toHaveLength(0); // nothing more is asked for a dropped preview
    expect(h.live).not.toHaveBeenCalledWith(PACK);
    expect(h.answered).toHaveBeenCalledWith(rev);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it('release before the buildings come back: the late answer is dropped, still answered', async () => {
    // Review focus 1: nothing reappears after the fade.
    const h = harness();
    const rev = h.sp.preview(paintOp());
    await h.answerLots();
    expect(h.buildAsks).toHaveLength(1);
    const commitRev = h.sp.barrier(true);
    expect(commitRev).toBeGreaterThan(rev);
    expect(h.release).toHaveBeenCalledTimes(1);
    await h.answerBuildings(PACK);
    expect(h.live).not.toHaveBeenCalled();
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
  });

  it('a preview a barrier follows at once (the pointer-up tail) asks for nothing', async () => {
    const h = harness();
    const rev = h.sp.preview(paintOp());
    h.sp.barrier(true);
    await flush();
    expect(h.lotAsks).toHaveLength(0);
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
  });

  it('cancel clears at once; barrier(true) fades', async () => {
    // Review focus 2: a cancelled stroke clears, and its preview is still answered, so the
    // controller does not hold the next stroke's first preview.
    const h = harness();
    const rev = h.sp.preview(paintOp());
    await h.answerLots();
    const c = h.sp.cancel();
    expect(c).toBeGreaterThan(rev);
    expect(h.clear).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
    await h.answerBuildings();
    expect(h.live).not.toHaveBeenCalled();
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);

    const b = h.sp.barrier(true);
    expect(b).toBeGreaterThan(c);
    expect(h.release).toHaveBeenCalledTimes(1);
    h.sp.barrier(false);
    expect(h.clear).toHaveBeenCalledTimes(2);
  });

  it('revs keep increasing across previews, cancels and barriers', () => {
    const h = harness();
    const revs = [
      h.sp.preview(paintOp()),
      h.sp.cancel(),
      h.sp.preview(paintOp()),
      h.sp.barrier(true),
      h.sp.preview(eraseOp)
    ];
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
  });

  it('an erase preview shows nothing and is answered', async () => {
    // Review focus 3: an Erase drag shows no buildings; the controller still sees its answer.
    const h = harness();
    const rev = h.sp.preview(eraseOp);
    expect(h.answered).not.toHaveBeenCalled(); // in a microtask, not inside preview()
    await flush();
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
    expect(h.lotAsks).toHaveLength(0);
    expect(h.buildAsks).toHaveLength(0);
    expect(h.live).not.toHaveBeenCalled();
  });

  it('a failed resolve is answered and shows nothing', async () => {
    const h = harness();
    const rev = h.sp.preview(paintOp());
    await h.answerLots({ ok: false, reason: 'no-session', message: 'x' });
    expect(h.buildAsks).toHaveLength(0);
    expect(h.live).not.toHaveBeenCalled();
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
  });

  it('a failed buildings request, or a rejected one, is answered and shows nothing', async () => {
    const h = harness();
    const rev = h.sp.preview(paintOp());
    await h.answerLots();
    h.buildAsks.at(-1)!.d.resolve({ ok: false, reason: 'no-session', message: 'x' });
    await flush();
    expect(h.answered).toHaveBeenLastCalledWith(rev);
    // A rejection (a bug, not a result) still answers.
    const sp = new StrokePreview({
      resolve: () => Promise.reject(new Error('boom')),
      buildings: () => Promise.reject(new Error('boom')),
      nearest: (l) => [...l],
      live: h.live,
      release: h.release,
      clear: h.clear,
      answered: h.answered
    });
    const rev3 = sp.preview(paintOp());
    await flush();
    expect(h.answered).toHaveBeenLastCalledWith(rev3);
    expect(h.live).not.toHaveBeenCalled();
  });

  it('no lots near the ring shows nothing (clears) and asks for no buildings', async () => {
    const h = harness();
    h.nearest.mockReturnValueOnce([]);
    const rev = h.sp.preview(paintOp());
    await h.answerLots();
    expect(h.buildAsks).toHaveLength(0);
    expect(h.live).toHaveBeenCalledExactlyOnceWith(null);
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
  });

  it('reset drops answers on their way and clears', async () => {
    // Review focus 4: Run mid-stroke or during the fade.
    const h = harness();
    const rev = h.sp.preview(paintOp());
    await h.answerLots();
    h.sp.reset();
    expect(h.clear).toHaveBeenCalledTimes(1);
    await h.answerBuildings();
    expect(h.live).not.toHaveBeenCalled();
    expect(h.answered).toHaveBeenCalledExactlyOnceWith(rev);
    // a rev after the reset is still above the dropped one
    expect(h.sp.preview(paintOp())).toBeGreaterThan(rev);
  });
});
