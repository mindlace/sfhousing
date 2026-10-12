import { afterEach, expect, it, vi } from 'vitest';
import { Deck, WebMercatorViewport } from '@deck.gl/core';
import type { Buffer, Device, VertexArray } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import { decodeRoofChunk, encodeRoofChunk } from '$lib/data/roof-codec';
import type { DecodedRoofChunk } from '$lib/data/building-roofs';
import type { ParcelId } from '$lib/data/parcel';
import { RoofMeshLayer, roofGpuBytes } from './roof-layer';
import { ROOF_PROGRAM_BYTES } from './roof-program';
import { RoofCache } from './roof-cache';
import { RoofController } from './roof-controller';
import { LayerComposer } from './layer-composer';
import { ExistingBuildings } from './existing-buildings';
import { roofFixture } from './test-utils/roof-fixtures';
import type { Manifest } from '$lib/data/manifest';

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
function watchVertexArray(vao: VertexArray) {
  const gl = canvas!.getContext('webgl2')!;
  const handle = (vao as unknown as { handle: WebGLVertexArrayObject }).handle;
  const destroy = vi.spyOn(vao, 'destroy');
  return { gl, handle, destroy };
}
function expectVertexArrayReleased(watch: ReturnType<typeof watchVertexArray>) {
  expect(watch.gl.isVertexArray(watch.handle)).toBe(false);
  expect(watch.destroy).toHaveBeenCalledTimes(1);
}
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
  expect(layer.gpuBytes).toBe(resources.reduce((n, b) => n + b.byteLength, 0) + ROOF_PROGRAM_BYTES);
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
  const vao = watchVertexArray(model.vertexArray);
  expect(vao.gl.isVertexArray(vao.handle)).toBe(true);
  deck.setProps({ layers: [] });
  await tick();
  deck.redraw('remove roofs');
  expectVertexArrayReleased(vao);
  deck.finalize();
  deck = undefined;
  expect(modelDestroy).toHaveBeenCalledTimes(1);
  expectVertexArrayReleased(vao);
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
  await vi.waitFor(() =>
    expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('GPU allocation failed'))
  );
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
  const vao = watchVertexArray(model.vertexArray);
  expect(vao.gl.isVertexArray(vao.handle)).toBe(true);
  vi.spyOn(model, 'draw').mockImplementation(() => {
    throw new Error('GPU draw failed');
  });
  deck!.redraw('failure');
  expect(failure).not.toHaveBeenCalled();
  expectVertexArrayReleased(vao);
  expect(layer.gpuBytes).toBe(0);
  await Promise.resolve();
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('GPU draw failed'));
  deck!.redraw('retry after failure');
  deck!.finalize();
  deck = undefined;
  expect(failure).toHaveBeenCalledTimes(1);
  expectVertexArrayReleased(vao);
  for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
});

it('releases managed uniform buffers when allocation fails partway through model setup', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  const device = testDevice;
  const create = device.createBuffer.bind(device);
  const allocated: Buffer[] = [];
  const vertexArrays: ReturnType<typeof watchVertexArray>[] = [];
  const createVertexArray = device.createVertexArray.bind(device);
  vi.spyOn(device, 'createVertexArray').mockImplementation((props) => {
    const vao = createVertexArray(props);
    vertexArrays.push(watchVertexArray(vao));
    return vao;
  });
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
  await vi.waitFor(() =>
    expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('uniform allocation failed'))
  );
  expect(ready).not.toHaveBeenCalled();
  expect(allocated).toHaveLength(6);
  expect(allocated.every((buffer) => buffer.destroyed)).toBe(true);
  expect(vertexArrays).toHaveLength(1);
  expectVertexArrayReleased(vertexArrays[0]);
  deck!.finalize();
  deck = undefined;
  expectVertexArrayReleased(vertexArrays[0]);
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
  expect(failure).not.toHaveBeenCalled();
  expect(layer.gpuBytes).toBe(0);
  await Promise.resolve();
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('invalid vertex binding'));
});

