// The timeline host's height limits (ensemble-runner Task 9, spec S14): `heights` for the zoning in
// force at the last `viewMonth` (month 1 before any), posted again when that zoning changes, and
// `heightLids` answered for it by staged lid builds in the runner's slices. Fixture-0, one world,
// a fake clock that charges compute time; a differential against the old host's posts.
import { describe, expect, it } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import { SRC_PAINT } from '$lib/sim/levers/source';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import { scenarioUrls } from '$lib/sim/scenario/load';
import { createScenarioHost } from '$lib/sim/scenario/scenario-host';
import type { ScenarioResponse } from '$lib/sim/scenario/types';
import type { TimelineHostRequest, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { customQuery, queryKey, type CustomBrush } from '$lib/sim-page/policy';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { createTimelineHost } from './host';
import { monthLastDay } from './months';
import { span, timingSet } from './policy/test/fixtures';
import { datasetFetch, fakeClock } from './runner/test/harness';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const MONTHS = 30;
const TICK_MS = 0.1;

type Msg = TimelineHostResponse;
type Of<T extends Msg['type']> = Extract<Msg, { type: T }>;
type BBox4 = [number, number, number, number];

const PAINT: CustomBrush = {
  id: 'paint',
  kind: 'paint',
  strokes: [{ path: [[-122.419, 37.76]], radiusM: 30 }],
  stories: 20
};

async function asOfOf(): Promise<Day> {
  const f = datasetFetch(FIXTURE);
  const body = (await (await f.fetch(scenarioUrls(f.manifest)!.projects)).json()) as {
    asOf: Day;
  };
  return body.asOf;
}

/** The lots of the fixture's first chunk, and its bbox. */
async function firstChunk(): Promise<{ ids: ParcelId[]; bbox: BBox4 }> {
  const f = datasetFetch(FIXTURE);
  const cell = f.manifest.chunks[0];
  const ids = ((await (await f.fetch(cell.url)).json()) as { id: ParcelId[] }).id;
  return { ids, bbox: cell.bbox as BBox4 };
}

/** The default document with the first chunk painted at 20 stories from model month `from`. */
async function paintedDoc(from: number) {
  const asOf = await asOfOf();
  const { ids, bbox } = await firstChunk();
  const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
  doc.kinds.zoning.push({
    id: 'p',
    label: 'p',
    preset: null,
    on: true,
    where: { tag: 'painted' },
    spans: [span(asOf, from, null, { tag: 'brushes', brushes: [PAINT] })]
  });
  return { doc, lots: { [queryKey(customQuery(PAINT))]: ids }, bbox };
}

function allBbox(m: Manifest): BBox4 {
  const b = m.chunks.map((c) => c.bbox);
  return [
    Math.min(...b.map((x) => x[0])),
    Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])),
    Math.max(...b.map((x) => x[3]))
  ];
}

function makeHost() {
  const f = datasetFetch(FIXTURE);
  const clock = fakeClock();
  const posts: { msg: Msg; transfer: ArrayBuffer[] }[] = [];
  /** True while a message handler runs: no staged unit may run then (D3). */
  let inHandler = false;
  let unitsInHandler = 0;
  const host = createTimelineHost({
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    post: (msg, transfer) => {
      if (inHandler && (msg.type === 'heights' || msg.type === 'heightLids'))
        if (msg.type === 'heights' || msg.result.ok) unitsInHandler++;
      posts.push({ msg, transfer });
    },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (h) => clock.clearTimeout(h),
    now: () => {
      clock.tick(TICK_MS);
      return clock.now();
    },
    retryDelaysMs: [],
    warn: () => {}
  });
  const handle = (req: TimelineHostRequest) => {
    inHandler = true;
    try {
      host.handle(req);
    } finally {
      inHandler = false;
    }
  };
  const of = <T extends Msg['type']>(type: T, from = 0): Of<T>[] =>
    posts.slice(from).flatMap((p) => (p.msg.type === type ? [p.msg as Of<T>] : []));
  async function run(pred: () => boolean, maxTimers = 20_000, maxIdleTurns = 5_000) {
    let timers = 0;
    let turns = 0;
    while (!pred() && timers < maxTimers && turns < maxIdleTurns) {
      if (await clock.runNext()) timers++;
      else {
        turns++;
        await new Promise((r) => setImmediate(r));
      }
    }
    if (!pred()) throw new Error(`run: the condition never held (${timers} timers)`);
  }
  const idle = async (max = 2_000) => {
    for (let k = 0; k < max; k++) if (!(await clock.runNext())) return true;
    return false;
  };
  const open = (policy: SimPolicy4, lots: Record<string, ParcelId[]> = {}, rev = 1) =>
    handle({
      type: 'openTimeline',
      rev,
      manifest: f.manifest,
      policy,
      lots,
      worlds: 1,
      months: MONTHS
    });
  let reqId = 0;
  const lidsOf = (id: number) => of('heightLids').find((m) => m.reqId === id);
  const askLids = (bbox: BBox4) => {
    const id = ++reqId;
    handle({ type: 'heightLids', reqId: id, bbox });
    return id;
  };
  const prefetchAll = () => handle({ type: 'prefetch', bbox: allBbox(f.manifest) });
  const filled = () => {
    const c = of('compiled').at(-1);
    return !!c && of('filled').at(-1)?.through === c.statics.lastIndex;
  };
  return {
    host,
    posts,
    of,
    run,
    idle,
    open,
    handle,
    askLids,
    lidsOf,
    prefetchAll,
    filled,
    manifest: f.manifest,
    unitsInHandler: () => unitsInHandler
  };
}

