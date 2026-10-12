import { expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { RoofController } from './roof-controller';
import { ExistingBuildings } from './existing-buildings';
import { LayerComposer } from './layer-composer';
import type { RoofMeshLayerProps } from './roof-layer';
import type { Manifest } from '$lib/data/manifest';
import type { DecodedRoofChunk, RoofChunkRef } from '$lib/data/building-roofs';
import type { ParcelId } from '$lib/data/parcel';
import { roofFixture } from './test-utils/roof-fixtures';
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup(ids = ['a']) {
  const fixtures = ids.map(roofFixture);
  const index = {
    schemaVersion: 1,
    datasetVersion: 'fixture-0',
    chunks: fixtures.map((f) => f.ref)
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
  let time = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const jobs: {
    ref: RoofChunkRef;
    signal: AbortSignal;
    entryBytes: number;
    resolve(c: DecodedRoofChunk): void;
    reject(e: Error): void;
  }[] = [];
  let published: Layer[] = [];
  const observations: { ready: string[]; active: boolean[] }[] = [];
  const existing = new ExistingBuildings({
    mode: 'piece',
    setState() {},
    clearState() {},
    onReplacementChange: ({ hidden, changed }) => controller.setHidden(hidden, changed)
  });
  const composer = new LayerComposer((layers) => {
    published = layers;
    observations.push({
      ready: [...existing.roofReady],
      active: layers.map((l) => (l.props as unknown as RoofMeshLayerProps).active)
    });
  });
  const fetcher = vi.fn(async () => new Response(JSON.stringify(index)));
  class FakeLayer {
    gpuBytes = 7300;
    initialized = true;
    constructor(public props: RoofMeshLayerProps) {}
    clone(props: Partial<RoofMeshLayerProps>) {
      return new FakeLayer({ ...this.props, ...props });
    }
    cancelPreparation() {
      return false;
    }
  }
  const created: FakeLayer[] = [];
  const controller = new RoofController({
    manifest,
    existing,
    composer,
    worker: {
      load: (ref: RoofChunkRef, _version: string, signal: AbortSignal, entryBytes: number) =>
        new Promise<DecodedRoofChunk>((resolve, reject) =>
          jobs.push({ ref, signal, entryBytes, resolve, reject })
        ),
      destroy() {}
    },
    fetch: fetcher,
    now: () => time,
    raf: (cb) => {
      frames.set(++frameId, cb);
      return frameId;
    },
    cancelRaf: (id) => {
      frames.delete(id);
    },
    createLayer: (props) => {
      const layer = new FakeLayer(props);
      created.push(layer);
      return layer as unknown as Layer;
    },
    onDiagnostic() {}
  });
  return {
    controller,
    layers: () => published.map((layer) => layer.props as unknown as RoofMeshLayerProps),
    existing,
    jobs,
    created,
    observations,
    fetcher,
    fixtures,
    index,
    manifest,
    time: (n: number) => {
      time = n;
    },
    frame: () => {
      const entry = frames.entries().next().value;
      if (entry) {
        frames.delete(entry[0]);
        entry[1](time);
      }
    }
  };
}
it('loads lazily, keeps replaced parcels hidden, and switches representations only on draw acknowledgment', async () => {
  const s = setup();
  s.controller.updateViewport([0, 0, 1, 1], 14.99, [0, 0]);
  expect(s.fetcher).not.toHaveBeenCalled();
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs).toHaveLength(1);
  s.existing.setReplaced('parcel-a' as ParcelId);
  s.jobs[0].resolve(s.fixtures[0].chunk);
  await flush();
  s.frame();
  expect(s.existing.roofReady.size).toBe(0);
  expect(s.created[0].props.hidden.has('parcel-a' as ParcelId)).toBe(true);
  s.created[0].props.onReady();
  expect(s.observations.at(-1)).toEqual({ ready: ['piece-a'], active: [true] });
  s.controller.updateViewport([0, 0, 1, 1], 14, [0, 0]);
  expect(s.observations.at(-1)).toEqual({ ready: [], active: [] });
  expect(s.controller.snapshot().ownedBytes).toBeGreaterThan(0);
  s.created[0].props.onFinalize?.();
  expect(s.controller.snapshot().ownedBytes).toBe(0);
});
it('limits jobs, deduplicates, backs off exactly 30 seconds, and cancels late results', async () => {
  const s = setup(['a', 'b', 'c', 'd', 'e', 'f']);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs).toHaveLength(4);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs).toHaveLength(4);
  s.jobs[0].reject(new Error('bad hash'));
  await flush();
  expect(s.jobs).toHaveLength(5);
  s.time(29999);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs).toHaveLength(5);
  s.jobs[1].reject(new Error('failed'));
  await flush();
  s.time(30000);
  s.jobs[2].reject(new Error('failed'));
  await flush();
  expect(s.jobs.at(-1)?.ref.chunkId).toBe('a');
  s.controller.destroy();
  expect(s.jobs.filter((j) => j.signal.aborted).length).toBeGreaterThan(0);
  for (const job of s.jobs) job.resolve(roofFixture(job.ref.chunkId).chunk);
  await flush();
  s.frame();
  expect(s.created).toHaveLength(0);
  expect(s.controller.snapshot().totalBytes).toBe(0);
});

