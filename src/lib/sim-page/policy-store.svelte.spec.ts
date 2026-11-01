// PolicyStore (undo and redo over the recipe) and LeverSync (resolve every brush query, compile,
// debounce, send): the latest recipe alone reaches the worker (Review Focus 2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import type { SimLevers } from '$lib/sim/levers/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { DEFAULT_POLICY, queryKey, type SimPolicy, type ZoningRule } from './policy';
import { LeverSync, PolicyStore } from './policy-store.svelte';

const BASE = DEFAULT_POLICY;

/** A street rule on one named street (the test's lot query). */
function area(name: string, stories = 4): ZoningRule {
  return {
    id: `b-${name}-${stories}`,
    kind: 'street',
    classes: [],
    names: [name],
    depth: 0,
    ncOnly: false,
    stories
  };
}
const withBrushes = (...rules: ZoningRule[]): SimPolicy => ({ ...BASE, rules });
const areaQuery = (name: string): BrushQuery => ({
  kind: 'street',
  classes: [],
  names: [name],
  depth: 0,
  ncOnly: false
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
  it('a locked store ignores changes, undo and redo', () => {
    const s = new PolicyStore(DEFAULT_POLICY);
    s.apply((p) => ({ ...p, protect: { ...p.protect, historic: true } }), 'a');
    s.locked = true;
    const before = s.policy;
    s.apply((p) => ({ ...p, protect: { ...p.protect, rentControl: true } }), 'b');
    expect(s.undo()).toBeNull();
    expect(s.redo()).toBeNull();
    expect(s.policy).toBe(before);
    s.locked = false;
    expect(s.undo()).toBe('a');
  });

  it('undo and redo restore the policy and return labels', () => {
    const store = new PolicyStore(BASE);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.undo()).toBeNull();
    store.apply((p) => ({ ...p, rules: [area('RH-1')] }), 'Allowed up to 4 stories on RH-1');
    const one = store.policy;
    store.apply((p) => ({ ...p, protect: { ...p.protect, historic: true } }), 'Protected historic');
    expect(store.canUndo).toBe(true);
    expect(store.undo()).toBe('Protected historic');
    expect(store.policy).toBe(one);
    expect(store.canRedo).toBe(true);
    expect(store.undo()).toBe('Allowed up to 4 stories on RH-1');
    expect(store.policy).toBe(BASE);
    expect(store.canUndo).toBe(false);
    expect(store.redo()).toBe('Allowed up to 4 stories on RH-1');
    expect(store.policy).toBe(one);
    expect(store.redo()).toBe('Protected historic');
    expect(store.policy.protect.historic).toBe(true);
    expect(store.redo()).toBeNull();
  });

  it('a new change clears redo', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => ({ ...p, rules: [area('RH-1')] }), 'a');
    store.undo();
    expect(store.canRedo).toBe(true);
    store.apply((p) => ({ ...p, rules: [area('RH-2')] }), 'b');
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBeNull();
  });

  it('changes with one coalesce key and nothing between make one undo entry', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => ({ ...p, rules: [area('RH-1', 4)] }), 'first', 'k');
    store.apply((p) => ({ ...p, rules: [area('RH-1', 5)] }), 'second', 'k');
    expect(store.undoLabel).toBe('second');
    expect(store.undo()).toBe('second');
    expect(store.policy).toBe(BASE);
    expect(store.canUndo).toBe(false);
  });

  it('an undo between same-key changes keeps two entries', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => ({ ...p, rules: [area('RH-1', 4)] }), 'first', 'k');
    store.undo();
    store.redo();
    store.apply((p) => ({ ...p, rules: [area('RH-1', 5)] }), 'second', 'k');
    expect(store.undo()).toBe('second');
    expect(store.undo()).toBe('first');
    expect(store.policy).toBe(BASE);
  });

  it('a different key, or a change with none between, makes a new entry', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => ({ ...p, rules: [area('RH-1', 4)] }), 'a', 'k');
    store.apply((p) => ({ ...p, rules: [area('RH-1', 5)] }), 'b', 'j');
    store.apply((p) => ({ ...p, rules: [area('RH-1', 7)] }), 'c');
    store.apply((p) => ({ ...p, rules: [area('RH-1', 6)] }), 'd', 'j');
    expect(store.undo()).toBe('d');
    expect(store.undo()).toBe('c');
    expect(store.undo()).toBe('b');
    expect(store.undo()).toBe('a');
  });

  it('a change that returns the same policy is not recorded', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => p, 'nothing');
    expect(store.canUndo).toBe(false);
  });

  it('reset replaces the policy and clears undo, redo and coalescing', () => {
    const store = new PolicyStore(BASE);
    store.apply((p) => ({ ...p, rules: [area('RH-1', 4)] }), 'a', 'k');
    store.apply((p) => ({ ...p, rules: [area('RH-1', 5)] }), 'b');
    store.undo();
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(true);
    const p = withBrushes(area('RH-2'));
    store.reset(p);
    expect(store.policy).toBe(p);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.undoLabel).toBeNull();
    // The next keyed change is a new entry, not merged into a cleared one.
    store.apply((q) => ({ ...q, rules: [area('RH-1', 5)] }), 'c', 'k');
    expect(store.undo()).toBe('c');
    expect(store.policy).toBe(p);
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
    const h = harness((q) => ok(q.kind === 'street' ? [`lot-${q.names[0]}`] : []));
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
    expect(h.sent[0].rules).toEqual([{ lots: ['lot-RM-2'], stories: 4 }]);
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
    expect(h.sent[0].rules[0].lots).toEqual(['a', 'b']);
  });

  it('a query asked once is cached across updates', async () => {
    const h = harness((q) => ok(q.kind === 'street' ? [q.names[0]] : []));
    h.sync.update(withBrushes(area('RH-1')));
    await vi.advanceTimersByTimeAsync(0);
    h.sync.update(withBrushes(area('RH-1', 6)));
    h.sync.update(withBrushes(area('RH-1', 8)));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].rules[0].stories).toBe(8);
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
    expect(h.sent[0].rules).toEqual([{ lots: ['x'], stories: 6 }]);
  });

  it('a policy with no brushes compiles at once, after the debounce', async () => {
    const h = harness();
    h.sync.update({ ...BASE, protect: { ...BASE.protect, historic: true } });
    expect(h.resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].protect.historic).toBe(true);
    expect(h.sent[0].compare).toBe('fzp'); // a customised policy compares with FZP as written
  });

  it('a superseded query answering late does not send the old recipe', async () => {
    const h = harness();
    h.sync.update(withBrushes(area('RH-1')));
    h.sync.update(withBrushes(area('RH-2')));
    h.pending[1].resolve(ok(['two']));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].rules[0].lots).toEqual(['two']);
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
    expect(h.sent[0].rules[0]).toMatchObject({ lots: ['a'], stories: 6 });
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
