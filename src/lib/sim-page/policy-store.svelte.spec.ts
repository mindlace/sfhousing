// PolicyStore (undo and redo over the recipe) and LeverSync (resolve every brush query, compile,
// debounce, send): the latest recipe alone reaches the worker (Review Focus 2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import { DEFAULT_LEVERS, type SimLevers } from '$lib/sim/levers/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { policyFromLevers, queryKey, type SimPolicy, type ZoningBrush } from './policy';
import { LeverSync, PolicyStore } from './policy-store.svelte';

const BASE = policyFromLevers(DEFAULT_LEVERS);

function area(district: string, stories = 4): ZoningBrush {
  return {
    id: `b-${district}-${stories}`,
    kind: 'area',
    districts: [district],
    neighborhoods: [],
    effect: { mode: 'raise', stories, densityLimits: false }
  } as ZoningBrush;
}
const withBrushes = (...brushes: ZoningBrush[]): SimPolicy => ({ ...BASE, brushes });
const areaQuery = (district: string): BrushQuery => ({
  kind: 'area',
  districts: [district],
  neighborhoods: []
});
const ok = (lots: string[]): BrushLotsResult => ({
  ok: true,
  lots,
  points: new Float64Array(lots.length * 2)
});
const failed: BrushLotsResult = { ok: false, reason: 'data-missing', message: 'no frontage' };
const noSession: BrushLotsResult = { ok: false, reason: 'no-session', message: 'gone' };

type Resolver = (r: BrushLotsResult) => void;

function harness(answer?: (q: BrushQuery) => BrushLotsResult) {
  const pending: { q: BrushQuery; resolve: Resolver }[] = [];
  const sent: SimLevers[] = [];
  const resolve = vi.fn((q: BrushQuery) =>
    answer
      ? Promise.resolve(answer(q))
      : new Promise<BrushLotsResult>((res) => pending.push({ q, resolve: res }))
  );
  const sync = new LeverSync({
    resolve,
    send: (l) => sent.push(l),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  return { sync, sent, resolve, pending };
}

describe('PolicyStore', () => {
  it('undo and redo restore the policy and return labels', () => {
    const store = new PolicyStore(BASE);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.undo()).toBeNull();
    store.apply((p) => ({ ...p, brushes: [area('RH-1')] }), 'Raised RH-1 to 4 stories');
    const one = store.policy;
    store.apply((p) => ({ ...p, compare: 'preFzp' }), 'Compared with the old zoning');
    expect(store.canUndo).toBe(true);
    expect(store.undo()).toBe('Compared with the old zoning');
    expect(store.policy).toBe(one);
    expect(store.canRedo).toBe(true);
    expect(store.undo()).toBe('Raised RH-1 to 4 stories');
    expect(store.policy).toBe(BASE);
    expect(store.canUndo).toBe(false);
    expect(store.redo()).toBe('Raised RH-1 to 4 stories');
    expect(store.policy).toBe(one);
    expect(store.redo()).toBe('Compared with the old zoning');
    expect(store.policy.compare).toBe('preFzp');
    expect(store.redo()).toBeNull();
  });

  it('a new change clears redo', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => ({ ...p, brushes: [area('RH-1')] }), 'a');
    store.undo();
    expect(store.canRedo).toBe(true);
    store.apply((p) => ({ ...p, brushes: [area('RH-2')] }), 'b');
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBeNull();
  });

  it('a change that returns the same policy is not recorded', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => p, 'nothing');
    expect(store.canUndo).toBe(false);
  });
});

