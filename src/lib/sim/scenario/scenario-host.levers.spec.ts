// The scenario host's lever plumbing (plan 2 Task 12): `initScenario.levers`, `setLevers`, the
// `levers` resolving/current posts, the touched-lot recompute as the scheduler's first job, latest
// lever revision wins, a failed needed chunk holds the revision, and /fzp (no levers) unchanged.
// Map overlays Task 2: each revision's fog grid, on its first resolving and on current.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { decodeParcelChunk, encodeParcelChunk } from '$lib/data/parcel-chunk';
import { sampleFog } from '$lib/map/fog/grid';
import { allNeeds, resolveEnvelopes } from '../levers/resolve';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { MINI_CHUNK_URL, MINI_VERSION, miniCity } from './fixtures/mini-parcels';
import { MINI_HISTORIC_ID, miniPolicy } from './fixtures/mini-policy';
import { MINI_AS_OF } from './fixtures/mini-projects';
import { MINI_POLICY_URL, makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { ScenarioResponse, TimelineResponse } from './types';

type LeversPost = Extract<ScenarioResponse, { type: 'levers' }>;

const WORLD: [number, number, number, number] = [-180, -90, 180, 90];
const N = 5; // band runs: small, so a run completes quickly
const city = miniCity();
const cellOf = (id: ParcelId) => city.parcels.cells[city.parcels.cell[city.parcels.index.get(id)!]];
/** Two lots in different cells (50_25 and 50_26). */
const LOT_A: ParcelId = '0026T009';
const LOT_B: ParcelId = '2999A001';
/** An unprotected lot below 40 stories under FZP. */
const FZP_LOT: ParcelId = LOT_A;

/** A fresh copy of `base` with one rule above FZP (uncapped): every named lot is a Need. */
function raised(lots: ParcelId[], stories: number, base: SimLevers = DEFAULT_LEVERS): SimLevers {
  const l = structuredClone(base);
  l.rules.push({ lots, stories });
  return l;
}

function harness(policy = true): ScenarioHarness {
  return makeScenarioHarness({ deps: { bandRuns: N }, policy });
}

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

const timelines = (h: ScenarioHarness, from = 0): TimelineResponse[] =>
  h.posts.slice(from).filter((m): m is TimelineResponse => m.type === 'timeline');
const leversPosts = (h: ScenarioHarness, from = 0): LeversPost[] =>
  h.posts.slice(from).filter((m): m is LeversPost => m.type === 'levers');
/** A timeline's content without its packed cells (transfer buffers). */
const content = (t: TimelineResponse) => ({
  rev: t.rev,
  seed: t.seed,
  revision: t.render.revision,
  score: t.score,
  bandRuns: t.bandRuns,
  bandRunsTotal: t.bandRunsTotal,
  complete: t.complete
});
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sequence = (h: ScenarioHarness) => h.posts.map((m) => `${m.type}:${'rev' in m ? m.rev : ''}`);
const indexOf = (h: ScenarioHarness, pred: (m: ScenarioResponse) => boolean) =>
  h.posts.findIndex(pred);
const isCurrent = (rev: number) => (m: ScenarioResponse) =>
  m.type === 'levers' && m.rev === rev && m.phase === 'current';

type CurrentPost = Extract<LeversPost, { phase: 'current' }>;
/** A lever session, run until its first `current`, with the fog tests' helpers. */
async function leverSession(levers: SimLevers) {
  const h = harness();
  h.init({ levers: structuredClone(levers) });
  await h.runAll();
  expect(h.errors()).toEqual([]);
  const lastIndex = (type: ScenarioResponse['type']) =>
    h.posts.findLastIndex((m) => m.type === type);
  return {
    h,
    posted: (type: 'levers') => leversPosts(h).filter((m) => m.type === type),
    labelPoint: (id: ParcelId): [number, number] => {
      const i = city.parcels.index.get(id)!;
      return [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
    },
    setLevers: (l: SimLevers) =>
      h.host.handle({ type: 'setLevers', rev: h.next(), levers: structuredClone(l) }),
    untilCurrent: () => h.runAll(),
    lastCurrent: (): CurrentPost =>
      leversPosts(h)
        .filter((m): m is CurrentPost => m.phase === 'current')
        .at(-1)!,
    lastTransfer: (type: ScenarioResponse['type']) => h.transfers[lastIndex(type)]
  };
}

/**
 * The no-lever run below (seed 1, the whole city prefetched, then a reroll to seed 9) as the host
 * posted it before Task 12, at 8b0d9cb: the post sequence, and a SHA-256 of the timelines'
 * content (`content`, in order).
 */
const BASELINE = {
  sequence: [
    'ready:1',
    'chunks:',
    'chunks:',
    'chunks:',
    'chunks:',
    'chunks:',
    'timeline:1',
    'timeline:1',
    'timeline:1',
    'timeline:2',
    'timeline:2'
  ],
  timelines: '34e94c230992dc4cc41266cc89cb2da958f8836aeb1dfa6ff4aa938d8fc74bb5'
};

describe('scenario host without levers (/fzp)', () => {
  it('posts the pre-change sequence and scores, and never fetches policy.bin', async () => {
    const h = harness(); // the manifest names policy.bin: still never fetched
    h.init();
    h.host.handle({ type: 'prefetch', bbox: WORLD });
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 9 });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(sequence(h)).toEqual(BASELINE.sequence);
    expect(sha(timelines(h).map(content))).toBe(BASELINE.timelines);
    expect(h.fetchesOf(MINI_POLICY_URL)).toEqual([]);
    expect(leversPosts(h)).toEqual([]);
  });

  it('answers setLevers on a session without levers with bad-request', async () => {
    const h = harness();
    h.init();
    await h.runAll();
    const rev = h.next();
    h.host.handle({ type: 'setLevers', rev, levers: structuredClone(DEFAULT_LEVERS) });
    expect(h.errors()).toEqual([
      {
        type: 'error',
        rev,
        code: 'bad-request',
        message: 'setLevers needs a session initialised with levers'
      }
    ]);
  });
});

