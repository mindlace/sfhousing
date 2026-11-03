// The stroke adapter: BrushController's editor and client, writing strokes into the policy recipe.
import { describe, expect, it, vi } from 'vitest';
import type { PlanOp } from '$lib/plan';
import { DEFAULT_POLICY, type CustomBrush, type SimPolicy, type Stroke } from './policy';
import { PolicyStore } from './policy-store.svelte';
import { createStrokeAdapter, removeCustomBrush, strokeLabel } from './stroke-adapter';
import type { StrokePreview } from './stroke-preview';

const paint = (x: number, radiusM = 30): PlanOp => ({
  kind: 'paint',
  stories: 8,
  radiusM,
  path: [
    [-122.42 + x, 37.76],
    [-122.41 + x, 37.76]
  ],
  id: `p${x}`
});
const erase = (x: number): PlanOp => ({
  kind: 'erase',
  radiusM: 20,
  path: [[-122.42 + x, 37.76]],
  id: `e${x}`
});

function setup() {
  const store = new PolicyStore(DEFAULT_POLICY);
  let stories = 8;
  const announce = vi.fn();
  const a = createStrokeAdapter({ store, stories: () => stories, announce });
  return { store, announce, a, setStories: (n: number) => (stories = n) };
}

describe('strokeLabel', () => {
  it('names the stories allowed', () => {
    expect(strokeLabel(8)).toBe('Allowed 8 stories');
    expect(strokeLabel(1)).toBe('Allowed 1 story');
  });
});

describe('createStrokeAdapter', () => {
  it('two Paint strokes at 8 stories make one custom paint brush with two strokes', () => {
    const { store, a, announce } = setup();
    expect(a.editor.readOnly).toBe(false);
    expect(a.editor.commit(paint(0))).toEqual({ ok: true });
    expect(announce).toHaveBeenLastCalledWith('Allowed 8 stories');
    expect(a.editor.commit(paint(0.001, 40))).toEqual({ ok: true });
    const bs = store.policy.custom;
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ kind: 'paint', stories: 8 });
    expect(bs[0].strokes).toEqual([
      { path: paint(0).path, radiusM: 30 },
      { path: paint(0.001).path, radiusM: 40 }
    ]);
    expect(store.policy.rules).toEqual([]);
    // One store change per stroke, so each undoes alone.
    expect(store.undo()).toBe('Allowed 8 stories');
    expect(store.policy.custom[0].strokes).toHaveLength(1);
  });

  it('a Paint at 8 then at 5 makes two brushes', () => {
    const { store, a, setStories, announce } = setup();
    a.editor.commit(paint(0));
    setStories(5);
    a.editor.commit(paint(0.001));
    expect(announce).toHaveBeenLastCalledWith('Allowed 5 stories');
    const bs = store.policy.custom;
    expect(bs.map((b) => [b.kind, b.kind === 'paint' && b.stories])).toEqual([
      ['paint', 8],
      ['paint', 5]
    ]);
    expect(bs[0].id).not.toBe(bs[1].id);
  });

  it('an Erase appends an erase brush, and joins consecutive erases', () => {
    const { store, a, announce } = setup();
    a.editor.commit(paint(0));
    a.editor.commit(erase(0));
    expect(announce).toHaveBeenLastCalledWith('Erased custom zoning');
    a.editor.commit(erase(0.001));
    const bs = store.policy.custom;
    expect(bs.map((b) => b.kind)).toEqual(['paint', 'erase']);
    expect(bs[1].strokes).toEqual([
      { path: erase(0).path, radiusM: 20 },
      { path: erase(0.001).path, radiusM: 20 }
    ]);
    // Paint after an erase starts a new brush, even at the same stories.
    a.editor.commit(paint(0.002));
    expect(store.policy.custom.map((b) => b.kind)).toEqual(['paint', 'erase', 'paint']);
  });

  it('undo and redo go to the store, return null and announce the label', () => {
    const { store, a, announce } = setup();
    expect(a.editor.undo()).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    a.editor.commit(paint(0));
    const label = store.undoLabel;
    expect(label).toBeTruthy();
    expect(a.editor.undo()).toBeNull();
    expect(store.policy.custom).toHaveLength(0);
    expect(announce).toHaveBeenLastCalledWith(`Undid: ${label}`);
    expect(store.redoLabel).toBe(label);
    expect(a.editor.redo()).toBeNull();
    expect(store.policy.custom).toHaveLength(1);
    expect(announce).toHaveBeenLastCalledWith(`Redid: ${label}`);
  });

  it('without a StrokePreview the client sends nothing to a worker and has no preview', () => {
    const { a } = setup();
    expect(a.client.preview).toBeUndefined();
    expect(a.client.cancelPreview).toBeUndefined();
    expect(typeof a.client.commit(paint(0))).toBe('number');
    expect(a.client.datasetVersion).toBeNull();
  });

  it('with a StrokePreview: preview and cancelPreview forward; commit and undo are fading barriers', () => {
    const store = new PolicyStore(DEFAULT_POLICY);
    let rev = 0;
    const sp = {
      preview: vi.fn(() => ++rev),
      cancel: vi.fn(() => ++rev),
      barrier: vi.fn(() => ++rev),
      reset: vi.fn()
    };
    const a = createStrokeAdapter({
      store,
      stories: () => 8,
      announce: () => {},
      preview: sp as unknown as StrokePreview
    });
    expect(a.client.preview!(paint(0))).toBe(1);
    expect(sp.preview).toHaveBeenCalledWith(paint(0));
    expect(a.client.cancelPreview!()).toBe(2);
    expect(sp.cancel).toHaveBeenCalledTimes(1);
    expect(a.client.commit(paint(0))).toBe(3);
    expect(sp.barrier).toHaveBeenLastCalledWith(true);
    expect(a.client.undo('p0')).toBe(4);
    expect(sp.barrier).toHaveBeenCalledTimes(2);
    expect(sp.barrier).toHaveBeenLastCalledWith(true);
    // the editor's commit is the store change alone: no paint callback, no preview
    a.editor.commit(paint(0));
    expect(sp.preview).toHaveBeenCalledTimes(1);
    expect(store.policy.custom).toHaveLength(1);
  });
});

