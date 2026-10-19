// The timelapse-sim performance budgets (spec §4.11, AC 13) on the bench city (synth-city.ts):
// the engine's per-run costs, and the scenario host end to end with real timers and clock
// (`setTimeout`, `performance.now`). Fails above budget. Timing-sensitive: run it alone
// (`vitest run --project server src/lib/sim/scenario/scenario.bench.spec.ts`) for the numbers.
//
// Macrotasks. Every host entry point (each `handle` call, each timer callback, and each fake
// fetch's delivery, which runs the chunk loader's decode in its microtasks) is wrapped as one
// task, and so is the bench's own polling (never counted). A task lasts from its callback's start
// to the end of the callback or of the last promise job after it (`promiseHooks`), whichever is
// later, up to the start of the next wrapped task or its own `setImmediate`: its callback and
// the microtasks it queued, but not the engine's own tasks (a garbage collector's finalisation)
// that the event loop runs in between. Each task also records `loose`, the end at that start or
// `setImmediate` (event-loop work included), which the logs show beside it. The 50 ms budget
// covers every task from the first band run on (band, twin and geometry work), the shown run's
// own task included: §4.11's 80 ms bounds the shown run's compute, not its macrotask.
import { runInNewContext } from 'node:vm';
import { promiseHooks, setFlagsFromString } from 'node:v8';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { FetchLike } from '../chunks';
import { BAND_RUNS } from './band';
import { dayOf } from './dates';
import {
  SYNTH_BBOX,
  SYNTH_MASTERS,
  SYNTH_PARCELS,
  SYNTH_PROJECTS,
  synthCity,
  type SynthCity
} from './fixtures/synth-city';
import { buildSimInput } from './input';
import type { FetchBytesLike } from './load';
import { createScenarioHost, type ScenarioHost } from './scenario-host';
import { monthsOf, shownSeries } from './score';
import type { ScenarioResponse, SimInput, TimelineResponse } from './types';

// Pass-through counters, so a macrotask can be told to hold the shown run.
const probe = vi.hoisted(() => ({ detailed: 0, net: 0 }));
vi.mock('./simulate', async (importOriginal) => {
  const m = await importOriginal<typeof import('./simulate')>();
  return {
    ...m,
    simulateNet: (...a: Parameters<typeof m.simulateNet>) => {
      probe.net++;
      return m.simulateNet(...a);
    },
    simulateDetailed: (...a: Parameters<typeof m.simulateDetailed>) => {
      probe.detailed++;
      return m.simulateDetailed(...a);
    }
  };
});
const { simulateDetailed, simulateNet } =
  await vi.importActual<typeof import('./simulate')>('./simulate');

const HORIZON: Day = dayOf(2050, 12, 31);
const TIMEOUT = 300_000;
const MB = 1024 * 1024;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (x: number) => `${x.toFixed(1)} ms`;

/** Median of `runs` timed calls after `warm` untimed ones. */
function timed(warm: number, runs: number, fn: (k: number) => void): number[] {
  for (let k = 0; k < warm; k++) fn(1000 + k);
  const out: number[] = [];
  for (let k = 0; k < runs; k++) {
    const t0 = performance.now();
    fn(k + 1);
    out.push(performance.now() - t0);
  }
  return out;
}

/** `global.gc`, or one exposed at runtime; null if neither is possible. */
function gcOf(): (() => void) | null {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) return g;
  try {
    setFlagsFromString('--expose-gc');
    return runInNewContext('gc') as () => void;
  } catch {
    return null;
  }
}

function inputOf(city: SynthCity): SimInput {
  return buildSimInput({
    parcels: city.parcels,
    projects: parseProjectsFile(structuredClone(city.projects)),
    calibration: parseCalibration(structuredClone(city.calibration))
  });
}

let city: SynthCity;
const realWarn = console.warn;

beforeAll(() => {
  console.warn = () => {}; // the engine's once-per-input skipped-rows note
  city = synthCity();
}, TIMEOUT);