it('releases the previous native VAO exactly once when immutable chunk identity changes', async () => {
  await emptyDeck();
  const ready = vi.fn(),
    failure = vi.fn();
  let layer = prepareLayer(ready, failure);
  await draw(layer);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  const oldModel = layer.getModels()[0];
  const oldVao = watchVertexArray(oldModel.vertexArray);
  const oldModelDestroy = vi.spyOn(oldModel, 'destroy');
  const oldBuffers = [
    ...Object.values(layer.state.buffers),
    ...oldModel._uniformStore.uniformBuffers.values()
  ];
  const oldDestroys = oldBuffers.map((buffer) => vi.spyOn(buffer!, 'destroy'));
  expect(oldVao.gl.isVertexArray(oldVao.handle)).toBe(true);
  layer = layer.clone({ chunk: chunk() });
  await draw(layer);
  await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expectVertexArrayReleased(oldVao);
  expect(oldModelDestroy).toHaveBeenCalledTimes(1);
  for (const destroy of oldDestroys) expect(destroy).toHaveBeenCalledTimes(1);
  const newModel = layer.getModels()[0];
  expect(newModel).not.toBe(oldModel);
  const newVao = watchVertexArray(newModel.vertexArray);
  expect(newVao.gl.isVertexArray(newVao.handle)).toBe(true);
  deck!.setProps({ layers: [] });
  await tick();
  deck!.redraw('remove replacement');
  expectVertexArrayReleased(newVao);
  expectVertexArrayReleased(oldVao);
  expect(oldModelDestroy).toHaveBeenCalledTimes(1);
  for (const destroy of oldDestroys) expect(destroy).toHaveBeenCalledTimes(1);
  expect(failure).not.toHaveBeenCalled();
});

it.each(['original', 'pre-initialization clone'])(
  'charges %s resources until finalization and permanently cancels queued initialization',
  async (firstOwner) => {
    await emptyDeck();
    const finalized = vi.fn();
    const cache = new RoofCache({
      onEvict: () => {
        deck!.setProps({ layers: [] });
        layer.cancelPreparation();
      }
    });
    const layer = new RoofMeshLayer({
      ...prepareLayer().props,
      onFinalize: () => {
        finalized();
        cache.release('gpu-test');
      }
    });
    const initial =
      firstOwner === 'original'
        ? layer
        : layer.clone({
            theme: 'dark',
            hidden: new Set(['parcel-0' as ParcelId]),
            visibilityRevision: 1
          });
    expect(layer.getCurrentLayer()).toBeNull();
    await draw(initial);
    await vi.waitFor(() => expect(initial.state.ready).toBe(true));
    expect(layer.gpuBytes).toBe(roofGpuBytes(layer.props.chunk));
    const model = initial.getModels()[0];
    const vao = watchVertexArray(model.vertexArray);
    const destroys = [
      ...Object.values(initial.state.buffers),
      ...model._uniformStore.uniformBuffers.values()
    ].map((buffer) => vi.spyOn(buffer!, 'destroy'));
    const modelDestroy = vi.spyOn(model, 'destroy');
    const bytes = layer.gpuBytes;
    const cpu =
      layer.props.chunk.positions.byteLength +
      layer.props.chunk.normals.byteLength +
      layer.props.chunk.indices.byteLength +
      layer.props.chunk.pieceSlots.byteLength +
      new TextEncoder().encode(JSON.stringify(layer.props.chunk.header)).length;
    cache.reserve('gpu-test', cpu, bytes);
    cache.install('gpu-test', layer.props.chunk);
    cache.setVisible(['gpu-test']);
    cache.reserve('other', 64 * 1024 * 1024 - cpu - bytes, 0);
    await draw(initial.clone({ active: true }));
    expect(pick(22, 0, 20)?.object.pieceId).toBe('piece-1');
    cache.evict('gpu-test');
    expect(cache.reserve('replacement', 1, 0)).toBe(false);
    expect(layer.cancelPreparation()).toBe(false);
    expect(finalized).not.toHaveBeenCalled();
    expect(layer.gpuBytes).toBe(bytes);
    await tick();
    deck!.redraw('finalize retired');
    expect(finalized).toHaveBeenCalledTimes(1);
    expect(layer.gpuBytes).toBe(0);
    expect(cache.reserve('replacement', 1, 0)).toBe(true);
    expectVertexArrayReleased(vao);
    expect(modelDestroy).toHaveBeenCalledTimes(1);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
    const cancelled = new RoofMeshLayer({ ...prepareLayer().props, onFinalize: finalized });
    expect(cancelled.cancelPreparation()).toBe(true);
    expect(finalized).toHaveBeenCalledTimes(2);
    const create = vi.spyOn(testDevice, 'createBuffer');
    await draw(cancelled.clone({ active: true }));
    expect(cancelled.gpuBytes).toBe(0);
    expect(
      create.mock.calls.filter(([p]) => 'id' in p && p.id?.startsWith('existing-roof-'))
    ).toEqual([]);
    deck!.setProps({ layers: [] });
    await tick();
    deck!.redraw('remove cancelled');
    expect(finalized).toHaveBeenCalledTimes(2);
    deck!.finalize();
    deck = undefined;
    expect(modelDestroy).toHaveBeenCalledTimes(1);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
  }
);

