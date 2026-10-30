// The overlay multiplexer: SimMap's single-owner setOverlayLayers shared by the lot dots and
// the brush ring, in a fixed order.
import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { createOverlayMux } from './overlay-mux';

const layer = (id: string) => ({ id }) as unknown as Layer;

describe('createOverlayMux', () => {
  it('concatenates the slots, lots before the ring', () => {
    const set = vi.fn();
    const mux = createOverlayMux(set);
    const a = layer('sim-lots');
    const b = layer('brush-ring');
    mux.slot('lots')([a]);
    expect(set).toHaveBeenLastCalledWith([a]);
    mux.slot('ring')([b]);
    expect(set).toHaveBeenLastCalledWith([a, b]);
    mux.slot('ring')([]);
    expect(set).toHaveBeenLastCalledWith([a]);
  });

  it('keeps the order whichever slot writes first', () => {
    const set = vi.fn();
    const mux = createOverlayMux(set);
    const a = layer('sim-lots');
    const b = layer('brush-ring');
    mux.slot('ring')([b]);
    mux.slot('lots')([a]);
    expect(set).toHaveBeenLastCalledWith([a, b]);
  });
});