afterAll(() => {
  console.warn = realWarn;
});

describe('scenario engine budgets (spec §4.11)', () => {
  let input: SimInput;
  let months: Day[];

  beforeAll(() => {
    input = inputOf(city);
    months = monthsOf(input.asOf, HORIZON);
  });

  it('is the bench city: 150,360 parcels in 16 × 16 cells, 2,000 projects, ≈ 8,000 starts', () => {
    expect(city.parcels.count).toBe(SYNTH_PARCELS);
    expect(city.parcels.cells).toHaveLength(256);
    expect(city.manifest.chunks).toHaveLength(256);
    const rows = city.projects.projects;
    expect(rows).toHaveLength(SYNTH_PROJECTS);
    expect(rows.filter((p) => p.multiPhase && p.phases !== null)).toHaveLength(SYNTH_MASTERS);
    expect(rows.filter((p) => !p.multiPhase && p.parcelIds.length > 1).length).toBeGreaterThan(100);
    expect(new Set(rows.map((p) => p.stage)).size).toBe(7);
    const run = simulateDetailed(input, 1, HORIZON);
    const starts = run.schedules.filter((s) => s.origin === 'simulated').length;
    console.log(`[perf] bench city: ${starts} simulated starts by 2050 at seed 1`);
    expect(starts).toBeGreaterThanOrEqual(6000);
    expect(starts).toBeLessThanOrEqual(10000);
  });

  it('simulateNet: median ≤ 15 ms per run', { timeout: TIMEOUT }, () => {
    const t = timed(3, 21, (seed) => simulateNet(input, seed, HORIZON, months));
    console.log(`[perf] simulateNet: median ${ms(median(t))} (${t.map((x) => x.toFixed(1))})`);
    expect(median(t)).toBeLessThanOrEqual(15);
  });

  it('simulateDetailed + shownSeries: median ≤ 80 ms', { timeout: TIMEOUT }, () => {
    const t = timed(3, 21, (seed) =>
      shownSeries(simulateDetailed(input, seed, HORIZON), input.asOf, HORIZON, months)
    );
    console.log(`[perf] simulate + score: median ${ms(median(t))} (${t.map((x) => x.toFixed(1))})`);
    expect(median(t)).toBeLessThanOrEqual(80);
  });
});

interface Posted {
  msg: ScenarioResponse;
  at: number;
}
interface Task {
  kind: 'handle' | 'timer' | 'fetch' | 'poll'; // poll: the bench's own waiting, never counted
  start: number;
  end: number;
  /** the end at the next wrapped task's start or its own setImmediate (the looser measure) */
  loose: number;
  detailed: boolean; // ran the shown run
  net: boolean; // ran a band or twin run
  cells: number; // cells posted in timelines
}

/** A scenario host over the bench city with real timers, its posts and its macrotasks. */
class Rig {
  readonly posted: Posted[] = [];
  readonly tasks: Task[] = [];
  readonly host: ScenarioHost;
  #open: { task: Task; detailed: number; net: number; posted: number; last: number } | null = null;
  /** Stops the promise hook that extends the open task over its microtasks. */
  readonly unhook: () => void;

  constructor(city: SynthCity) {
    const deliver = <T>(value: T): Promise<T> =>
      new Promise((resolve) =>
        globalThis.setTimeout(() => this.task('fetch', () => resolve(value)), 0)
      );
    const fetch: FetchLike = (url) => {
      const body = city.files.json.get(url);
      return deliver(
        body === undefined
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => body }
      );
    };
    const fetchBytes: FetchBytesLike = (url) =>
      deliver(
        url === city.files.bin
          ? { ok: true, status: 200, arrayBuffer: async () => city.bin.slice().buffer }
          : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
      );
    this.host = createScenarioHost({
      fetch,
      fetchBytes,
      post: (msg) => this.posted.push({ msg, at: performance.now() }),
      setTimeout: (fn, ms) => globalThis.setTimeout(() => this.task('timer', fn), ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => performance.now(),
      warn: () => {}
    });
    const stop = promiseHooks.onAfter(() => {
      if (this.#open) this.#open.last = performance.now();
    });
    this.unhook = () => stop();
  }

  #close(): void {
    const o = this.#open;
    if (!o) return;
    o.task.end = o.last;
    o.task.loose = performance.now();
    o.task.detailed = probe.detailed > o.detailed;
    o.task.net = probe.net > o.net;
    for (const { msg } of this.posted.slice(o.posted))
      if (msg.type === 'timeline') o.task.cells += msg.render.cells.length;
    this.#open = null;
  }

