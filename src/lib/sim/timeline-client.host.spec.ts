// The timeline host driven through `TimelineClient` with delayed delivery (ensemble-runner rule 22,
// S14): host posts queue in a fake worker and reach the client later, interleaved with the
// client's requests, as a real worker's postMessage does. The months the client delivers, applied
// in order (`refill` withdraws from its `from`), are contiguous from 0 to `lastIndex` and equal a
// fresh open of the last accepted document. Fixture-0, 4 worlds, a fake clock.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Day } from '$lib/timelapse/time';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import type { ScenarioWorkerLike } from './scenario-client';
import type { WorkerRequest } from './scenario/types';
import { TimelineClient } from './timeline-client';
import type { TimelineHostRequest, TimelineHostResponse } from './timeline-protocol';
import { createTimelineHost } from './world/host';
import { span, timingSet } from './world/policy/test/fixtures';
import { datasetFetch, fakeClock } from './world/runner/test/harness';
import { viewOf, type ScoreStatics, type SeriesChunk, type TimelineView } from './world/score';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const WORLDS = 4;
const MONTHS = 130;

type Msg = TimelineHostResponse;
type Of<T extends Msg['type']> = Extract<Msg, { type: T }>;

const f = datasetFetch(FIXTURE);
/** Fixture-0's `asOf` (the FZP projects' day), which the documents' spans are dated from. */
const asOf = (
  JSON.parse(
    readFileSync(
      new URL(`../../../${FIXTURE}/scenarios/fzp/projects.json`, import.meta.url),
      'utf8'
    )
  ) as { asOf: Day }
).asOf;

// --- documents (as host.edit.spec.ts) ---

function baseDoc(): SimPolicy4 {
  const doc: SimPolicy4 = structuredClone(DEFAULT_POLICY4);
  doc.kinds.permitting.push({
    id: 'observed',
    label: 'observed',
    preset: null,
    on: true,
    where: { tag: 'routes' },
    spans: [span(asOf, 1, null, { tag: 'timing', set: timingSet() })]
  });
  return doc;
}

const protect = (from: number, years: number): Policy => ({
  id: `newer-${years}-${from}`,
  label: 'newer',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'newerThan' },
  spans: [span(asOf, from, null, { tag: 'protect', years })]
});

/** A painted brush whose query is missing from `lots`: the compiler rejects the document. */
const unresolved = (): Policy => ({
  id: 'painted',
  label: 'painted',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [
    span(asOf, 1, null, {
      tag: 'brushes',
      brushes: [
        {
          id: 'paint',
          kind: 'paint',
          strokes: [{ path: [[-122.419, 37.76]], radiusM: 30 }],
          stories: 20
        }
      ]
    })
  ]
});

function withZoning(doc: SimPolicy4, ...ps: Policy[]): SimPolicy4 {
  const out = structuredClone(doc);
  out.kinds.zoning.push(...ps);
  return out;
}

// --- a worker whose posts reach the client later ---

/**
 * A fake worker around the real timeline host. Client requests reach the host at once; host posts
 * wait in `inbox` until `deliver` hands them to the client in order. `openTimeline` is sent on
 * with `WORLDS` and `MONTHS` in place of the client's production sizes (test cost only).
 */
