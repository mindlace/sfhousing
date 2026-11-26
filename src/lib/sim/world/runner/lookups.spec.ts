// The timeline host's brush service files (ensemble-runner Task 3), on the mini city.
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru } from '$lib/sim/lru';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { scenarioUrls } from '$lib/sim/scenario/load';
import {
  MINI_TRANSIT_URL,
  makeScenarioHarness,
  type ScenarioHarness
} from '$lib/sim/scenario/test/host-harness';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './dataset';
import { createBrushService } from './lookups';
import { fakeClock, mapFetch, type MapFetch } from './test/harness';

const city = miniCity();
const LOADED_LOT: ParcelId = '0026T009';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;
const LOADED_CELL = cellOf(LOADED_LOT);

function bboxOf(cellId: string): [number, number, number, number] {
  const c = city.manifest.chunks.find((x) => x.cellId === cellId)!;
  const x = (c.bbox[0] + c.bbox[2]) / 2;
  const y = (c.bbox[1] + c.bbox[3]) / 2;
  return [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6];
}
let warnSpy: MockInstance<typeof console.warn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warnSpy.mockRestore());

const settle = async () => {
  for (let k = 0; k < 6; k++) await new Promise((r) => setImmediate(r));
};

/** The new dataset over the old harness's bodies, with `LOADED_CELL` loaded. */
async function newDataset(h: ScenarioHarness, gen = generate): Promise<Dataset> {
  const manifest = h.manifest();
  const f = mapFetch(h.bodies);
  const deps: DatasetDeps = {
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    later: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (x) => clearTimeout(x as ReturnType<typeof setTimeout>),
    now: () => 0,
    warn: () => {},
    retryDelaysMs: [],
    maxConcurrent: 4,
    stopped: () => false,
    onChunk: () => {},
    onChunksReport: () => {}
  };
  const chunks = createChunkSet(manifest, deps);
  const ds = await loadDataset(
    manifest,
    scenarioUrls(manifest)!,
    chunks,
    deps,
    createLru<string, GeneratedBuilding | null>(1000),
    { gen, genForUnits: generateForUnits, logOnce: () => {} }
  );
  if ('code' in ds) throw new Error(ds.message);
  chunks.prefetch(bboxOf(LOADED_CELL));
  for (let k = 0; k < 1000 && !chunks.byCell.has(LOADED_CELL); k++) await settle();
  expect(chunks.byCell.has(LOADED_CELL)).toBe(true);
  return ds;
}

interface Posted {
  msg: TimelineHostResponse;
  transfer: ArrayBuffer[];
}

function brushService(
  ds: Dataset,
  f: MapFetch,
  o: { later?: (fn: () => void, ms: number) => unknown; retryDelaysMs?: readonly number[] } = {}
) {
  const posted: Posted[] = [];
  const svc = createBrushService({
    manifest: ds.manifest,
    parcels: ds.loaded.fzp.parcels,
    policy: ds.loaded.policy!,
    fetch: f.fetch,
    later: o.later ?? ((fn, ms) => setTimeout(fn, ms)),
    retryDelaysMs: o.retryDelaysMs ?? [],
    stopped: () => false,
    warn: () => {},
    post: (msg, transfer) => posted.push({ msg, transfer })
  });
  const of = (id: number) => posted.filter((p) => (p.msg as { reqId?: number }).reqId === id);
  return { svc, posted, of };
}

describe('createBrushService files', () => {
  let ds: Dataset;
  let h: ScenarioHarness;
  beforeAll(async () => {
    h = makeScenarioHarness({ policy: true });
    ds = await newDataset(h);
  });
  const Q: BrushQuery = { kind: 'transit', stopTypes: ['metro'], maxM: 100 };

  it.each([400, 404, 410])('a %i brush file is permanent: one request', async (status) => {
    const f = mapFetch(h.bodies);
    const clock = fakeClock();
    const b = brushService(ds, f, { later: clock.setTimeout, retryDelaysMs: [1000, 4000, 16000] });
    f.fail(MINI_TRANSIT_URL, 1, { status });
    b.svc.request(1, Q);
    await clock.runUntil(() => b.of(1).length > 0);
    b.svc.request(2, Q);
    await clock.runUntil(() => b.of(2).length > 0);
    for (const id of [1, 2])
      expect(b.of(id)[0].msg).toMatchObject({ result: { ok: false, reason: 'data-missing' } });
    expect(f.fetchesOf(MINI_TRANSIT_URL)).toHaveLength(1);
    expect(clock.now()).toBe(0); // no retry delay
  });

  it('a 5xx is retried with the delays and not cached', async () => {
    const f = mapFetch(h.bodies);
    const clock = fakeClock();
    const b = brushService(ds, f, { later: clock.setTimeout, retryDelaysMs: [1000, 4000, 16000] });
    f.fail(MINI_TRANSIT_URL, 4, { status: 500 });
    b.svc.request(1, Q);
    await clock.runUntil(() => b.of(1).length > 0);
    expect(b.of(1)[0].msg).toMatchObject({ result: { ok: false, reason: 'data-missing' } });
    expect(f.fetchesOf(MINI_TRANSIT_URL)).toHaveLength(4);
    expect(clock.now()).toBe(21_000);
    b.svc.request(2, Q);
    await clock.runUntil(() => b.of(2).length > 0);
    expect(b.of(2)[0].msg).toMatchObject({ result: { ok: true } });
    expect(f.fetchesOf(MINI_TRANSIT_URL)).toHaveLength(5);
    b.svc.request(3, Q);
    await clock.runUntil(() => b.of(3).length > 0);
    expect(f.fetchesOf(MINI_TRANSIT_URL)).toHaveLength(5); // cached once loaded
  });

  it('end answers a waiting request no-session, once', async () => {
    const f = mapFetch(h.bodies);
    const clock = fakeClock();
    const b = brushService(ds, f, { later: clock.setTimeout, retryDelaysMs: [1000] });
    f.fail(MINI_TRANSIT_URL, 1, { status: 503 });
    b.svc.request(1, Q);
    b.svc.request(2, null);
    await settle();
    expect(b.posted).toEqual([]);
    b.svc.end();
    expect(b.of(1).map((p) => p.msg)).toEqual([
      {
        type: 'brushLots',
        reqId: 1,
        result: {
          ok: false,
          reason: 'no-session',
          message: 'brushes need a loaded session initialised with levers'
        }
      }
    ]);
    expect(b.of(2).map((p) => p.msg)).toEqual([{ type: 'brushCatalog', reqId: 2, catalog: null }]);
    while (await clock.runNext());
    expect(b.posted).toHaveLength(2);
  });
});