  /** Runs `fn` as one macrotask of the host. */
  task(kind: Task['kind'], fn: () => void): void {
    this.#close();
    const start = performance.now();
    const task: Task = {
      kind,
      start,
      end: NaN,
      loose: NaN,
      detailed: false,
      net: false,
      cells: 0
    };
    this.tasks.push(task);
    const open = {
      task,
      detailed: probe.detailed,
      net: probe.net,
      posted: this.posted.length,
      last: start
    };
    this.#open = open;
    try {
      fn();
    } finally {
      open.last = Math.max(open.last, performance.now());
      setImmediate(() => {
        if (this.#open === open) this.#close();
      });
    }
  }

  handle(req: Parameters<ScenarioHost['handle']>[0]): number {
    const t0 = performance.now();
    this.task('handle', () => this.host.handle(req));
    return t0;
  }

  timelines(rev: number): (Posted & { msg: TimelineResponse })[] {
    return this.posted.filter(
      (p): p is Posted & { msg: TimelineResponse } => p.msg.type === 'timeline' && p.msg.rev === rev
    );
  }

  errors(): ScenarioResponse[] {
    return this.posted.filter((p) => p.msg.type === 'error').map((p) => p.msg);
  }

  async until<T>(what: string, get: () => T | undefined | false, limitMs = 60_000): Promise<T> {
    const deadline = performance.now() + limitMs;
    for (;;) {
      const v = get();
      if (v !== undefined && v !== false) return v;
      if (this.errors().length > 0) throw new Error(`host error: ${JSON.stringify(this.errors())}`);
      if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      // a wrapped task too, so that it ends the host task before it rather than add to it
      await new Promise<void>((r) => globalThis.setTimeout(() => this.task('poll', r), 2));
    }
  }

  /** Resolves once the host has run no task for `quietMs`. */
  async idle(quietMs = 150): Promise<void> {
    await this.until(
      'idle',
      () => {
        const last = this.tasks.filter((t) => t.kind !== 'poll').at(-1);
        return !last || (Number.isFinite(last.end) && performance.now() - last.end > quietMs);
      },
      120_000
    );
  }

  /** The host tasks started at or after `from` (the bench's polling left out). */
  #since(from: number): Task[] {
    return this.tasks.filter((t) => t.start >= from && t.kind !== 'poll' && Number.isFinite(t.end));
  }

