// The scenario host's `initScenario.awaitLevers` (gross-table Task 6): an `/s/<id>` open starts
// the session without running its init levers. Until the first `setLevers` is current the host
// posts only `ready`, errors and request answers; prefetch is held and its latest bbox replayed at
// `current`; a reroll while waiting sets the first revision's seed.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import type { BrushQuery } from '../levers/brushes';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { MINI_CHUNK_URL, miniCity } from './fixtures/mini-parcels';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { ScenarioResponse, TimelineResponse } from './types';

type LeversPost = Extract<ScenarioResponse, { type: 'levers' }>;
type BrushLotsPost = Extract<ScenarioResponse, { type: 'brushLots' }>;

const WORLD: [number, number, number, number] = [-180, -90, 180, 90];
const N = 5; // band runs: small, so a run completes quickly
const city = miniCity();
/** Two lots in different cells (50_25 and 50_26). */
const LOT_A: ParcelId = '0026T009';
const LOT_B: ParcelId = '2999A001';
const cellOf = (id: ParcelId) =>
  city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]].cellId;
const labelOf = (id: ParcelId): [number, number] => {
  const i = city.parcels.index.get(id)!;
  return [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
};

/** A fresh copy of `base` with one rule above FZP (uncapped): every named lot is a Need. */
function raised(lots: ParcelId[], stories: number, base: SimLevers = DEFAULT_LEVERS): SimLevers {
  const l = structuredClone(base);
  l.rules.push({ lots, stories });
  return l;
}

function harness(gross = true): ScenarioHarness {
  return makeScenarioHarness({ deps: { bandRuns: N }, policy: true, gross });
}

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

const timelines = (h: ScenarioHarness): TimelineResponse[] =>
  h.posts.filter((m): m is TimelineResponse => m.type === 'timeline');
const leversPosts = (h: ScenarioHarness): LeversPost[] =>
  h.posts.filter((m): m is LeversPost => m.type === 'levers');
const sequence = (h: ScenarioHarness) => h.posts.map((m) => `${m.type}:${'rev' in m ? m.rev : ''}`);
const indexOf = (h: ScenarioHarness, pred: (m: ScenarioResponse) => boolean) =>
  h.posts.findIndex(pred);
const chunkUrls = new Set(Object.keys(city.chunks));
const chunkFetches = (h: ScenarioHarness) => h.fetches.filter((f) => chunkUrls.has(f.url));
/** The posts of the lever kinds a held session must not send. */
const revisionPosts = (h: ScenarioHarness, rev: number) =>
  h.posts.filter(
    (m) =>
      (m.type === 'levers' || m.type === 'heights' || m.type === 'timeline') &&
      'rev' in m &&
      m.rev === rev
  );

const initAwait = (h: ScenarioHarness) => h.init({ levers: raised([LOT_A], 8), awaitLevers: true });
function setLevers(h: ScenarioHarness, levers: SimLevers): number {
  const rev = h.next();
  h.host.handle({ type: 'setLevers', rev, levers });
  return rev;
}

describe('initScenario.awaitLevers', () => {
  it('nothing but ready is posted until setLevers', async () => {
    const h = harness();
    initAwait(h);
    await h.runAll();
    expect(sequence(h)).toEqual(['ready:1']);
    expect(h.pendingTimers()).toBe(0);
  });

  it('setLevers after the load runs one revision at its rev: heights, current, timelines', async () => {
    const h = harness();
    const rev1 = initAwait(h);
    await h.runAll();
    const rev = setLevers(h, raised([LOT_A, LOT_B], 8));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(revisionPosts(h, rev1)).toEqual([]);
    expect(leversPosts(h).map((m) => `${m.phase}:${m.rev}`)).toEqual([`current:${rev}`]);
    const heights = indexOf(h, (m) => m.type === 'heights' && m.rev === rev);
    const current = indexOf(h, (m) => m.type === 'levers' && m.phase === 'current');
    const first = indexOf(h, (m) => m.type === 'timeline');
    expect(heights).toBeGreaterThan(0);
    expect(heights).toBeLessThan(current);
    expect(current).toBeLessThan(first);
    expect(timelines(h).length).toBeGreaterThan(0);
    expect(timelines(h).every((t) => t.rev === rev)).toBe(true);
    expect(timelines(h).at(-1)!.complete).toBe(true);
  });

  it('setLevers before the load finishes: one revision, at the setLevers rev', async () => {
    const h = harness();
    h.holdDecodes();
    const rev1 = initAwait(h);
    await h.flush();
    const rev = setLevers(h, raised([LOT_A, LOT_B], 8));
    h.releaseDecodes();
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.decodes().settled).toBe(1);
    expect(revisionPosts(h, rev1)).toEqual([]);
    expect(leversPosts(h).map((m) => `${m.phase}:${m.rev}`)).toEqual([`current:${rev}`]);
    expect(timelines(h).length).toBeGreaterThan(0);
    expect(timelines(h).every((t) => t.rev === rev)).toBe(true);
  });

  it('brush requests are answered while waiting', async () => {
    const h = harness();
    initAwait(h);
    const query: BrushQuery = {
      kind: 'freehand',
      strokes: [{ path: [labelOf('0026T001A'), labelOf('0026T006')], radiusM: 30 }]
    };
    h.host.handle({ type: 'resolveBrush', reqId: 7, query });
    await h.runAll();
    expect(sequence(h)).toEqual(['ready:1', 'brushLots:']);
    const answer = h.posts[1] as BrushLotsPost;
    expect(answer.reqId).toBe(7);
    expect(answer.result.ok).toBe(true);
  });

  it('a reroll while waiting gives the first revision its seed', async () => {
    const h = harness();
    initAwait(h);
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 9 });
    await h.runAll();
    expect(sequence(h)).toEqual(['ready:1']);
    const rev = setLevers(h, raised([LOT_A], 8));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const ts = timelines(h);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts[0].seed).toBe(9);
    expect(ts[0].rev).toBe(rev);
  });

  it('a prefetch while waiting fetches no chunk; the latest bbox loads at current', async () => {
    const h = harness();
    initAwait(h);
    await h.runAll();
    h.host.handle({ type: 'prefetch', bbox: WORLD });
    const [x, y] = labelOf(LOT_A);
    h.host.handle({ type: 'prefetch', bbox: [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6] });
    await h.runAll();
    expect(chunkFetches(h)).toEqual([]);
    expect(sequence(h)).toEqual(['ready:1']);
    setLevers(h, raised([LOT_A], 8));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const current = indexOf(h, (m) => m.type === 'levers' && m.phase === 'current');
    const fetched = chunkFetches(h);
    expect(fetched.map((f) => f.url)).toEqual([MINI_CHUNK_URL(cellOf(LOT_A))]);
    expect(fetched[0].posts).toBeGreaterThan(current);
    expect(h.fetchesOf(MINI_CHUNK_URL(cellOf(LOT_B)))).toEqual([]);
    // the prefetch is no longer held
    h.host.handle({ type: 'prefetch', bbox: WORLD });
    await h.runAll();
    expect(h.fetchesOf(MINI_CHUNK_URL(cellOf(LOT_B)))).toHaveLength(1);
  });

  it('without gross: setLevers posts resolving, then current (an /s open on an older dataset)', async () => {
    const h = harness(false);
    const rev1 = initAwait(h);
    await h.runAll();
    expect(sequence(h)).toEqual(['ready:1']);
    const rev = setLevers(h, raised([LOT_A, LOT_B], 8));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(revisionPosts(h, rev1)).toEqual([]);
    const phases = leversPosts(h).map((m) => `${m.phase}:${m.rev}`);
    expect(phases[0]).toBe(`resolving:${rev}`);
    expect(phases.at(-1)).toBe(`current:${rev}`);
    expect(timelines(h).every((t) => t.rev === rev)).toBe(true);
  });

  it('awaitLevers without levers is bad-request', async () => {
    const h = harness();
    const rev = h.init({ awaitLevers: true });
    await h.runAll();
    expect(h.errors()).toEqual([
      { type: 'error', rev, code: 'bad-request', message: 'awaitLevers needs levers' }
    ]);
    expect(sequence(h)).toEqual([`error:${rev}`]);
  });
});