it('prepares a near-limit decoded chunk without a 50 ms main-thread long task', async () => {
  const vertices = 149000;
  const mesh = chunk();
  mesh.positions = new Float32Array(vertices * 3);
  mesh.normals = new Float32Array(vertices * 3);
  mesh.indices = new Uint32Array([0, 1, 2]);
  mesh.pieceSlots = new Uint32Array(vertices);
  mesh.header.pieces = [{ ...mesh.header.pieces[0], firstIndex: 0, indexCount: 3 }];
  const encoded = encodeRoofChunk(mesh);
  const decoded = decodeRoofChunk(encoded.header, encoded.buffer);
  expect(encoded.buffer.byteLength).toBe(4172012);
  await emptyDeck();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const tasks: number[] = [];
  const start = performance.now();
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.startTime >= start) tasks.push(entry.duration);
  });
  observer.observe({ type: 'longtask' });
  const ready = vi.fn(),
    failure = vi.fn();
  const layer = new RoofMeshLayer({
    chunk: decoded,
    hidden: new Set(),
    visibilityRevision: 0,
    theme: 'light',
    active: false,
    onReady: ready,
    onFailure: failure
  });
  try {
    await draw(layer);
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(failure).not.toHaveBeenCalled();
    expect(layer.gpuBytes).toBe(5967180 + ROOF_PROGRAM_BYTES);
    expect(tasks.filter((duration) => duration > 50)).toEqual([]);
  } finally {
    observer.disconnect();
  }
});