describe('scenario host with levers', () => {
  it('rejects an invalid lever document as bad-request', async () => {
    const h = harness();
    const rev = h.init({ levers: { ...structuredClone(DEFAULT_LEVERS), schema: 1 } });
    await h.runAll();
    expect(h.errors()).toMatchObject([{ rev, code: 'bad-request', message: /schema/ }]);
    expect(h.fetches).toEqual([]);
  });

  it('default levers: current before the first timeline, timelines as /fzp', async () => {
    const plain = harness();
    plain.init();
    await plain.runAll();

    const h = harness();
    const rev = h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.fetchesOf(MINI_POLICY_URL)).toHaveLength(1);
    const lv = leversPosts(h);
    expect(lv.map((m) => [m.rev, m.phase])).toEqual([[rev, 'current']]); // no needs: no resolving
    expect(structuredClone(lv[0])).toEqual(lv[0]); // postMessage can carry it
    const current = indexOf(h, isCurrent(rev));
    expect(current).toBeLessThan(indexOf(h, (m) => m.type === 'timeline'));
    expect(timelines(h).map(content)).toEqual(timelines(plain).map(content));
  });

  it('posts resolving with every Need, and no timeline before current', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const before = timelines(h).length;
    expect(before).toBeGreaterThan(0);

    h.hold(MINI_CHUNK_URL(cellOf(LOT_B).cellId)); // one needed cell stays pending
    const levers = raised([LOT_A, LOT_B], 20);
    const rev = h.next();
    const from = h.posts.length;
    h.host.handle({ type: 'setLevers', rev, levers });
    await h.runAll();

    const ctx = { parcels: city.parcels, policy: miniPolicy(city) };
    const need = allNeeds(resolveEnvelopes(ctx, levers, MINI_AS_OF));
    expect(need.length).toBeGreaterThanOrEqual(2);
    const lv = leversPosts(h, from);
    expect(lv[0]).toMatchObject({ rev, phase: 'resolving', done: 0, total: need.length });
    expect(lv.every((m) => m.phase === 'resolving')).toBe(true);
    expect(timelines(h, from)).toEqual([]);

    h.release(MINI_CHUNK_URL(cellOf(LOT_B).cellId));
    await h.runAll();
    const current = indexOf(h, isCurrent(rev));
    expect(current).toBeGreaterThan(from);
    const after = timelines(h, from);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((t) => t.rev === rev)).toBe(true);
    expect(indexOf(h, (m) => m.type === 'timeline' && m.rev === rev)).toBeGreaterThan(current);
    expect(h.errors()).toEqual([]);
  });

  it('latest setLevers wins', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const url = MINI_CHUNK_URL(cellOf(LOT_A).cellId);
    h.hold(url);
    const from = h.posts.length;
    const r1 = h.next();
    h.host.handle({ type: 'setLevers', rev: r1, levers: raised([LOT_A], 20) });
    await h.runAll(); // r1 waits on LOT_A's chunk
    const r2 = h.next();
    h.host.handle({ type: 'setLevers', rev: r2, levers: raised([LOT_A], 25) });
    h.release(url);
    await h.runAll();

    expect(h.errors()).toEqual([]);
    expect(
      leversPosts(h, from)
        .filter((m) => m.phase === 'current')
        .map((m) => m.rev)
    ).toEqual([r2]);
    const after = timelines(h, from);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((t) => t.rev === r2)).toBe(true);
    expect(indexOf(h, (m) => m.type === 'timeline' && m.rev === r2)).toBeGreaterThan(
      indexOf(h, isCurrent(r2))
    );
  });

  it('chunk failure holds the lever revision', async () => {
    const h = makeScenarioHarness({ deps: { bandRuns: N }, policy: true, retryDelaysMs: [] });
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const cell = cellOf(LOT_A).cellId;
    h.fail(MINI_CHUNK_URL(cell), 1, { status: 503 });
    const from = h.posts.length;
    const rev = h.next();
    h.host.handle({ type: 'setLevers', rev, levers: raised([LOT_A], 20) });
    await h.runAll();

    const lv = leversPosts(h, from);
    expect(lv.at(-1)).toMatchObject({ rev, phase: 'resolving', failedCells: [cell] });
    expect(lv.some((m) => m.phase === 'current')).toBe(false);
    expect(timelines(h, from)).toEqual([]);

    h.host.handle({ type: 'retryChunks' });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const current = indexOf(h, isCurrent(rev));
    expect(current).toBeGreaterThan(from);
    expect(indexOf(h, (m) => m.type === 'timeline' && m.rev === rev)).toBeGreaterThan(current);
  });

  it('a reroll while resolving gives the pending run its rev and seed', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const url = MINI_CHUNK_URL(cellOf(LOT_A).cellId);
    h.hold(url);
    const from = h.posts.length;
    const r1 = h.next();
    h.host.handle({ type: 'setLevers', rev: r1, levers: raised([LOT_A], 20) });
    await h.runAll();
    const r2 = h.next();
    h.host.handle({ type: 'reroll', rev: r2, seed: 77 });
    await h.runAll();
    expect(timelines(h, from)).toEqual([]);
    h.release(url);
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(
      leversPosts(h, from)
        .filter((m) => m.phase === 'current')
        .map((m) => m.rev)
    ).toEqual([r1]);
    const after = timelines(h, from);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((t) => t.rev === r2 && t.seed === 77)).toBe(true);
  });

  it('same levers and seed: two fresh hosts give equal scores in any chunk order', async () => {
    const run = async (first: ParcelId) => {
      const h = harness();
      const url = MINI_CHUNK_URL(cellOf(first).cellId);
      h.hold(url); // the other lot's chunk arrives first
      const rev = h.init({ levers: raised([LOT_A, LOT_B], 20) });
      await h.runAll();
      h.release(url);
      await h.runAll();
      expect(h.errors()).toEqual([]);
      expect(indexOf(h, isCurrent(rev))).toBeGreaterThan(0);
      return timelines(h).map(content);
    };
    const a = await run(LOT_A);
    const b = await run(LOT_B);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('every current carries the fog of the levers in force', async () => {
    const h = await leverSession(DEFAULT_LEVERS);
    const first = h.posted('levers').find((m) => m.phase === 'current')!;
    expect(first.phase === 'current' && first.fog).toBeTruthy();
    const [lng, lat] = h.labelPoint(FZP_LOT);
    const before = sampleFog((first as CurrentPost).fog, lng, lat);
    expect(before).toBeGreaterThan(0);
    h.setLevers({ ...DEFAULT_LEVERS, paint: [{ lots: [FZP_LOT], stories: 40 }], compare: 'fzp' });
    await h.untilCurrent();
    expect(h.h.errors()).toEqual([]);
    expect(sampleFog(h.lastCurrent().fog, lng, lat)).toBeGreaterThan(before);
    expect(h.lastTransfer('levers')).toContain(h.lastCurrent().fog.heightM.buffer);
  });

  it('a painted lot under a category protection keeps its FZP fog', async () => {
    const h = await leverSession(DEFAULT_LEVERS);
    const [lng, lat] = h.labelPoint(MINI_HISTORIC_ID);
    const fzp = sampleFog(h.lastCurrent().fog, lng, lat);
    h.setLevers({
      ...DEFAULT_LEVERS,
      paint: [{ lots: [MINI_HISTORIC_ID], stories: 40 }],
      protect: { ...DEFAULT_LEVERS.protect, historic: true },
      compare: 'fzp'
    });
    await h.untilCurrent();
    expect(h.h.errors()).toEqual([]);
    expect(h.lastCurrent().rev).toBeGreaterThan(1);
    expect(sampleFog(h.lastCurrent().fog, lng, lat)).toBeCloseTo(fzp, 4);
  });

  it('the fog goes out on the first resolving: a revision held by a failed chunk shows it', async () => {
    const h = makeScenarioHarness({ deps: { bandRuns: N }, policy: true, retryDelaysMs: [] });
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const before = leversPosts(h).find((m) => m.phase === 'current') as CurrentPost;
    const i = city.parcels.index.get(LOT_A)!;
    const [lng, lat] = [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
    const cell = cellOf(LOT_A).cellId;
    h.fail(MINI_CHUNK_URL(cell), 1, { status: 503 });
    const from = h.posts.length;
    const rev = h.next();
    h.host.handle({ type: 'setLevers', rev, levers: raised([LOT_A], 40) });
    await h.runAll();

    const lv = leversPosts(h, from);
    expect(lv.some((m) => m.phase === 'current')).toBe(false); // held
    expect(lv.at(-1)).toMatchObject({ rev, phase: 'resolving', failedCells: [cell] });
    const withFog = lv.filter((m) => m.phase === 'resolving' && m.fog);
    expect(withFog).toHaveLength(1); // the first resolving only
    expect(withFog[0]).toBe(lv[0]);
    const fog = (lv[0] as Extract<LeversPost, { phase: 'resolving' }>).fog!;
    expect(sampleFog(fog, lng, lat)).toBeGreaterThan(sampleFog(before.fog, lng, lat));
    expect(h.transfers[h.posts.indexOf(lv[0])]).toEqual([fog.heightM.buffer]);

    h.host.handle({ type: 'retryChunks' });
    await h.runAll();
    const current = h.posts.find(isCurrent(rev)) as CurrentPost;
    expect(current.fog.heightM).toEqual(fog.heightM); // the same grid, a separate buffer
    expect(current.fog.heightM.buffer).not.toBe(fog.heightM.buffer);
  });

  it('a need whose record is missing from its loaded cell reaches current and warns once', async () => {
    const cell = cellOf(LOT_A).cellId;
    const url = MINI_CHUNK_URL(cell);
    const without = decodeParcelChunk(city.chunks[url]).filter((r) => r.id !== LOT_A);
    const h = makeScenarioHarness({
      deps: { bandRuns: N },
      policy: true,
      bodies: { [url]: JSON.parse(encodeParcelChunk(MINI_VERSION, cell, without)) }
    });
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const from = h.posts.length;
    const rev = h.next();
    h.host.handle({ type: 'setLevers', rev, levers: raised([LOT_A, LOT_B], 20) });
    await h.runAll();
    const r2 = h.next();
    h.host.handle({ type: 'setLevers', rev: r2, levers: raised([LOT_A, LOT_B], 21) });
    await h.runAll();

    expect(h.errors()).toEqual([]);
    expect(indexOf(h, isCurrent(rev))).toBeGreaterThan(from);
    expect(indexOf(h, isCurrent(r2))).toBeGreaterThan(from);
    const warned = h.warnings.filter((m) => m.includes(LOT_A));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/no record/);
  });
});
