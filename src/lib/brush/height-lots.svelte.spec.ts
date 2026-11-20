import { describe, expect, it } from 'vitest';
import type { HeightLotsResult } from '$lib/sim/protocol';
import type { LotOutlines } from '$lib/sim/outlines';
import { HeightLots } from './height-lots.svelte';

/** A recording `ask`: every request in order, each answered when the test says. */
function asker() {
  const asks: { outlineOf: number | null; answer(r: HeightLotsResult | null): Promise<void> }[] =
    [];
  const ask = (outlineOf: number | null) =>
    new Promise<HeightLotsResult | null>((resolve) => {
      asks.push({
        outlineOf,
        async answer(r) {
          resolve(r);
          await Promise.resolve(); // the requester's `then` runs
          await Promise.resolve();
        }
      });
    });
  return { ask, asks };
}
const outline = (lots: string[]): LotOutlines => ({
  lots,
  ringLot: new Uint32Array(),
  starts: new Uint32Array([0]),
  positions: new Float64Array()
});
const result = (lots: number, missing = 0, o: LotOutlines | null = null): HeightLotsResult => ({
  heights: [{ stories: 6, lots, rebuilt: lots }],
  missing,
  outline: o
});

describe('HeightLots', () => {
  it('latest wins: an older answer after a newer request is dropped', async () => {
    const { ask, asks } = asker();
    const h = new HeightLots(ask);
    expect(h.result).toBeNull();
    h.planChanged();
    h.planChanged();
    expect(asks.map((a) => a.outlineOf)).toEqual([null, null]);
    await asks[1].answer(result(5));
    expect(h.result).toEqual(result(5));
    await asks[0].answer(result(99)); // older: dropped
    expect(h.result).toEqual(result(5));
  });

  it('a fresh plan clears the counts until its answer; an edit keeps them', async () => {
    const { ask, asks } = asker();
    const h = new HeightLots(ask);
    h.planChanged();
    await asks[0].answer(result(5));
    h.planChanged();
    expect(h.result).toEqual(result(5));
    h.planChanged(true);
    expect(h.result).toBeNull();
    await asks[2].answer(result(1));
    expect(h.result).toEqual(result(1));
  });

  it('asks again on chunks only while something is missing', async () => {
    const { ask, asks } = asker();
    const h = new HeightLots(ask);
    h.chunksChanged(); // nothing asked yet: nothing to refresh
    expect(asks).toHaveLength(0);
    h.planChanged();
    await asks[0].answer(result(2, 3));
    h.chunksChanged();
    expect(asks).toHaveLength(2);
    await asks[1].answer(result(4, 0));
    h.chunksChanged();
    h.chunksChanged();
    expect(asks).toHaveLength(2);
    expect(h.result).toEqual(result(4, 0));
  });

  it('show(h) asks for that outline; show(null) clears it without a request', async () => {
    const { ask, asks } = asker();
    const h = new HeightLots(ask);
    h.planChanged();
    await asks[0].answer(result(2));
    h.show(6);
    expect(asks.map((a) => a.outlineOf)).toEqual([null, 6]);
    await asks[1].answer(result(2, 0, outline(['a', 'b'])));
    expect(h.outline?.lots).toEqual(['a', 'b']);
    // While shown, a plan change asks with the outline again.
    h.planChanged();
    expect(asks[2].outlineOf).toBe(6);
    h.show(null);
    expect(asks).toHaveLength(3);
    expect(h.outline).toBeNull();
    // The reply to the request made while shown keeps its counts, not its outline.
    await asks[2].answer(result(3, 0, outline(['a'])));
    expect(h.result).toEqual(result(3, 0, outline(['a'])));
    expect(h.outline).toBeNull();
    // A null answer (no worker state) clears both.
    h.show(6);
    await asks[3].answer(null);
    expect(h.result).toBeNull();
    expect(h.outline).toBeNull();
  });
});
