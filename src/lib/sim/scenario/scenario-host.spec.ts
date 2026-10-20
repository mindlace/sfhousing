// Scenario host timeline delivery (spec §4.6, §4.7, §4.5 "Empty until computed", AC 7-9): the
// band runs, revision 0, the shown twin's plan-effect update, progressive band pairs, reroll,
// cancellation, the ≤ 50 ms slices, viewport-driven geometry (chunks, packing, the memo) and
// `parcelSummary`. Loading and its errors are in scenario-host.load.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { encodeParcelChunk } from '$lib/data/parcel-chunk';
import { generate, generateForUnits } from '$lib/generator';
import type { TimedPackedCell } from '$lib/map/types';
import { cellsIntersecting } from '$lib/sim/chunks';
import { createLru } from '$lib/sim/lru';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { bandSeed, quantiles, representativeIndex } from './band';
import { chooseProject, projectCard, revisionAt, type CardCtx } from './card';
import { MINI_CELLS, MINI_CHUNK_URL, MINI_VERSION, miniCity } from './fixtures/mini-parcels';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import {
  footprintParcel,
  massingFor,
  massingsFor,
  pipeKey,
  simKey,
  type MassingCtx
} from './massing';
import { assembleScore, monthsOf, netOf, phasingOf, planEffectOf, shownSeries } from './score';
import { simulateDetailed } from './simulate';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { ScenarioHostDeps } from './scenario-host';
import type { Schedule, SimInput, TimelineResponse, TimelineScore } from './types';

type Call = {
  fn: 'net' | 'detailed';
  twin: boolean; // the baseZoning input (it shares the base columns)
  seed: number;
  input: SimInput;
  posts: number; // posts made before the call
  slice: number; // the harness timer callback it ran in (index into h.slices)
};

// Pass-through spies on the two engines: each call is logged with the post count at that moment
// and charged a fixed fake compute cost on the harness clock.
const hooks = vi.hoisted(() => ({
  netMs: 15,
  detailedMs: 40,
  packMs: 0, // fake compute charged per packTimedCell call
  throwFor: null as string | null, // packTimedCell throws for items holding this project
  tick: (ms: number): void => void ms,
  posts: (): number => 0,
  slice: (): number => 0,
  calls: [] as Call[],
  packs: [] as { cellId: string; posts: number; slice: number }[],
  geometries: [] as number[] // the harness timer callback of each createGeometry
}));

// Pass-through spy on the shown run's geometry set-up: the callback each createGeometry ran in.
vi.mock('./geometry', async (importOriginal) => {
  const m = await importOriginal<typeof import('./geometry')>();
  return {
    ...m,
    createGeometry: vi.fn((o: Parameters<typeof m.createGeometry>[0]) => {
      hooks.geometries.push(hooks.slice());
      return m.createGeometry(o);
    })
  };
});
// Pass-through spy on timelapse-render's packing: each call is logged and charged `packMs`.
vi.mock('$lib/map/pack-timed', async (importOriginal) => {
  const m = await importOriginal<typeof import('$lib/map/pack-timed')>();
  return {
    ...m,
    packTimedCell: vi.fn((cellId: string, items: Parameters<typeof m.packTimedCell>[1]) => {
      hooks.packs.push({ cellId, posts: hooks.posts(), slice: hooks.slice() });
      hooks.tick(hooks.packMs);
      const bad = hooks.throwFor;
      if (bad !== null && items.some((i) => i.schedule.projectId === bad))
        throw new Error(`packTimedCell ${cellId}: project ${bad} has a broken ring`);
      return m.packTimedCell(cellId, items);
    })
  };
});

vi.mock('./simulate', async (importOriginal) => {
  const m = await importOriginal<typeof import('./simulate')>();
  const record = (fn: Call['fn'], input: SimInput, seed: number, ms: number) => {
    const twin = input.parcels.envelopeStories === input.parcels.baseStories;
    hooks.calls.push({ fn, twin, seed, input, posts: hooks.posts(), slice: hooks.slice() });
    hooks.tick(ms);
  };
  return {
    ...m,
    simulateNet: vi.fn((input: SimInput, seed: number, horizon: Day, months: Day[]) => {
      record('net', input, seed, hooks.netMs);
      return m.simulateNet(input, seed, horizon, months);
    }),
    simulateDetailed: vi.fn((input: SimInput, seed: number, horizon: Day) => {
      record('detailed', input, seed, hooks.detailedMs);
      return m.simulateDetailed(input, seed, horizon);
    })
  };
});

const actual = await vi.importActual<typeof import('./simulate')>('./simulate');
const actualPack =
  await vi.importActual<typeof import('$lib/map/pack-timed')>('$lib/map/pack-timed');

const H = MINI_HORIZON;
const N = 17; // lowered band size (deps.bandRuns); one test runs the full 101
const SEED = 1000; // a shown seed that is no band seed, so its twin is told apart from theirs

function harness(
  bandRuns: number | null = N,
  opts: { deps?: Partial<ScenarioHostDeps>; retryDelaysMs?: readonly number[] } = {}
): ScenarioHarness {
  const h = makeScenarioHarness({
    deps: { ...(bandRuns === null ? {} : { bandRuns }), ...opts.deps },
    ...(opts.retryDelaysMs ? { retryDelaysMs: opts.retryDelaysMs } : {})
  });
  hooks.tick = h.tick;
  hooks.posts = () => h.posts.length;
  hooks.slice = () => h.slices.length; // the callback running now is pushed when it ends
  hooks.calls.length = 0;
  hooks.packs.length = 0;
  hooks.geometries.length = 0;
  return h;
}

// The load's skipped-rows note goes through deps.warn (harness `warnings`), never the console;
// the chunk loader's console.warn per failed attempt is allowed where a test expects it.
const SKIP_NOTE = /^projects\.json: skipped \d+ project\(s\) the simulation does not run/;
let warnSpy: MockInstance<typeof console.warn>;
let allowedWarnings: RegExp[];

beforeEach(() => {
  hooks.netMs = 15;
  hooks.detailedMs = 40;
  hooks.packMs = 0;
  hooks.throwFor = null;
  allowedWarnings = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  const unexpected = warnSpy.mock.calls.filter(
    (args) => !allowedWarnings.some((re) => re.test(String(args[0])))
  );
  warnSpy.mockRestore();
  expect(unexpected).toEqual([]);
});

const timelines = (h: ScenarioHarness, rev?: number): TimelineResponse[] =>
  h.posts.filter(
    (m): m is TimelineResponse => m.type === 'timeline' && (rev === undefined || m.rev === rev)
  );
const bandOnly = (revision: number) => ({ revision, cells: [], removedCells: [], demolish: [] });

/** The host's own two inputs, as the engines saw them. */
function inputs(): { fzp: SimInput; twin: SimInput } {
  const fzp = hooks.calls.find((c) => !c.twin)?.input;
  const twin = hooks.calls.find((c) => c.twin)?.input;
  if (!fzp || !twin) throw new Error('both inputs not seen yet');
  return { fzp, twin };
}

