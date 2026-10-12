import { describe, expect, it } from 'vitest';
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
