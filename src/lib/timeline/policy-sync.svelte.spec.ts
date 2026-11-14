// PolicySync: the lots of the latest schema 4 document (resolve every brush query, debounce 250 ms).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { PolicySync } from './policy-sync.svelte';
import { DEFAULT_POLICY4, queriesOf4, type Policy, type SimPolicy4 } from './policy4';

const transit = (id: string, maxM: number): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [{ from: 10, to: null, what: { tag: 'bands', bands: [{ maxM, stories: 5 }] } }]
});
const doc = (...zoning: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money: [] }
});
const ok = (lots: string[]): BrushLotsResult => ({
  ok: true,
  lots,
  points: new Float64Array(lots.length * 2)
});
const failed: BrushLotsResult = { ok: false, reason: 'data-missing', message: 'no transit' };
const noSession: BrushLotsResult = { ok: false, reason: 'no-session', message: 'gone' };

function harness(answer?: (q: BrushQuery) => BrushLotsResult) {
  const pending: { q: BrushQuery; resolve: (r: BrushLotsResult) => void }[] = [];
  const resolve = vi.fn((q: BrushQuery) =>
    answer
      ? Promise.resolve(answer(q))
      : new Promise<BrushLotsResult>((res) => pending.push({ q, resolve: res }))
  );
  const sync = new PolicySync({
    resolve,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  return { sync, resolve, pending };
}

describe('PolicySync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lots are null while debouncing, then the 250 ms send has every query key', async () => {
    const h = harness(() => ok(['lot']));
    const d = doc(transit('a', 100), transit('b', 200));
    h.sync.update(d);
    expect(h.sync.lots).toBeNull();
    await vi.advanceTimersByTimeAsync(249);
    expect(h.sync.lots).toBeNull();
    expect(h.sync.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const keys = queriesOf4(d).map((q) => q.key);
    expect(Object.keys(h.sync.lots!).sort()).toEqual([...keys].sort());
    expect(h.sync.pending).toBe(false);
  });

  it('each settle is a new object; a newer update restarts the debounce', async () => {
    const h = harness(() => ok(['x']));
    h.sync.update(doc(transit('a', 100)));
    await vi.advanceTimersByTimeAsync(250);
    const first = h.sync.lots;
    h.sync.update(doc(transit('a', 100)));
    expect(h.sync.lots).toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sync.lots).not.toBe(first);
    expect(h.sync.lots).toEqual(first);
  });

  it('a query still in flight holds the settle until it resolves', async () => {
    const h = harness();
    const d = doc(transit('a', 100));
    h.sync.update(d);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.pending).toBe(true);
    expect(h.sync.lots).toBeNull();
    h.pending[0].resolve(ok(['a', 'b']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sync.lots).toEqual({ [queriesOf4(d)[0].key]: ['a', 'b'] });
  });

  it("a superseded query answering late does not settle the old document's lots", async () => {
    const h = harness();
    const one = doc(transit('a', 100));
    const two = doc(transit('a', 200));
    h.sync.update(one);
    h.sync.update(two);
    h.pending[1].resolve(ok(['two']));
    await vi.advanceTimersByTimeAsync(250);
    const settled = h.sync.lots;
    expect(settled).toEqual({ [queriesOf4(two)[0].key]: ['two'] });
    h.pending[0].resolve(ok(['one']));
    await vi.advanceTimersByTimeAsync(1000);
    // Still the latest document's lots, the same settle: the late answer only fills the cache.
    expect(h.sync.lots).toBe(settled);
    expect(h.sync.result(queriesOf4(one)[0].key)).toMatchObject({ ok: true });
  });

  it('open with no queries gives {} at once', () => {
    const h = harness();
    h.sync.open(DEFAULT_POLICY4);
    expect(h.sync.lots).toEqual({});
    expect(h.sync.pending).toBe(false);
  });

  it('open settles once every query has answered, with no debounce; a failure is no lots', async () => {
    const h = harness();
    const d = doc(transit('a', 100), transit('b', 200));
    h.sync.open(d);
    expect(h.sync.lots).toBeNull();
    h.pending[0].resolve(ok(['p']));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.lots).toBeNull();
    h.pending[1].resolve(failed);
    await vi.advanceTimersByTimeAsync(0);
    const keys = queriesOf4(d).map((q) => q.key);
    expect(h.sync.lots).toEqual({ [keys[0]]: ['p'], [keys[1]]: [] });
  });

  it('a failed query on update settles nothing until retry succeeds', async () => {
    const h = harness();
    const d = doc(transit('a', 100));
    const key = queriesOf4(d)[0].key;
    h.sync.update(d);
    h.pending[0].resolve(failed);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.lots).toBeNull();
    expect(h.sync.pending).toBe(false);
    expect(h.sync.result(key)).toEqual(failed);
    h.sync.retry(key);
    expect(h.resolve).toHaveBeenCalledTimes(2);
    h.pending[1].resolve(ok(['z']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sync.lots).toEqual({ [key]: ['z'] });
  });

  it('parks no-session answers and resumes', async () => {
    const h = harness();
    const d = doc(transit('a', 100));
    const key = queriesOf4(d)[0].key;
    h.sync.update(d);
    h.pending[0].resolve(noSession);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync.result(key)).toBeUndefined();
    expect(h.sync.lots).toBeNull();
    expect(h.sync.pending).toBe(true);
    h.sync.update(d);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    h.sync.resume();
    expect(h.resolve).toHaveBeenCalledTimes(2);
    h.pending[1].resolve(ok(['a']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sync.lots).toEqual({ [key]: ['a'] });
    expect(h.sync.pending).toBe(false);
  });

  it('a no-session answer to a query asked before resume is asked again at once', async () => {
    const h = harness();
    h.sync.update(doc(transit('a', 100)));
    h.sync.resume();
    h.pending[0].resolve(noSession);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resolve).toHaveBeenCalledTimes(2);
  });

  it('a query asked once is cached across updates', async () => {
    const h = harness(() => ok(['x']));
    h.sync.update(doc(transit('a', 100)));
    await vi.advanceTimersByTimeAsync(250);
    h.sync.update(doc(transit('a', 100), transit('b', 200)));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.resolve).toHaveBeenCalledTimes(2);
  });
});