const netCalls = (pred: (c: Call) => boolean = () => true) =>
  hooks.calls.filter((c) => c.fn === 'net' && pred(c));

/**
 * Every T11 parcel of every Schedule with a construction start, earliest day, by parcel id (a
 * parcel absent from T11 has no demolish entry).
 */
function demolishOf(schedules: Schedule[], fzp: SimInput): { parcelId: ParcelId; day: Day }[] {
  const first = new Map<ParcelId, Day>();
  for (const s of schedules) {
    const c = s.entered.construction;
    if (c === undefined) continue;
    for (const id of s.parcelIds) {
      if (!fzp.parcels.index.has(id)) continue;
      const d = first.get(id);
      if (d === undefined || c < d) first.set(id, c);
    }
  }
  return [...first]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([parcelId, day]) => ({ parcelId, day }));
}

/** The shown run of `seed`, computed directly. */
function shownRun(fzp: SimInput, seed: number) {
  const months = monthsOf(fzp.asOf, H);
  const run = actual.simulateDetailed(fzp, seed, H);
  const shown = shownSeries(run, fzp.asOf, H, months);
  return { months, schedules: run.schedules, shown, net: netOf(shown) };
}

/** The first `n` band pairs, computed directly. */
function bandOf(inp: { fzp: SimInput; twin: SimInput }, n: number) {
  const months = monthsOf(inp.fzp.asOf, H);
  const fzp: Int32Array[] = [];
  const effect: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const f = actual.simulateNet(inp.fzp, bandSeed(i), H, months);
    const t = actual.simulateNet(inp.twin, bandSeed(i), H, months);
    fzp.push(f.completedNet);
    effect.push(f.completedNetNew.map((v, k) => v - t.completedNetNew[k]));
  }
  return {
    band: quantiles(fzp),
    planEffectBand: quantiles(effect),
    representative: bandSeed(representativeIndex(fzp.map((r) => r[r.length - 1])))
  };
}

function twinEffect(inp: { fzp: SimInput; twin: SimInput }, seed: number) {
  const { months, net } = shownRun(inp.fzp, seed);
  return planEffectOf(net, actual.simulateNet(inp.twin, seed, H, months));
}

function scoreOf(
  fzp: SimInput,
  seed: number,
  parts: Pick<TimelineScore, 'band' | 'planEffect' | 'planEffectBand'>
): TimelineScore {
  const projects = parseProjectsFile(miniProjectsJson(), { onInvalid: () => {} });
  const { months, shown } = shownRun(fzp, seed);
  return assembleScore({
    months,
    shown,
    ...parts,
    baseline: projects.rhnaCompletedNet,
    phasing: phasingOf(fzp.projects, fzp.asOf)
  });
}

/** Steps the fake clock one timer at a time until `done()`. */
async function stepUntil(h: ScenarioHarness, done: () => boolean): Promise<void> {
  await h.flush();
  while (!done()) {
    if (!(await h.step())) throw new Error('stepUntil: no timer left');
  }
}

describe('scenario host: a seeded init', () => {
  it('posts ready, then revision 0 of the shown run: the full demolish list, empty band and plan effect', async () => {
    const h = harness();
    const rev = h.init({ seed: SEED });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    // the load's one skipped-rows note, through deps.warn (the console stays clean: afterEach)
    expect(h.warnings.filter((w) => SKIP_NOTE.test(w))).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({ type: 'ready', rev });
    const t0 = h.posts[1] as TimelineResponse;
    expect(t0.type).toBe('timeline');
    const { fzp } = inputs();
    const { schedules } = shownRun(fzp, SEED);
    const demolish = demolishOf(schedules, fzp);
    expect(demolish.length).toBeGreaterThan(0);
    expect(t0).toEqual({
      type: 'timeline',
      rev,
      seed: SEED,
      render: { revision: 0, cells: [], removedCells: [], demolish },
      score: scoreOf(fzp, SEED, { band: [], planEffect: [], planEffectBand: [] }),
      bandRuns: 0,
      bandRunsTotal: N,
      complete: true
    });
    expect(t0.score.months).toHaveLength(291);
    expect(h.transfers[1]).toEqual([]);
  });

  it('then the shown twin as a band-only update, then band pairs with an update every 16 and after the last', async () => {
    const h = harness();
    const rev = h.init({ seed: SEED });
    await h.runAll();
    const inp = inputs();
    const tl = timelines(h);
    expect(tl.map((t) => t.render.revision)).toEqual([0, 1, 2, 3]);
    expect(tl.map((t) => t.bandRuns)).toEqual([0, 0, 16, N]);
    for (const t of tl) {
      expect(t).toMatchObject({ rev, seed: SEED, bandRunsTotal: N, complete: true });
      expect(t.score.shown).toEqual(tl[0].score.shown);
    }
    for (const t of tl.slice(1)) expect(t.render).toEqual(bandOnly(t.render.revision));
    const effect = twinEffect(inp, SEED);
    const b16 = bandOf(inp, 16);
    const b17 = bandOf(inp, N);
    // the twin update: planEffect, and the planEffectBand folded so far (none yet)
    expect(tl[1].score).toEqual(
      scoreOf(inp.fzp, SEED, { band: [], planEffect: effect, planEffectBand: [] })
    );
    expect(tl[2].score).toEqual(
      scoreOf(inp.fzp, SEED, {
        band: b16.band,
        planEffect: effect,
        planEffectBand: b16.planEffectBand
      })
    );
    expect(tl[3].score).toEqual(
      scoreOf(inp.fzp, SEED, {
        band: b17.band,
        planEffect: effect,
        planEffectBand: b17.planEffectBand
      })
    );
    // shown run, its twin, then FZP + twin per band seed; every post transfers nothing
    const order = hooks.calls.map((c) => `${c.fn}:${c.twin ? 'twin' : 'fzp'}:${c.seed}`);
    const pairs = Array.from({ length: N }, (_, i) => [
      `net:fzp:${bandSeed(i)}`,
      `net:twin:${bandSeed(i)}`
    ]).flat();
    expect(order).toEqual([`detailed:fzp:${SEED}`, `net:twin:${SEED}`, ...pairs]);
    expect(h.transfers.every((t) => t.length === 0)).toBe(true);
  });

  it('complete tracks packing only: true on every timeline while the band is still provisional', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    const provisional = timelines(h).filter((t) => t.bandRuns < t.bandRunsTotal);
    expect(provisional.length).toBeGreaterThan(0);
    expect(timelines(h).every((t) => t.complete)).toBe(true);
  });

  it('never makes twin Schedules: simulateDetailed only ever sees the FZP input', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 3 });
    await h.runAll();
    const detailed = hooks.calls.filter((c) => c.fn === 'detailed');
    expect(detailed.map((c) => c.seed)).toEqual([SEED, 3]);
    expect(detailed.every((c) => !c.twin)).toBe(true);
    expect(timelines(h).every((t) => t.render.cells.length === 0)).toBe(true);
  });
});