it('activates controller roofs cloned by theme and replacement before their first deck initialization', async () => {
  await emptyDeck();
  const mesh = chunk();
  const ref = {
    ...roofFixture('gpu-test').ref,
    headerBytes: new TextEncoder().encode(JSON.stringify(mesh.header)).length,
    meshBytes: mesh.header.byteLength,
    pieceCount: mesh.header.pieces.length,
    modelCount: 1
  };
  const manifest = {
    datasetVersion: 'fixture-0',
    buildingRoofs: {
      schemaVersion: 1,
      indexUrl: '/data/fixture-0/roofs/index.json',
      auditUrl: '/data/fixture-0/roofs/audit.json',
      reportUrl: '/data/fixture-0/roofs/report.json'
    }
  } as Manifest;
  let published: RoofMeshLayer[] = [];
  let frame: FrameRequestCallback | undefined;
  let original: RoofMeshLayer | undefined;
  const existing = new ExistingBuildings({
    mode: 'piece',
    setState() {},
    clearState() {},
    onReplacementChange: ({ hidden, changed }) => controller.setHidden(hidden, changed)
  });
  const composer = new LayerComposer((layers) => {
    published = layers as RoofMeshLayer[];
  });
  const diagnostic = vi.fn();
  const controller = new RoofController({
    manifest,
    existing,
    composer,
    worker: { load: async () => mesh, destroy() {} },
    fetch: async () =>
      new Response(
        JSON.stringify({ schemaVersion: 1, datasetVersion: 'fixture-0', chunks: [ref] })
      ),
    now: () => 0,
    raf: (callback) => {
      frame = callback;
      return 1;
    },
    cancelRaf: () => {
      frame = undefined;
    },
    createLayer: (props) => {
      original = new RoofMeshLayer(props);
      return original;
    },
    onDiagnostic: diagnostic
  });
  try {
    controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
    await vi.waitFor(() => expect(frame).toBeDefined());
    frame!(0);
    expect(original!.getCurrentLayer()).toBeNull();
    controller.setTheme('dark');
    existing.setReplaced('parcel-0' as ParcelId);
    const preparing = published[0];
    expect(preparing).not.toBe(original);
    expect(preparing.props.active).toBe(false);
    await draw(preparing);
    await vi.waitFor(() =>
      expect(controller.snapshot().activePieceIds).toEqual(['piece-0', 'piece-1'])
    );
    expect(original!.gpuBytes).toBe(roofGpuBytes(mesh));
    expect(controller.snapshot().activePieceIds).toEqual(['piece-0', 'piece-1']);
    expect([...existing.roofReady]).toEqual(['piece-0', 'piece-1']);
    expect(published[0].props.active).toBe(true);
    await draw(published[0]);
    expect(pick(-22, 0, 20)).toBeNull();
    expect(pick(22, 0, 20)?.object.pieceId).toBe('piece-1');
    const owned = controller.snapshot().ownedBytes;
    controller.updateViewport([0, 0, 1, 1], 14, [0, 0]);
    expect(existing.roofReady.size).toBe(0);
    expect(published).toEqual([]);
    expect(controller.snapshot().ownedBytes).toBe(owned);
    deck!.setProps({ layers: published });
    await tick();
    deck!.redraw('finalize pre-initialization clone');
    expect(controller.snapshot().ownedBytes).toBe(0);
    expect(original!.gpuBytes).toBe(0);
    expect(diagnostic).not.toHaveBeenCalled();
  } finally {
    controller.destroy();
    composer.destroy();
    existing.destroy();
  }
});

it('waits for asynchronous link completion before layout queries and the real inactive draw', async () => {
  await emptyDeck();
  const gl = canvas!.getContext('webgl2')!;
  const extension = gl.getExtension('KHR_parallel_shader_compile');
  expect(extension).not.toBeNull();
  let complete = false;
  const premature: number[] = [];
  const getParameter = gl.getProgramParameter.bind(gl);
  vi.spyOn(gl, 'getProgramParameter').mockImplementation((program, parameter) => {
    if (parameter === extension!.COMPLETION_STATUS_KHR && !complete) return false;
    if (!complete) premature.push(parameter);
    return getParameter(program, parameter);
  });
  const programs: WebGLProgram[] = [];
  const createProgram = gl.createProgram.bind(gl);
  vi.spyOn(gl, 'createProgram').mockImplementation(() => {
    const program = createProgram()!;
    programs.push(program);
    return program;
  });
  const ready = vi.fn(),
    failure = vi.fn();
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(premature).toEqual([]);
  expect(ready).not.toHaveBeenCalled();
  expect(layer.getModels()).toEqual([]);
  expect(programs).toHaveLength(1);
  complete = true;
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(failure).not.toHaveBeenCalled();
  expect(programs).toHaveLength(1);
  expect((layer.getModels()[0].pipeline as unknown as { handle: WebGLProgram }).handle).toBe(
    programs[0]
  );
  expect(pixel(-22, 0, 20)[3]).toBe(0);
  expect(pick(-22, 0, 20)).toBeNull();
});

