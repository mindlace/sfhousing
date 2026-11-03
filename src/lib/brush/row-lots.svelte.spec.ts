import { describe, expect, it } from 'vitest';
import type { PlanRowGroup } from '$lib/paint/rows';
import type { LotOutlines } from '$lib/sim/outlines';
import type { OpLotsResult } from '$lib/sim/protocol';
import { RowLots } from './row-lots.svelte';

interface Call {
  opIds: string[];
  outlines: boolean;
  resolve(r: OpLotsResult | null): void;
}

function setup() {
  const calls: Call[] = [];
  const rl = new RowLots({
    request: (opIds, outlines) =>
      new Promise<OpLotsResult | null>((resolve) => calls.push({ opIds, outlines, resolve }))
  });
  return { rl, calls };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const g = (id: string, ...rest: string[]): PlanRowGroup => ({
  id,
  kind: 'paint',
  stories: 8,
  opIds: [id, ...rest]
});
const answer = (lots: number, missing = 0, outline: LotOutlines | null = null): OpLotsResult => ({
  lots,
  missing,
  outline
});
const outlineOf = (...lots: string[]): LotOutlines => ({
  lots,
  ringLot: Uint32Array.from(lots.map((_, i) => i)),
  starts: Uint32Array.from([0, ...lots.map((_, i) => 4 * (i + 1))]),
  positions: new Float64Array(8 * lots.length)
});
/** Answers the oldest unanswered call and lets the next request go out. */
async function reply(calls: Call[], from: number, r: OpLotsResult | null) {
  calls[from].resolve(r);
  await settle();
}

describe('RowLots', () => {
  it('asks once per changed row, one request in flight at a time', async () => {
    const { rl, calls } = setup();
    rl.want([g('a', 'b'), g('c'), g('d')]);
    await settle();
    expect(calls.map((c) => c.opIds)).toEqual([['a', 'b']]);
    expect(calls[0].outlines).toBe(false);
    expect(rl.status('a')).toEqual({ kind: 'finding' });
    await reply(calls, 0, answer(5));
    expect(calls.map((c) => c.opIds)).toEqual([['a', 'b'], ['c']]);
    await reply(calls, 1, answer(2));
    await reply(calls, 2, answer(0));
    expect(calls).toHaveLength(3);
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 5 });
    expect(rl.status('c')).toEqual({ kind: 'found', lots: 2 });
    expect(rl.status('d')).toEqual({ kind: 'found', lots: 0 });
  });

  it('does not ask again for an unchanged row, and asks again for a growing last row', async () => {
    const { rl, calls } = setup();
    rl.want([g('a'), g('c')]);
    await settle();
    await reply(calls, 0, answer(1));
    await reply(calls, 1, answer(2));
    rl.want([g('a'), g('c')]);
    await settle();
    expect(calls).toHaveLength(2);
    rl.want([g('a'), g('c', 'x')]);
    await settle();
    expect(calls.map((c) => c.opIds)).toEqual([['a'], ['c'], ['c', 'x']]);
    // The grown row's old count is stale: it shows 'finding' until its new answer.
    expect(rl.status('c')).toEqual({ kind: 'finding' });
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 1 });
    await reply(calls, 2, answer(3));
    expect(rl.status('c')).toEqual({ kind: 'found', lots: 3 });
  });

  it('shows Finding lots while chunks are missing, asks again on each chunks message, then the count', async () => {
    const { rl, calls } = setup();
    rl.want([g('a')]);
    await settle();
    await reply(calls, 0, answer(3, 2));
    expect(rl.status('a')).toEqual({ kind: 'finding' });

    rl.chunksChanged();
    await settle();
    expect(calls).toHaveLength(2);
    await reply(calls, 1, answer(6, 1));
    expect(rl.status('a')).toEqual({ kind: 'finding' });

    rl.chunksChanged();
    await settle();
    expect(calls).toHaveLength(3);
    await reply(calls, 2, answer(7, 0));
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 7 });

    rl.chunksChanged(); // nothing missing any more: no new request
    await settle();
    expect(calls).toHaveLength(3);
  });

  it('a chunks message while a row is in flight asks that row again if it came back missing lots', async () => {
    const { rl, calls } = setup();
    rl.want([g('a')]);
    await settle();
    rl.chunksChanged(); // the first answer is already out of date
    await settle();
    expect(calls).toHaveLength(1);
    await reply(calls, 0, answer(3, 1));
    expect(calls).toHaveLength(2);
    await reply(calls, 1, answer(4, 0));
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 4 });
    expect(calls).toHaveLength(2);
  });

  it('keeps a row Finding after a null answer and asks again on a chunks message', async () => {
    const { rl, calls } = setup();
    rl.want([g('a')]);
    await settle();
    await reply(calls, 0, null);
    expect(rl.status('a')).toEqual({ kind: 'finding' });
    rl.chunksChanged();
    await settle();
    expect(calls).toHaveLength(2);
    await reply(calls, 1, answer(2));
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 2 });
  });

  it('treats an unknown row as finding', () => {
    const { rl } = setup();
    expect(rl.status('nope')).toEqual({ kind: 'finding' });
    expect(rl.outline).toBeNull();
  });

  it('select asks with outlines true and exposes the outline; another row or null clears it', async () => {
    const { rl, calls } = setup();
    rl.want([g('a'), g('c')]);
    await settle();
    await reply(calls, 0, answer(2));
    await reply(calls, 1, answer(3));
    expect(rl.outline).toBeNull();

    rl.select('c');
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ opIds: ['c'], outlines: true });
    const o = outlineOf('1', '2', '3');
    await reply(calls, 2, answer(3, 0, o));
    expect(rl.outline).toBe(o);
    expect(rl.status('c')).toEqual({ kind: 'found', lots: 3 });

    rl.select('a');
    expect(rl.outline).toBeNull(); // the old row's outline goes at once
    await settle();
    expect(calls[3]).toMatchObject({ opIds: ['a'], outlines: true });
    const o2 = outlineOf('9');
    await reply(calls, 3, answer(2, 0, o2));
    expect(rl.outline).toBe(o2);

    rl.select(null);
    expect(rl.outline).toBeNull();
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 2 });
    await settle();
    expect(calls).toHaveLength(4);
  });

  it('selecting a row already answered with its outline asks nothing new', async () => {
    const { rl, calls } = setup();
    rl.want([g('a')]);
    rl.select('a');
    await settle();
    expect(calls[0]).toMatchObject({ opIds: ['a'], outlines: true });
    const o = outlineOf('1');
    await reply(calls, 0, answer(1, 0, o));
    rl.select('a');
    await settle();
    expect(calls).toHaveLength(1);
    expect(rl.outline).toBe(o);
  });

  it('the selected row is asked first, and again with outlines when it grows or chunks arrive', async () => {
    const { rl, calls } = setup();
    rl.want([g('a'), g('c')]);
    await settle(); // a in flight
    rl.select('c');
    await reply(calls, 0, answer(1));
    expect(calls[1]).toMatchObject({ opIds: ['c'], outlines: true });
    await reply(calls, 1, answer(2, 1, outlineOf('1')));
    expect(rl.status('c')).toEqual({ kind: 'finding' });
    expect(rl.outline?.lots).toEqual(['1']); // partial outline while lots are missing
    rl.chunksChanged();
    await settle();
    expect(calls[2]).toMatchObject({ opIds: ['c'], outlines: true });
    await reply(calls, 2, answer(3, 0, outlineOf('1', '2', '3')));
    rl.want([g('a'), g('c', 'x')]);
    await settle();
    expect(calls[3]).toMatchObject({ opIds: ['c', 'x'], outlines: true });
  });

  it('drops an answer for a row that has changed since it was asked', async () => {
    const { rl, calls } = setup();
    rl.want([g('a')]);
    await settle();
    rl.want([g('a', 'b')]); // grows while the first request is out
    await settle();
    expect(calls).toHaveLength(1); // one in flight
    await reply(calls, 0, answer(9)); // stale: dropped
    expect(rl.status('a')).toEqual({ kind: 'finding' });
    expect(calls).toHaveLength(2);
    expect(calls[1].opIds).toEqual(['a', 'b']);
    await reply(calls, 1, answer(11));
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 11 });
  });

  it('forgets rows that are gone, drops their answers and their selection', async () => {
    const { rl, calls } = setup();
    rl.want([g('a'), g('c')]);
    await settle();
    rl.select('c');
    await reply(calls, 0, answer(1));
    expect(calls[1]).toMatchObject({ opIds: ['c'], outlines: true });
    await reply(calls, 1, answer(2, 0, outlineOf('1', '2')));
    expect(rl.outline).not.toBeNull();
    rl.want([g('a')]);
    expect(rl.outline).toBeNull();
    expect(rl.status('c')).toEqual({ kind: 'finding' });
    rl.chunksChanged();
    await settle();
    expect(calls).toHaveLength(2); // c is not asked again
  });

  it('does not ask for a gone row that was still queued', async () => {
    const { rl, calls } = setup();
    rl.want([g('a'), g('c'), g('d')]);
    await settle();
    rl.want([g('a'), g('d')]);
    await reply(calls, 0, answer(1));
    expect(calls.map((c) => c.opIds)).toEqual([['a'], ['d']]);
  });

  it('reset asks every row again and ignores answers to the old requests', async () => {
    const { rl, calls } = setup();
    rl.want([g('a'), g('c')]);
    await settle();
    await reply(calls, 0, answer(1));
    await reply(calls, 1, answer(2));
    rl.reset();
    expect(rl.status('a')).toEqual({ kind: 'finding' });
    await settle();
    expect(calls.map((c) => c.opIds)).toEqual([['a'], ['c'], ['a']]);
    await reply(calls, 2, answer(4));
    expect(calls.map((c) => c.opIds)).toEqual([['a'], ['c'], ['a'], ['c']]);
    await reply(calls, 3, answer(5));
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 4 });
    expect(rl.status('c')).toEqual({ kind: 'found', lots: 5 });
  });

  it('reset while a request is out drops its answer', async () => {
    const { rl, calls } = setup();
    rl.want([g('a')]);
    await settle();
    rl.reset();
    await reply(calls, 0, answer(99)); // from the old worker
    expect(rl.status('a')).toEqual({ kind: 'finding' });
    expect(calls).toHaveLength(2);
    await reply(calls, 1, answer(3));
    expect(rl.status('a')).toEqual({ kind: 'found', lots: 3 });
  });

  it('a request that rejects leaves the row Finding and does not stall the queue', async () => {
    const rl = new RowLots({
      request: (opIds) =>
        opIds[0] === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve(answer(2))
    });
    rl.want([g('a'), g('c')]);
    await settle();
    expect(rl.status('a')).toEqual({ kind: 'finding' });
    expect(rl.status('c')).toEqual({ kind: 'found', lots: 2 });
  });
});