describe('removeCustomBrush', () => {
  const s = (x: number): Stroke => ({ path: [[-122.42 + x, 37.76]], radiusM: 30 });
  const p = (id: string, stories: number, x: number): CustomBrush => ({
    id,
    kind: 'paint',
    strokes: [s(x)],
    stories
  });
  const e = (id: string, x: number): CustomBrush => ({ id, kind: 'erase', strokes: [s(x)] });
  const policy = (...custom: CustomBrush[]): SimPolicy => ({ ...DEFAULT_POLICY, custom });
  const ids = (q: SimPolicy) => q.custom.map((b) => b.id);

  it('merges the two paint brushes made adjacent when they share their stories', () => {
    const q = removeCustomBrush(policy(p('a', 8, 0), p('b', 6, 1), p('c', 8, 2)), 'b');
    expect(q.custom).toEqual([{ id: 'a', kind: 'paint', stories: 8, strokes: [s(0), s(2)] }]);
  });

  it('leaves two brushes when their stories differ', () => {
    const q = removeCustomBrush(policy(p('a', 8, 0), p('b', 6, 1), p('c', 4, 2)), 'b');
    expect(ids(q)).toEqual(['a', 'c']);
    expect(q.custom[0].strokes).toEqual([s(0)]);
  });

  it('merges the erases either side of a removed paint brush', () => {
    const q = removeCustomBrush(policy(e('e1', 0), p('b', 8, 1), e('e2', 2)), 'b');
    expect(q.custom).toEqual([{ id: 'e1', kind: 'erase', strokes: [s(0), s(2)] }]);
  });

  it('never merges a paint brush with an erase', () => {
    const q = removeCustomBrush(policy(p('a', 8, 0), p('b', 6, 1), e('c', 2)), 'b');
    expect(ids(q)).toEqual(['a', 'c']);
    const r = removeCustomBrush(policy(e('a', 0), p('b', 6, 1), p('c', 8, 2)), 'b');
    expect(ids(r)).toEqual(['a', 'c']);
  });

  it('merges nothing when the first or last brush goes', () => {
    const three = policy(p('a', 8, 0), p('b', 6, 1), p('c', 8, 2));
    expect(ids(removeCustomBrush(three, 'a'))).toEqual(['b', 'c']);
    expect(ids(removeCustomBrush(three, 'c'))).toEqual(['a', 'b']);
  });

  it('returns the policy itself for an id that is not there; ids never repeat', () => {
    const three = policy(p('a', 8, 0), p('b', 6, 1), p('c', 8, 2));
    expect(removeCustomBrush(three, 'zz')).toBe(three);
    const q = removeCustomBrush(policy(p('a', 8, 0), p('b', 8, 1), p('c', 8, 2)), 'b');
    expect(new Set(ids(q)).size).toBe(ids(q).length);
  });
});
