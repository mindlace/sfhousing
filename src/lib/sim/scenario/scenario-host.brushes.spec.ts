// The scenario host's brush requests (plan 3 Task 5): `resolveBrush` and `brushCatalog`, answered
// only in a lever session, after load; the optional brush files fetched lazily, once per session.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { createLotIndex, type BrushQuery } from '../levers/brushes';
import { DEFAULT_LEVERS } from '../levers/types';
import {
  MINI_AVE_DEEP,
  MINI_AVE_FRONT,
  MINI_NEIGHBORHOOD,
  MINI_STREETS,
  MINI_ST_LOTS,
  MINI_STOP_LOTS
} from './fixtures/mini-frontage';
import { miniCity } from './fixtures/mini-parcels';
import {
  MINI_FRONTAGE_URL,
  MINI_NEIGHBORHOODS_URL,
  MINI_TRANSIT_URL,
  makeScenarioHarness,
  type ScenarioHarness
} from './test/host-harness';
import type { BrushLotsResult, ScenarioResponse } from './types';

type BrushLotsPost = Extract<ScenarioResponse, { type: 'brushLots' }>;
type CatalogPost = Extract<ScenarioResponse, { type: 'brushCatalog' }>;

const city = miniCity();
const BRUSH_URLS = [MINI_FRONTAGE_URL, MINI_TRANSIT_URL, MINI_NEIGHBORHOODS_URL];

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

function harness(opts: Parameters<typeof makeScenarioHarness>[0] = {}): ScenarioHarness {
  return makeScenarioHarness({ deps: { bandRuns: 2 }, policy: true, ...opts });
}
const initLevers = (h: ScenarioHarness) => h.init({ levers: structuredClone(DEFAULT_LEVERS) });

let reqId = 0;
function resolve(h: ScenarioHarness, query: unknown): number {
  const id = ++reqId;
  h.host.handle({ type: 'resolveBrush', reqId: id, query: query as BrushQuery });
  return id;
}
function catalog(h: ScenarioHarness): number {
  const id = ++reqId;
  h.host.handle({ type: 'brushCatalog', reqId: id });
  return id;
}
const lotsPosts = (h: ScenarioHarness, id: number): BrushLotsPost[] =>
  h.posts.filter((m): m is BrushLotsPost => m.type === 'brushLots' && m.reqId === id);
const catalogPosts = (h: ScenarioHarness, id: number): CatalogPost[] =>
  h.posts.filter((m): m is CatalogPost => m.type === 'brushCatalog' && m.reqId === id);
function only(h: ScenarioHarness, id: number): BrushLotsResult {
  const ps = lotsPosts(h, id);
  expect(ps).toHaveLength(1);
  return ps[0].result;
}
const lotsOf = (r: BrushLotsResult): ParcelId[] => {
  if (!r.ok) throw new Error(`not ok: ${r.reason} ${r.message}`);
  return r.lots;
};
const eligible = (ids: ParcelId[]) =>
  ids.filter((id) => city.parcels.eligible[city.parcels.index.get(id)!] === 1);