it('keeps a fresh shader-hook program cold compilation and activation below 50 ms', async () => {
  await emptyDeck();
  const gl = canvas!.getContext('webgl2')!;
  const extension = gl.getExtension('KHR_parallel_shader_compile');
  expect(extension).not.toBeNull();
  const name = `roofCold${Date.now()}`;
  class FreshRoof extends RoofMeshLayer {
    static layerName = 'FreshRoof';
    getShaders(shaders: Parameters<RoofMeshLayer['getShaders']>[0]) {
      return super.getShaders({
        ...shaders,
        modules: [
          ...shaders.modules,
          {
            name,
            vs: `layout(std140) uniform ${name}Uniforms { float offset; } ${name};`,
            uniformTypes: { offset: 'f32' },
            defaultUniforms: { offset: 0 }
          }
        ],
        inject: {
          'vs:DECKGL_FILTER_GL_POSITION': `position.x += ${name}.offset * ${1 + Math.random()};`
        }
      });
    }
  }
  let pendingPolls = 0;
  const query = gl.getProgramParameter.bind(gl);
  vi.spyOn(gl, 'getProgramParameter').mockImplementation((program, parameter) => {
    const value = query(program, parameter);
    if (parameter === extension!.COMPLETION_STATUS_KHR && !value) pendingPolls++;
    return value;
  });
  const tasks: number[] = [];
  const observer = new PerformanceObserver((list) =>
    tasks.push(...list.getEntries().map((e) => e.duration))
  );
  observer.observe({ entryTypes: ['longtask'] });
  const started = performance.now();
  const ready = vi.fn(),
    failure = vi.fn();
  const layer = new FreshRoof({ ...prepareLayer().props, onReady: ready, onFailure: failure });
  try {
    await draw(layer);
    await vi.waitFor(() => {
      expect(failure).not.toHaveBeenCalled();
      expect(ready).toHaveBeenCalledOnce();
    });
    const preparationMs = performance.now() - started;
    const active = layer.clone({ active: true });
    await draw(active);
    await tick();
    tasks.push(...observer.takeRecords().map((e) => e.duration));
    observer.disconnect();
    console.warn('ROOF_FRESH_PROGRAM', {
      preparationMs,
      pendingPolls,
      tasks,
      sourceBytes: layer.state.program!.sourceBytes
    });
    expect(pendingPolls).toBeGreaterThan(0);
    expect(pick(-22, 0, 20)?.object.pieceId).toBe('piece-0');
    expect(pixel(-22, 0, 20)[3]).toBe(255);
    expect(tasks.filter((ms) => ms > 50)).toEqual([]);
  } finally {
    observer.disconnect();
  }
}, 20000);

