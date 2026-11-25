// The car system on /sim (car-ownership Task 11): the dataset builds it once (`carSystemOf`), both
// ensembles' worlds run it on seed 1, the feed log carries each month's snapshot into the series,
// and the chunks posted in `filled` carry `cars`. Without cars.bin, or with `cars: 'off'`, /sim
// runs as before: `cars: null`, nothing on stderr. Fixture-0 with a fake clock.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { createLru } from '$lib/sim/lru';
import { scenarioUrls } from '$lib/sim/scenario/load';
import type { TimelineHostRequest, TimelineHostResponse } from '$lib/sim/timeline-protocol';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import { carSnapshotOf, carSystemOf } from './cars';
import { createTimelineHost, type TimelineHostDeps } from './host';
import { span, timingSet } from './policy/test/fixtures';
import { carRowsOf } from './score/series';
import { viewOf, type ScoreStatics, type SeriesChunk, type TimelineView } from './score';
import { createChunkSet, loadDataset, type Dataset, type DatasetDeps } from './runner/dataset';
import { SEED } from './runner/ensemble';
import { createRunner } from './runner/runner';
import { datasetFetch, fakeClock } from './runner/test/harness';

const FIXTURE = 'e2e/fixtures/data/fixture-0';
const MONTHS = 48;

type Msg = TimelineHostResponse;
type Of<T extends Msg['type']> = Extract<Msg, { type: T }>;

let ds: Dataset;
let asOf: Day;

