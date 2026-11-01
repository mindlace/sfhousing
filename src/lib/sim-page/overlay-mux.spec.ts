// The overlay multiplexer: SimMap's single-owner setOverlayLayers shared by the feedback
// buildings, the height fog, the painted outlines and the brush ring, in a fixed order.
import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { createOverlayMux } from './overlay-mux';

const layer = (id: string) => ({ id }) as unknown as Layer;

describe('createOverlayMux', () => {
  it('concatenates slots in draw order whatever the write order', () => {
    const set = vi.fn();
    const mux = createOverlayMux(set);
    const [ring, fog, fb, out] = [
      'brush-ring',
      'sim-height-fog',
      'sim-feedback-1',
      'sim-painted-outline'
    ].map(layer);
    mux.slot('ring')([ring]);
    mux.slot('fog')([fog]);
    mux.slot('outline')([out]);
    mux.slot('feedback')([fb]);
    expect(set).toHaveBeenLastCalledWith([fb, fog, out, ring]);
  });

  it('clearing one slot leaves the others', () => {
    const set = vi.fn();
    const mux = createOverlayMux(set);
    mux.slot('fog')([layer('sim-height-fog')]);
    mux.slot('ring')([layer('brush-ring')]);
    mux.slot('fog')([]);
    expect(set.mock.lastCall![0].map((l: Layer) => l.id)).toEqual(['brush-ring']);
  });
});
