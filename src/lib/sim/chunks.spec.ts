import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelRecord } from '$lib/data/parcel';
import { encodeParcelChunk } from '$lib/data/parcel-chunk';
import { GRID_CHUNKS } from '$lib/plan/fixtures/grid-20x20';
import type { ChunksResponse } from './protocol';
import {
  cellsIntersecting,
  createChunkLoader,
  type ChunkLoaderDeps,
  type FetchLike
} from './chunks';

type Report = Omit<ChunksResponse, 'type'>;
type Resp = Awaited<ReturnType<FetchLike>>;

const VERSION = 'fixture-1';
const urlOf = (cellId: string) => `/data/${VERSION}/chunks/${cellId}.json`;

function makeManifest(cellIds: string[], bboxes?: number[][]): Manifest {
  return {
    datasetVersion: VERSION,
    builtAt: '2026-10-01T00:00:00Z',
    sources: [],
    chunks: cellIds.map((cellId, i) => ({
      cellId,
      bbox: (bboxes?.[i] ?? [i, 0, i + 1, 1]) as [number, number, number, number],
      url: urlOf(cellId),
      parcelCount: 1
    })),
    buildingsTiles: `/data/${VERSION}/buildings`,
    basemapTiles: `/data/${VERSION}/basemap`,
    glyphs: `/data/${VERSION}/glyphs`,
    neighborhoods: `/data/${VERSION}/neighborhoods.json`
  };
}

const REC = GRID_CHUNKS[0].records.slice(0, 3);
const body = (cellId: string, version = VERSION, recs: ParcelRecord[] = REC): unknown =>
  JSON.parse(encodeParcelChunk(version, cellId, recs));
const okResp = (raw: unknown): Resp => ({ ok: true, status: 200, json: async () => raw });
const notFound: Resp = { ok: false, status: 404, json: async () => ({}) };

