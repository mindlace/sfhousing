// The scenario host's height limits (height-lids plan, Task 8): each lever revision's staged city
// build posts one `heights` before its `current`; `heightLids { bbox }` is answered by the staged
// lid build on the latest complete city. The fog grid no longer leaves the worker.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import type { HeightCity } from '$lib/map/height/types';
import { SRC_PAINT } from '../levers/source';
import { DEFAULT_LEVERS, type SimLevers } from '../levers/types';
import { cellsIntersecting } from '../chunks';
import { MINI_CHUNK_URL, miniCity } from './fixtures/mini-parcels';
import { MINI_HISTORIC_ID } from './fixtures/mini-policy';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { HeightLidsResult, ScenarioResponse } from './types';

type HeightsPost = Extract<ScenarioResponse, { type: 'heights' }>;
type LidsPost = Extract<ScenarioResponse, { type: 'heightLids' }>;
type BBox4 = [number, number, number, number];

const N = 5; // band runs: small, so a session settles quickly
const WORLD: BBox4 = [-180, -90, 180, 90];
const city = miniCity();
/** An unprotected lot below 40 stories under FZP (cell 50_25). */
const LOT_A: ParcelId = '0026T009';

let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

function labelPoint(id: ParcelId): [number, number] {
  const i = city.parcels.index.get(id)!;
  return [city.parcels.labelPoint[2 * i], city.parcels.labelPoint[2 * i + 1]];
}

/** A bbox of about ±r metres around a lot's label point. */
function around(id: ParcelId, r = 100): BBox4 {
  const [lng, lat] = labelPoint(id);
  const dLng = r / 88_000;
  const dLat = r / 111_000;
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/**
 * The harness with a clock that moves 5 ms on every `now()` (when `ticking`), so staged builds
 * run out of budget mid-way and take several slices, as they do on the real city.
 */
function harness(opts: { policy?: boolean; ticking?: boolean } = {}): ScenarioHarness {
  let t = 0;
  return makeScenarioHarness({
    policy: opts.policy ?? true,
    deps: { bandRuns: N, ...(opts.ticking ? { now: () => (t += 5) } : {}) }
  });
}

const heights = (h: ScenarioHarness): HeightsPost[] =>
  h.posts.filter((m): m is HeightsPost => m.type === 'heights');
const lidAnswers = (h: ScenarioHarness): LidsPost[] =>
  h.posts.filter((m): m is LidsPost => m.type === 'heightLids');
const answerOf = (h: ScenarioHarness, reqId: number): HeightLidsResult | undefined =>
  lidAnswers(h).find((m) => m.reqId === reqId)?.result;
const indexOf = (h: ScenarioHarness, pred: (m: ScenarioResponse) => boolean) =>
  h.posts.findIndex(pred);
const isCurrent = (rev: number) => (m: ScenarioResponse) =>
  m.type === 'levers' && m.rev === rev && m.phase === 'current';

let reqSeq = 0;
function askLids(h: ScenarioHarness, bbox: BBox4): number {
  const reqId = ++reqSeq;
  h.host.handle({ type: 'heightLids', reqId, bbox });
  return reqId;
}

function setLevers(h: ScenarioHarness, l: SimLevers): number {
  const rev = h.next();
  h.host.handle({ type: 'setLevers', rev, levers: structuredClone(l) });
  return rev;
}

/** The chains' highest stories with `src` on the higher side. */
const chainsWith = (c: HeightCity, stories: number, src?: number) =>
  [...c.chains.hi.keys()].filter(
    (k) => c.chains.hi[k] === stories && (src === undefined || c.chains.srcA[k] === src)
  );

const painted = (lot: ParcelId, stories: number, over: Partial<SimLevers> = {}): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  paint: [{ lots: [lot], stories }],
  compare: 'fzp',
  ...over
});