  /** The longest host task started at or after `from`, the shown run's included. */
  longest(from: number): Task | null {
    let best: Task | null = null;
    for (const t of this.#since(from)) if (!best || dur(t) > dur(best)) best = t;
    return best;
  }

  /** The longest host task started at or after `from` by the looser measure (logged only). */
  longestLoose(from: number): number {
    return Math.max(0, ...this.#since(from).map((t) => t.loose - t.start));
  }

  /** The last shown-run task started at or after `from`. */
  shownTask(from: number): Task | undefined {
    return this.tasks.filter((t) => t.start >= from && t.detailed).at(-1);
  }
}

const dur = (t: Task | null | undefined) => (t ? t.end - t.start : 0);
function taskLabel(t: Task | null): string {
  if (!t) return 'none';
  const notes: string[] = [t.kind];
  if (t.detailed) notes.push('shown run');
  if (t.net) notes.push('band/twin run');
  if (t.cells) notes.push(`${t.cells} cells posted`);
  return `${ms(dur(t))} (${notes.join(', ')}; loose ${ms(t.loose - t.start)})`;
}

describe('scenario host budgets (spec §4.11)', () => {
  let rig: Rig;
  let gc: (() => void) | null;
  let heap0 = 0;
  let initAt = 0;
  let firstBandTask = 0;
  let rev0At = 0;
  let representative = 0;

  beforeAll(() => {
    gc = gcOf();
    gc?.();
    heap0 = process.memoryUsage().heapUsed;
    rig = new Rig(city);
  });

  afterAll(() => {
    rig?.host.dispose();
    rig?.unhook();
  });

  it(
    'initScenario(null): fetched files to the first timeline ≤ 3 s (no chunks)',
    { timeout: TIMEOUT },
    async () => {
      initAt = rig.handle({
        type: 'initScenario',
        rev: 1,
        manifest: city.manifest,
        scenario: 'fzp',
        seed: null,
        horizon: HORIZON
      });
      const first = await rig.until('revision 0', () => rig.timelines(1)[0]);
      rev0At = first.at;
      representative = first.msg.seed;
      firstBandTask = rig.tasks.find((t) => t.net)?.start ?? Infinity;
      const t = first.at - initAt;
      console.log(
        `[perf] initScenario(null) → revision 0: ${ms(t)} (load ${ms(firstBandTask - initAt)}; ` +
          `shown-run task ${ms(dur(rig.shownTask(initAt)))})`
      );
      expect(first.msg.render.revision).toBe(0);
      expect(first.msg.score.band).toHaveLength(first.msg.score.months.length);
      expect(t).toBeLessThanOrEqual(3000);
    }
  );

  it('shown twin → planEffect ≤ 200 ms after revision 0', { timeout: TIMEOUT }, async () => {
    const twin = await rig.until('the twin update', () =>
      rig.timelines(1).find((p) => p.msg.score.planEffect.length > 0)
    );
    const t = twin.at - rev0At;
    console.log(`[perf] shown twin update: ${ms(t)} after revision 0`);
    expect(twin.msg.render.revision).toBe(1);
    expect(t).toBeLessThanOrEqual(200);
  });

  it('all 101 band pairs ≤ 4 s after revision 0', { timeout: TIMEOUT }, async () => {
    const done = await rig.until('every pair', () =>
      rig.timelines(1).find((p) => p.msg.bandRuns === BAND_RUNS)
    );
    const t = done.at - rev0At;
    console.log(`[perf] ${BAND_RUNS} band pairs: ${ms(t)} after revision 0`);
    expect(done.msg.bandRunsTotal).toBe(BAND_RUNS);
    expect(t).toBeLessThanOrEqual(4000);
  });

  it('longest macrotask ≤ 50 ms during band and twin work', { timeout: TIMEOUT }, async () => {
    await rig.idle();
    const worst = rig.longest(firstBandTask);
    const runs = rig.tasks.filter((t) => t.start >= firstBandTask && t.net).length;
    console.log(
      `[perf] longest band/twin macrotask: ${taskLabel(worst)}; ${runs} band/twin tasks; ` +
        `longest loose ${ms(rig.longestLoose(firstBandTask))}`
    );
    expect(runs).toBeGreaterThan(40); // 101 FZP runs, the shown twin and 101 twins, ≈ 3 a slice
    expect(dur(worst)).toBeLessThanOrEqual(50);
  });

  it(
    'longest macrotask ≤ 50 ms while all 256 cells load and pack',
    { timeout: TIMEOUT },
    async () => {
      const from = rig.handle({ type: 'prefetch', bbox: [...SYNTH_BBOX] });
      await rig.until('every chunk', () =>
        rig.posted.some(
          ({ msg, at }) =>
            at >= from && msg.type === 'chunks' && msg.pending === 0 && msg.failed.length === 0
        )
      );
      await rig.until('geometry complete', () => rig.timelines(1).at(-1)!.msg.complete, 120_000);
      await rig.idle();
      const worst = rig.longest(from);
      const revisions = rig.timelines(1).filter((p) => p.at >= from).length;
      console.log(
        `[perf] whole-city geometry: ${ms(performance.now() - from)}, ${revisions} revisions; ` +
          `longest macrotask ${taskLabel(worst)}; longest loose ${ms(rig.longestLoose(from))}`
      );
      expect(dur(worst)).toBeLessThanOrEqual(50);
    }
  );

  /**
   * A reroll with every cell ready: its revision 0 time, and its whole run to idle (its twin and
   * any later geometry). Every cell ends up packed, with a slot per project.
   */
  async function reroll(rev: number, seed: number): Promise<{ rev0: number; worst: Task | null }> {
    const t0 = rig.handle({ type: 'reroll', rev, seed });
    const first = await rig.until(`reroll ${rev} revision 0`, () => rig.timelines(rev)[0]);
    expect(first.msg.seed).toBe(seed);
    await rig.until(
      `reroll ${rev} complete`,
      () => rig.timelines(rev).at(-1)!.msg.complete,
      120_000
    );
    await rig.idle();
    const worst = rig.longest(t0);
    const cells = new Map(
      rig.timelines(rev).flatMap((p) => p.msg.render.cells.map((c) => [c.cellId, c] as const))
    );
    const slots = [...cells.values()].reduce((n, c) => n + c.slotProjectIds.length, 0);
    const twin = rig.timelines(rev).find((p) => p.msg.score.planEffect.length > 0)!;
    console.log(
      `[perf] reroll ${rev} (seed ${seed}) → revision 0: ${ms(first.at - t0)}, ` +
        `${first.msg.render.cells.length} cells (${cells.size} in all, ${slots} slots); ` +
        `twin ${ms(twin.at - first.at)} after it; shown-run task ${ms(dur(rig.shownTask(t0)))}; ` +
        `longest macrotask ${taskLabel(worst)}; longest loose ${ms(rig.longestLoose(t0))}`
    );
    expect(first.msg.render.cells.length).toBe(256); // every cell was ready: all in revision 0
    expect(cells.size).toBe(256);
    expect(slots).toBeGreaterThan(9000); // ≈ 2,000 pipeline and ≈ 8,000 simulated projects
    expect(twin.at - first.at).toBeLessThanOrEqual(200);
    return { rev0: first.at - t0, worst };
  }

  // Cold: a seed none of whose simulated buildings were generated yet (keys are content-based, so
  // a parcel and stories another run drew already hit). Warm: the representative seed, every one
  // of whose buildings the whole-city packing above put in the memo.
  it('reroll → revision 0 ≤ 3 s, cold, all 256 cells ready', { timeout: TIMEOUT }, async () => {
    const r = await reroll(2, 7);
    expect(dur(r.worst)).toBeLessThanOrEqual(50);
    expect(r.rev0).toBeLessThanOrEqual(3000);
  });

  it('reroll → revision 0 ≤ 3 s, warm, all 256 cells ready', { timeout: TIMEOUT }, async () => {
    const r = await reroll(3, representative);
    expect(dur(r.worst)).toBeLessThanOrEqual(50);
    expect(r.rev0).toBeLessThanOrEqual(3000);
  });

  it(
    'heap growth ≤ 300 MB with all 256 cells loaded, after 3 rerolls',
    { timeout: TIMEOUT },
    async () => {
      const r = await reroll(4, 8);
      expect(dur(r.worst)).toBeLessThanOrEqual(50);
      gc?.();
      const grown = (process.memoryUsage().heapUsed - heap0) / MB;
      console.log(`[perf] heap growth: ${grown.toFixed(0)} MB (gc ${gc ? 'on' : 'unavailable'})`);
      expect(grown).toBeLessThanOrEqual(300);
    }
  );
});