beforeAll(async () => {
  const { manifest, fetch, fetchBytes } = datasetFetch(FIXTURE);
  const deps: DatasetDeps = {
    fetch,
    fetchBytes,
    later: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => 0,
    warn: () => {},
    retryDelaysMs: [],
    maxConcurrent: 4,
    stopped: () => false,
    onChunk: () => {},
    onChunksReport: () => {}
  };
  const r = await loadDataset(
    manifest,
    scenarioUrls(manifest)!,
    createChunkSet(manifest, deps),
    deps,
    createLru<string, GeneratedBuilding | null>(1000),
    { gen: generate, genForUnits: generateForUnits, logOnce: () => {} }
  );
  if ('code' in r) throw new Error(`load failed: ${r.code} ${r.message}`);
  ds = r;
  ds.chunks.want(manifest.chunks.map((c) => c.cellId));
  for (let k = 0; k < 200 && ds.chunks.byCell.size < manifest.chunks.length; k++)
    await new Promise((res) => setImmediate(res));
  expect(ds.chunks.byCell.size).toBe(manifest.chunks.length);
  asOf = ds.loaded.fzp.asOf;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The manifest without `scenarios.fzp.cars` and `carZones` (a dataset built before them). */
function withoutCars(m: Manifest): Manifest {
  const fzp = { ...m.scenarios!.fzp };
  delete fzp.cars;
  delete fzp.carZones;
  return { ...m, scenarios: { fzp } };
}

function allBbox(m: Manifest): [number, number, number, number] {
  const b = m.chunks.map((c) => c.bbox);
  return [
    Math.min(...b.map((x) => x[0])),
    Math.min(...b.map((x) => x[1])),
    Math.max(...b.map((x) => x[2])),
    Math.max(...b.map((x) => x[3]))
  ];
}

/** A host on fixture-0 (or `manifest`) opened on the default document and filled. */
async function filledHost(manifest?: Manifest, over: Partial<TimelineHostDeps> = {}) {
  const f = datasetFetch(FIXTURE);
  const m = manifest ?? f.manifest;
  const clock = fakeClock();
  const posts: Msg[] = [];
  const warns: string[] = [];
  const host = createTimelineHost({
    fetch: f.fetch,
    fetchBytes: f.fetchBytes,
    post: (msg) => posts.push(msg),
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (h) => clock.clearTimeout(h),
    now: () => {
      clock.tick(0.1);
      return clock.now();
    },
    retryDelaysMs: [],
    warn: (msg) => warns.push(msg),
    ...over
  });
  const of = <T extends Msg['type']>(type: T): Of<T>[] =>
    posts.flatMap((p) => (p.type === type ? [p as Of<T>] : []));
  const handle = (req: TimelineHostRequest) => host.handle(req);
  handle({
    type: 'openTimeline',
    rev: 1,
    manifest: m,
    policy: DEFAULT_POLICY4,
    lots: {},
    months: MONTHS
  });
  handle({ type: 'prefetch', bbox: allBbox(m) });
  const done = () => {
    if (of('error').length > 0) return true;
    const c = of('compiled').at(-1);
    const fl = of('filled').at(-1);
    return !!c && !!fl && fl.through === c.statics.lastIndex;
  };
  for (let turns = 0; !done() && turns < 20_000;) {
    if (!(await clock.runNext())) {
      turns++;
      await new Promise((r) => setImmediate(r));
    }
  }
  host.dispose();
  return { posts, warns, of, chunks: of('filled').map((x) => x.series) };
}

describe('carSystemOf', () => {
  it('is a system with cars.bin and calibration.cars; null without either, or off', () => {
    const loaded = ds.loaded;
    expect(loaded.cars).not.toBeNull();
    expect(loaded.fzp.calibration.cars).toBeDefined();
    expect(carSystemOf(loaded)).not.toBeNull();
    expect(carSystemOf(loaded, { off: true })).toBeNull();
    expect(carSystemOf({ ...loaded, cars: null })).toBeNull();
    const calibration = { ...loaded.fzp.calibration, cars: undefined };
    expect(carSystemOf({ ...loaded, fzp: { ...loaded.fzp, calibration } })).toBeNull();
  });

  it('the dataset carries the system it built its world core with', () => {
    expect(ds.cars).not.toBeNull();
    expect(ds.core).toBeDefined();
  });
});

describe('both worlds', () => {
  it('the plan and the comparison worlds run the car system, on seed 1', async () => {
    expect(SEED).toBe(1);
    const clock = fakeClock();
    const runner = createRunner({
      dataset: ds,
      post: () => {},
      now: () => {
        clock.tick(0.1);
        return clock.now();
      },
      later: (fn, ms) => clock.setTimeout(fn, ms),
      warn: () => {},
      logOnce: () => {}
    });
    runner.open(1, DEFAULT_POLICY4, {}, MONTHS);
    await clock.runUntil(() => {
      const { plan, comp } = runner.ensembles();
      return (plan?.month ?? -1) >= 12 && (comp?.month ?? -1) >= 12;
    }, 50_000);
    const { plan, comp } = runner.ensembles();
    expect(plan!.world!.cars).toBeDefined();
    expect(comp!.world!.cars).toBeDefined();
    expect(plan!.world!.cars).not.toBe(comp!.world!.cars);
    runner.dispose();
  });
});

describe('snapshots', () => {
  it("only the plan's series takes car snapshots (the comparison's reach no chunk)", async () => {
    const r = makeRunner();
    r.runner.open(1, DEFAULT_POLICY4, {}, MONTHS);
    await r.run(r.full(1));
    const { plan, comp } = r.runner.ensembles();
    expect(plan!.series).not.toBeNull();
    expect(comp!.series).not.toBeNull();
    expect(carRowsOf(plan!.series!, 0, plan!.finalThrough())).not.toBeNull();
    expect(carRowsOf(comp!.series!, 0, comp!.finalThrough())).toBeNull();
    r.runner.dispose();
  });

  it("month 0's row is the world's car state at creation", async () => {
    const r = makeRunner();
    r.runner.open(1, DEFAULT_POLICY4, {}, MONTHS);
    await r.run(r.full(1));
    const cars = viewFrom(r.posts).cars!;
    const timeline = r.runner.internals().timelines[0]!;
    r.runner.dispose();
    const w = ds.core.createWorld(ds.statics, timeline, SEED, { event() {} });
    const start = carSnapshotOf(w)!;
    expect(start.households).toBeGreaterThan(0);
    expect(cars.households[0]).toBe(start.households);
    expect(cars.cars[0]).toBe(start.cars);
  });
});

describe('the host', () => {
  it('on fixture-0 the filled chunks carry cars, households above 0', async () => {
    const h = await filledHost();
    expect(h.of('error')).toEqual([]);
    expect(h.chunks.length).toBeGreaterThan(0);
    // month 0 included: it carries the start snapshot (`WorldSeries.created`)
    expect(h.chunks[0].from).toBe(0);
    for (const c of h.chunks) {
      expect(c.cars).not.toBeNull();
      expect(c.cars!.length).toBe(c.rows.length);
      for (const row of c.cars!) expect(row.households).toBeGreaterThan(0);
    }
  });

  it('without scenarios.fzp.cars: cars null, the session opens, nothing on stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write');
    const cerr = vi.spyOn(console, 'error');
    const cwarn = vi.spyOn(console, 'warn');
    const h = await filledHost(withoutCars(datasetFetch(FIXTURE).manifest));
    expect(h.of('error')).toEqual([]);
    expect(h.of('ready')).toHaveLength(1);
    expect(h.chunks.length).toBeGreaterThan(0);
    for (const c of h.chunks) expect(c.cars).toBeNull();
    expect(h.warns.filter((w) => /car/i.test(w))).toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
    expect(cerr).not.toHaveBeenCalled();
    expect(cwarn).not.toHaveBeenCalled();
  });

  it("cars: 'off' runs without the car system: cars null", async () => {
    const h = await filledHost(undefined, { cars: 'off' });
    expect(h.of('error')).toEqual([]);
    expect(h.chunks.length).toBeGreaterThan(0);
    for (const c of h.chunks) expect(c.cars).toBeNull();
  });
});