describe('scenario host: a null seed (the full 101)', () => {
  it('runs every FZP band run first, posts the representative run with a complete band, then the twin and 101 pairs', async () => {
    const h = harness(null); // deps.bandRuns unset: N = 101
    const rev = h.init({ seed: null });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const inp = inputs();
    const full = bandOf(inp, 101);

    // 101 FZP band runs, in seed order, before any timeline
    const fzpRuns = netCalls((c) => !c.twin);
    expect(fzpRuns.map((c) => c.seed)).toEqual(Array.from({ length: 101 }, (_, i) => i + 1));
    expect(fzpRuns.every((c) => c.posts === 1)).toBe(true); // only `ready` so far

    const tl = timelines(h);
    expect(tl.every((t) => t.rev === rev && t.bandRunsTotal === 101)).toBe(true);
    expect(tl.map((t) => t.render.revision)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tl.map((t) => t.bandRuns)).toEqual([0, 0, 16, 32, 48, 64, 80, 96, 101]);
    expect(tl.every((t) => t.seed === full.representative)).toBe(true);

    const [t0, t1] = tl;
    expect(t0.score).toEqual(
      scoreOf(inp.fzp, full.representative, {
        band: full.band,
        planEffect: [],
        planEffectBand: []
      })
    );
    expect(t0.render.demolish).toEqual(
      demolishOf(shownRun(inp.fzp, full.representative).schedules, inp.fzp)
    );
    // AC 7: the shown run's final completedNet is the final p50
    expect(t0.score.shown.at(-1)!.completedNet).toBe(t0.score.band.at(-1)!.p50);
    const effect = twinEffect(inp, full.representative);
    expect(t1.render).toEqual(bandOnly(1));
    expect(t1.score.planEffect).toEqual(effect);
    expect(t1.score.planEffectBand).toEqual([]);
    const last = tl.at(-1)!;
    expect(last.bandRuns).toBe(101);
    expect(last.score.band).toEqual(full.band);
    expect(last.score.planEffect).toEqual(effect);
    expect(last.score.planEffectBand).toEqual(full.planEffectBand);

    // after revision 0: the shown twin, then only the band twins (the FZP runs are reused)
    const after = hooks.calls.slice(hooks.calls.findIndex((c) => c.fn === 'detailed') + 1);
    expect(after.every((c) => c.fn === 'net' && c.twin)).toBe(true);
    expect(after.map((c) => c.seed)).toEqual([
      full.representative,
      ...Array.from({ length: 101 }, (_, i) => i + 1)
    ]);
  });
});

describe('scenario host: reroll', () => {
  it('after a complete band recomputes only the shown run and its twin, and reuses both bands', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    const inp = inputs();
    const before = timelines(h).at(-1)!;
    hooks.calls.length = 0;
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: 5 });
    await h.runAll();
    expect(hooks.calls.map((c) => `${c.fn}:${c.twin ? 'twin' : 'fzp'}:${c.seed}`)).toEqual([
      'detailed:fzp:5',
      'net:twin:5'
    ]);
    const tl = timelines(h, r);
    expect(tl).toHaveLength(2);
    expect(tl[0]).toEqual({
      type: 'timeline',
      rev: r,
      seed: 5,
      render: {
        revision: 0,
        cells: [],
        removedCells: [],
        demolish: demolishOf(shownRun(inp.fzp, 5).schedules, inp.fzp)
      },
      score: scoreOf(inp.fzp, 5, { band: before.score.band, planEffect: [], planEffectBand: [] }),
      bandRuns: N,
      bandRunsTotal: N,
      complete: true
    });
    expect(tl[1]).toEqual({
      ...tl[0],
      render: bandOnly(1),
      score: scoreOf(inp.fzp, 5, {
        band: before.score.band,
        planEffect: twinEffect(inp, 5),
        planEffectBand: before.score.planEffectBand
      })
    });
  });

  it('reroll(null) gives the representative seed without rerunning any band run', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    const { representative } = bandOf(inputs(), N);
    hooks.calls.length = 0;
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: null });
    await h.runAll();
    expect(hooks.calls.map((c) => `${c.fn}:${c.seed}`)).toEqual([
      `detailed:${representative}`,
      `net:${representative}`
    ]);
    expect(timelines(h, r).map((t) => [t.seed, t.render.revision])).toEqual([
      [representative, 0],
      [representative, 1]
    ]);
  });

  it('counts revisions per (rev, seed): the same seed again gives a fresh revision 0', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    const first = timelines(h)[0];
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: SEED });
    await h.runAll();
    const tl = timelines(h, r);
    expect(tl.map((t) => t.render.revision)).toEqual([0, 1]);
    expect(tl[0].render).toEqual(first.render);
    expect(tl[0].score.shown).toEqual(first.score.shown);
  });

  it('reroll(null) during a seeded band posts revision 0 only after every FZP band run, and keeps the band work', async () => {
    const h = harness();
    const rev = h.init({ seed: SEED });
    const bandFzp = () => netCalls((c) => !c.twin).length;
    await stepUntil(h, () => bandFzp() >= 5);
    expect(timelines(h, rev).map((t) => t.render.revision)).toEqual([0, 1]);
    const handledAt = h.posts.length;
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: null });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    // the old run is cancelled: nothing more under its rev
    expect(h.posts.slice(handledAt).some((m) => 'rev' in m && m.rev === rev)).toBe(false);

    const inp = inputs();
    const full = bandOf(inp, N);
    const tl = timelines(h, r);
    const at0 = h.posts.indexOf(tl[0]);
    // every FZP band run exists before revision 0, and each ran exactly once overall
    const fzpRuns = netCalls((c) => !c.twin);
    expect(fzpRuns.map((c) => c.seed)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(fzpRuns.every((c) => c.posts <= at0)).toBe(true);
    expect(tl[0]).toMatchObject({ seed: full.representative, render: { revision: 0 } });
    expect(tl[0].score.band).toEqual(full.band);
    expect(tl[0].score.planEffect).toEqual([]);
    expect(tl[0].score.planEffectBand).toEqual([]);
    // the band twins ran once each (none redone), after the old shown twin and the new one
    const twins = netCalls((c) => c.twin).map((c) => c.seed);
    expect(twins.filter((x) => x === SEED)).toHaveLength(1); // the old shown twin, before
    expect(twins).toHaveLength(N + 2);
    for (let i = 0; i < N; i++) {
      const s = bandSeed(i);
      const expected = (s === full.representative ? 1 : 0) + 1; // the band twin, plus the shown twin
      expect(twins.filter((x) => x === s)).toHaveLength(expected);
    }
    const last = tl.at(-1)!;
    expect(last.bandRuns).toBe(N);
    expect(last.score.planEffectBand).toEqual(full.planEffectBand);
    expect(tl.map((t) => t.render.revision)).toEqual(tl.map((_, k) => k));
  });

  it("cancels the old seed's twin: it never runs and nothing more is posted under the old rev", async () => {
    const h = harness();
    const rev = h.init({ seed: SEED });
    await stepUntil(h, () => timelines(h, rev).length === 1);
    expect(netCalls((c) => c.twin && c.seed === SEED)).toHaveLength(0);
    const handledAt = h.posts.length;
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: 7 });
    await h.runAll();
    expect(netCalls((c) => c.twin && c.seed === SEED)).toHaveLength(0);
    expect(h.posts.slice(handledAt).some((m) => 'rev' in m && m.rev === rev)).toBe(false);
    expect(timelines(h, r).map((t) => t.render.revision)).toEqual([0, 1, 2, 3]);
    expect(timelines(h, r).at(-1)!.bandRuns).toBe(N);
  });

  it('a reroll superseded before its first slice posts nothing', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    const r1 = h.next();
    h.host.handle({ type: 'reroll', rev: r1, seed: 4 });
    const r2 = h.next();
    h.host.handle({ type: 'reroll', rev: r2, seed: 6 });
    await h.runAll();
    expect(timelines(h, r1)).toEqual([]);
    expect(timelines(h, r2).map((t) => [t.seed, t.render.revision])).toEqual([
      [6, 0],
      [6, 1]
    ]);
  });
});

