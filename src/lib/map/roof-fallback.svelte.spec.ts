import { expect, it, vi } from 'vitest';
import { Deck } from '@deck.gl/core';
import type { Device } from '@luma.gl/core';
import { RoofMeshLayer } from './roof-layer';
import { roofFixture } from './test-utils/roof-fixtures';

it('missing KHR fails before roof shader or buffer allocation and releases ownership exactly once', async () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  let device!: Device;
  const deck = new Deck({
    canvas,
    width: 100,
    height: 100,
    layers: [],
    initialViewState: { longitude: -122.4, latitude: 37.78, zoom: 17 },
    onDeviceInitialized: (d) => {
      device = d;
    }
  });
  try {
    await vi.waitFor(() => expect(deck.isInitialized).toBe(true));
    const gl = canvas.getContext('webgl2')!;
    expect(gl.getExtension('KHR_parallel_shader_compile')).toBeNull();
    const compile = vi.spyOn(gl, 'compileShader'),
      shader = vi.spyOn(gl, 'createShader'),
      program = vi.spyOn(gl, 'createProgram'),
      buffer = vi.spyOn(device, 'createBuffer');
    const ready = vi.fn(),
      failure = vi.fn(),
      finalized = vi.fn();
    const original = new RoofMeshLayer({
      chunk: roofFixture('fallback').chunk,
      hidden: new Set(),
      visibilityRevision: 0,
      theme: 'light',
      active: false,
      onReady: ready,
      onFailure: failure,
      onFinalize: finalized
    });
    const clone = original.clone({ theme: 'dark' });
    deck.setProps({ layers: [clone] });
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    expect(failure.mock.calls[0][0].message).toContain('unavailable');
    expect(ready).not.toHaveBeenCalled();
    expect(original.gpuBytes).toBe(0);
    deck.setProps({ layers: [clone.clone({ visibilityRevision: 1 })] });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(failure).toHaveBeenCalledOnce();
    for (const call of [compile, shader, program, buffer]) expect(call).not.toHaveBeenCalled();
    deck.finalize();
    expect(finalized).toHaveBeenCalledOnce();
    expect(original.gpuBytes).toBe(0);
  } finally {
    vi.restoreAllMocks();
    deck.finalize();
    canvas.remove();
  }
});

it('finalizes a failed layer removed by its failure callback during initial reconciliation', async () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const deck = new Deck({
    canvas,
    width: 100,
    height: 100,
    layers: [],
    initialViewState: { longitude: -122.4, latitude: 37.78, zoom: 17 }
  });
  try {
    await vi.waitFor(() => expect(deck.isInitialized).toBe(true));
    expect(canvas.getContext('webgl2')!.getExtension('KHR_parallel_shader_compile')).toBeNull();
    const finalized = vi.fn();
    const failure = vi.fn(() => deck.setProps({ layers: [] }));
    const layer = new RoofMeshLayer({
      chunk: roofFixture('fallback').chunk,
      hidden: new Set(),
      visibilityRevision: 0,
      theme: 'light',
      active: false,
      onReady: () => {
        throw new Error('Unsupported layer must not become ready');
      },
      onFailure: failure,
      onFinalize: finalized
    });
    deck.setProps({ layers: [layer] });
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    expect(layer.gpuBytes).toBe(0);
    await vi.waitFor(() => expect(finalized).toHaveBeenCalledOnce());
    expect(layer.props.ownership!.released).toBe(true);
  } finally {
    deck.finalize();
    canvas.remove();
  }
});

it.each(['cancelled', 'destroyed'])(
  'does not notify a %s owner after its deferred initialization failure',
  async (action) => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const deck = new Deck({
      canvas,
      width: 100,
      height: 100,
      layers: [],
      initialViewState: { longitude: -122.4, latitude: 37.78, zoom: 17 }
    });
    class CancelledRoof extends RoofMeshLayer {
      static layerName = 'CancelledRoof';
      initializeState() {
        if (action === 'destroyed') queueMicrotask(() => deck.finalize());
        super.initializeState();
        if (action === 'cancelled') this.cancelPreparation();
      }
    }
    try {
      await vi.waitFor(() => expect(deck.isInitialized).toBe(true));
      expect(canvas.getContext('webgl2')!.getExtension('KHR_parallel_shader_compile')).toBeNull();
      const failure = vi.fn(),
        finalized = vi.fn();
      const layer = new CancelledRoof({
        chunk: roofFixture('fallback').chunk,
        hidden: new Set(),
        visibilityRevision: 0,
        theme: 'light',
        active: false,
        onReady: vi.fn(),
        onFailure: failure,
        onFinalize: finalized
      });
      deck.setProps({ layers: [layer] });
      await vi.waitFor(() =>
        expect(
          action === 'cancelled'
            ? layer.props.ownership!.cancelled
            : layer.props.ownership!.released
        ).toBe(true)
      );
      expect(failure).not.toHaveBeenCalled();
      expect(layer.gpuBytes).toBe(0);
      if (action === 'cancelled') deck.setProps({ layers: [] });
      await vi.waitFor(() => expect(finalized).toHaveBeenCalledOnce());
    } finally {
      deck.finalize();
      canvas.remove();
    }
  }
);
