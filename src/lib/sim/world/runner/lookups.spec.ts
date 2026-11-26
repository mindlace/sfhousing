// The timeline host's brush service files (ensemble-runner Task 3), on the mini city.
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import {
  generate,
  generateForUnits,
  lotBuildableStories,
  type GeneratedBuilding
} from '$lib/generator';
import { createLru } from '$lib/sim/lru';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { scenarioUrls } from '$lib/sim/scenario/load';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { MINI_TRANSIT_URL, miniDataset, type MiniDataset } from '../test/mini-dataset';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './dataset';
import { MINI_AS_OF } from '$lib/sim/scenario/fixtures/mini-projects';
import { massingFor } from '$lib/sim/scenario/massing';
import { PREVIEW_MAX_LOTS } from '$lib/sim/world/runner/budget';
import type { Schedule } from '$lib/sim/scenario/types';
import {
  buildableStories,
  cardDepsOf,
  createBrushService,
  lotAtResult,
  lotOutlinesResult,
  previewResult
} from './lookups';
import { fakeClock, mapFetch, type MapFetch } from './test/harness';

const city = miniCity();
const LOADED_LOT: ParcelId = '0026T009';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;
const OTHER_LOADED_LOT: ParcelId = '0026T014';
const UNLOADED_LOT: ParcelId = '2999A001';
const LOADED_CELL = cellOf(LOADED_LOT);
const labelOf = (id: ParcelId): [number, number] => {
  const i = city.parcels.index.get(id)!;
  return [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
};

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

/** The dataset over the mini city's bodies, with `LOADED_CELL` loaded. */
async function newDataset(h: MiniDataset, gen = generate): Promise<Dataset> {
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
  let h: MiniDataset;
  beforeAll(async () => {
    h = miniDataset({ policy: true });
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

describe('direct lookups on the mini city', () => {
  let ds: Dataset;
  beforeAll(async () => {
    ds = await newDataset(miniDataset({ policy: true }));
  });

  it('lotOutlinesResult answers the loaded lots and counts the missing', () => {
    const lots = [LOADED_LOT, UNLOADED_LOT, OTHER_LOADED_LOT];
    const { result, transfer } = lotOutlinesResult(ds.chunks.records, lots);
    expect(result).toMatchObject({ ok: true, missing: 1 });
    expect(transfer).toHaveLength(3);
    expect(lotOutlinesResult(ds.chunks.records, [UNLOADED_LOT]).result).toMatchObject({
      ok: true,
      missing: 1
    });
  });

  it('lotAtResult finds the lot at its label point and asks the owner once', () => {
    for (const id of [LOADED_LOT, OTHER_LOADED_LOT]) {
      const asked: ParcelId[] = [];
      const got = lotAtResult(ds.manifest, ds.chunks.byCell, labelOf(id), (pid) => {
        asked.push(pid);
        return null;
      });
      expect(got.ok).toBe(true);
      if (got.ok) expect(got.parcelId).toBe(id);
      expect(asked).toEqual([id]);
    }
  });

  it('lotAtResult asks no owner where no lot is', () => {
    const asked: ParcelId[] = [];
    const got = lotAtResult(ds.manifest, ds.chunks.byCell, [0, 0], (pid) => {
      asked.push(pid);
      return null;
    });
    expect(got).toMatchObject({ ok: true, parcelId: null });
    expect(asked).toEqual([]);
  });

  const previewOf = (lots: ParcelId[], stories: number, prot: (row: number) => boolean) =>
    previewResult({
      parcels: ds.loaded.fzp.parcels,
      protectedRow: prot,
      records: ds.chunks.records,
      memo: createLru(1000),
      gen: generate,
      lots,
      stories,
      maxLots: PREVIEW_MAX_LOTS
    });

  it('previewResult builds the loaded lots and counts the missing', () => {
    const lots = [LOADED_LOT, OTHER_LOADED_LOT, UNLOADED_LOT, LOADED_LOT];
    for (const stories of [40, 5]) {
      const { result, transfer } = previewOf(lots, stories, () => false);
      expect(result).toMatchObject({ ok: true, built: 2, missing: 1 });
      expect(transfer.length).toBeGreaterThan(0);
    }
  });

  it('previewResult skips a protected row', () => {
    const row = ds.loaded.fzp.parcels.index.get(LOADED_LOT)!;
    const { result } = previewOf(
      [LOADED_LOT, OTHER_LOADED_LOT, UNLOADED_LOT],
      40,
      (r) => r === row
    );
    expect(result).toMatchObject({ ok: true, built: 1, missing: 1 });
  });

  it('buildableStories is the generator’s stories, at most the allowed', () => {
    const deps = {
      parcels: ds.loaded.fzp.parcels,
      records: ds.chunks.records,
      memo: createLru<string, GeneratedBuilding | null>(10),
      gen: generate
    };
    const low = buildableStories(deps, LOADED_LOT, 2, 0);
    const high = buildableStories(deps, LOADED_LOT, 40, 0);
    expect(high).not.toBeNull();
    expect(low === null ? 0 : low).toBeLessThanOrEqual(2);
    expect(high!).toBeLessThanOrEqual(40);
    expect(high!).toBeGreaterThanOrEqual(low ?? 0);
  });

  it('buildableStories falls back to the lot’s polygon when the generator gives nothing', () => {
    const spy = vi.fn(() => null);
    const got = buildableStories(
      {
        parcels: ds.loaded.fzp.parcels,
        records: ds.chunks.records,
        memo: createLru(10),
        gen: spy
      },
      LOADED_LOT,
      40,
      0
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const rec = ds.chunks.records.get(LOADED_LOT)!;
    expect(got).toBe(lotBuildableStories(rec.polygon, 40, 0));
  });

  it('cardDepsOf: record, quality rules and the once-only log', () => {
    const logged: [string, string][] = [];
    const deps = cardDepsOf(
      ds,
      () => ds.loaded.fzp.parcels,
      (k, m) => logged.push([k, m])
    );
    const rec = deps.record(LOADED_LOT)!;
    expect(rec).toBe(ds.chunks.records.get(LOADED_LOT));
    expect(deps.record(UNLOADED_LOT)).toBeNull();
    expect(deps.qualityRules).toEqual(
      new Map(ds.loaded.projects.qualityRules.map((q) => [q.id, q]))
    );
    deps.logOnce('x', 'm');
    expect(logged).toEqual([['card:x', 'm']]);
  });

  it('cardDepsOf.building masses only a schedule whose cells are all loaded', () => {
    const deps = cardDepsOf(
      ds,
      () => ds.loaded.fzp.parcels,
      () => {}
    );
    const sched = (parcelIds: ParcelId[]): Schedule => ({
      projectId: `sim:${parcelIds[0]}`,
      origin: 'simulated',
      parcelIds,
      pathway: 'discretionary',
      entered: {},
      end: { kind: 'open' },
      revisions: [{ day: MINI_AS_OF, units: 20, stories: 5 }],
      existingUnits: 0,
      multiPhase: false,
      phase: null
    });
    const drawn = sched([LOADED_LOT]);
    expect(deps.building(drawn, 0)).toEqual(massingFor(drawn, 0, ds.massing));
    expect('footprint' in deps.building(drawn, 0)).toBe(false);
    expect(deps.building(sched([LOADED_LOT, UNLOADED_LOT]), 0)).toEqual({ footprint: [] });
    expect(deps.building(sched(['NOT-IN-T11']), 0)).toEqual({ footprint: [] });
  });
});