describe('scenario host: requests between slices and cancellation', () => {
  it('answers a parcelSummary sent between band slices before the band finishes', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await stepUntil(h, () => netCalls((c) => !c.twin).length >= 2);
    h.host.handle({ type: 'parcelSummary', reqId: 9, parcelId: '0026T001A', day: 20000 });
    expect(h.posts.at(-1)).toEqual({ type: 'parcelSummary', reqId: 9, summary: null });
    expect(Math.max(...timelines(h).map((t) => t.bandRuns))).toBeLessThan(N);
    expect(h.pendingTimers()).toBeGreaterThan(0);
    await h.runAll();
    expect(timelines(h).at(-1)!.bandRuns).toBe(N);
  });

  it('an initScenario sent mid-load cancels the first: no timeline under its rev, ever', async () => {
    const h = harness();
    h.holdDecodes();
    const a = h.init({ seed: SEED });
    await h.flush();
    const b = h.init({ seed: 2 });
    await h.flush();
    h.releaseDecodes();
    await h.runAll();
    expect(h.decodes()).toEqual({ started: 2, settled: 2 });
    expect(timelines(h, a)).toEqual([]);
    expect(timelines(h, b).at(-1)).toMatchObject({ seed: 2, bandRuns: N });
  });

  it('an initScenario mid-band cancels everything of the first', async () => {
    const h = harness();
    const a = h.init({ seed: SEED });
    await stepUntil(h, () => netCalls((c) => !c.twin).length >= 3);
    const handledAt = h.posts.length;
    const b = h.init({ seed: 2 });
    await h.runAll();
    expect(h.posts.slice(handledAt).some((m) => 'rev' in m && m.rev === a)).toBe(false);
    expect(timelines(h, b).map((t) => t.bandRuns)).toEqual([0, 0, 16, N]);
  });

  it('dispose mid-band leaves no timer and posts nothing more', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await stepUntil(h, () => netCalls().length >= 4);
    const n = h.posts.length;
    const calls = hooks.calls.length;
    h.host.dispose();
    expect(h.pendingTimers()).toBe(0);
    await h.runAll();
    expect(h.posts).toHaveLength(n);
    expect(hooks.calls).toHaveLength(calls);
  });
});

describe('scenario host: a throw inside a slice', () => {
  it('posts internal under the run rev, ends the session, and a fresh init recovers', async () => {
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    vi.mocked(simulateDetailed).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: 3 });
    await h.runAll();
    expect(h.errors()).toEqual([
      { type: 'error', rev: r, code: 'internal', message: 'Error: boom' }
    ]);
    expect(h.pendingTimers()).toBe(0);
    const r2 = h.next();
    h.host.handle({ type: 'reroll', rev: r2, seed: 3 });
    expect(h.errors().at(-1)).toMatchObject({
      rev: r2,
      code: 'bad-request',
      message: 'not initialised'
    });
    const b = h.init({ seed: 2 });
    await h.runAll();
    expect(timelines(h, b).at(-1)).toMatchObject({ seed: 2, bandRuns: N });
  });
});

describe('scenario host: slices', () => {
  it('every slice takes at most 50 ms of fake time, and slices follow each other with setTimeout 0', async () => {
    const h = harness();
    h.init({ seed: null });
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 9 });
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: null });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(h.slices.length).toBeGreaterThan(0);
    expect(Math.max(...h.slices)).toBeLessThanOrEqual(50);
    // band runs are packed: three 15 ms runs fit one slice
    expect(Math.max(...h.slices)).toBe(45);
    // the clock moved only by the charged compute: no slice waited on a delay
    const charged = hooks.calls.reduce(
      (t, c) => t + (c.fn === 'net' ? hooks.netMs : hooks.detailedMs),
      0
    );
    expect(h.now()).toBe(charged);
    expect(netCalls()).toHaveLength(2 * N + 3); // the band pairs, plus three shown twins
  });

  it('the shown run always has a slice to itself: no band, twin or packing job joins it', async () => {
    // cheap jobs everywhere, so the 45 ms plan would otherwise pack them around the shown run
    hooks.netMs = 1;
    hooks.detailedMs = 5;
    const h = harness();
    h.init({ seed: null }); // band FZP runs before the shown run
    prefetch(h, WORLD);
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 9 }); // ready cells to pack after it
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const shown = hooks.calls.filter((c) => c.fn === 'detailed');
    expect(shown).toHaveLength(2);
    expect(hooks.packs.length).toBeGreaterThan(0);
    for (const s of shown) {
      expect(hooks.calls.filter((c) => c.slice === s.slice)).toEqual([s]);
      expect(hooks.packs.filter((p) => p.slice === s.slice)).toEqual([]);
    }
    // the slices on either side still pack several cheap jobs
    expect(
      new Set(hooks.calls.filter((c) => c.fn === 'net').map((c) => c.slice)).size
    ).toBeLessThan(hooks.calls.filter((c) => c.fn === 'net').length);
  });

  it("the shown run's slice holds simulate and score only: its geometry opens the next slice", async () => {
    hooks.packMs = 100;
    const h = harness();
    const rev = h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const [shown] = hooks.calls.filter((c) => c.fn === 'detailed');
    expect(hooks.geometries).toHaveLength(1);
    const [geometry] = hooks.geometries;
    expect(geometry).toBeGreaterThan(shown.slice);
    expect(hooks.packs.filter((p) => p.slice === shown.slice)).toEqual([]);
    // revision 0 is still the complete snapshot: every ready cell (4 × 100 ms, inside the 2.5 s
    // cap) and the full demolish list
    const { fzp } = inputs();
    const { schedules } = shownRun(fzp, SEED);
    const [t0] = timelines(h, rev);
    expect(t0.render.revision).toBe(0);
    expect(t0.render.cells).toEqual(expectedCells(fzp, schedules, MINI_CELLS));
    expect(t0.render.demolish).toEqual(demolishOf(schedules, fzp));
    expect(t0.complete).toBe(true);
    expect(h.posts.slice(0, h.posts.indexOf(t0)).some((m) => m.type === 'timeline')).toBe(false);
  });

  it('a slow shown run gets a slice of its own', async () => {
    hooks.detailedMs = 120;
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    expect(h.slices.filter((s) => s > 50)).toEqual([120]);
    expect(h.slices.filter((s) => s !== 120).every((s) => s <= 50)).toBe(true);
  });
});