describe('scenario host: heights', () => {
  it('a lever revision posts one heights at its rev, before its current', async () => {
    const h = harness();
    const initRev = h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(heights(h).map((m) => m.rev)).toEqual([initRev]);
    const at = indexOf(h, (m) => m.type === 'heights' && m.rev === initRev);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(indexOf(h, isCurrent(initRev)));
    const c = heights(h)[0].city;
    expect(c.rev).toBe(initRev);
    expect(c.chains.starts.length).toBeGreaterThan(1);
    // every buffer of the chains and labels is transferred, each once
    const sent = h.transfers[at];
    const bufs = [
      c.chains.starts,
      c.chains.positions,
      c.chains.hi,
      c.chains.lo,
      c.chains.kind,
      c.chains.srcA,
      c.chains.srcB,
      c.labels.position,
      c.labels.minZoom
    ].map((a) => a.buffer);
    for (const b of bufs) expect(sent).toContain(b);
    expect(new Set(sent).size).toBe(sent.length);
  });

  it('a painted lot at a new height shows in the next heights; a protected painted lot keeps FZP', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const fzp = heights(h).at(-1)!.city;
    expect(chainsWith(fzp, 40)).toEqual([]); // nothing in the mini city is 40 stories under FZP

    const r1 = setLevers(h, painted(LOT_A, 40));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const c1 = heights(h).at(-1)!;
    expect(c1.rev).toBe(r1);
    expect(chainsWith(c1.city, 40, SRC_PAINT).length).toBeGreaterThan(0);

    // control: the historic lot painted unprotected rises; protected, it keeps its FZP limit
    const r2 = setLevers(h, painted(MINI_HISTORIC_ID, 40));
    await h.runAll();
    expect(heights(h).at(-1)!.rev).toBe(r2);
    expect(chainsWith(heights(h).at(-1)!.city, 40, SRC_PAINT).length).toBeGreaterThan(0);
    const r3 = setLevers(
      h,
      painted(MINI_HISTORIC_ID, 40, { protect: { ...DEFAULT_LEVERS.protect, historic: true } })
    );
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(heights(h).at(-1)!.rev).toBe(r3);
    expect(chainsWith(heights(h).at(-1)!.city, 40)).toEqual([]);
  });

  it('a revision superseded before its city is done posts no heights', async () => {
    const h = harness();
    const initRev = h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const r1 = setLevers(h, painted(LOT_A, 30));
    const r2 = setLevers(h, painted(LOT_A, 40));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(r1).toBeLessThan(r2);
    expect(heights(h).map((m) => m.rev)).toEqual([initRev, r2]);
  });

  it('heights go out before the recompute: a revision held by a failed chunk shows them', async () => {
    const h = makeScenarioHarness({ deps: { bandRuns: N }, policy: true, retryDelaysMs: [] });
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const cell = city.parcels.cells[city.parcels.cell[city.parcels.index.get(LOT_A)!]].cellId;
    h.fail(MINI_CHUNK_URL(cell), 1, { status: 503 });
    const rev = h.next();
    // a rule above FZP: LOT_A is a Need, so its chunk is wanted, and fails
    const l = structuredClone(DEFAULT_LEVERS);
    l.rules.push({ lots: [LOT_A], stories: 40 });
    h.host.handle({ type: 'setLevers', rev, levers: l });
    await h.runAll();
    expect(h.posts.some(isCurrent(rev))).toBe(false); // held
    expect(heights(h).at(-1)!.rev).toBe(rev);
    expect(chainsWith(heights(h).at(-1)!.city, 40).length).toBeGreaterThan(0);
    h.host.handle({ type: 'retryChunks' });
    await h.runAll();
    expect(h.posts.some(isCurrent(rev))).toBe(true);
    expect(heights(h).filter((m) => m.rev === rev)).toHaveLength(1);
  });

  it('levers responses no longer carry fog', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    setLevers(h, painted(LOT_A, 40));
    await h.runAll();
    const lv = h.posts.filter((m) => m.type === 'levers');
    expect(lv.some((m) => m.phase === 'current')).toBe(true);
    for (const m of lv) expect('fog' in m).toBe(false);
  });
});

