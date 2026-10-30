// The stroke adapter: BrushController's editor and client, writing strokes into the policy recipe.
import { describe, expect, it, vi } from 'vitest';
import type { PlanOp } from '$lib/plan';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import { policyFromLevers, type Effect } from './policy';
import { PolicyStore } from './policy-store.svelte';
import { createStrokeAdapter, type StrokeTarget } from './stroke-adapter';

const raise8: Effect = { mode: 'raise', stories: 8, densityLimits: false };
const lower4: Effect = { mode: 'lower', stories: 4, densityLimits: true };

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
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  let target: StrokeTarget = 'zoning';
  let effect: Effect = raise8;
  const announce = vi.fn();
  const a = createStrokeAdapter({ store, target: () => target, effect: () => effect, announce });
  return {
    store,
    announce,
    a,
    setTarget: (t: StrokeTarget) => (target = t),
    setEffect: (e: Effect) => (effect = e)
  };
}

describe('createStrokeAdapter', () => {
  it('appends paint strokes with one effect to one freehand brush', () => {
    const { store, a } = setup();
    expect(a.editor.readOnly).toBe(false);
    expect(a.editor.commit(paint(0))).toEqual({ ok: true });
    expect(a.editor.commit(paint(0.001, 40))).toEqual({ ok: true });
    const bs = store.policy.brushes;
    expect(bs).toHaveLength(1);
    expect(bs[0].kind).toBe('freehand');
    if (bs[0].kind !== 'freehand') return;
    expect(bs[0].effect).toEqual(raise8);
    expect(bs[0].strokes).toEqual([
      { path: paint(0).path, radiusM: 30 },
      { path: paint(0.001).path, radiusM: 40 }
    ]);
    // One store change per stroke, so each undoes alone.
    expect(store.undo()).not.toBeNull();
    expect(
      store.policy.brushes[0].kind === 'freehand' && store.policy.brushes[0].strokes
    ).toHaveLength(1);
  });

  it('starts a second brush when the effect changes', () => {
    const { store, a, setEffect } = setup();
    a.editor.commit(paint(0));
    setEffect(lower4);
    a.editor.commit(paint(0.001));
    const bs = store.policy.brushes;
    expect(bs).toHaveLength(2);
    expect(bs[1].kind === 'freehand' && bs[1].effect).toEqual(lower4);
    expect(bs[0].id).not.toBe(bs[1].id);
  });

  it('appends an erase op as an erase brush, and joins consecutive erases', () => {
    const { store, a } = setup();
    a.editor.commit(paint(0));
    a.editor.commit(erase(0));
    a.editor.commit(erase(0.001));
    const bs = store.policy.brushes;
    expect(bs.map((b) => b.kind)).toEqual(['freehand', 'erase']);
    expect(bs[1].kind === 'erase' && bs[1].strokes).toEqual([
      { path: erase(0).path, radiusM: 20 },
      { path: erase(0.001).path, radiusM: 20 }
    ]);
  });

  it('writes protect and unprotect strokes for the protect target', () => {
    const { store, a, setTarget } = setup();
    setTarget('protect');
    a.editor.commit(paint(0));
    a.editor.commit(erase(0));
    expect(store.policy.brushes).toHaveLength(0);
    expect(store.policy.protect.strokes).toEqual([
      { path: paint(0).path, radiusM: 30, kind: 'protect' },
      { path: erase(0).path, radiusM: 20, kind: 'unprotect' }
    ]);
  });

  it('undo and redo go to the store, return null and announce the label', () => {
    const { store, a, announce } = setup();
    expect(a.editor.undo()).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    a.editor.commit(paint(0));
    const label = store.undoLabel;
    expect(label).toBeTruthy();
    expect(a.editor.undo()).toBeNull();
    expect(store.policy.brushes).toHaveLength(0);
    expect(announce).toHaveBeenLastCalledWith(`Undid: ${label}`);
    expect(store.redoLabel).toBe(label);
    expect(a.editor.redo()).toBeNull();
    expect(store.policy.brushes).toHaveLength(1);
    expect(announce).toHaveBeenLastCalledWith(`Redid: ${label}`);
  });

  it('the client sends nothing to a worker and has no preview', () => {
    const { a } = setup();
    expect(a.client.preview).toBeUndefined();
    expect(a.client.cancelPreview).toBeUndefined();
    expect(typeof a.client.commit(paint(0))).toBe('number');
    expect(a.client.datasetVersion).toBeNull();
  });
});