// --- geometry (§4.2 "Geometry", §4.7, §4.8; T6, T7; AC 9) ---

const P = MINI_PROJECTS;
const WORLD: [number, number, number, number] = [-180, -90, 180, 90];
type DetailedRun = ReturnType<typeof actual.simulateDetailed>;

function prefetch(h: ScenarioHarness, bbox: [number, number, number, number]): void {
  h.host.handle({ type: 'prefetch', bbox });
}

/** A tiny bbox at the centre of one cell that intersects no other cell. */
function bboxOf(cellId: string): [number, number, number, number] {
  const m = miniCity().manifest;
  const c = m.chunks.find((x) => x.cellId === cellId)!;
  const x = (c.bbox[0] + c.bbox[2]) / 2;
  const y = (c.bbox[1] + c.bbox[3]) / 2;
  const b: [number, number, number, number] = [x - 1e-6, y - 1e-6, x + 1e-6, y + 1e-6];
  expect(cellsIntersecting(m, b)).toEqual([cellId]);
  return b;
}

function cellOf(fzp: SimInput, id: ParcelId): string | undefined {
  const i = fzp.parcels.index.get(id);
  return i === undefined ? undefined : fzp.parcels.cells[fzp.parcels.cell[i]].cellId;
}

/** The T11 cell of a project's smallest T11 parcel, if it has one. */
function anchorCell(fzp: SimInput, s: Schedule): string | undefined {
  const present = s.parcelIds.filter((id) => fzp.parcels.index.has(id)).sort();
  return present.length === 0 ? undefined : cellOf(fzp, present[0]);
}

const scheduleOf = (schedules: Schedule[], id: string) =>
  schedules.find((s) => s.projectId === id)!;

/** A massing context over the mini city's records in `ready` cells, with a fresh memo. */
function massingCtx(fzp: SimInput, ready: Iterable<string>): MassingCtx {
  const cells = new Set(ready);
  const records = miniCity().records;
  return {
    input: fzp,
    records: (id) => (cells.has(cellOf(fzp, id) ?? '') ? records.get(id) : undefined),
    memo: createLru(1_000_000),
    gen: generate,
    genForUnits: generateForUnits,
    logOnce: () => {}
  };
}

/**
 * The packed cells, by cell id, once the `ready` cells are loaded, computed directly: per ready
 * anchor cell, every project anchored there whose T11 parcels' cells are all ready.
 */
function expectedCells(
  fzp: SimInput,
  schedules: Schedule[],
  ready: Iterable<string>
): TimedPackedCell[] {
  const cells = new Set(ready);
  const ctx = massingCtx(fzp, cells);
  const byCell = new Map<string, Schedule[]>();
  for (const s of schedules) {
    const home = anchorCell(fzp, s);
    const needs = s.parcelIds.flatMap((id) => cellOf(fzp, id) ?? []);
    if (home === undefined || !needs.every((c) => cells.has(c))) continue;
    byCell.set(home, [...(byCell.get(home) ?? []), s]);
  }
  return [...byCell.keys()].sort().map((cellId) =>
    actualPack.packTimedCell(
      cellId,
      byCell.get(cellId)!.map((s) => ({
        schedule: s,
        massings: massingsFor(s, ctx),
        pickParcelId: footprintParcel(
          [...new Set(s.parcelIds)].flatMap((id) => ctx.records(id) ?? [])
        ).id
      }))
    )
  );
}

const cellIds = (t: TimelineResponse) => t.render.cells.map((c) => c.cellId);
const chunkPosts = (h: ScenarioHarness) => h.posts.filter((m) => m.type === 'chunks');

/** The transfer list of `t` is exactly the cells' typed-array buffers, in order. */
function expectTransfers(h: ScenarioHarness, t: TimelineResponse): void {
  const sent = h.transfers[h.posts.indexOf(t)];
  const want = t.render.cells.flatMap((c) => actualPack.packTimedTransferables(c));
  expect(sent).toHaveLength(want.length);
  want.forEach((b, k) => expect(sent[k]).toBe(b));
}

