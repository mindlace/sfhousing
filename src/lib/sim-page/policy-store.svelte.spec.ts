// PolicyStore: undo and redo over the policy document.
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type SimPolicy, type ZoningRule } from './policy';
import { PolicyStore } from './policy-store.svelte';

const BASE = DEFAULT_POLICY;

const DISTRICTS = ['RH-1', 'RH-2', 'RH-3', 'RM-1', 'RM-2'];
/** A district's distance in the test: a distinct transit band per name, so queries differ. */
const metres = (name: string) => (DISTRICTS.indexOf(name) + 1) * 100;

/** A transit rule whose single band stands for one named district (the test's lot query). */
function area(name: string, stories = 4): ZoningRule {
  return {
    id: `b-${name}-${stories}`,
    kind: 'transit',
    stopTypes: ['metro'],
    bands: [{ maxM: metres(name), stories }]
  };
}
const withBrushes = (...rules: ZoningRule[]): SimPolicy => ({ ...BASE, rules });

describe('PolicyStore', () => {
  it('has no run lock: a change, undo and redo always apply (rule 14)', () => {
    const s = new PolicyStore(DEFAULT_POLICY);
    expect('locked' in s).toBe(false);
    s.apply((p) => ({ ...p, protect: { ...p.protect, historic: true } }), 'a');
    expect(s.undo()).toBe('a');
    expect(s.redo()).toBe('a');
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

describe('PolicyStore generic', () => {
  type Doc = { n: number };
  const a: Doc = { n: 1 };
  const b: Doc = { n: 2 };
  const c: Doc = { n: 3 };

  it('undoTo walks back to the given document and keeps redo', () => {
    const s = new PolicyStore<Doc>(a);
    s.apply(() => b, 'b');
    s.apply(() => c, 'c');
    s.undoTo(a, 'Not applied');
    expect([s.policy, s.canRedo, s.canUndo]).toEqual([a, true, false]);
    expect(s.redo()).toBe('b');
  });

  it('undoTo a document not in the past records one change', () => {
    const s = new PolicyStore<Doc>(a);
    s.apply(() => b, 'b');
    const x: Doc = { n: 9 };
    s.undoTo(x, 'Not applied');
    expect(s.policy).toBe(x);
    expect(s.undoLabel).toBe('Not applied');
    expect(s.undo()).toBe('Not applied');
    expect(s.policy).toBe(b);
  });

  it('undoTo the current document changes nothing', () => {
    const s = new PolicyStore<Doc>(a);
    s.undoTo(a, 'Not applied');
    expect([s.policy, s.canUndo]).toEqual([a, false]);
  });

  it('an identical document is no change: no entry, no notification', () => {
    const s = new PolicyStore<Doc>(a);
    let seen = 0;
    const stop = $effect.root(() => {
      $effect(() => {
        void s.policy;
        void s.canUndo;
        seen++;
      });
    });
    flushSync();
    const before = seen;
    s.apply((p) => p, 'nothing');
    flushSync();
    expect([s.canUndo, s.undoLabel, seen]).toEqual([false, null, before]);
    stop();
  });

  it('normalize runs in apply and its result is what is stored', () => {
    const calls: [Doc, Doc][] = [];
    const normal: Doc = { n: 100 };
    const s = new PolicyStore<Doc>(a, (next, prev) => {
      calls.push([next, prev]);
      return normal;
    });
    s.apply(() => b, 'b');
    expect(calls).toEqual([[b, a]]);
    expect(s.policy).toBe(normal);
    expect(s.undo()).toBe('b');
    expect(s.policy).toBe(a);
  });

  it('normalize also runs when undoTo records a change', () => {
    const normal: Doc = { n: 100 };
    const s = new PolicyStore<Doc>(a, () => normal);
    s.undoTo(c, 'Not applied');
    expect(s.policy).toBe(normal);
  });
});