/** Lets pending promise chains (fetch → json → decode) run to completion. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

interface Harness {
  deps: ChunkLoaderDeps;
  calls: string[];
  reports: Report[];
  loaded: [string, ParcelRecord[]][];
  routes: Map<string, () => Promise<Resp>>;
}

function harness(overrides: Partial<ChunkLoaderDeps> = {}): Harness {
  const calls: string[] = [];
  const reports: Report[] = [];
  const loaded: [string, ParcelRecord[]][] = [];
  const routes = new Map<string, () => Promise<Resp>>();
  const deps: ChunkLoaderDeps = {
    fetch: (url) => {
      calls.push(url);
      const r = routes.get(url);
      return r ? r() : Promise.resolve(notFound);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    retryDelaysMs: [1000, 4000, 16000],
    maxConcurrent: 4,
    onLoaded: (cellId, records) => loaded.push([cellId, records]),
    onReport: (r) => reports.push(structuredClone(r)),
    ...overrides
  };
  return { deps, calls, reports, loaded, routes };
}

/** A route whose response is resolved by hand. */
function deferred(h: Harness, cellId: string) {
  let resolve!: (r: Resp) => void;
  h.routes.set(urlOf(cellId), () => new Promise<Resp>((r) => (resolve = r)));
  return { resolve: (r: Resp) => resolve(r) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createChunkLoader', () => {
  it('fetches each wanted chunk once and never refetches while loading or ready', async () => {
    const h = harness();
    const d = deferred(h, 'a');
    const loader = createChunkLoader(makeManifest(['a', 'b']), h.deps);
    loader.want(['a', 'zzz']);
    loader.want(['a']);
    expect(h.calls).toEqual([urlOf('a')]);
    d.resolve(okResp(body('a')));
    await settle();
    expect(loader.isReady('a')).toBe(true);
    loader.want(['a']);
    expect(h.calls).toEqual([urlOf('a')]);
  });

  it('keeps at most maxConcurrent fetches in flight', async () => {
    const h = harness();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const ds = ids.map((id) => deferred(h, id));
    const loader = createChunkLoader(makeManifest(ids), h.deps);
    loader.want(ids);
    expect(h.calls).toEqual(['a', 'b', 'c', 'd'].map(urlOf));
    ds[1].resolve(okResp(body('b')));
    await settle();
    expect(h.calls).toEqual(['a', 'b', 'c', 'd', 'e'].map(urlOf));
  });

  it('backs off on the real schedule, then reports the chunk failed', async () => {
    const h = harness();
    const loader = createChunkLoader(makeManifest(['a']), h.deps);
    loader.want(['a']);
    await settle();
    expect(h.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.length).toBe(3);
    await vi.advanceTimersByTimeAsync(15999);
    expect(h.calls.length).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.length).toBe(4);
    await settle();
    const last = h.reports.at(-1)!;
    expect(last).toEqual({ status: { a: 'error' }, pending: 0, failed: ['a'] });
    expect(loader.isReady('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls.length).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retryFailed starts a fresh cycle immediately and reports loading again', async () => {
    const h = harness();
    const loader = createChunkLoader(makeManifest(['a']), h.deps);
    loader.want(['a']);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(h.calls.length).toBe(4);
    expect(h.reports.at(-1)!.failed).toEqual(['a']);
    loader.retryFailed();
    expect(h.calls.length).toBe(5);
    expect(h.reports.at(-1)).toEqual({ status: { a: 'loading' }, pending: 1, failed: [] });
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(h.calls.length).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls.length).toBe(6);
  });

  const badBodies: [string, () => Resp][] = [
    ['a datasetVersion mismatch', () => okResp(body('a', 'fixture-9'))],
    ['a cellId mismatch', () => okResp(body('b'))],
    [
      'json() throwing',
      () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        }
      })
    ],
    ['an unknown format', () => okResp({ format: 'nope', datasetVersion: VERSION, cellId: 'a' })],
    ['a non-object body', () => okResp(null)]
  ];
  for (const [name, make] of badBodies) {
    it(`treats ${name} as a retried failure`, async () => {
      const h = harness();
      h.routes.set(urlOf('a'), async () => make());
      const loader = createChunkLoader(makeManifest(['a', 'b']), h.deps);
      loader.want(['a']);
      await settle();
      expect(loader.isReady('a')).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.calls).toEqual([urlOf('a'), urlOf('a')]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(h.reports.at(-1)!.failed).toEqual(['a']);
      expect(h.loaded).toEqual([]);
    });
  }

  it('passes decoded records to onLoaded with isReady already true', async () => {
    let readyInside: boolean | undefined;
    const h = harness({
      onLoaded: (cellId, records) => {
        readyInside = loader.isReady(cellId);
        h.loaded.push([cellId, records]);
      }
    });
    h.routes.set(urlOf('a'), async () => okResp(body('a')));
    const loader = createChunkLoader(makeManifest(['a']), h.deps);
    loader.want(['a']);
    await settle();
    expect(readyInside).toBe(true);
    expect(h.loaded.length).toBe(1);
    expect(h.loaded[0][0]).toBe('a');
    expect(h.loaded[0][1].map((r) => r.id)).toEqual(REC.map((r) => r.id).sort());
  });

  it('keeps the chunk ready when onLoaded throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness({
      onLoaded: () => {
        throw new Error('boom');
      }
    });
    h.routes.set(urlOf('a'), async () => okResp(body('a')));
    const loader = createChunkLoader(makeManifest(['a']), h.deps);
    loader.want(['a']);
    await settle();
    expect(loader.isReady('a')).toBe(true);
    expect(err).toHaveBeenCalled();
    expect(h.calls.length).toBe(1);
  });

  it('reports loading then ready for one successful chunk', async () => {
    const h = harness();
    const d = deferred(h, 'c');
    const loader = createChunkLoader(makeManifest(['c']), h.deps);
    loader.want(['c']);
    d.resolve(okResp(body('c')));
    await settle();
    expect(h.reports).toEqual([
      { status: { c: 'loading' }, pending: 1, failed: [] },
      { status: { c: 'ready' }, pending: 0, failed: [] }
    ]);
  });

  it('includes every loading or error cell in each report', async () => {
    const h = harness();
    deferred(h, 'a');
    const dB = deferred(h, 'b');
    const loader = createChunkLoader(makeManifest(['a', 'b']), h.deps);
    loader.want(['a', 'b']);
    expect(h.reports).toEqual([{ status: { a: 'loading', b: 'loading' }, pending: 2, failed: [] }]);
    dB.resolve(okResp(body('b')));
    await settle();
    expect(h.reports.at(-1)).toEqual({
      status: { a: 'loading', b: 'ready' },
      pending: 1,
      failed: []
    });
  });

  it('drops in-flight results and clears retry timers after dispose', async () => {
    const h = harness();
    const dA = deferred(h, 'a');
    const loader = createChunkLoader(makeManifest(['a', 'b']), h.deps);
    loader.want(['a', 'b']);
    await settle();
    expect(vi.getTimerCount()).toBe(1); // b is waiting on its first retry
    const before = h.reports.length;
    loader.dispose();
    expect(vi.getTimerCount()).toBe(0);
    dA.resolve(okResp(body('a')));
    await settle();
    expect(h.loaded).toEqual([]);
    expect(h.reports.length).toBe(before);
    expect(loader.isReady('a')).toBe(false);
  });
});

describe('cellsIntersecting', () => {
  const m = makeManifest(
    ['x', 'y', 'z'],
    [
      [2, 0, 3, 1],
      [0, 0, 1, 1],
      [1, 0, 2, 1]
    ]
  );
  it('treats touching edges as intersecting and keeps manifest order', () => {
    expect(cellsIntersecting(m, [1, 0.5, 1, 0.5])).toEqual(['y', 'z']);
    expect(cellsIntersecting(m, [1, 0.5, 2, 0.5])).toEqual(['x', 'y', 'z']);
    expect(cellsIntersecting(m, [3, 1, 4, 2])).toEqual(['x']);
    expect(cellsIntersecting(m, [0.2, 0.2, 0.8, 0.8])).toEqual(['y']);
    expect(cellsIntersecting(m, [5, 5, 6, 6])).toEqual([]);
    expect(cellsIntersecting(m, [-1, -1, 10, 10])).toEqual(['x', 'y', 'z']);
  });
});