describe('scenario host: geometry', () => {
  it('packs only the anchors in ready cells, posts chunks as the editor does, and transfers every typed array', async () => {
    const h = harness();
    const rev = h.init({ seed: SEED });
    prefetch(h, bboxOf('51_25'));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const { fzp } = inputs();
    const { schedules } = shownRun(fzp, SEED);
    // no project anchored in 51_25 needs another cell, so only the viewport's chunk is fetched
    expect(h.fetches.filter((f) => f.url.includes('/parcels/')).map((f) => f.url)).toEqual([
      MINI_CHUNK_URL('51_25')
    ]);
    expect(chunkPosts(h)).toEqual([
      { type: 'chunks', status: { '51_25': 'loading' }, pending: 1, failed: [] },
      { type: 'chunks', status: { '51_25': 'ready' }, pending: 0, failed: [] }
    ]);
    const [t0, ...rest] = timelines(h, rev);
    const expected = expectedCells(fzp, schedules, ['51_25']);
    expect(expected.map((c) => c.cellId)).toEqual(['51_25']);
    expect(t0.render).toEqual({
      revision: 0,
      cells: expected,
      removedCells: [],
      demolish: demolishOf(schedules, fzp)
    });
    expect(t0.complete).toBe(true);
    // the slots are exactly the shown run's projects anchored in the cell (no twin, no master)
    const anchoredThere = schedules.filter((s) => anchorCell(fzp, s) === '51_25');
    expect(anchoredThere.some((s) => s.origin === 'pipeline')).toBe(true);
    expect(anchoredThere.some((s) => s.origin === 'simulated')).toBe(true);
    expect(t0.render.cells[0].slotProjectIds).toEqual(anchoredThere.map((s) => s.projectId).sort());
    expectTransfers(h, t0);
    expect(rest.every((t) => t.render.cells.length === 0)).toBe(true);
  });

  it('a multi-parcel project waits for all its cells, which the host wants, and its anchor cell is repacked in full', async () => {
    const h = harness();
    const far = MINI_CHUNK_URL('51_26');
    h.hold(far);
    const rev = h.init({ seed: SEED });
    prefetch(h, bboxOf('50_26')); // before the run exists: its extra cells are wanted later
    await h.runAll();
    const { fzp } = inputs();
    const { schedules } = shownRun(fzp, SEED);
    const cross = scheduleOf(schedules, P.crossCell);
    expect(anchorCell(fzp, cross)).toBe('50_26');
    expect(cellOf(fzp, cross.parcelIds[1])).toBe('51_26');
    expect(h.fetchesOf(far)).toHaveLength(1); // wanted, though outside the viewport

    const before = timelines(h, rev);
    const t0 = before[0];
    expect(t0.render.cells).toEqual(expectedCells(fzp, schedules, ['50_26']));
    expect(cellIds(t0)).toEqual(['50_26']);
    expect(t0.render.cells[0].slotProjectIds).not.toContain(P.crossCell);
    expect(t0.complete).toBe(true); // waiting on a chunk is not waiting to be packed
    expect(before.slice(1).every((t) => t.render.cells.length === 0)).toBe(true);

    h.release(far);
    await h.runAll();
    const later = timelines(h, rev).slice(before.length);
    expect(later).toHaveLength(1);
    const both = expectedCells(fzp, schedules, ['50_26', '51_26']);
    expect(later[0].render).toEqual({
      revision: before.length,
      cells: both,
      removedCells: [],
      demolish: []
    });
    expect(later[0].render.cells[0].slotProjectIds).toEqual(
      [...t0.render.cells[0].slotProjectIds, P.crossCell].sort()
    );
    expect(later[0].complete).toBe(true);
    expectTransfers(h, later[0]);
  });

  it('a prefetch after the run exists also wants the extra cells of the projects anchored there', async () => {
    const h = harness();
    const rev = h.init({ seed: SEED });
    await h.runAll();
    const n0 = timelines(h, rev).length;
    prefetch(h, bboxOf('50_26'));
    await h.runAll();
    const parcelsFetched = h.fetches.filter((f) => f.url.includes('/parcels/')).map((f) => f.url);
    expect(parcelsFetched.sort()).toEqual([MINI_CHUNK_URL('50_26'), MINI_CHUNK_URL('51_26')]);
    const { fzp } = inputs();
    const later = timelines(h, rev).slice(n0);
    const cells = later.flatMap((t) => t.render.cells);
    const last = new Map(cells.map((c) => [c.cellId, c]));
    expect([...last.values()].sort((a, b) => (a.cellId < b.cellId ? -1 : 1))).toEqual(
      expectedCells(fzp, shownRun(fzp, SEED).schedules, ['50_26', '51_26'])
    );
    expect(later.every((t) => t.render.demolish.length === 0)).toBe(true);
    expect(later.at(-1)!.complete).toBe(true);
  });

  it('revision 0 packs ready cells for at most 2.5 s; the rest follow later, and complete tracks packing only', async () => {
    hooks.packMs = 1000; // one cell per slice
    const h = harness();
    const rev = h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const { fzp } = inputs();
    const all = expectedCells(fzp, shownRun(fzp, SEED).schedules, MINI_CELLS);
    expect(all.map((c) => c.cellId)).toEqual([...MINI_CELLS]);
    const tl = timelines(h, rev);
    // 40 ms of shown run, then cells at 1,040, 2,040 and 3,040 ms: the third starts inside the cap
    expect(tl[0].render.cells).toEqual(all.slice(0, 3));
    expect(tl[0].complete).toBe(false);
    expect(tl[0].render.demolish.length).toBeGreaterThan(0);
    const withCells = tl.slice(1).filter((t) => t.render.cells.length > 0);
    expect(withCells.map(cellIds)).toEqual([[all[3].cellId]]);
    expect(withCells[0].render).toEqual({
      revision: withCells[0].render.revision,
      cells: [all[3]],
      removedCells: [],
      demolish: []
    });
    const k = tl.indexOf(withCells[0]);
    expect(tl.slice(0, k).every((t) => !t.complete)).toBe(true);
    expect(tl.slice(k).every((t) => t.complete)).toBe(true);
    // the twin's band-only update went out between, with complete still false
    expect(tl[1].render).toEqual(bandOnly(1));
    expect(tl[1].complete).toBe(false);
    expect(Math.max(...h.slices)).toBe(1000);
  });

  it('a revision-0 pack slice that starts after the 2.5 s cap settles at once and packs nothing', async () => {
    hooks.packMs = 1000;
    const h = harness();
    const rev = h.init({ seed: SEED });
    prefetch(h, WORLD);
    await stepUntil(h, () => hooks.calls.some((c) => c.fn === 'detailed'));
    expect(timelines(h, rev)).toEqual([]);
    h.tick(3000); // the worker was busy elsewhere: the cap passes before the next slice
    await h.step();
    const [t0] = timelines(h, rev);
    expect(t0.render.cells).toEqual([]);
    expect(t0.complete).toBe(false);
    expect(hooks.packs).toEqual([]);
    await h.runAll();
    const later = timelines(h, rev).flatMap(cellIds);
    expect(later).toEqual([...MINI_CELLS]);
    expect(timelines(h, rev).at(-1)!.complete).toBe(true);
  });

  it('posts a newly ready set of chunks one revision per 50 ms packing slice', async () => {
    hooks.packMs = 20; // two cells fit a slice; a third would make 60 ms
    const h = harness();
    for (const c of MINI_CELLS) h.hold(MINI_CHUNK_URL(c));
    const rev = h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    const n0 = timelines(h, rev).length;
    expect(timelines(h, rev).every((t) => t.render.cells.length === 0 && t.complete)).toBe(true);
    const slices0 = h.slices.length;
    for (const c of MINI_CELLS) h.release(MINI_CHUNK_URL(c));
    await h.runAll();
    const later = timelines(h, rev).slice(n0);
    expect(later.map(cellIds)).toEqual([MINI_CELLS.slice(0, 2), MINI_CELLS.slice(2)]);
    expect(later.map((t) => t.render.revision)).toEqual([n0, n0 + 1]);
    expect(later.map((t) => t.complete)).toEqual([false, true]);
    const { fzp } = inputs();
    expect(later.flatMap((t) => t.render.cells)).toEqual(
      expectedCells(fzp, shownRun(fzp, SEED).schedules, MINI_CELLS)
    );
    expect(later.every((t) => t.render.demolish.length === 0)).toBe(true);
    expect(h.slices.slice(slices0)).toEqual([40, 40]);
    for (const t of later) expectTransfers(h, t);
  });

  it('never packs a score-only project or one with no T11 parcel, gives them no demolish entry, still scores them, and logs each absent parcel once', async () => {
    const h = harness();
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 5 });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const { fzp } = inputs();
    for (const seed of [SEED, 5]) {
      const { schedules } = shownRun(fzp, seed);
      // both are simulated, so the score counts them
      expect(scheduleOf(schedules, P.scoreOnly).parcelIds).toEqual([]);
      expect(scheduleOf(schedules, P.absentOnly).parcelIds).toEqual(['9900001']);
    }
    const tl = timelines(h);
    const slots = tl.flatMap((t) => t.render.cells.flatMap((c) => c.slotProjectIds));
    expect(slots).not.toContain(P.scoreOnly);
    expect(slots).not.toContain(P.absentOnly);
    expect(slots).toContain(P.absentMixed); // its T11 parcel still carries it
    const demolished = tl.flatMap((t) => t.render.demolish.map((d) => d.parcelId));
    expect(demolished.length).toBeGreaterThan(0);
    expect(demolished.filter((id) => !fzp.parcels.index.has(id))).toEqual([]);
    // once each, across both runs (and the score-only project logs nothing)
    expect(h.warnings.filter((w) => w.includes('9900001'))).toEqual([
      `parcel 9900001 of ${P.absentOnly} is not in parcels.bin: the project has no geometry`
    ]);
    expect(h.warnings.filter((w) => w.includes('9900002'))).toEqual([
      `parcel 9900002 of ${P.absentMixed} is not in parcels.bin: its geometry omits the parcel`
    ]);
  });

  it('leaves out one unpackable project, logged once, and packs the rest of its cell', async () => {
    hooks.throwFor = P.entitledStreamlined; // on 3512010, in 51_25
    const h = harness();
    const rev = h.init({ seed: SEED });
    prefetch(h, bboxOf('51_25'));
    await h.runAll();
    h.host.handle({ type: 'reroll', rev: h.next(), seed: SEED }); // a repack does not re-log
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const { fzp } = inputs();
    const { schedules } = shownRun(fzp, SEED);
    const rest = schedules.filter((s) => s.projectId !== P.entitledStreamlined);
    const [t0] = timelines(h, rev);
    expect(t0.render.cells).toEqual(expectedCells(fzp, rest, ['51_25']));
    expect(t0.render.cells[0].slotProjectIds).not.toContain(P.entitledStreamlined);
    expect(t0.render.cells[0].slotProjectIds.length).toBeGreaterThan(1);
    expect(t0.complete).toBe(true);
    expect(h.warnings.filter((w) => w.includes(P.entitledStreamlined))).toEqual([
      `packTimedCell 51_25: project ${P.entitledStreamlined} has a broken ring; not drawn`
    ]);
  });

  it('drops the chunks of a superseded init', async () => {
    const h = harness();
    const url = MINI_CHUNK_URL('51_25');
    h.hold(url);
    h.init({ seed: SEED });
    prefetch(h, bboxOf('51_25'));
    await h.runAll();
    const b = h.init({ seed: SEED });
    await h.runAll();
    const since = h.posts.length;
    h.release(url);
    await h.runAll();
    expect(h.posts.slice(since)).toEqual([]);
    expect(timelines(h, b).every((t) => t.render.cells.length === 0)).toBe(true);
  });

  it('retryChunks refetches a failed cell, which then packs', async () => {
    allowedWarnings.push(/^\[sim\] chunk 51_25 attempt 1 failed/);
    const h = harness(N, { retryDelaysMs: [] });
    const url = MINI_CHUNK_URL('51_25');
    h.fail(url, 1, { status: 503 });
    const rev = h.init({ seed: SEED });
    prefetch(h, bboxOf('51_25'));
    await h.runAll();
    expect(chunkPosts(h)).toEqual([
      { type: 'chunks', status: { '51_25': 'loading' }, pending: 1, failed: [] },
      { type: 'chunks', status: { '51_25': 'error' }, pending: 0, failed: ['51_25'] }
    ]);
    const n0 = timelines(h, rev).length;
    expect(timelines(h, rev).every((t) => t.render.cells.length === 0 && t.complete)).toBe(true);
    h.host.handle({ type: 'retryChunks' });
    await h.runAll();
    expect(chunkPosts(h).slice(2)).toEqual([
      { type: 'chunks', status: { '51_25': 'loading' }, pending: 1, failed: [] },
      { type: 'chunks', status: { '51_25': 'ready' }, pending: 0, failed: [] }
    ]);
    expect(timelines(h, rev).slice(n0).map(cellIds)).toEqual([['51_25']]);
    expect(h.fetchesOf(url)).toHaveLength(2);
  });
});