it('admits nearest chunks first, expands only one viewport margin and installs one chunk per frame', async () => {
  const s = setup(['far', 'near', 'middle', 'outside']);
  s.index.chunks[0].bbox = [1.8, 0, 1.9, 0.1];
  s.index.chunks[1].bbox = [0, 0, 0.1, 0.1];
  s.index.chunks[2].bbox = [0.8, 0, 0.9, 0.1];
  s.index.chunks[3].bbox = [2.1, 0, 2.2, 0.1];
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs.map((j) => j.ref.chunkId)).toEqual(['near', 'middle', 'far']);
  for (const job of s.jobs) job.resolve(roofFixture(job.ref.chunkId).chunk);
  await flush();
  expect(s.created).toHaveLength(0);
  s.frame();
  expect(s.created.map((l) => l.props.chunk.header.chunkId)).toEqual(['near']);
  s.frame();
  expect(s.created.map((l) => l.props.chunk.header.chunkId)).toEqual(['near', 'middle']);
  s.frame();
  expect(s.created).toHaveLength(3);
});
it('keeps cancelled worker reservations and job slots until acknowledgment under viewport thrash', async () => {
  const s = setup(['a', 'b', 'c', 'd', 'e']);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  const charged = s.controller.snapshot().reservedBytes;
  s.controller.updateViewport([20, 20, 21, 21], 15, [20, 20]);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs).toHaveLength(4);
  expect(s.controller.snapshot().inFlight).toBe(4);
  expect(s.controller.snapshot().reservedBytes).toBe(charged);
  expect(s.jobs.every((j) => j.signal.aborted)).toBe(true);
  s.jobs[0].resolve(roofFixture().chunk);
  await flush();
  expect(s.jobs).toHaveLength(5);
  expect(s.created).toHaveLength(0);
  expect(s.controller.snapshot().inFlight).toBe(4);
});
it.each(['whitespace', 'unknown fields'])(
  'preserves measured %s index bytes instead of normalized entry bytes',
  async (kind) => {
    const s = setup();
    const raw =
      kind === 'whitespace'
        ? JSON.stringify(s.index, null, 2)
        : JSON.stringify({ ...s.index, unknown: 'x'.repeat(800) });
    s.fetcher.mockImplementation(async () => new Response(raw));
    s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
    await flush();
    expect(s.jobs[0].entryBytes).toBe(new TextEncoder().encode(raw).length);
    expect(s.controller.snapshot().indexBytes).toBe(new TextEncoder().encode(raw).length);
  }
);
it('uses per-entry bytes only when every original canonical index byte matches', async () => {
  const s = setup();
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs[0].entryBytes).toBe(
    new TextEncoder().encode(JSON.stringify(s.index.chunks[0])).length
  );
});
it('bounds visible reservations at 64 MiB, leaving unadmitted extrusions ready to render', async () => {
  const s = setup(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
  for (const ref of s.index.chunks) ref.meshBytes = 4 * 1024 * 1024 - 2000;
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs.map((j) => j.ref.chunkId)).toEqual(['a', 'b', 'c']);
  expect(s.controller.snapshot().totalBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  for (let i = 0; i < 20; i++) {
    s.frame();
    s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  }
  expect(s.jobs).toHaveLength(3);
  expect(s.existing.roofReady.size).toBe(0);
});
it('clears readiness atomically on a late layer failure and ignores later readiness', async () => {
  const s = setup();
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  s.jobs[0].resolve(s.fixtures[0].chunk);
  await flush();
  s.frame();
  s.created[0].props.onReady();
  s.created[0].props.onFailure(new Error('draw failed'));
  expect(s.observations.at(-1)).toEqual({ ready: [], active: [] });
  s.created[0].props.onReady();
  expect(s.existing.roofReady.size).toBe(0);
  s.created[0].props.onFinalize?.();
  expect(s.controller.snapshot().ownedBytes).toBe(0);
});
it('index failures leave readiness empty and enforce 30-second index backoff', async () => {
  const s = setup();
  s.fetcher.mockImplementation(async () => new Response('{bad'));
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.controller.snapshot().indexStatus).toBe('error');
  s.time(29999);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.fetcher).toHaveBeenCalledTimes(1);
  s.time(30000);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.fetcher).toHaveBeenCalledTimes(2);
  expect(s.existing.roofReady.size).toBe(0);
});

