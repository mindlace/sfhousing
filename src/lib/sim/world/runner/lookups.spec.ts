// The timeline host's shared lookups (ensemble-runner Task 3), differential against the old
// scenario host on the mini city: a lever session on `DEFAULT_LEVERS`, before any `setLevers`, so
// the old host answers on the base parcels with nothing protected.
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
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import type { ParcelSummary } from '$lib/sim/protocol';
import { MINI_NEIGHBORHOOD } from '$lib/sim/scenario/fixtures/mini-brushes';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { MINI_AS_OF } from '$lib/sim/scenario/fixtures/mini-projects';
import { scenarioUrls } from '$lib/sim/scenario/load';
import { massingFor } from '$lib/sim/scenario/massing';
import { PREVIEW_MAX_LOTS } from '$lib/sim/scenario/preview';
import type { ScenarioHostDeps } from '$lib/sim/scenario/scenario-host';
import {
  MINI_TRANSIT_URL,
  makeScenarioHarness,
  type ScenarioHarness
} from '$lib/sim/scenario/test/host-harness';
import type { ScenarioResponse, Schedule } from '$lib/sim/scenario/types';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './dataset';
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
const OTHER_LOADED_LOT: ParcelId = '0026T014';
const UNLOADED_LOT: ParcelId = '2999A001';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;
const LOADED_CELL = cellOf(LOADED_LOT);

function bboxOf(cellId: string): [number, number, number, number] {
  const c = city.manifest.chunks.find((x) => x.cellId === cellId)!;
  const x = (c.bbox[0] + c.bbox[2]) / 2;
  const y = (c.bbox[1] + c.bbox[3]) / 2;
  return [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6];
}
const labelOf = (id: ParcelId): [number, number] => {
  const i = city.parcels.index.get(id)!;
  return [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
};

const STROKE: [number, number][] = [labelOf('0026T001A'), labelOf('0026T006')];
const FREEHAND: BrushQuery = { kind: 'freehand', strokes: [{ path: STROKE, radiusM: 30 }] };
const TRANSIT: BrushQuery = { kind: 'transit', stopTypes: ['regionalRail', 'metro'], maxM: 5 };
const AREA: BrushQuery = { kind: 'area', districts: [], neighborhoods: [MINI_NEIGHBORHOOD] };

let warnSpy: MockInstance<typeof console.warn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warnSpy.mockRestore());

/** An old lever session, loaded, with `LOADED_CELL` prefetched and its timeline run out. */
async function oldSession(deps: Partial<ScenarioHostDeps> = {}): Promise<ScenarioHarness> {
  const h = makeScenarioHarness({ deps: { bandRuns: 2, ...deps }, policy: true });
  h.init({ levers: structuredClone(DEFAULT_LEVERS) });
  await h.flush();
  h.host.handle({ type: 'prefetch', bbox: bboxOf(LOADED_CELL) });
  await h.runAll();
  expect(h.errors()).toEqual([]);
  return h;
}

let reqId = 1000;
/** The old host's one post for a request it answers (after settling). */
async function ask<T extends ScenarioResponse['type']>(
  h: ScenarioHarness,
  req: Parameters<ScenarioHarness['host']['handle']>[0] & { reqId: number },
  type: T
): Promise<Extract<ScenarioResponse, { type: T }>> {
  h.host.handle(req);
  await h.flush();
  const ps = h.posts.filter(
    (m) => m.type === type && (m as { reqId?: number }).reqId === req.reqId
  ) as Extract<ScenarioResponse, { type: T }>[];
  expect(ps).toHaveLength(1);
  return ps[0];
}

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