/** Generator spies that log each call's content key (§4.8) and pass through. */
function generatorSpies() {
  const keys: string[] = [];
  const deps: Partial<ScenarioHostDeps> = {
    generate: (rec, env, seed, mode) => {
      keys.push(simKey(rec.id, env.maxStories));
      return generate(rec, env, seed, mode);
    },
    generateForUnits: (recs, units, maxStories, seed, stories, opts = {}) => {
      const ids = [recs].flat().map((r: ParcelRecord) => r.id);
      keys.push(pipeKey(seed, units, stories ?? null, ids, opts));
      return generateForUnits(recs, units, maxStories, seed, stories, opts);
    }
  };
  return { keys, deps };
}

/** Serves every mini file again under dataset version `v`; returns its manifest. */
function relabel(h: ScenarioHarness, v: string): Manifest {
  const swap = <T>(x: T): T => JSON.parse(JSON.stringify(x).replaceAll(MINI_VERSION, v)) as T;
  for (const [url, body] of [...h.bodies]) {
    h.bodies.set(url.replaceAll(MINI_VERSION, v), url.includes('/parcels/') ? swap(body) : body);
  }
  return swap(h.manifest());
}

describe('scenario host: the content memo', () => {
  it('hits on reroll: no content key is generated twice, and a reroll back generates nothing', async () => {
    const { keys, deps } = generatorSpies();
    const h = harness(N, { deps });
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    const first = keys.length;
    expect(keys.some((k) => k.startsWith('p|'))).toBe(true);
    expect(keys.some((k) => k.startsWith('s|'))).toBe(true);
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 5 });
    await h.runAll();
    const second = keys.length;
    expect(second).toBeGreaterThan(first); // seed 5 has its own simulated sizes
    h.host.handle({ type: 'reroll', rev: h.next(), seed: SEED });
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(keys).toHaveLength(second);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is kept across inits of one datasetVersion and cleared by an init naming another', async () => {
    const { keys, deps } = generatorSpies();
    const h = harness(N, { deps });
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    const n1 = keys.length;
    expect(n1).toBeGreaterThan(0);
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    expect(keys).toHaveLength(n1); // the same version: every key hits
    const r = h.init({ seed: SEED, manifest: relabel(h, 'fixture-61') });
    prefetch(h, WORLD);
    await h.runAll();
    expect(h.errors()).toEqual([]);
    expect(timelines(h, r).flatMap(cellIds)).toEqual([...MINI_CELLS]);
    expect(keys).toHaveLength(2 * n1); // cleared: the same keys again
    expect(keys.slice(n1)).toEqual(keys.slice(0, n1));
  });
});

