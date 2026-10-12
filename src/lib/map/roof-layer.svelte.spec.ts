import { afterEach, expect, it, vi } from 'vitest';
import { Deck, WebMercatorViewport } from '@deck.gl/core';
import type { Buffer, Device } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import { decodeRoofChunk, encodeRoofChunk } from '$lib/data/roof-codec';
import type { DecodedRoofChunk } from '$lib/data/building-roofs';
import type { ParcelId } from '$lib/data/parcel';
import { RoofMeshLayer, roofGpuBytes } from './roof-layer';

// Two independent pitched surfaces and south-facing vertical walls. No shared piece vertices.
function chunk(): DecodedRoofChunk {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [],
    slots: number[] = [];
  for (let slot = 0; slot < 2; slot++) {
    const x = slot ? 5 : -40;
    for (const [vertices, normal] of [
      [
        [x, -20, 10, x + 35, -20, 30, x + 35, 20, 30, x, 20, 10],
        [-20 / Math.hypot(20, 35), 0, 35 / Math.hypot(20, 35)]
      ],
      [
        [x, -20, 0, x + 35, -20, 0, x + 35, -20, 30, x, -20, 10],
        [0, -1, 0]
      ]
    ]) {
      const start = positions.length / 3;
      positions.push(...vertices);
      for (let j = 0; j < 4; j++) {
        normals.push(...normal);
        slots.push(slot);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const raw = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    pieceSlots: new Uint32Array(slots),
    header: {
      schemaVersion: 1,
      datasetVersion: 'fixture-0',
      chunkId: 'gpu-test',
      projectedOrigin: [0, 0],
      anchor: [-122.4, 37.78],
      byteLength: 0,
      buffers: {},
      pieces: [0, 1].map((slot) => ({
        pieceId: `piece-${slot}`,
        buildingId: 'shared-building',
        parcelId: `parcel-${slot}`,
        method: 'lidar_only',
        firstIndex: slot * 12,
        indexCount: 12
      }))
    }
  } as DecodedRoofChunk;
  const encoded = encodeRoofChunk(raw);
  return decodeRoofChunk(encoded.header, encoded.buffer);
}
let deck: Deck | undefined;
let testDevice: Device;
let canvas: HTMLCanvasElement | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  deck?.finalize();
  deck = undefined;
  canvas?.remove();
});
const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function draw(layer: RoofMeshLayer) {
  deck!.setProps({ layers: [layer] });
  await tick();
  deck!.redraw('test');
}
function point(x: number, y: number, z: number): [number, number] {
  const vp = deck!.getViewports()[0] as WebMercatorViewport;
  const origin = vp.projectPosition([-122.4, 37.78, 0]);
  const units = vp.getDistanceScales().unitsPerMeter;
  const lngLat = vp.unprojectPosition(origin.map((n, i) => n + [x, y, z][i] * units[i]));
  return vp.project(lngLat).slice(0, 2) as [number, number];
}
function pick(x: number, y: number, z: number) {
  const [px, py] = point(x, y, z);
  return deck!.pickObject({ x: px, y: py, radius: 1 });
}
function pixel(x: number, y: number, z: number) {
  deck!.redraw('sample');
  const gl = canvas!.getContext('webgl2')!;
  const [px, py] = point(x, y, z);
  const rgba = new Uint8Array(4);
  gl.readPixels(
    Math.floor(px),
    gl.drawingBufferHeight - 1 - Math.floor(py),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    rgba
  );
  return [...rgba];
}
it('prepares inactive indexed roofs, shades/picks individual pieces, hides without mesh uploads, and releases all buffers', async () => {
  const mesh = chunk();
  const hidden = new Set<ParcelId>();
  const ready = vi.fn(),
    failure = vi.fn();
  let layer = new RoofMeshLayer({
    chunk: mesh,
    hidden,
    visibilityRevision: 0,
    theme: 'light',
    active: false,
    onReady: ready,
    onFailure: failure
  });
  expect(ready).not.toHaveBeenCalled();
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  deck = new Deck({
    canvas,
    onDeviceInitialized: (device) => {
      testDevice = device;
    },
    width: 400,
    height: 400,
    useDevicePixels: false,
    initialViewState: { longitude: -122.4, latitude: 37.78, zoom: 18.5, pitch: 50 },
    deviceProps: { webgl: { preserveDrawingBuffer: true } },
    layers: [layer]
  });
  await vi.waitFor(() => {
    expect(failure.mock.calls).toEqual([]);
    expect(ready).toHaveBeenCalledTimes(1);
  });
  expect(failure).not.toHaveBeenCalled();
  expect(pick(-22, 0, 20)).toBeNull();
  expect(pixel(-22, 0, 20)[3]).toBe(0);
  const model = layer.getModels()[0];
  const buffers = Object.values(layer.state.buffers) as Buffer[];
  const uniforms = [...model._uniformStore.uniformBuffers.values()];
  const resources = [...buffers, ...uniforms];
  expect(model.topology).toBe('triangle-list');
  expect(model.isInstanced).toBe(false);
  expect(model.indexCount).toBe(24);
  expect(layer.gpuBytes).toBe(resources.reduce((n, b) => n + b.byteLength, 0));
  expect(roofGpuBytes(mesh)).toBe(layer.gpuBytes);
  const meshWrites = ['positions', 'normals', 'indices', 'pickingColors'].map((name) =>
    vi.spyOn(layer.state.buffers[name as keyof typeof layer.state.buffers]!, 'write')
  );
  layer = layer.clone({ active: true });
  await draw(layer);
  expect(pick(-22, 0, 20)?.object).toEqual(mesh.header.pieces[0]);
  expect(pick(22, 0, 20)?.object).toEqual(mesh.header.pieces[1]);
  const roof = pixel(-22, 0, 20),
    wall = pixel(-22, -20, 5);
  expect(roof[3]).toBe(255);
  expect(wall[3]).toBe(255);
  expect(Math.abs(roof[0] - wall[0])).toBeGreaterThan(5);
  hidden.add('parcel-0' as ParcelId);
  layer = layer.clone({ visibilityRevision: 1 });
  await draw(layer);
  expect(pick(-22, 0, 20)).toBeNull();
  expect(pixel(-22, 0, 20)[3]).toBe(0);
  expect(pick(22, 0, 20)?.object.pieceId).toBe('piece-1');
  const light = pixel(22, 0, 20);
  layer = layer.clone({ theme: 'dark' });
  await draw(layer);
  expect(pixel(22, 0, 20)[0]).toBeLessThan(light[0]);
  expect(Object.values(layer.state.buffers)).toEqual(buffers);
  expect(layer.getModels()[0]).toBe(model);
  for (const write of meshWrites) expect(write).not.toHaveBeenCalled();
  expect(ready).toHaveBeenCalledTimes(1);
  const destroys = resources.map((b) => vi.spyOn(b, 'destroy'));
  const modelDestroy = vi.spyOn(model, 'destroy');
  deck.finalize();
  deck = undefined;
  expect(modelDestroy).toHaveBeenCalledTimes(1);
  for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
}, 20000);

