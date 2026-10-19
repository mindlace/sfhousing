// Scenario host timeline delivery (spec §4.6, §4.7, §4.5 "Empty until computed", AC 7-8): the
// band runs, revision 0, the shown twin's plan-effect update, progressive band pairs, reroll,
// cancellation, and the ≤ 50 ms slices. Loading and its errors are in scenario-host.load.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { bandSeed, quantiles, representativeIndex } from './band';
import { MINI_HORIZON, miniProjectsJson } from './fixtures/mini-projects';
import { assembleScore, monthsOf, netOf, phasingOf, planEffectOf, shownSeries } from './score';
import { simulateDetailed } from './simulate';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';
import type { Schedule, SimInput, TimelineResponse, TimelineScore } from './types';

type Call = {
  fn: 'net' | 'detailed';
  twin: boolean; // the baseZoning input (it shares the base columns)
  seed: number;
  input: SimInput;
  posts: number; // posts made before the call
};

// Pass-through spies on the two engines: each call is logged with the post count at that moment
// and charged a fixed fake compute cost on the harness clock.
const hooks = vi.hoisted(() => ({
  netMs: 15,
  detailedMs: 40,
  tick: (ms: number): void => void ms,
  posts: (): number => 0,
  calls: [] as Call[]
}));

vi.mock('./simulate', async (importOriginal) => {
  const m = await importOriginal<typeof import('./simulate')>();
  const record = (fn: Call['fn'], input: SimInput, seed: number, ms: number) => {
    const twin = input.parcels.envelopeStories === input.parcels.baseStories;
    hooks.calls.push({ fn, twin, seed, input, posts: hooks.posts() });
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

const H = MINI_HORIZON;
const N = 17; // lowered band size (deps.bandRuns); one test runs the full 101
const SEED = 1000; // a shown seed that is no band seed, so its twin is told apart from theirs

function harness(bandRuns: number | null = N): ScenarioHarness {
  const h = makeScenarioHarness({ deps: bandRuns === null ? {} : { bandRuns } });
  hooks.tick = h.tick;
  hooks.posts = () => h.posts.length;
  hooks.calls.length = 0;
  return h;
}

beforeEach(() => {
  hooks.netMs = 15;
  hooks.detailedMs = 40;
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

/** Every parcel of every Schedule with a construction start, earliest day, by parcel id. */
function demolishOf(schedules: Schedule[]): { parcelId: ParcelId; day: Day }[] {
  const first = new Map<ParcelId, Day>();
  for (const s of schedules) {
    const c = s.entered.construction;
    if (c === undefined) continue;
    for (const id of s.parcelIds) {
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
    expect(h.posts[0]).toMatchObject({ type: 'ready', rev });
    const t0 = h.posts[1] as TimelineResponse;
    expect(t0.type).toBe('timeline');
    const { fzp } = inputs();
    const { schedules } = shownRun(fzp, SEED);
    const demolish = demolishOf(schedules);
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
      demolishOf(shownRun(inp.fzp, full.representative).schedules)
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
        demolish: demolishOf(shownRun(inp.fzp, 5).schedules)
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

  it('a slow shown run gets a slice of its own', async () => {
    hooks.detailedMs = 120;
    const h = harness();
    h.init({ seed: SEED });
    await h.runAll();
    expect(h.slices.filter((s) => s > 50)).toEqual([120]);
    expect(h.slices.filter((s) => s !== 120).every((s) => s <= 50)).toBe(true);
  });
});