const heightsOf = (h: ReturnType<typeof makeHost>) => h.of('heights');

describe('timeline host: heights', () => {
  it("heights posts on open for month 1's zoning", async () => {
    const h = makeHost();
    h.open(DEFAULT_POLICY4);
    h.prefetchAll();
    await h.run(() => heightsOf(h).length > 0 && h.filled());
    expect(h.of('error')).toEqual([]);
    expect(await h.idle()).toBe(true);
    const got = heightsOf(h);
    expect(got).toHaveLength(1);
    expect(got[0].rev).toBe(1);
    const c = got[0].city;
    expect(c.chains.starts.length).toBeGreaterThan(1);
    // the city's own buffers are transferred, each once
    const at = h.posts.findIndex((p) => p.msg.type === 'heights');
    const sent = h.posts[at].transfer;
    for (const a of [c.chains.starts, c.chains.positions, c.chains.hi, c.labels.position])
      expect(sent).toContain(a.buffer);
    expect(new Set(sent).size).toBe(sent.length);
    expect(h.unitsInHandler()).toBe(0);
  });

  it('viewMonth into a frame with different zoning posts heights again, same zoning posts none', async () => {
    const { doc, lots } = await paintedDoc(13);
    const h = makeHost();
    h.open(doc, lots);
    h.prefetchAll();
    await h.run(() => heightsOf(h).length > 0 && h.filled());
    expect(await h.idle()).toBe(true);
    expect(heightsOf(h)).toHaveLength(1);
    const fzp = heightsOf(h)[0].city;
    expect(fzp.sourceIds).toEqual([]);
    // same zoning (months 1 to 12): nothing
    h.handle({ type: 'viewMonth', month: 6 });
    expect(await h.idle()).toBe(true);
    expect(heightsOf(h)).toHaveLength(1);
    // into the painted months: the painted city
    h.handle({ type: 'viewMonth', month: 20 });
    await h.run(() => heightsOf(h).length === 2);
    const painted = heightsOf(h)[1].city;
    expect([...painted.chains.srcA].some((s) => s === SRC_PAINT)).toBe(true);
    expect([...fzp.chains.srcA].some((s) => s === SRC_PAINT)).toBe(false);
    h.handle({ type: 'viewMonth', month: 25 });
    expect(await h.idle()).toBe(true);
    expect(heightsOf(h)).toHaveLength(2);
    // back to month 1's zoning: the FZP city again
    h.handle({ type: 'viewMonth', month: 2 });
    await h.run(() => heightsOf(h).length === 3);
    expect(heightsOf(h)[2].city).toEqual(fzp);
    expect(h.unitsInHandler()).toBe(0);
    expect(h.of('error')).toEqual([]);
  });

  it('an edit posts heights only when the zoning at the last viewMonth changes', async () => {
    const { doc, lots } = await paintedDoc(1);
    const h = makeHost();
    h.open(DEFAULT_POLICY4);
    h.prefetchAll();
    await h.run(() => heightsOf(h).length > 0 && h.filled());
    expect(await h.idle()).toBe(true);
    // an edit with the same zoning (a timing policy): no heights
    const timing = structuredClone(DEFAULT_POLICY4);
    timing.kinds.permitting.push({
      id: 't',
      label: 't',
      preset: null,
      on: true,
      where: { tag: 'routes' },
      spans: [
        span(await asOfOf(), 1, null, {
          tag: 'timing',
          set: timingSet({
            edits: [{ pathway: 'discretionary', stage: 'permitFiled', scale: 0.5, reach: 'all' }]
          })
        })
      ]
    });
    h.handle({ type: 'setPolicy', rev: 2, policy: timing, lots: {} });
    await h.run(() => h.of('compiled').some((c) => c.rev === 2));
    expect(await h.idle()).toBe(true);
    expect(heightsOf(h)).toHaveLength(1);
    // an edit painting from month 1: heights at its rev
    h.handle({ type: 'setPolicy', rev: 3, policy: doc, lots });
    await h.run(() => heightsOf(h).length === 2);
    expect(heightsOf(h)[1].rev).toBe(3);
    expect([...heightsOf(h)[1].city.chains.srcA].some((s) => s === SRC_PAINT)).toBe(true);
    expect(h.of('error')).toEqual([]);
  });

  it('heightLids answers for the zoning at the last viewMonth and is superseded by a newer one', async () => {
    const { doc, lots, bbox } = await paintedDoc(13);
    const h = makeHost();
    h.open(doc, lots);
    h.prefetchAll();
    await h.run(() => heightsOf(h).length > 0 && h.filled());
    const a = h.askLids(bbox);
    const b = h.askLids(bbox);
    // the older one is answered at once, by the handler
    expect(h.lidsOf(a)?.result).toMatchObject({ ok: false, reason: 'superseded' });
    await h.run(() => h.lidsOf(b) !== undefined);
    const fzp = h.lidsOf(b)!.result;
    expect(fzp.ok).toBe(true);
    h.handle({ type: 'viewMonth', month: 20 });
    const c = h.askLids(bbox);
    await h.run(() => h.lidsOf(c) !== undefined);
    const painted = h.lidsOf(c)!.result;
    expect(painted.ok).toBe(true);
    if (!fzp.ok || !painted.ok) return;
    // the painted zoning's lids come after its heights, on its limits
    expect(heightsOf(h)).toHaveLength(2);
    expect(painted.lids).not.toEqual(fzp.lids);
    expect([...painted.lids.pieces.source].some((s) => s === SRC_PAINT)).toBe(true);
    expect([...fzp.lids.pieces.source].some((s) => s === SRC_PAINT)).toBe(false);
    expect(h.unitsInHandler()).toBe(0);
  });

  it('a session end answers a waiting heightLids no-session', async () => {
    const h = makeHost();
    h.open(DEFAULT_POLICY4);
    const id = h.askLids(allBbox(h.manifest));
    expect(h.lidsOf(id)).toBeUndefined();
    h.open(DEFAULT_POLICY4, {}, 2);
    expect(h.lidsOf(id)?.result).toMatchObject({ ok: false, reason: 'no-session' });
    const late = h.askLids([0, 0, 0.001, 0.001]);
    h.host.dispose();
    expect(h.lidsOf(late)?.result).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it("the default document's heights and lids equal the old host's with default levers", async () => {
    const { bbox } = await firstChunk();
    const asOf = await asOfOf();
    // the old host, before any setLevers
    const f = datasetFetch(FIXTURE);
    const clock = fakeClock();
    const old: ScenarioResponse[] = [];
    const oldHost = createScenarioHost({
      fetch: f.fetch,
      fetchBytes: f.fetchBytes,
      post: (m) => old.push(m),
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (x) => clock.clearTimeout(x),
      now: () => {
        clock.tick(TICK_MS);
        return clock.now();
      },
      retryDelaysMs: [],
      bandRuns: 1,
      warn: () => {}
    });
    oldHost.handle({
      type: 'initScenario',
      rev: 1,
      manifest: f.manifest,
      scenario: 'fzp',
      seed: 1,
      horizon: monthLastDay(asOf, MONTHS),
      levers: structuredClone(DEFAULT_LEVERS)
    });
    oldHost.handle({ type: 'prefetch', bbox: allBbox(f.manifest) });
    oldHost.handle({ type: 'heightLids', reqId: 1, bbox });
    const oldLids = () =>
      old.find(
        (m): m is Extract<ScenarioResponse, { type: 'heightLids' }> => m.type === 'heightLids'
      );
    for (let k = 0; k < 20_000 && !oldLids(); k++)
      if (!(await clock.runNext())) await new Promise((r) => setImmediate(r));
    oldHost.dispose();
    const oldHeights = old.filter((m) => m.type === 'heights');
    expect(oldHeights).toHaveLength(1);
    expect(oldLids()!.result.ok).toBe(true);

    const h = makeHost();
    h.open(DEFAULT_POLICY4);
    h.prefetchAll();
    await h.run(() => h.filled());
    const id = h.askLids(bbox);
    await h.run(() => h.lidsOf(id) !== undefined);
    h.host.dispose();
    expect(heightsOf(h)).toEqual(oldHeights);
    expect(h.lidsOf(id)!.result).toEqual(oldLids()!.result);
  });
});