const labelOf = (id: ParcelId): [number, number] => {
  const i = city.parcels.index.get(id)!;
  return [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
};

/** A stroke along the first row of cell 50_25. */
const STROKE: [number, number][] = [labelOf('0026T001A'), labelOf('0026T006')];
const FREEHAND: BrushQuery = { kind: 'freehand', strokes: [{ path: STROKE, radiusM: 30 }] };

describe('resolveBrush', () => {
  it('waits for the load, then answers the mini city lots with their label points', async () => {
    const h = harness();
    initLevers(h);
    const id = resolve(h, FREEHAND);
    expect(lotsPosts(h, id)).toEqual([]);
    await h.flush();
    const r = only(h, id);
    const want = eligible(
      createLotIndex(city.parcels)
        .nearPath(STROKE, 30)
        .map((row) => city.parcels.id[row])
    );
    expect(want.length).toBeGreaterThan(2);
    expect(lotsOf(r)).toEqual(want);
    if (!r.ok) return;
    expect(r.points).toBeInstanceOf(Float64Array);
    expect(r.points.length).toBe(2 * r.lots.length);
    expect([...r.points]).toEqual(r.lots.flatMap(labelOf));
    // the points buffer is transferred
    const k = h.posts.findIndex((m) => m.type === 'brushLots' && m.reqId === id);
    expect(h.transfers[k]).toEqual([r.points.buffer]);
  });

  it('a freehand query fetches none of the brush files', async () => {
    const h = harness();
    initLevers(h);
    resolve(h, FREEHAND);
    await h.runAll();
    for (const url of BRUSH_URLS) expect(h.fetchesOf(url)).toEqual([]);
  });

  it('street, transit and area queries fetch their file once and resolve on it', async () => {
    const h = harness();
    initLevers(h);
    await h.flush();
    const street = resolve(h, {
      kind: 'street',
      classes: [],
      names: ['MINI AVE'],
      depth: 1,
      ncOnly: false
    });
    const street0 = resolve(h, {
      kind: 'street',
      classes: ['arterial'],
      names: [],
      depth: 0,
      ncOnly: false
    });
    const transit = resolve(h, { kind: 'transit', stopTypes: ['regionalRail', 'metro'], maxM: 5 });
    const area = resolve(h, { kind: 'area', districts: [], neighborhoods: [MINI_NEIGHBORHOOD] });
    await h.flush();
    expect(lotsOf(only(h, street))).toEqual(eligible([MINI_AVE_FRONT, MINI_AVE_DEEP]));
    expect(lotsOf(only(h, street0))).toEqual(MINI_ST_LOTS);
    expect(lotsOf(only(h, transit))).toEqual(MINI_STOP_LOTS.slice(0, 2));
    const inCell0 = city.parcels.id.filter((_, i) => city.parcels.cell[i] === 0);
    expect(lotsOf(only(h, area))).toEqual(eligible(inCell0));
    for (const url of BRUSH_URLS) expect(h.fetchesOf(url)).toHaveLength(1);
  });

  it('a street query without frontage is data-missing; one frontage request for two queries', async () => {
    const h = harness({ bodies: { [MINI_FRONTAGE_URL]: undefined } }); // a 404, default delays
    initLevers(h);
    const q = { kind: 'street', classes: ['arterial'], names: [], depth: 0, ncOnly: false };
    const a = resolve(h, q);
    await h.flush();
    const b = resolve(h, q);
    await h.flush();
    for (const id of [a, b]) {
      const r = only(h, id);
      expect(r).toMatchObject({ ok: false, reason: 'data-missing' });
    }
    expect(h.fetchesOf(MINI_FRONTAGE_URL)).toHaveLength(1);
    // a freehand query still resolves
    const c = resolve(h, FREEHAND);
    await h.flush();
    expect(only(h, c).ok).toBe(true);
  });

  it.each([400, 404, 410])(
    'a %i is permanent: data-missing after one request, with the default retry delays',
    async (status) => {
      const h = harness();
      initLevers(h);
      await h.flush();
      h.fail(MINI_FRONTAGE_URL, 1, { status });
      const q = { kind: 'street', classes: ['arterial'], names: [], depth: 0, ncOnly: false };
      const a = resolve(h, q);
      await h.flush(); // no retry timer: answered without advancing the clock
      expect(only(h, a)).toMatchObject({ ok: false, reason: 'data-missing' });
      const b = resolve(h, q);
      await h.flush();
      expect(only(h, b)).toMatchObject({ ok: false, reason: 'data-missing' });
      expect(h.fetchesOf(MINI_FRONTAGE_URL)).toHaveLength(1);
    }
  );

  it.each([
    ['a network error', 'reject' as const],
    ['a 503', { status: 503 }],
    ['a failed body read', 'body' as const]
  ])('%s is transient: the next identical query fetches again', async (_, how) => {
    const h = harness({ retryDelaysMs: [] });
    initLevers(h);
    await h.flush();
    h.fail(MINI_FRONTAGE_URL, 1, how);
    const q = { kind: 'street', classes: ['arterial'], names: [], depth: 0, ncOnly: false };
    const a = resolve(h, q);
    await h.flush();
    expect(only(h, a)).toMatchObject({ ok: false, reason: 'data-missing' });
    const b = resolve(h, q);
    await h.flush();
    expect(lotsOf(only(h, b))).toEqual(MINI_ST_LOTS);
    expect(h.fetchesOf(MINI_FRONTAGE_URL)).toHaveLength(2);
    // once loaded it stays cached
    const c = resolve(h, q);
    await h.flush();
    expect(only(h, c).ok).toBe(true);
    expect(h.fetchesOf(MINI_FRONTAGE_URL)).toHaveLength(2);
  });

  it('a 5xx is retried with the session delays before data-missing', async () => {
    const h = harness();
    initLevers(h);
    await h.flush();
    h.fail(MINI_FRONTAGE_URL, 4, { status: 500 });
    const q = { kind: 'street', classes: ['arterial'], names: [], depth: 0, ncOnly: false };
    const a = resolve(h, q);
    await h.flush();
    expect(lotsPosts(h, a)).toEqual([]);
    await h.advance(21_000);
    expect(only(h, a)).toMatchObject({ ok: false, reason: 'data-missing' });
    expect(h.fetchesOf(MINI_FRONTAGE_URL)).toHaveLength(4);
  });

  it('a bad file is cached: data-missing without another request', async () => {
    const h = harness({ bodies: { [MINI_TRANSIT_URL]: { format: 'nope' } } });
    initLevers(h);
    const q = { kind: 'transit', stopTypes: ['metro'], maxM: 100 };
    const a = resolve(h, q);
    await h.flush();
    const b = resolve(h, q);
    await h.flush();
    for (const id of [a, b]) expect(only(h, id)).toMatchObject({ reason: 'data-missing' });
    expect(h.fetchesOf(MINI_TRANSIT_URL)).toHaveLength(1);
  });

  it('a manifest without the file is data-missing, with no request', async () => {
    const h = harness();
    const m = h.manifest();
    delete m.transit;
    h.init({ manifest: m, levers: structuredClone(DEFAULT_LEVERS) });
    const id = resolve(h, { kind: 'transit', stopTypes: ['metro'], maxM: 100 });
    await h.flush();
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'data-missing' });
    expect(h.fetchesOf(MINI_TRANSIT_URL)).toEqual([]);
  });

  it('a session without levers answers no-session and never fetches the brush files', async () => {
    const h = harness({ policy: false });
    h.init();
    const id = resolve(h, {
      kind: 'street',
      classes: ['arterial'],
      names: [],
      depth: 0,
      ncOnly: false
    });
    const cat = catalog(h);
    await h.runAll();
    const later = resolve(h, FREEHAND);
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'no-session' });
    expect(only(h, later)).toMatchObject({ ok: false, reason: 'no-session' });
    expect(catalogPosts(h, cat)).toEqual([{ type: 'brushCatalog', reqId: cat, catalog: null }]);
    for (const url of BRUSH_URLS) expect(h.fetchesOf(url)).toEqual([]);
  });

  it('no session at all answers no-session', () => {
    const h = harness();
    const id = resolve(h, FREEHAND);
    const cat = catalog(h);
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'no-session' });
    expect(catalogPosts(h, cat)).toEqual([{ type: 'brushCatalog', reqId: cat, catalog: null }]);
  });

  it('a new initScenario answers a request waiting on the load no-session', async () => {
    const h = harness();
    initLevers(h);
    const id = resolve(h, FREEHAND);
    const cat = catalog(h);
    initLevers(h);
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'no-session' });
    expect(catalogPosts(h, cat)).toEqual([{ type: 'brushCatalog', reqId: cat, catalog: null }]);
    await h.runAll();
    expect(lotsPosts(h, id)).toHaveLength(1); // never answered twice
    expect(catalogPosts(h, cat)).toHaveLength(1);
  });

  it('a new initScenario answers a request waiting on a brush file no-session', async () => {
    const h = harness();
    initLevers(h);
    await h.flush();
    h.hold(MINI_FRONTAGE_URL);
    const id = resolve(h, {
      kind: 'street',
      classes: [],
      names: ['MINI ST'],
      depth: 0,
      ncOnly: false
    });
    await h.flush();
    expect(lotsPosts(h, id)).toEqual([]);
    initLevers(h);
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'no-session' });
    h.release(MINI_FRONTAGE_URL);
    await h.flush();
    expect(lotsPosts(h, id)).toHaveLength(1);
  });

  it('a failed load answers waiting requests no-session', async () => {
    const h = harness({ retryDelaysMs: [] });
    h.fail(miniCity().manifest.scenarios!.fzp.calibration, 1, { status: 500 });
    initLevers(h);
    const id = resolve(h, FREEHAND);
    await h.runAll();
    expect(h.errors()).toHaveLength(1);
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it('dispose answers waiting requests no-session', () => {
    const h = harness();
    initLevers(h);
    const id = resolve(h, FREEHAND);
    h.host.dispose();
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it.each([
    ['not an object', 7],
    ['an unknown kind', { kind: 'lasso' }],
    ['a zero radius', { kind: 'freehand', strokes: [{ path: STROKE, radiusM: 0 }] }],
    ['an infinite radius', { kind: 'freehand', strokes: [{ path: STROKE, radiusM: Infinity }] }],
    ['a NaN in a path', { kind: 'freehand', strokes: [{ path: [[NaN, 37]], radiusM: 10 }] }],
    ['a negative maxM', { kind: 'transit', stopTypes: ['metro'], maxM: -1 }],
    ['an unknown stop type', { kind: 'transit', stopTypes: ['ferry'], maxM: 100 }],
    [
      'an unknown street class',
      { kind: 'street', classes: ['alley'], names: [], depth: 0, ncOnly: false }
    ],
    ['a bad depth', { kind: 'street', classes: [], names: ['X'], depth: 2, ncOnly: false }],
    ['a non-string district', { kind: 'area', districts: [3], neighborhoods: [] }]
  ])('%s is a bad-request, before any fetch', async (_, query) => {
    const h = harness();
    initLevers(h);
    await h.flush();
    const id = resolve(h, query);
    await h.flush();
    expect(only(h, id)).toMatchObject({ ok: false, reason: 'bad-request' });
    for (const url of BRUSH_URLS) expect(h.fetchesOf(url)).toEqual([]);
  });
});

describe('brushCatalog', () => {
  it('fetches the three files once and describes them', async () => {
    const h = harness();
    initLevers(h);
    const a = catalog(h);
    await h.flush();
    const b = catalog(h);
    await h.flush();
    const [pa] = catalogPosts(h, a);
    const [pb] = catalogPosts(h, b);
    expect(pa.catalog).toEqual(pb.catalog);
    const c = pa.catalog!;
    expect(c.has).toEqual({ frontage: true, transit: true, neighborhoods: true });
    expect(c.streetNames).toEqual([...MINI_STREETS]);
    expect(c.neighborhoods).toEqual([MINI_NEIGHBORHOOD]);
    expect(c.stops).toEqual({ regionalRail: 1, metro: 1, rapidBus: 1, frequentBus: 0 });
    for (const url of BRUSH_URLS) expect(h.fetchesOf(url)).toHaveLength(1);
  });

  it('a missing file is has false', async () => {
    const h = harness({ bodies: { [MINI_NEIGHBORHOODS_URL]: undefined } }); // a 404
    initLevers(h);
    const id = catalog(h);
    await h.flush();
    const c = catalogPosts(h, id)[0].catalog!;
    expect(c.has).toEqual({ frontage: true, transit: true, neighborhoods: false });
    expect(c.neighborhoods).toEqual([]);
  });
});