// --- a restore after an edit ---

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

function makeRunner() {
  const clock = fakeClock();
  const posts: Msg[] = [];
  const runner = createRunner({
    dataset: ds,
    post: (msg) => posts.push(msg),
    now: () => {
      clock.tick(0.1);
      return clock.now();
    },
    later: (fn, ms) => clock.setTimeout(fn, ms),
    warn: () => {},
    logOnce: () => {}
  });
  const full = (rev: number) => () => {
    const c = posts.filter((m): m is Of<'compiled'> => m.type === 'compiled').at(-1);
    const f = posts.filter((m): m is Of<'filled'> => m.type === 'filled').at(-1);
    return !!c && c.rev === rev && !!f && f.rev === rev && f.through === c.statics.lastIndex;
  };
  const both = (m: number) => () => {
    const { plan, comp } = runner.ensembles();
    return (plan?.month ?? -1) >= m && (comp?.month ?? -1) >= m;
  };
  const run = (pred: () => boolean) => clock.runUntil(pred, 50_000);
  return { runner, posts, full, both, run };
}

function before(c: SeriesChunk, n: number): SeriesChunk | null {
  if (c.from >= n) return null;
  const k = n - c.from;
  return {
    from: c.from,
    rows: c.rows.slice(0, k),
    planEffect: c.planEffect.slice(0, k),
    money: c.money ? c.money.slice(0, k) : null,
    tiers: c.tiers ? c.tiers.slice(0, k) : null,
    cars: c.cars ? c.cars.slice(0, k) : null
  };
}

/** What a client that applies every `filled` and `refill` in order holds. */
function viewFrom(posts: Msg[]): TimelineView {
  let chunks: SeriesChunk[] = [];
  let statics: ScoreStatics | null = null;
  for (const m of posts) {
    if (m.type === 'compiled') statics = m.statics;
    else if (m.type === 'filled') chunks.push(m.series);
    else if (m.type === 'refill')
      chunks = chunks.flatMap((c) => {
        const t = before(c, m.from);
        return t ? [t] : [];
      });
  }
  return viewOf(chunks, statics!);
}

describe('a restore', () => {
  it('after an edit gives the same cars rows as a fresh run', async () => {
    const months = 200;
    const r = makeRunner();
    r.runner.open(1, baseDoc(), {}, months);
    await r.run(r.both(150));
    const w1 = r.runner.ensembles().plan!.world;
    const doc = baseDoc();
    doc.kinds.zoning.push(protect(100, 200));
    r.runner.setPolicy(2, doc, {});
    await r.run(r.full(2));
    expect(r.posts.filter((m) => m.type === 'error')).toEqual([]);
    // restored: a new world object
    expect(r.runner.ensembles().plan!.world).not.toBe(w1);
    const edited = viewFrom(r.posts).cars;
    r.runner.dispose();

    const f = makeRunner();
    f.runner.open(1, doc, {}, months);
    await f.run(f.full(1));
    const fresh = viewFrom(f.posts).cars;
    f.runner.dispose();
    expect(edited).not.toBeNull();
    expect(edited).toEqual(fresh);
  });
});