it('restarts an aborted index after zoom returns before cancellation settles', async () => {
  const s = setup();
  let rejectFirst!: (error: Error) => void;
  s.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((_resolve, reject) => {
        rejectFirst = reject;
      })
  );
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  s.controller.updateViewport([0, 0, 1, 1], 14, [0, 0]);
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  rejectFirst(new DOMException('Aborted', 'AbortError'));
  await flush();
  expect(s.fetcher).toHaveBeenCalledTimes(2);
  expect(s.jobs).toHaveLength(1);
});

it('reclaims farther visible demand when the nearest priority changes without reusing cancelled bytes', async () => {
  const s = setup(['a', 'b', 'c', 'd']);
  for (const [i, ref] of s.index.chunks.entries()) {
    ref.meshBytes = 4 * 1024 * 1024 - 2000;
    ref.bbox = [i / 4, 0, i / 4 + 0.1, 0.1];
  }
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.jobs.map((j) => j.ref.chunkId)).toEqual(['a', 'b', 'c']);
  const charged = s.controller.snapshot().reservedBytes;
  s.controller.updateViewport([0, 0, 1, 1], 15, [1, 0]);
  await flush();
  expect(s.jobs[0].signal.aborted).toBe(true);
  expect(s.controller.snapshot().reservedBytes).toBe(charged);
  s.jobs[0].resolve(roofFixture().chunk);
  await flush();
  expect(s.jobs.at(-1)?.ref.chunkId).toBe('d');
});

it('updates only resident chunks containing changed parcels once per adapter transaction', async () => {
  const s = setup(['a', 'b']);
  s.controller.setTheme('dark');
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  for (const job of s.jobs) job.resolve(roofFixture(job.ref.chunkId).chunk);
  await flush();
  s.frame();
  s.frame();
  expect(s.layers().map((p) => p.theme)).toEqual(['dark', 'dark']);
  const original = s.layers().map((p) => p.chunk);
  s.existing.transaction(() => {
    s.existing.setReplaced('parcel-a' as ParcelId);
    s.existing.setReplaced('parcel-a' as ParcelId);
  });
  expect(s.layers().map((p) => p.visibilityRevision)).toEqual([1, 0]);
  expect(s.layers().map((p) => p.chunk)).toEqual(original);
  expect(s.created).toHaveLength(2);
  s.controller.setTheme('light');
  expect(s.layers().map((p) => p.theme)).toEqual(['light', 'light']);
  expect(s.layers().map((p) => p.visibilityRevision)).toEqual([1, 0]);
});
it('rejects an index exceeding the actual stream safety bound without Content-Length', async () => {
  const s = setup();
  s.fetcher.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(8 * 1024 * 1024));
            c.enqueue(new Uint8Array(1));
            c.close();
          }
        })
      )
  );
  s.controller.updateViewport([0, 0, 1, 1], 15, [0, 0]);
  await flush();
  expect(s.controller.snapshot().indexStatus).toBe('error');
  expect(s.controller.snapshot().totalBytes).toBe(0);
  expect(s.jobs).toHaveLength(0);
});