describe('LeverSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('only the latest recipe is sent', async () => {
    const h = harness((q) => ok(q.kind === 'area' ? [`lot-${q.districts[0]}`] : []));
    // Five changes 40 ms apart, all inside one 250 ms window of the one before.
    for (const [i, d] of ['RH-1', 'RH-2', 'RH-3', 'RM-1', 'RM-2'].entries()) {
      if (i > 0) await vi.advanceTimersByTimeAsync(40);
      h.sync.update(withBrushes(area(d)));
    }
    expect(h.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(249);
    expect(h.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].user).toEqual([
      { lots: ['lot-RM-2'], mode: 'raise', stories: 4, densityLimits: false }
    ]);
    expect(h.sync.levers).toBe(h.sent[0]);
  });

  it('a query still in flight holds the send until it resolves', async () => {
    const h = harness();
    h.sync.update(withBrushes(area('RH-1')));
    expect(h.sync.resolving).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sent).toEqual([]);
    h.pending[0].resolve(ok(['a', 'b']));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.resolving).toBe(0);
    expect(h.sync.result(queryKey(areaQuery('RH-1')))).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].user[0].lots).toEqual(['a', 'b']);
  });

  it('a query asked once is cached across updates', async () => {
    const h = harness((q) => ok(q.kind === 'area' ? [q.districts[0]] : []));
    h.sync.update(withBrushes(area('RH-1')));
    await vi.advanceTimersByTimeAsync(0);
    h.sync.update(withBrushes(area('RH-1', 6)));
    h.sync.update(withBrushes(area('RH-1', 8)));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].user[0].stories).toBe(8);
  });

  it('a failed query sends nothing until retry succeeds', async () => {
    const h = harness();
    const key = queryKey(areaQuery('RH-1'));
    h.sync.update(withBrushes(area('RH-1')));
    h.pending[0].resolve(failed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sent).toEqual([]);
    expect(h.sync.result(key)).toEqual(failed);
    // Another update does not ask again by itself: the failure stands until Retry.
    h.sync.update(withBrushes(area('RH-1', 6)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual([]);

    h.sync.retry(key);
    expect(h.resolve).toHaveBeenCalledTimes(2);
    expect(h.sync.result(key)).toBeUndefined();
    expect(h.sync.resolving).toBe(1);
    h.pending[1].resolve(ok(['x']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].user).toEqual([
      { lots: ['x'], mode: 'raise', stories: 6, densityLimits: false }
    ]);
  });

  it('a policy with no brushes compiles at once, after the debounce', async () => {
    const h = harness();
    h.sync.update({ ...BASE, compare: 'preFzp' });
    expect(h.resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].compare).toBe('preFzp');
  });

  it('a superseded query answering late does not send the old recipe', async () => {
    const h = harness();
    h.sync.update(withBrushes(area('RH-1')));
    h.sync.update(withBrushes(area('RH-2')));
    h.pending[1].resolve(ok(['two']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].user[0].lots).toEqual(['two']);
    h.pending[0].resolve(ok(['one']));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sent).toHaveLength(1);
    expect(h.sync.result(queryKey(areaQuery('RH-1')))).toMatchObject({ ok: true });
  });

  it('a bad-request answer also stands until retry', async () => {
    const h = harness();
    const key = queryKey(areaQuery('RH-1'));
    h.sync.update(withBrushes(area('RH-1')));
    h.pending[0].resolve({ ok: false, reason: 'bad-request', message: 'x' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.result(key)).toMatchObject({ reason: 'bad-request' });
    h.sync.resume();
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual([]);
  });

  it('no-session is not a failure: the query waits for resume, then sends', async () => {
    const h = harness();
    const key = queryKey(areaQuery('RH-1'));
    h.sync.update(withBrushes(area('RH-1')));
    h.pending[0].resolve(noSession);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.result(key)).toBeUndefined();
    expect(h.sync.resolving).toBe(0);
    expect(h.sent).toEqual([]);
    // Not asked again before the session is back, however often the recipe changes.
    h.sync.update(withBrushes(area('RH-1', 6)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.resolve).toHaveBeenCalledTimes(1);

    h.sync.resume();
    expect(h.resolve).toHaveBeenCalledTimes(2);
    h.pending[1].resolve(ok(['a']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].user[0]).toMatchObject({ lots: ['a'], stories: 6 });
  });

  it('a no-session answer to a query asked before resume is asked again at once', async () => {
    const h = harness();
    h.sync.update(withBrushes(area('RH-1')));
    h.sync.resume(); // a new session started while the old one still held the query
    h.pending[0].resolve(noSession);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resolve).toHaveBeenCalledTimes(2);
    h.pending[1].resolve(ok(['b']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
  });
});