describe('scenario host: heightLids', () => {
  it('heightLids before any heights waits, then answers from the first limits', async () => {
    const h = harness();
    const initRev = h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    const reqId = askLids(h, around(LOT_A));
    await h.flush();
    expect(answerOf(h, reqId)).toBeUndefined();
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const answer = answerOf(h, reqId)!;
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.lids.limitsRev).toBe(initRev);
    expect(lidAnswers(h)).toHaveLength(1);
  });

  it('a newer heightLids answers the older superseded', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const a = askLids(h, around(LOT_A));
    const b = askLids(h, around(LOT_A, 150));
    const first = answerOf(h, a)!; // answered at once
    expect(first.ok).toBe(false);
    expect(!first.ok && first.reason).toBe('superseded');
    await h.runAll();
    expect(answerOf(h, b)?.ok).toBe(true);
    expect(lidAnswers(h).filter((m) => m.reqId === a)).toHaveLength(1);
  });

  it('a newer heightLids supersedes a running lid build', async () => {
    const h = harness({ ticking: true });
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    h.host.handle({ type: 'prefetch', bbox: WORLD });
    await h.runAll();
    const a = askLids(h, around(LOT_A, 1400));
    await h.step(); // one slice of the lid build
    expect(answerOf(h, a)).toBeUndefined();
    const b = askLids(h, around(LOT_A, 100));
    expect(answerOf(h, a)).toMatchObject({ ok: false, reason: 'superseded' });
    await h.runAll();
    expect(answerOf(h, b)?.ok).toBe(true);
    expect(lidAnswers(h).map((m) => m.reqId)).toEqual([a, b]);
  });

  it('a setLevers during a lid build restarts it on the new limits', async () => {
    const h = harness({ ticking: true });
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    h.host.handle({ type: 'prefetch', bbox: WORLD });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const reqId = askLids(h, around(LOT_A, 1400));
    await h.step(); // the lid build has started on the init's limits, and is not done
    expect(answerOf(h, reqId)).toBeUndefined();
    const nextRev = setLevers(h, painted(LOT_A, 40));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(lidAnswers(h)).toHaveLength(1);
    const r = answerOf(h, reqId)!;
    expect(r.ok).toBe(true);
    expect(r.ok && r.lids.limitsRev).toBe(nextRev); // Review Focus 1
    if (!r.ok) return;
    // components, stories and sources all from the new revision: the painted lot's 40 shows
    const nextCity = heights(h).at(-1)!;
    expect(nextCity.rev).toBe(nextRev);
    expect(r.lids.sourceIds).toEqual(nextCity.city.sourceIds);
    const p = r.lids.pieces;
    const k = [...p.stories.keys()].find((i) => p.stories[i] === 40);
    expect(k).toBeDefined();
    expect(p.source[k!]).toBe(SRC_PAINT);
    // the answer came after the new revision's heights
    expect(indexOf(h, (m) => m.type === 'heights' && m.rev === nextRev)).toBeLessThan(
      indexOf(h, (m) => m.type === 'heightLids')
    );
  });

  it('missing counts the bbox cells not loaded; lots of loaded cells form faces', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const bbox = around(LOT_A);
    const cells = cellsIntersecting(h.manifest(), bbox);
    expect(cells.length).toBeGreaterThan(0);
    const fetched = (c: string) => h.fetchesOf(MINI_CHUNK_URL(c)).length > 0;
    const notLoaded = cells.filter((c) => !fetched(c)).length;
    expect(notLoaded).toBeGreaterThan(0); // nothing has asked for this view yet

    const a = askLids(h, bbox);
    await h.runAll();
    const before = answerOf(h, a)!;
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.missing).toBe(notLoaded);

    h.host.handle({ type: 'prefetch', bbox });
    await h.runAll();
    const b = askLids(h, bbox);
    await h.runAll();
    const after = answerOf(h, b)!;
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.missing).toBe(0);
    expect(after.lids.faces.length).toBeGreaterThan(0);
    expect(after.lids.sourceIds).toEqual(heights(h).at(-1)!.city.sourceIds);
    // its buffers are transferred, each once
    const sent = h.transfers[h.posts.findLastIndex((m) => m.type === 'heightLids')];
    expect(sent).toContain(after.lids.pieces.stories.buffer);
    expect(sent).toContain(after.lids.faces[0].rings[0].buffer);
    expect(sent).toContain(after.lids.walls.a.buffer);
    expect(sent).toContain(after.lids.paintLabels.position.buffer);
    expect(new Set(sent).size).toBe(sent.length);
  });

  it('a 4 km bbox answers too-large', async () => {
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    await h.runAll();
    const [lng, lat] = labelPoint(LOT_A);
    const reqId = askLids(h, [lng, lat, lng + 4000 / 88_000, lat + 0.001]);
    await h.runAll();
    const r = answerOf(h, reqId)!;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('too-large');
    expect(h.errors()).toEqual([]);
  });

  it('no lever session (/fzp) answers no-session; a new init answers waiting requests no-session', async () => {
    // no session at all
    const none = harness();
    const r0 = askLids(none, around(LOT_A));
    expect(answerOf(none, r0)).toMatchObject({ ok: false, reason: 'no-session' });

    // /fzp: a session without levers
    const fzp = harness({ policy: false });
    fzp.init();
    await fzp.runAll();
    const r1 = askLids(fzp, around(LOT_A));
    expect(answerOf(fzp, r1)).toMatchObject({ ok: false, reason: 'no-session' });

    // a waiting request, then a new init
    const h = harness();
    h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    const r2 = askLids(h, around(LOT_A));
    expect(answerOf(h, r2)).toBeUndefined();
    const again = h.init({ levers: structuredClone(DEFAULT_LEVERS) });
    expect(answerOf(h, r2)).toMatchObject({ ok: false, reason: 'no-session' });
    await h.runAll();
    expect(lidAnswers(h)).toHaveLength(1);
    expect(heights(h).map((m) => m.rev)).toEqual([again]);

    // dispose answers a waiting request too
    const d = harness();
    d.init({ levers: structuredClone(DEFAULT_LEVERS) });
    const r3 = askLids(d, around(LOT_A));
    d.host.dispose();
    expect(answerOf(d, r3)).toMatchObject({ ok: false, reason: 'no-session' });
  });
});