function watchNativePrograms() {
  const gl = canvas!.getContext('webgl2')!;
  const programs: WebGLProgram[] = [],
    shaders: WebGLShader[] = [];
  const createProgram = gl.createProgram.bind(gl),
    createShader = gl.createShader.bind(gl);
  vi.spyOn(gl, 'createProgram').mockImplementation(() => {
    const handle = createProgram()!;
    programs.push(handle);
    return handle;
  });
  vi.spyOn(gl, 'createShader').mockImplementation((stage) => {
    const handle = createShader(stage)!;
    shaders.push(handle);
    return handle;
  });
  const deleteProgram = vi.spyOn(gl, 'deleteProgram'),
    deleteShader = vi.spyOn(gl, 'deleteShader');
  return { gl, programs, shaders, deleteProgram, deleteShader };
}
function expectProgramsReleased(watch: ReturnType<typeof watchNativePrograms>) {
  for (const handle of watch.programs) {
    expect(watch.gl.isProgram(handle)).toBe(false);
    expect(watch.deleteProgram.mock.calls.filter(([deleted]) => deleted === handle)).toHaveLength(
      1
    );
  }
  for (const handle of watch.shaders) {
    expect(watch.gl.isShader(handle)).toBe(false);
    expect(watch.deleteShader.mock.calls.filter(([deleted]) => deleted === handle)).toHaveLength(1);
  }
}
function holdNativeLink() {
  const gl = canvas!.getContext('webgl2')!;
  const extension = gl.getExtension('KHR_parallel_shader_compile')!;
  expect(extension).not.toBeNull();
  const query = gl.getProgramParameter.bind(gl);
  return vi
    .spyOn(gl, 'getProgramParameter')
    .mockImplementation((program, parameter) =>
      parameter === extension.COMPLETION_STATUS_KHR ? false : query(program, parameter)
    );
}
it('cancels a pending pre-initialization clone without late queries or retained source staging', async () => {
  await emptyDeck();
  const watch = watchNativePrograms(),
    query = holdNativeLink();
  const ready = vi.fn(),
    failure = vi.fn(),
    finalized = vi.fn();
  const original = new RoofMeshLayer({
    ...prepareLayer(ready, failure).props,
    onFinalize: finalized
  });
  const clone = original.clone({
    theme: 'dark',
    hidden: new Set(['parcel-0' as ParcelId]),
    visibilityRevision: 1
  });
  await draw(clone);
  const program = clone.state.program!;
  expect(program.sourceBytes).toBeGreaterThan(0);
  expect(original.gpuBytes).toBe(ROOF_PROGRAM_BYTES);
  expect(original.cancelPreparation()).toBe(false);
  expectProgramsReleased(watch);
  expect(program.sourceBytes).toBe(0);
  const queries = query.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(query.mock.calls).toHaveLength(queries);
  expect(ready).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
  expect(finalized).not.toHaveBeenCalled();
  deck!.setProps({ layers: [] });
  await tick();
  deck!.redraw('cancelled pending clone');
  expect(finalized).toHaveBeenCalledOnce();
  expect(original.gpuBytes).toBe(0);
  expectProgramsReleased(watch);
});
it.each(['timeout', 'context loss'])(
  'releases pending native program ownership on %s',
  async (reason) => {
    await emptyDeck();
    const watch = watchNativePrograms(),
      query = holdNativeLink();
    const ready = vi.fn(),
      failure = vi.fn();
    const layer = prepareLayer(ready, failure);
    await draw(layer);
    if (reason === 'timeout')
      vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 6000);
    else watch.gl.getExtension('WEBGL_lose_context')!.loseContext();
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    expect(ready).not.toHaveBeenCalled();
    expect(layer.gpuBytes).toBe(0);
    expectProgramsReleased(watch);
    const queries = query.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(query.mock.calls).toHaveLength(queries);
    expect(failure.mock.calls[0][0].message).toContain(
      reason === 'timeout' ? 'timed out' : 'context lost'
    );
  }
);
it.each(['second shader', 'link', 'link status', 'model wrapper', 'vertex array'])(
  'cleans native handles after partial %s failure',
  async (phase) => {
    await emptyDeck();
    const watch = watchNativePrograms();
    if (phase === 'second shader') {
      const compile = watch.gl.compileShader.bind(watch.gl);
      vi.spyOn(watch.gl, 'compileShader').mockImplementation((shader) => {
        if (watch.shaders.length === 2) throw new Error('shader compilation failed');
        compile(shader);
      });
    } else if (phase === 'link') {
      vi.spyOn(watch.gl, 'linkProgram').mockImplementation(() => {
        throw new Error('link failed');
      });
    } else if (phase === 'link status') {
      const query = watch.gl.getProgramParameter.bind(watch.gl);
      vi.spyOn(watch.gl, 'getProgramParameter').mockImplementation((program, parameter) =>
        parameter === watch.gl.LINK_STATUS ? false : query(program, parameter)
      );
    } else if (phase === 'vertex array') {
      vi.spyOn(testDevice, 'createVertexArray').mockImplementation(() => {
        throw new Error('vertex array failed');
      });
    } else
      vi.spyOn(testDevice, 'createRenderPipeline').mockImplementation(() => {
        throw new Error('model wrapper failed');
      });
    const ready = vi.fn(),
      failure = vi.fn();
    const layer = prepareLayer(ready, failure);
    await draw(layer);
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    expect(ready).not.toHaveBeenCalled();
    expect(layer.gpuBytes).toBe(0);
    expectProgramsReleased(watch);
    deck!.finalize();
    deck = undefined;
    expectProgramsReleased(watch);
  }
);