function delayedWorker() {
  const clock = fakeClock();
  const inbox: Msg[] = [];
  /** Every host post so far, delivered or not, for the run conditions. */
  const all: Msg[] = [];
  const host = createTimelineHost({
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    post: (msg) => {
      inbox.push(msg);
      all.push(msg);
    },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (h) => clock.clearTimeout(h),
    now: () => {
      clock.tick(0.1);
      return clock.now();
    },
    retryDelaysMs: [],
    warn: () => {}
  });
  const w: ScenarioWorkerLike = {
    onmessage: null,
    postMessage(msg: WorkerRequest) {
      const req = msg as unknown as TimelineHostRequest;
      host.handle(req.type === 'openTimeline' ? { ...req, worlds: WORLDS, months: MONTHS } : req);
    },
    terminate: () => host.dispose()
  };
  /** Hands every waiting post to the client, in order. */
  const deliver = () => {
    for (const m of inbox.splice(0)) w.onmessage?.({ data: m as never });
  };
  /**
   * Fires host timers until `pred()` holds; with none pending it waits real turns (the dataset
   * decode). `live`: deliver after every timer, so posts reach the client one task late.
   */
  async function run(pred: () => boolean, live: boolean) {
    for (let k = 0, turns = 0; k < 20_000 && turns < 5_000 && !pred();) {
      if (await clock.runNext()) {
        k++;
        if (live) deliver();
      } else {
        turns++;
        await new Promise((res) => setImmediate(res));
      }
    }
    expect(pred()).toBe(true);
  }
  return { w, host, inbox, all, deliver, run };
}

/** What the client delivered, applied in order, with the contiguity of every `filled`. */
function recorder() {
  const got: Msg[] = [];
  let chunks: SeriesChunk[] = [];
  let statics: ScoreStatics | null = null;
  /** The last month index held: a `filled` must start right after it. */
  let held = -1;
  const gaps: string[] = [];
  const push = (m: Msg) => got.push(m);
  const events = {
    onCompiling: push,
    onCompiled: (m: Of<'compiled'>) => {
      push(m);
      statics = m.statics;
    },
    onFilled: (m: Of<'filled'>) => {
      push(m);
      if (m.series.from !== held + 1) gaps.push(`filled from ${m.series.from} after ${held}`);
      chunks.push(m.series);
      held = m.through;
    },
    onRefill: (m: Of<'refill'>) => {
      push(m);
      chunks = chunks.flatMap((c) => {
        const t = before(c, m.from);
        return t ? [t] : [];
      });
      held = Math.min(held, m.from - 1);
    },
    onError: push
  };
  return {
    events,
    got,
    gaps,
    held: () => held,
    statics: () => statics,
    view: (): TimelineView => viewOf(chunks, statics!)
  };
}

function before(c: SeriesChunk, n: number): SeriesChunk | null {
  if (c.from >= n) return null;
  const k = n - c.from;
  return {
    from: c.from,
    mean: c.mean.slice(0, k),
    sd: c.sd.slice(0, k),
    shown: c.shown.slice(0, k),
    planEffect: c.planEffect.slice(0, k),
    money: c.money ? c.money.slice(0, k) : null,
    tiers: c.tiers ? c.tiers.slice(0, k) : null
  };
}

/** Filled through the last month of the last `compiled` posted at `rev`. */
const fullAt = (posts: Msg[], rev: number) => () => {
  const c = posts.filter((m): m is Of<'compiled'> => m.type === 'compiled').at(-1);
  const fl = posts.filter((m): m is Of<'filled'> => m.type === 'filled').at(-1);
  return !!c && c.rev === rev && !!fl && fl.rev === rev && fl.through === c.statics.lastIndex;
};

const filledThrough = (posts: Msg[], month: number) => () =>
  posts.some((m) => m.type === 'filled' && m.through >= month);

/** The view of a fresh open of `doc`, delivered at once. */
async function fresh(doc: SimPolicy4): Promise<TimelineView> {
  const wk = delayedWorker();
  const rec = recorder();
  const client = new TimelineClient(wk.w, rec.events);
  client.open(f.manifest, doc, {});
  await wk.run(fullAt(wk.all, 1), true);
  wk.deliver();
  expect(rec.gaps).toEqual([]);
  client.dispose();
  return rec.view();
}

/**
 * Opens `baseDoc()`, fills (delivered) through month index `shown`, fills on through
 * `heldThrough` with the posts held in flight, then sends `edit` before any of them arrives.
 */