async function emptyDeck() {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  deck = new Deck({
    canvas,
    onDeviceInitialized: (device) => {
      testDevice = device;
    },
    width: 400,
    height: 400,
    useDevicePixels: false,
    initialViewState: { longitude: -122.4, latitude: 37.78, zoom: 18.5, pitch: 50 },
    layers: []
  });
  await vi.waitFor(() => expect(deck!.isInitialized).toBe(true));
}
function prepareLayer(ready = vi.fn(), failure = vi.fn()) {
  return new RoofMeshLayer({
    chunk: chunk(),
    hidden: new Set(),
    visibilityRevision: 0,
    theme: 'light',
    active: false,
    onReady: ready,
    onFailure: failure
  });
}
it('retries an unready GPU model without acknowledging readiness early', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  const realDraw = Model.prototype.draw;
  let blocked = true;
  vi.spyOn(Model.prototype, 'draw').mockImplementation(function (this: Model, pass) {
    return blocked ? false : realDraw.call(this, pass);
  });
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  expect(ready).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
  blocked = false;
  await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  expect(layer.gpuBytes).toBe(roofGpuBytes(layer.props.chunk));
});
it('reports partial allocation failure once and destroys buffers already allocated', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  const device = testDevice;
  const create = device.createBuffer.bind(device);
  const destroys: ReturnType<typeof vi.spyOn>[] = [];
  let allocations = 0;
  vi.spyOn(device, 'createBuffer').mockImplementation((props) => {
    if ('id' in props && props.id?.startsWith('existing-roof-')) {
      if (++allocations === 3) throw new Error('GPU allocation failed');
      const buffer = create(props);
      destroys.push(vi.spyOn(buffer, 'destroy'));
      return buffer;
    }
    return create(props);
  });
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('GPU allocation failed'));
  expect(ready).not.toHaveBeenCalled();
  expect(layer.gpuBytes).toBe(0);
  deck!.finalize();
  deck = undefined;
  expect(destroys).toHaveLength(2);
  for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
});
it('reports a later draw exception once and releases the prepared representation', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  const model = layer.getModels()[0];
  const buffers = [
    ...Object.values(layer.state.buffers),
    ...model._uniformStore.uniformBuffers.values()
  ];
  const destroys = buffers.map((b) => vi.spyOn(b!, 'destroy'));
  vi.spyOn(model, 'draw').mockImplementation(() => {
    throw new Error('GPU draw failed');
  });
  deck!.redraw('failure');
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('GPU draw failed'));
  expect(layer.gpuBytes).toBe(0);
  deck!.redraw('retry after failure');
  deck!.finalize();
  deck = undefined;
  expect(failure).toHaveBeenCalledTimes(1);
  for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
});

it('releases managed uniform buffers when allocation fails partway through model setup', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  const device = testDevice;
  const create = device.createBuffer.bind(device);
  const allocated: Buffer[] = [];
  let ownedSetup = false;
  vi.spyOn(device, 'createBuffer').mockImplementation((props) => {
    if ('id' in props && props.id === 'existing-roof-gpu-test-positions') ownedSetup = true;
    if (ownedSetup && allocated.length === 6) {
      ownedSetup = false;
      throw new Error('uniform allocation failed');
    }
    const buffer = create(props);
    if (ownedSetup) allocated.push(buffer);
    return buffer;
  });
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('uniform allocation failed'));
  expect(ready).not.toHaveBeenCalled();
  expect(allocated).toHaveLength(6);
  expect(allocated.every((buffer) => buffer.destroyed)).toBe(true);
  expect(layer.gpuBytes).toBe(0);
});

it('reports a permanently invalid GPU binding instead of retrying forever', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  const model = layer.getModels()[0];
  vi.spyOn(model.vertexArray, 'getDrawValidationError').mockReturnValue('invalid vertex binding');
  deck!.redraw('invalid binding');
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('invalid vertex binding'));
  expect(layer.gpuBytes).toBe(0);
});