it('releases ready pipeline wrappers before their program and shader handles exactly once', async () => {
  await emptyDeck();
  const watch = watchNativePrograms();
  const layer = prepareLayer();
  await draw(layer);
  await vi.waitFor(() => expect(layer.state.ready).toBe(true));
  const pipeline = layer.state.model!.pipeline;
  const destroyed = vi.spyOn(pipeline, 'destroy');
  const program = layer.state.program!;
  expect(watch.gl.isProgram(watch.programs[0])).toBe(true);
  expect(watch.shaders.every((shader) => watch.gl.isShader(shader))).toBe(true);
  deck!.setProps({ layers: [] });
  await tick();
  deck!.redraw('release prepared program');
  expect(destroyed).toHaveBeenCalledOnce();
  expect(destroyed.mock.invocationCallOrder[0]).toBeLessThan(
    watch.deleteProgram.mock.invocationCallOrder[0]
  );
  expect(watch.deleteProgram.mock.invocationCallOrder[0]).toBeLessThan(
    watch.deleteShader.mock.invocationCallOrder[0]
  );
  expectProgramsReleased(watch);
  expect(program.sourceBytes).toBe(0);
  expect(layer.gpuBytes).toBe(0);
  deck!.finalize();
  deck = undefined;
  expectProgramsReleased(watch);
});

it('rejects changed assembled Model source before creating a pipeline wrapper', async () => {
  await emptyDeck();
  const watch = watchNativePrograms();
  const assembler = Model.defaultProps.shaderAssembler as unknown as {
    assembleGLSLShaderPair(...args: unknown[]): { vs: string; fs: string };
  };
  const assemble = assembler.assembleGLSLShaderPair.bind(assembler);
  let count = 0;
  vi.spyOn(assembler, 'assembleGLSLShaderPair').mockImplementation((...args) => {
    const result = assemble(...args);
    return ++count === 2 ? { ...result, vs: result.vs + '\n// changed Model source' } : result;
  });
  const wrapper = vi.spyOn(testDevice, 'createRenderPipeline');
  const ready = vi.fn(),
    failure = vi.fn();
  const layer = prepareLayer(ready, failure);
  await draw(layer);
  await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
  expect(failure.mock.calls[0][0].message).toContain('source differs');
  expect(ready).not.toHaveBeenCalled();
  expect(wrapper).not.toHaveBeenCalled();
  expect(layer.gpuBytes).toBe(0);
  expectProgramsReleased(watch);
});

it('delivers a real hover-leave result without stopping reconciliation and finalization', async () => {
  await emptyDeck();
  const finalized = vi.fn();
  const layer = new RoofMeshLayer({ ...prepareLayer().props, onFinalize: finalized });
  await draw(layer);
  await vi.waitFor(() => expect(layer.state.ready).toBe(true));
  const active = layer.clone({ active: true });
  await draw(active);
  const [x, y] = point(-22, 0, 20);
  const enter = { x, y, radius: 1, mode: 'hover' };
  expect(deck!.pickObject(enter)?.object.pieceId).toBe('piece-0');
  const leave = { x: 0, y: 0, radius: 0, mode: 'hover' };
  const left = deck!.pickObject(leave);
  expect(left?.picked).toBe(false);
  expect(left?.object).toBeUndefined();
  active.cancelPreparation();
  deck!.setProps({ layers: [] });
  await tick();
  deck!.redraw('hover leave then removal');
  expect(finalized).toHaveBeenCalledOnce();
  expect(layer.gpuBytes).toBe(0);
});

it('bounds wrapper ownership across repeated Model parameter changes', async () => {
  await emptyDeck();
  const watch = watchNativePrograms();
  const layer = prepareLayer();
  await draw(layer);
  await vi.waitFor(() => expect(layer.state.ready).toBe(true));
  const model = layer.state.model!;
  const bytes = layer.gpuBytes;
  for (let i = 0; i < 20; i++) {
    const previous = model.pipeline;
    const destroy = vi.spyOn(previous, 'destroy');
    model.setParameters({ depthWriteEnabled: i % 2 === 0 });
    model.predraw(testDevice.commandEncoder);
    expect(previous.destroyed).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(model.pipeline.destroyed).toBe(false);
    expect(layer.gpuBytes).toBe(bytes);
  }
  expect(watch.programs).toHaveLength(1);
  expect(watch.shaders).toHaveLength(2);
  await draw(layer.clone({ active: true }));
  expect(pick(-22, 0, 20)?.object.pieceId).toBe('piece-0');
  deck!.finalize();
  deck = undefined;
  expectProgramsReleased(watch);
});