async function editMidFill(edit: SimPolicy4, shown: number, heldThrough: number) {
  const wk = delayedWorker();
  const rec = recorder();
  const client = new TimelineClient(wk.w, rec.events);
  client.open(f.manifest, baseDoc(), {});
  await wk.run(filledThrough(wk.all, shown), true);
  wk.deliver();
  await wk.run(filledThrough(wk.all, heldThrough), false);
  const inFlight = wk.inbox.filter((m) => m.type === 'filled').length;
  expect(inFlight).toBeGreaterThan(0);
  const rev = client.setPolicy(edit, {});
  return { wk, rec, client, rev };
}

async function finish(wk: ReturnType<typeof delayedWorker>, rev: number) {
  await wk.run(fullAt(wk.all, rev), true);
  wk.deliver();
}

describe('TimelineClient over the timeline host, delayed delivery', () => {
  it('a setPolicy mid-fill that the host keeps: contiguous months, equal to a fresh open', async () => {
    const doc = withZoning(baseDoc(), protect(125, 41));
    const { wk, rec, client, rev } = await editMidFill(doc, 20, 50);
    await finish(wk, rev);
    expect(rec.got.filter((m) => m.type === 'error')).toEqual([]);
    expect(rec.got.some((m) => m.type === 'refill')).toBe(false);
    expect(rec.gaps).toEqual([]);
    expect(rec.held()).toBe(rec.statics()!.lastIndex);
    expect(rec.view()).toEqual(await fresh(doc));
    client.dispose();
  });

  it('a setPolicy mid-fill at an earlier month that restores: contiguous months, equal to a fresh open', async () => {
    const doc = withZoning(baseDoc(), protect(40, 200));
    const { wk, rec, client, rev } = await editMidFill(doc, 20, 80);
    await finish(wk, rev);
    expect(rec.got.filter((m) => m.type === 'error')).toEqual([]);
    const refills = rec.got.filter((m): m is Of<'refill'> => m.type === 'refill');
    expect(refills).toHaveLength(1);
    // the edit withdraws months the client got only from posts that were in flight
    expect(refills[0].from).toBeGreaterThan(20);
    expect(rec.gaps).toEqual([]);
    expect(rec.held()).toBe(rec.statics()!.lastIndex);
    const view = rec.view();
    expect(view.money).not.toBeNull();
    expect(view).toEqual(await fresh(doc));
    expect(view).not.toEqual(await fresh(baseDoc()));
    client.dispose();
  });

  it('a rejected setPolicy mid-fill: bad-request, contiguous months, equal to a fresh open of the previous document', async () => {
    const { wk, rec, client, rev } = await editMidFill(withZoning(baseDoc(), unresolved()), 20, 50);
    await finish(wk, 1);
    expect(rec.got.filter((m) => m.type === 'error')).toEqual([
      expect.objectContaining({ rev, code: 'bad-request' })
    ]);
    expect(rec.gaps).toEqual([]);
    expect(rec.held()).toBe(rec.statics()!.lastIndex);
    expect(rec.view()).toEqual(await fresh(baseDoc()));
    client.dispose();
  });

  it('a second open with posts of the first in flight: none of them is delivered', async () => {
    const wk = delayedWorker();
    const rec = recorder();
    const client = new TimelineClient(wk.w, rec.events);
    client.open(f.manifest, baseDoc(), {});
    await wk.run(filledThrough(wk.all, 30), false);
    const first = wk.inbox.filter((m) => 'rev' in m && m.type !== 'ready').length;
    expect(first).toBeGreaterThan(0);
    const doc = withZoning(baseDoc(), protect(10, 41));
    expect(client.open(f.manifest, doc, {})).toBe(2);
    await finish(wk, 2);
    const revs = rec.got.flatMap((m) => ('rev' in m ? [m.rev] : []));
    expect(revs.length).toBeGreaterThan(0);
    expect(new Set(revs)).toEqual(new Set([2]));
    expect(rec.gaps).toEqual([]);
    expect(rec.view()).toEqual(await fresh(doc));
    client.dispose();
  });
});