describe('differential against the old host', () => {
  let h: ScenarioHarness;
  let ds: Dataset;
  beforeAll(async () => {
    h = await oldSession();
    ds = await newDataset(h);
  });

  it('brush answers equal the old host’s', async () => {
    const b = brushService(ds, mapFetch(h.bodies));
    const queries: (BrushQuery | null)[] = [FREEHAND, TRANSIT, AREA, null];
    for (const q of queries) {
      const id = ++reqId;
      const old =
        q === null
          ? await ask(h, { type: 'brushCatalog', reqId: id }, 'brushCatalog')
          : await ask(h, { type: 'resolveBrush', reqId: id, query: q }, 'brushLots');
      b.svc.request(id, q);
      await settle();
      const mine = b.of(id);
      expect(mine).toHaveLength(1);
      expect(mine[0].msg).toEqual(old);
      if (old.type === 'brushLots') {
        expect(old.result.ok).toBe(true);
        const k = h.posts.indexOf(old);
        expect(mine[0].transfer.map((t) => t.byteLength)).toEqual(
          h.transfers[k].map((t) => t.byteLength)
        );
      } else {
        expect(old.catalog).not.toBeNull();
      }
    }
  });

  it('a bad brush query is the old host’s bad-request', async () => {
    const b = brushService(ds, mapFetch(h.bodies));
    const id = ++reqId;
    const q = { kind: 'transit', stopTypes: ['ferry'], maxM: 100 } as unknown as BrushQuery;
    const old = await ask(h, { type: 'resolveBrush', reqId: id, query: q }, 'brushLots');
    b.svc.request(id, q);
    expect(b.of(id).map((p) => p.msg)).toEqual([old]);
    expect(old.result).toMatchObject({ ok: false, reason: 'bad-request' });
  });

  it('lotOutlinesResult equals the old host’s lotOutlines', async () => {
    const lots = [LOADED_LOT, UNLOADED_LOT, OTHER_LOADED_LOT];
    const id = ++reqId;
    const old = await ask(h, { type: 'lotOutlines', reqId: id, lots }, 'lotOutlines');
    const mine = lotOutlinesResult(ds.chunks.records, lots);
    expect(mine.result).toEqual(old.result);
    expect(mine.result).toMatchObject({ ok: true, missing: 1 });
    expect(mine.transfer).toHaveLength(3);
  });

  it('lotAtResult equals the old host’s lotAt', async () => {
    for (const point of [
      labelOf(LOADED_LOT),
      labelOf(OTHER_LOADED_LOT),
      [0, 0] as [number, number]
    ]) {
      const id = ++reqId;
      const old = await ask(h, { type: 'lotAt', reqId: id, point }, 'lotAt');
      if (!old.result.ok) throw new Error(old.result.message);
      const oldOwner = old.result.owner;
      const asked: ParcelId[] = [];
      const mine = lotAtResult(ds.manifest, ds.chunks.byCell, point, (pid) => {
        asked.push(pid);
        return oldOwner;
      });
      expect(mine).toEqual(old.result);
      expect(asked).toEqual(old.result.parcelId === null ? [] : [old.result.parcelId]);
    }
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

  it('previewResult equals the old host’s previewBuildings', async () => {
    const lots = [LOADED_LOT, OTHER_LOADED_LOT, UNLOADED_LOT, LOADED_LOT];
    for (const stories of [40, 5]) {
      const id = ++reqId;
      const old = await ask(
        h,
        { type: 'previewBuildings', reqId: id, lots, stories },
        'previewBuildings'
      );
      const mine = previewOf(lots, stories, () => false);
      expect(mine.result).toEqual(old.result);
      expect(mine.result).toMatchObject({ ok: true, built: 2, missing: 1 });
      const k = h.posts.indexOf(old);
      expect(mine.transfer.length).toBe(h.transfers[k].length);
    }
  });

  it('previewResult skips a protected row', async () => {
    const row = ds.loaded.fzp.parcels.index.get(LOADED_LOT)!;
    const id = ++reqId;
    const old = await ask(
      h,
      { type: 'previewBuildings', reqId: id, lots: [OTHER_LOADED_LOT, UNLOADED_LOT], stories: 40 },
      'previewBuildings'
    );
    const mine = previewOf([LOADED_LOT, OTHER_LOADED_LOT, UNLOADED_LOT], 40, (r) => r === row);
    expect(mine.result).toEqual(old.result);
    expect(mine.result).toMatchObject({ ok: true, built: 1, missing: 1 });
  });

  async function oldSummary(hh: ScenarioHarness, parcelId: ParcelId): Promise<ParcelSummary> {
    const id = ++reqId;
    const p = await ask(
      hh,
      { type: 'parcelSummary', reqId: id, parcelId, day: MINI_AS_OF },
      'parcelSummary'
    );
    expect(p.summary?.limits?.protected).toBe(false);
    return p.summary!;
  }

  it('buildableStories equals the old host’s limits.buildable (generator path)', async () => {
    const s = await oldSummary(h, LOADED_LOT);
    const got = buildableStories(
      {
        parcels: ds.loaded.fzp.parcels,
        records: ds.chunks.records,
        memo: createLru(10),
        gen: generate
      },
      LOADED_LOT,
      s.limits!.allowed,
      s.existingUnits
    );
    expect(got).toBe(s.limits!.buildable);
  });

  it('buildableStories equals the old host’s limits.buildable (lotBuildableStories fallback)', async () => {
    const none = () => null;
    const hn = await oldSession({ generate: none });
    const dn = await newDataset(hn, none);
    const s = await oldSummary(hn, LOADED_LOT);
    const spy = vi.fn(none);
    const got = buildableStories(
      { parcels: dn.loaded.fzp.parcels, records: dn.chunks.records, memo: createLru(10), gen: spy },
      LOADED_LOT,
      s.limits!.allowed,
      s.existingUnits
    );
    expect(got).toBe(s.limits!.buildable);
    expect(spy).toHaveBeenCalledTimes(1);
    const rec = dn.chunks.records.get(LOADED_LOT)!;
    expect(got).toBe(lotBuildableStories(rec.polygon, s.limits!.allowed, s.existingUnits));
  });

  it('cardDepsOf: the record and buildable stories of the old card', async () => {
    const logged: [string, string][] = [];
    const deps = cardDepsOf(
      ds,
      () => ds.loaded.fzp.parcels,
      (k, m) => logged.push([k, m])
    );
    const s = await oldSummary(h, LOADED_LOT);
    const rec = deps.record(LOADED_LOT)!;
    expect({
      neighborhood: rec.neighborhood,
      landUse: rec.landUse,
      eligible: rec.eligible
    }).toEqual({
      neighborhood: s.neighborhood,
      landUse: s.landUse,
      eligible: s.eligible
    });
    expect(deps.record(UNLOADED_LOT)).toBeNull();
    expect(deps.buildable(LOADED_LOT, s.limits!.allowed, s.existingUnits)).toBe(
      s.limits!.buildable
    );
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
