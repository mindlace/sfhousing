// The stroke adapter: BrushController's editor and client, writing strokes into the policy recipe.
import { describe, expect, it, vi } from 'vitest';
import type { PlanOp } from '$lib/plan';
import { DEFAULT_POLICY } from './policy';
import { PolicyStore } from './policy-store.svelte';
import { createStrokeAdapter, strokeLabel } from './stroke-adapter';

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

  it('a Paint stroke calls onpaint once, after the store change, with the stroke and stories', () => {
    const store = new PolicyStore(DEFAULT_POLICY);
    const seen: number[] = [];
    const onpaint = vi.fn(() => seen.push(store.policy.custom.length));
    const a = createStrokeAdapter({ store, stories: () => 8, announce: () => {}, onpaint });
    a.editor.commit(paint(0));
    expect(onpaint).toHaveBeenCalledTimes(1);
    expect(onpaint).toHaveBeenCalledWith({ path: paint(0).path, radiusM: 30 }, 8);
    expect(seen).toEqual([1]); // the store already holds the stroke
    a.editor.commit(erase(0));
    expect(onpaint).toHaveBeenCalledTimes(1); // never for Erase
  });

  it('the client sends nothing to a worker and has no preview', () => {
    const { a } = setup();
    expect(a.client.preview).toBeUndefined();
    expect(a.client.cancelPreview).toBeUndefined();
    expect(typeof a.client.commit(paint(0))).toBe('number');
    expect(a.client.datasetVersion).toBeNull();
  });
});
