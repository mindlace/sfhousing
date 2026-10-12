import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { LayerComposer } from './layer-composer';

const layer = (id: string) => ({ id }) as Layer;
describe('LayerComposer', () => {
  it('preserves roofs through generated/brush updates and emits nested transactions once', () => {
    const updates: string[][] = [];
    const c = new LayerComposer((layers) => updates.push(layers.map((l) => l.id)));
    c.setRoofs([layer('roof')]);
    c.transaction(() => {
      c.setGenerated([layer('generated')]);
      c.transaction(() => c.setBrush([layer('brush')]));
    });
    expect(updates).toEqual([['roof'], ['roof', 'generated', 'brush']]);
    c.setGenerated([]);
    expect(updates.at(-1)).toEqual(['roof', 'brush']);
    c.destroy();
    c.setRoofs([layer('late')]);
    expect(updates.at(-1)).toEqual([]);
    expect(updates).toHaveLength(4);
  });
  it('flushes completed mutations on exceptions and resumes normal updates', () => {
    const updates: Layer[][] = [];
    const c = new LayerComposer((layers) => updates.push(layers));
    expect(() =>
      c.transaction(() => {
        c.setRoofs([layer('roof')]);
        throw Error('stop');
      })
    ).toThrow('stop');
    c.setBrush([layer('brush')]);
    expect(updates.map((ls) => ls.map((l) => l.id))).toEqual([['roof'], ['roof', 'brush']]);
  });
});

it('E2E composition observes only final publications and distinguishes preparing layers', () => {
  vi.stubEnv('VITE_E2E', '1');
  try {
    const c = new LayerComposer(() => {});
    const roof = (active: boolean) =>
      ({ id: 'existing-roof-a', props: { active } }) as unknown as Layer;
    c.setRoofs([roof(false)]);
    expect(c.snapshot()).toMatchObject({
      publications: 1,
      roofs: [{ id: 'existing-roof-a', active: false }]
    });
    c.transaction(() => {
      c.setRoofs([roof(true)]);
      c.setGenerated([layer('generated-a')]);
      expect(c.snapshot()!.publications).toBe(1);
    });
    expect(c.snapshot()).toMatchObject({
      publications: 2,
      roofs: [{ id: 'existing-roof-a', active: true }]
    });
    c.destroy();
    expect(c.snapshot()!.roofs).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('E2E composition retains transient duplicate publications after they disappear', () => {
  vi.stubEnv('VITE_E2E', '1');
  try {
    const c = new LayerComposer(() => {});
    const roof = { id: 'existing-roof-a', props: { active: true } } as unknown as Layer;
    c.setRoofs([roof, roof]);
    c.setRoofs([]);
    expect(c.snapshot()).toMatchObject({ maxRoofs: 2, duplicatePublications: 1 });
  } finally {
    vi.unstubAllEnvs();
  }
});