describe('scenario host: parcelSummary', () => {
  /** The §4.9 card context over the mini city, computed directly. */
  function cardCtx(fzp: SimInput, run: DetailedRun): CardCtx {
    const file = parseProjectsFile(miniProjectsJson(), { onInvalid: () => {} });
    const ctx = massingCtx(fzp, MINI_CELLS);
    return {
      asOf: fzp.asOf,
      input: fzp,
      rows: new Map(fzp.projects.map((p) => [p.id, p])),
      masters: new Map(run.masters.map((m) => [m.masterId, m])),
      qualityRules: new Map(file.qualityRules.map((q) => [q.id, q])),
      building: (s, k) => massingFor(s, k, ctx),
      logOnce: () => {}
    };
  }

  function summaryAt(h: ScenarioHarness, parcelId: ParcelId, day: Day, projectId?: string) {
    const reqId = h.posts.length + 100;
    h.host.handle({
      type: 'parcelSummary',
      reqId,
      parcelId,
      day,
      ...(projectId === undefined ? {} : { projectId })
    });
    const msg = h.posts.at(-1)!;
    expect(msg).toMatchObject({ type: 'parcelSummary', reqId });
    return (msg as Extract<typeof msg, { type: 'parcelSummary' }>).summary;
  }

  it('is null for a parcel whose record is not loaded', async () => {
    const h = harness();
    h.init({ seed: SEED });
    prefetch(h, bboxOf('50_25'));
    await h.runAll();
    expect(summaryAt(h, '3512012', MINI_AS_OF + 1)).toBeNull(); // 51_25 is not loaded
    expect(summaryAt(h, '0026T003', MINI_AS_OF + 1)).not.toBeNull();
  });

  it('gives the record, the T11 values and the chosen project, with and without projectId', async () => {
    const h = harness();
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    const { fzp } = inputs();
    const run = actual.simulateDetailed(fzp, SEED, H);
    const ctx = cardCtx(fzp, run);
    const id = '3512012';
    const day = MINI_AS_OF + 1;
    const rec = miniCity().records.get(id)!;
    const i = fzp.parcels.index.get(id)!;
    const onParcel = run.schedules.filter((s) => s.parcelIds.includes(id));
    expect(onParcel.map((s) => s.projectId).sort()).toEqual([P.sharedFirst, P.sharedExisting]);
    const auto = chooseProject(onParcel, day)!;
    const other = onParcel.find((s) => s !== auto)!;
    expect(chooseProject(onParcel, day, other.projectId)).toBe(other);

    const expected = (s: Schedule) => {
      const m = ctx.building(s, revisionAt(s, day));
      return {
        parcelId: id,
        neighborhood: rec.neighborhood,
        landUse: rec.landUse,
        eligible: rec.eligible,
        existingUnits: fzp.parcels.existingUnits[i],
        envelope: { maxStories: fzp.parcels.envelopeStories[i] },
        generated:
          'parts' in m ? { typology: m.typology, stories: m.stories, units: m.units } : null,
        project: projectCard(s, day, ctx)
      };
    };
    // T11 values, not the chunk's: the chunk says 1 existing unit, T11 says 2
    expect([rec.existingUnits, fzp.parcels.existingUnits[i]]).toEqual([1, 2]);
    expect(fzp.parcels.envelopeStories[i]).toBe(4);
    const a = summaryAt(h, id, day);
    expect(a).toEqual(expected(auto));
    expect(a!.generated).not.toBeNull();
    expect(summaryAt(h, id, day, other.projectId)).toEqual(expected(other));
  });

  it('has no project before any is visible, and a null envelope where T11 has none', async () => {
    const h = harness();
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.runAll();
    const { fzp } = inputs();
    const id = '0026T008'; // outside every height district
    const rec = miniCity().records.get(id)!;
    const i = fzp.parcels.index.get(id)!;
    expect(fzp.parcels.envelopeStories[i]).toBe(0);
    expect(summaryAt(h, id, MINI_AS_OF - 3650)).toEqual({
      parcelId: id,
      neighborhood: rec.neighborhood,
      landUse: rec.landUse,
      eligible: rec.eligible,
      existingUnits: fzp.parcels.existingUnits[i],
      envelope: null,
      generated: null
    });
    // a pipeline parcel ten years before asOf: nothing has started yet
    const s = summaryAt(h, '3512010', MINI_AS_OF - 3650)!;
    expect(s.project).toBeUndefined();
    expect(s.generated).toBeNull();
  });

  it('describes no building for a project whose cells are not all ready, and memoises no partial lot', async () => {
    const { keys, deps } = generatorSpies();
    const h = harness(N, { deps });
    const far = MINI_CHUNK_URL('51_26');
    h.hold(far);
    h.init({ seed: SEED });
    prefetch(h, bboxOf('50_26'));
    await h.runAll();
    const { fzp } = inputs();
    const run = actual.simulateDetailed(fzp, SEED, H);
    const cross = scheduleOf(run.schedules, P.crossCell);
    const [near] = cross.parcelIds; // 2999A019 in 50_26; 2999A020 waits in 51_26
    const day = MINI_AS_OF + 1;
    expect(
      chooseProject(
        run.schedules.filter((s) => s.parcelIds.includes(near)),
        day
      )
    ).toBe(cross);
    const ctx = cardCtx(fzp, run);
    const partial = summaryAt(h, near, day)!;
    expect(partial.generated).toBeNull();
    expect(partial.project).toEqual(
      projectCard(cross, day, { ...ctx, building: () => ({ footprint: [] }) })
    );
    expect(partial.project!.massing).toBe('none');
    // nothing was generated for the near lot alone
    expect(keys.filter((k) => k.split('|')[4] === near)).toEqual([]);

    h.release(far);
    await h.runAll();
    const full = summaryAt(h, near, day)!;
    const m = ctx.building(cross, revisionAt(cross, day));
    expect('parts' in m).toBe(true);
    expect(full.project).toEqual(projectCard(cross, day, ctx));
    expect(full.project!.massing).not.toBe('none');
    expect(full.generated).toEqual(
      'parts' in m ? { typology: m.typology, stories: m.stories, units: m.units } : null
    );
  });

  it('is null until the scenario files are loaded, even with the record loaded', async () => {
    const h = harness();
    h.holdDecodes();
    h.init({ seed: SEED });
    prefetch(h, WORLD);
    await h.flush();
    expect(chunkPosts(h).at(-1)).toMatchObject({ pending: 0, failed: [] }); // records are in
    expect(summaryAt(h, '3512012', MINI_AS_OF + 1)).toBeNull();
    h.releaseDecodes();
    await h.runAll();
    expect(summaryAt(h, '3512012', MINI_AS_OF + 1)).toMatchObject({ existingUnits: 2 });
  });

  it("uses the chunk record's units for a parcel absent from T11, with no envelope or building", async () => {
    const city = miniCity();
    const url = MINI_CHUNK_URL('51_25');
    const inCell = [...city.records.values()].filter((r) => r.id.startsWith('3512'));
    const absent: ParcelRecord = {
      ...city.records.get('3512005')!,
      id: '9900001',
      existingUnits: 3
    };
    const h = harness();
    h.bodies.set(url, JSON.parse(encodeParcelChunk(MINI_VERSION, '51_25', [...inCell, absent])));
    h.init({ seed: SEED });
    prefetch(h, bboxOf('51_25'));
    await h.runAll();
    expect(h.errors()).toEqual([]);
    const { fzp } = inputs();
    expect(fzp.parcels.index.has('9900001')).toBe(false);
    const run = actual.simulateDetailed(fzp, SEED, H);
    const day = MINI_AS_OF + 1;
    const only = scheduleOf(run.schedules, P.absentOnly);
    const s = summaryAt(h, '9900001', day)!;
    expect(s).toEqual({
      parcelId: '9900001',
      neighborhood: absent.neighborhood,
      landUse: absent.landUse,
      eligible: absent.eligible,
      existingUnits: 3,
      envelope: null,
      generated: null,
      project: projectCard(only, day, { ...cardCtx(fzp, run), building: () => ({ footprint: [] }) })
    });
    expect(s.project!.massing).toBe('none');
  });
});
