// map-stream's updates fed to the real `TimelineController` (spec test 3), and `rewind` (rule 9):
// after an edit world 1 is restored to an earlier month and refilled. Bench city, seed 1, unless
// a test says otherwise.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { FILL_LEVELS } from '$lib/data/scenario-codec';
import { makeFakeTimelineDeps, type FakeTimelineDeps } from '$lib/map/test/fake-timeline-deps';
import { validateTimedCell } from '$lib/map/timelapse/encode';
import { TimelineController } from '$lib/map/timeline-controller';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { precomputeOf } from '$lib/sim/scenario/input';
import { cellAnchorParcel } from '$lib/sim/scenario/massing';
import type { SimInput } from '$lib/sim/scenario/types';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { createMapStream, type MapStream } from './map-stream';
import {
  monthLastDay,
  monthOfDay,
  planDue,
  scheduleAt,
  staticsOf,
  step,
  type Statics,
  type World
} from '.';
import type { PolicyFrame, PolicyTimeline } from './policy/frame';
import { startRates } from './rates';
import { benchInput, fixtureInput } from './test/cities.node';
import { benchRecords, fixtureRecords } from './test/map-stream-cities.node';
import { sharedGenMemo, streamDeps as depsOf, warmGenMemo } from './test/map-stream-deps';
import { useFastTypedArrayEquality } from './test/map-stream-equal';
import {
  FakeController,
  fill,
  rewindTo,
  startStream,
  type StreamSink
} from './test/map-stream-run';
import { Recorder, runWorld, SEEDS } from './test/run';
import { changingAt, everyStage, frameOf, oneFrame } from './test/timeline';
import { ORIGIN_SIM, type Due } from './types';

const SEED = 1;
const WINDOW = 480;
const NS = STAGE_ORDER.length;
const CONSTRUCTION = STAGE_ORDER.indexOf('construction');

useFastTypedArrayEquality();

/** Every stream of this file shares one generator memo per city (a pure cache by content). */
const streamDeps: typeof depsOf = (i, r, o = {}) =>
  depsOf(i, r, { genMemo: sharedGenMemo(i), ...o });

interface City {
  input: SimInput;
  statics: Statics;
  base: PolicyFrame;
  records: ParcelRecord[];
}

function cityOf(input: SimInput, records: ParcelRecord[]): City {
  return { input, statics: staticsOf(input), base: frameOf(input), records };
}

let bench: City;
let fixture: City;

// The city a test runs on (bench unless it calls `use(fixture)`): every helper below reads these.
// Every cell of the bench city holds a project from the dataset date on, so the tests of a cell
// left with no project run on fixture-0, whose second cell starts empty.
let input: SimInput;
let statics: Statics;
let base: PolicyFrame;
let timeline: PolicyTimeline;
let records: ParcelRecord[];
/** The "removes a project" policy: the start rate is 0 (market -1000 replans every free lot). */
let NO_STARTS: PolicyFrame;

function use(c: City): void {
  ({ input, statics, base, records } = c);
  timeline = oneFrame(base);
  NO_STARTS = frameOf(input, { id: 1, market: -1000 });
}

beforeAll(async () => {
  bench = cityOf(benchInput(), benchRecords());
  fixture = cityOf(await fixtureInput(), fixtureRecords());
  warmGenMemo(bench.input, bench.records, bench.statics, oneFrame(bench.base), SEED, 120);
});

let deps: FakeTimelineDeps;
beforeEach(() => {
  use(bench);
  deps = makeFakeTimelineDeps();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs frames until the controller's slices and pump have converged. */
function converge(c: TimelineController): void {
  for (let i = 0; c.debugSnapshot().pending > 0; i++) {
    if (i > 10_000) throw new Error('controller did not converge');
    deps.flushFrame();
  }
}

/** Whether the controller hides the lot's existing building on `day`. */
function hiddenOn(c: TimelineController, lot: ParcelId, day: number): boolean {
  c.setTime(day);
  deps.flushFrame();
  converge(c);
  return c.demolished.has(lot);
}

/** A controller on fresh fake deps, fed `updates` in order. */
function controllerOf(updates: TimelineUpdate[]): TimelineController {
  deps = makeFakeTimelineDeps();
  const c = new TimelineController(deps, 'light');
  for (const u of updates) c.apply(u);
  expect(deps.resyncCount).toBe(0);
  return c;
}

const lastDayOf = (world: World) => monthLastDay(statics.asOf, world.month);

const cellOf = (id: ParcelId): string => {
  const P = input.parcels;
  return P.cells[P.cell[P.index.get(id)!]].cellId;
};

/** The anchor cell of `row` in `world` (null for a master or a row without a T11 parcel). */
function anchorOfRow(world: World, row: number): string | null {
  const s = scheduleAt(world, statics, row, lastDayOf(world));
  if (s === null) return null;
  const a = cellAnchorParcel(
    s.parcelIds.filter((id) => input.parcels.index.has(id)),
    input.parcels
  );
  return a === null ? null : cellOf(a);
}

/** The anchor cells of every row of `world`. */
function anchorsOf(world: World): Set<string> {
  const out = new Set<string>();
  for (let row = 0; row < world.projects.n; row++) {
    const a = anchorOfRow(world, row);
    if (a !== null) out.add(a);
  }
  return out;
}

const projectIdOf = (world: World, row: number) =>
  scheduleAt(world, statics, row, lastDayOf(world))!.projectId;

/** Every project id of `world`'s rows (masters apart). */
function idsOf(world: World): Set<string> {
  const out = new Set<string>();
  for (let row = 0; row < world.projects.n; row++) {
    const s = scheduleAt(world, statics, row, lastDayOf(world));
    if (s) out.add(s.projectId);
  }
  return out;
}

/** The model month of the row's first revision (its start). */
const startMonthOf = (world: World, row: number) =>
  monthOfDay(statics.asOf, scheduleAt(world, statics, row, lastDayOf(world))!.revisions[0].day);

/** Folds updates as the map does: the last version of every cell, less the removed ones. */
function foldCells(us: TimelineUpdate[]): Map<string, TimedPackedCell> {
  const out = new Map<string, TimedPackedCell>();
  for (const u of us) {
    if (u.revision === 0) out.clear();
    for (const c of u.cells) out.set(c.cellId, c);
    for (const id of u.removedCells) out.delete(id);
  }
  return out;
}

/** Folds demolitions as the pump does: restore removes every entry, the earliest day wins. */
function foldDemolitions(us: TimelineUpdate[]): Map<ParcelId, number> {
  const out = new Map<ParcelId, number>();
  for (const u of us) {
    if (u.revision === 0) out.clear();
    else for (const id of u.restore ?? []) out.delete(id);
    for (const d of u.demolish) out.set(d.parcelId, Math.min(d.day, out.get(d.parcelId) ?? d.day));
  }
  return out;
}

interface Run {
  world: World;
  statics: Statics;
  timeline: PolicyTimeline;
  seed: number;
  stream: MapStream;
  sink: StreamSink;
  due: Due;
}

/**
 * A stream fed by a world under `tl`, flushed every month (Infinity budget) through `through`,
 * with a full copy of the world at month `save`.
 */
function firstFill(
  o: { tl?: PolicyTimeline; seed?: number; save: number; through: number },
  streamOpts: Parameters<typeof streamDeps>[2] = {}
): { run: Run; saved: World; updates: TimelineUpdate[]; deps: ReturnType<typeof streamDeps> } {
  const tl = o.tl ?? timeline;
  const seed = o.seed ?? SEED;
  const sdeps = streamDeps(input, records, streamOpts);
  const stream = createMapStream(sdeps, WINDOW);
  const { world, sink } = startStream(statics, tl, seed, stream);
  const due = planDue(world, statics, tl, seed, WINDOW);
  const run: Run = { world, statics, timeline: tl, seed, stream, sink, due };
  const updates = [stream.flush(world, statics, Infinity)!, ...fill({ ...run, through: o.save })];
  const saved = structuredClone(world);
  updates.push(...fill({ ...run, through: o.through }));
  return { run, saved, updates, deps: sdeps };
}

/** Rewinds `stream` to `saved` under `tl` and returns the refill's run. */
function rewound(
  saved: World,
  stream: MapStream,
  tl: PolicyTimeline,
  through: number,
  seed = SEED
) {
  const r = rewindTo(saved, { statics, timeline: tl, seed, stream, through });
  const run: Run = {
    world: r.world,
    statics,
    timeline: tl,
    seed,
    stream,
    sink: r.sink,
    due: r.due
  };
  return run;
}

/** Every update until one with nothing left; Infinity budget (the draining rule). */
function drain(run: Run): TimelineUpdate[] {
  const out: TimelineUpdate[] = [];
  for (let u = run.stream.flush(run.world, statics, Infinity); u;) {
    out.push(u);
    u = run.stream.flush(run.world, statics, Infinity);
  }
  return out;
}

/**
 * A seed and a cell whose projects in a fill to 120 under `timeline` all began after month `at`,
 * and which no project of a run of `stop` through 120 holds.
 */
function emptiedCell(at: number, stop: PolicyTimeline): { seed: number; cell: string } {
  for (const seed of SEEDS) {
    const w1 = runWorld(statics, timeline, seed, 120);
    const n = runWorld(statics, timeline, seed, at).projects.n;
    const w2 = runWorld(statics, stop, seed, 120);
    const cells = new Set<string>();
    for (let row = n; row < w1.projects.n; row++) {
      const a = anchorOfRow(w1, row);
      if (a !== null) cells.add(a);
    }
    for (let row = 0; row < w2.projects.n; row++) cells.delete(anchorOfRow(w2, row) ?? '');
    if (cells.size > 0) return { seed, cell: [...cells][0] };
  }
  throw new Error('no emptied cell');
}

interface Construction {
  row: number;
  /** Start month and construction month and day. */
  s: number;
  c: number;
  day: number;
  lot: ParcelId;
}

/**
 * The sim rows that are the first to enter construction on their T11 lot, with their start
 * month, in a run of `tl` through `through`.
 */
function firstConstructions(tl: PolicyTimeline, through: number, seed = SEED): Construction[] {
  const rec = new Recorder();
  const w = runWorld(statics, tl, seed, through, rec);
  const startMonth = new Map<number, number>();
  const seen = new Set<ParcelId>();
  const out: Construction[] = [];
  for (const e of rec.events) {
    if (e.kind === 'start') startMonth.set(e.row, e.month);
    if (e.kind !== 'enter' || e.stage !== 'construction') continue;
    const ids = scheduleAt(w, statics, e.row, lastDayOf(w))?.parcelIds ?? [];
    const lot = statics.parcelId[w.projects.src[e.row]];
    const first = w.projects.origin[e.row] === ORIGIN_SIM && !seen.has(lot);
    for (const id of ids) seen.add(id);
    if (!first || !input.parcels.index.has(lot) || !startMonth.has(e.row)) continue;
    out.push({ row: e.row, s: startMonth.get(e.row)!, c: e.month, day: e.day, lot });
  }
  return out;
}

/** The month and day `row` enters construction in a run of `tl`, or null. */
function constructionOf(
  tl: PolicyTimeline,
  row: number,
  through: number
): { c: number; day: number } | null {
  const rec = new Recorder();
  runWorld(statics, tl, SEED, through, rec);
  const e = rec.events.find(
    (x) => x.row === row && x.kind === 'enter' && x.stage === 'construction'
  );
  return e ? { c: e.month, day: e.day } : null;
}

const named = (us: TimelineUpdate[], lot: ParcelId) => ({
  restore: us.filter((u) => (u.restore ?? []).includes(lot)),
  demolish: us.flatMap((u) => u.demolish.filter((d) => d.parcelId === lot))
});

describe('map-stream with the real controller', () => {
  it('with the real controller, the existing building is hidden from the construction day', () => {
    // a sim lot whose first construction starts after month 1 (bench city, seed 1)
    const hit = firstConstructions(timeline, 120).find((x) => x.c >= 2);
    expect(hit).toBeDefined();
    const { lot, c: month, day } = hit!;

    const stream = createMapStream(streamDeps(input, records), WINDOW);
    const { world, sink } = startStream(statics, timeline, SEED, stream);
    const due = planDue(world, statics, timeline, SEED, WINDOW);
    const updates = [stream.flush(world, statics, Infinity)!];
    updates.push(
      ...fill({ world, statics, timeline, seed: SEED, stream, sink, due, through: month + 1 })
    );

    const c = controllerOf(updates);
    expect(hiddenOn(c, lot, day - 1)).toBe(false);
    expect(deps.replaced.has(lot)).toBe(false);
    expect(hiddenOn(c, lot, day)).toBe(true);
    expect(deps.replaced.has(lot)).toBe(true);
  });
});

describe('map-stream: rewind (rule 9)', () => {
  it('rewind to month 60 and a refill without new starts removes the projects started after it', () => {
    const { run, saved, updates } = firstFill({ save: 60, through: 120 });
    const re = rewound(saved, run.stream, changingAt(61, base, NO_STARTS, null), 120);
    const refill = [...drain(re), ...fill({ ...re, through: 120 })];
    // the sim projects started after month 60 that have a cell and are absent from the refill (a
    // lot-month begun in month 60 keeps its frame, rule 6, so a start in month 61 may come again)
    const kept = idsOf(re.world);
    const later: string[] = [];
    for (let row = saved.projects.n; row < run.world.projects.n; row++) {
      if (run.world.projects.origin[row] !== ORIGIN_SIM) continue;
      if (anchorOfRow(run.world, row) === null) continue;
      const id = projectIdOf(run.world, row);
      if (startMonthOf(run.world, row) >= 62) expect(kept.has(id)).toBe(false);
      if (!kept.has(id)) later.push(id);
    }
    expect(later.length).toBeGreaterThan(0);
    const gone = new Set(later);
    const held = new Set<string>(); // cells that held one of them
    for (const [id, c] of foldCells(updates))
      if (c.slotProjectIds.some((p) => gone.has(p))) held.add(id);
    expect(held.size).toBeGreaterThan(0);

    // no cell of the map after the refill holds one of them (one expect over every cell and
    // project, not one per pair: 256 cells x ~1,600 projects was ~2.3 s on the bench city of `expect` alone)
    const stale: string[] = [];
    for (const [id, c] of foldCells([...updates, ...refill]))
      for (const p of c.slotProjectIds) if (gone.has(p)) stale.push(`${id}:${p}`);
    expect(stale).toEqual([]);
    const touched = new Set(
      refill.flatMap((u) => [...u.cells.map((c) => c.cellId), ...u.removedCells])
    );
    for (const id of held) expect(touched.has(id)).toBe(true);
  });

  it('a sent cell left with no project is removed (fixture-0)', () => {
    use(fixture);
    // a cell whose projects in the first fill all began after month 60 and which no project of
    // the refill without starts holds
    const AT = 60;
    const stop = changingAt(AT + 1, base, NO_STARTS, null);
    const { seed, cell } = emptiedCell(AT, stop);
    const { run, saved, updates } = firstFill({ seed, save: AT, through: 120 });
    expect(foldCells(updates).has(cell)).toBe(true);
    const re = rewound(saved, run.stream, stop, 120, seed);
    const now = drain(re);
    expect(now.length).toBeGreaterThan(0);
    expect(now[0].removedCells).toContain(cell);
    expect(now[0].cells.map((c) => c.cellId)).not.toContain(cell);
    const refill = [...now, ...fill({ ...re, through: 120 })];
    expect(refill.flatMap((u) => u.removedCells).filter((c) => c === cell)).toHaveLength(1);
    expect(foldCells([...updates, ...refill]).has(cell)).toBe(false);
  });

  it('a refill under the same policy sends only cells dirtied after the restore point', () => {
    const { run, saved, updates } = firstFill({ save: 60, through: 120 });
    const rec = new Recorder();
    const w = runWorld(statics, timeline, SEED, 120, rec);
    const want = new Set<string>();
    const rows = new Set<number>(); // a row's anchor once, however many events it has
    for (const e of rec.events) if (e.month > 60) rows.add(e.row);
    for (const row of rows) {
      const a = anchorOfRow(w, row);
      if (a !== null) want.add(a);
    }
    expect(want.size).toBeGreaterThan(0);

    const re = rewound(saved, run.stream, timeline, 120);
    // Rule 9: the rows stage days or ends of which are unknown again at month 60, and the
    // projects begun after it, are sent at once; every one of them had an event after month 60.
    const now = drain(re);
    for (const u of now)
      for (const id of [...u.cells.map((c) => c.cellId), ...u.removedCells])
        expect(want.has(id)).toBe(true);
    // flushed yearly: which cells go out is the rule here, and a cell dirtied in any month of the
    // year goes out in that year's flush (monthly, the 60 months of whole-cell packs were ~400 ms)
    const refill = [...now, ...fill({ ...re, through: 120, flushEvery: 12 })];
    const sent = new Set(refill.flatMap((u) => u.cells.map((c) => c.cellId)));
    expect([...sent].sort()).toEqual([...want].sort());
    // the map ends where the first fill left it
    expect(foldCells([...updates, ...refill])).toEqual(foldCells(updates));
    expect(foldDemolitions([...updates, ...refill])).toEqual(foldDemolitions(updates));
  });

  it('rewind to month 40 restores the lot of a project entering construction at 50; the real controller shows the building again', () => {
    const hit = firstConstructions(timeline, 120).find((x) => x.s <= 40 && x.c > 40);
    expect(hit).toBeDefined();
    const { row, c, day, lot } = hit!;
    const slow = changingAt(
      41,
      base,
      frameOf(input, { id: 1, speed: everyStage(2) }),
      new Int32Array(0)
    );
    const next = constructionOf(slow, row, WINDOW);
    expect(next).not.toBeNull();
    expect(next!.day).toBeGreaterThan(day);

    const { run, saved, updates } = firstFill({ save: 40, through: c + 1 });
    expect(foldDemolitions(updates).get(lot)).toBe(day);
    const re = rewound(saved, run.stream, slow, next!.c + 1);
    const u = re.stream.flush(re.world, statics, Infinity)!;
    expect(u.restore).toContain(lot);
    expect(u.demolish.map((d) => d.parcelId)).not.toContain(lot);
    // the row differs (its construction day is unknown again): its cell is sent again at once
    const packed = u.cells.find((x) => x.cellId === anchorOfRow(run.world, row));
    expect(packed).toBeDefined();
    const slot = packed!.slotProjectIds.indexOf(projectIdOf(run.world, row));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(packed!.slotStages[NS * slot + CONSTRUCTION]).toBeNaN();
    const all = [...updates, u];
    let ctl = controllerOf(all);
    expect(hiddenOn(ctl, lot, day)).toBe(false);
    expect(hiddenOn(ctl, lot, next!.day)).toBe(false);

    const refill = fill({ ...re, through: next!.c + 1 });
    expect(named(refill, lot).demolish).toEqual([{ parcelId: lot, day: next!.day }]);
    expect(named(refill, lot).restore).toEqual([]);
    ctl = controllerOf([...all, ...refill]);
    expect(hiddenOn(ctl, lot, day)).toBe(false);
    expect(hiddenOn(ctl, lot, next!.day - 1)).toBe(false);
    expect(hiddenOn(ctl, lot, next!.day)).toBe(true);
  });

  it('a project of the withdrawn future whose lot is protected in the refill is removed and its lot restored', () => {
    const hit = firstConstructions(timeline, 118).find((x) => x.s >= 43);
    expect(hit).toBeDefined();
    const { row, c, day, lot } = hit!;
    const { run, saved, updates } = firstFill({ save: 40, through: c + 1 });
    const projectId = projectIdOf(run.world, row);
    const cell = anchorOfRow(run.world, row)!;
    expect(foldCells(updates).get(cell)!.slotProjectIds).toContain(projectId);

    // zoning from month 41: the lot gains no home at any size, so it never starts again
    const lotRow = run.world.projects.src[row];
    const p = input.parcels;
    const F = FILL_LEVELS.length;
    const yieldCol = p.yield.slice();
    for (let k = 0; k < F; k++) yieldCol[lotRow * F + k] = 0;
    const parcels = { ...p, yield: yieldCol };
    const view = { parcels, pre: precomputeOf({ ...input, parcels }) };
    const guarded = frameOf(input, { id: 1, view });
    expect(startRates(base.view, base.market)[lotRow]).toBeLessThan(0);
    expect(startRates(view, guarded.market)[lotRow]).toBe(0);

    const re = rewound(
      saved,
      run.stream,
      changingAt(41, base, guarded, Int32Array.of(lotRow)),
      c + 1
    );
    const refill = [...drain(re), ...fill({ ...re, through: c + 1 })];
    // no project starts on the lot after month 40
    for (let r = saved.projects.n; r < re.world.projects.n; r++)
      expect(
        re.world.projects.origin[r] === ORIGIN_SIM && re.world.projects.src[r] === lotRow
      ).toBe(false);
    expect(idsOf(re.world).has(projectId)).toBe(false);
    const touched = refill.flatMap((u) => [...u.cells.map((x) => x.cellId), ...u.removedCells]);
    expect(touched).toContain(cell);
    for (const x of foldCells([...updates, ...refill]).values())
      expect(x.slotProjectIds).not.toContain(projectId);
    expect(named(refill, lot).restore.length).toBe(1);
    expect(named(refill, lot).demolish).toEqual([]);
    expect(foldDemolitions([...updates, ...refill]).has(lot)).toBe(false);
    const ctl = controllerOf([...updates, ...refill]);
    const last = lastDayOf(re.world);
    for (let d = day - 1; d <= last; d += 97) expect(hiddenOn(ctl, lot, d)).toBe(false);
    expect(hiddenOn(ctl, lot, day)).toBe(false);
    expect(hiddenOn(ctl, lot, last)).toBe(false);
  });

  it('a project started after the rewind point and absent from the refill never demolishes', () => {
    // started from month 43: a lot-month begun before month 41 keeps its frame (rule 6)
    const hit = firstConstructions(timeline, 118).find((x) => x.s >= 43);
    expect(hit).toBeDefined();
    const { c, day, lot } = hit!;
    const { run, saved, updates } = firstFill({ save: 40, through: c + 1 });
    expect(foldDemolitions(updates).get(lot)).toBe(day);
    const re = rewound(saved, run.stream, changingAt(41, base, NO_STARTS, null), c + 1);
    const refill = [...drain(re), ...fill({ ...re, through: c + 1 })];
    expect(named(refill, lot).restore.length).toBe(1);
    expect(named(refill, lot).demolish).toEqual([]);
    expect(foldDemolitions([...updates, ...refill]).has(lot)).toBe(false);
    const ctl = controllerOf([...updates, ...refill]);
    const last = lastDayOf(re.world);
    for (let d = day - 1; d <= last; d += 97) expect(hiddenOn(ctl, lot, d)).toBe(false);
    expect(hiddenOn(ctl, lot, day)).toBe(false);
    expect(hiddenOn(ctl, lot, last)).toBe(false);
  });

  it('a rewind drops a never-sent cell silently (fixture-0)', () => {
    use(fixture);
    // a cell empty at month 60 whose first project begins in month M >= 63 (a lot-month begun
    // before the edit keeps its frame, rule 6) and which the refill without starts leaves empty
    const AT = 60;
    const stop = changingAt(AT + 1, base, NO_STARTS, null);
    let found: { seed: number; cell: string; M: number } | null = null;
    for (const seed of SEEDS) {
      const w1 = runWorld(statics, timeline, seed, 120);
      const n = runWorld(statics, timeline, seed, AT).projects.n;
      const w2 = runWorld(statics, stop, seed, 120);
      const first = new Map<string, number>(); // cell → its first start month, null if old
      const old = new Set<string>();
      for (let row = 0; row < w1.projects.n; row++) {
        const a = anchorOfRow(w1, row);
        if (a === null) continue;
        if (row < n) old.add(a);
        else first.set(a, Math.min(first.get(a) ?? Infinity, startMonthOf(w1, row)));
      }
      for (let row = 0; row < w2.projects.n; row++) old.add(anchorOfRow(w2, row) ?? '');
      const hit = [...first].find(([c, M]) => !old.has(c) && M >= AT + 3 && M < 118);
      if (hit) {
        found = { seed, cell: hit[0], M: hit[1] };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { seed, cell, M } = found!;
    // a clock 10 ms per reading: a flush with no budget does one piece of work, and a cell warmed
    // in a call is not packed in it, so the cell dirtied in month M stays queued
    let t = 0;
    const { run, saved, updates } = firstFill(
      { seed, save: AT, through: M - 1 },
      { now: () => (t += 10) }
    );
    step(run.world, run.due, statics, timeline, seed, run.sink);
    const u = run.stream.flush(run.world, statics, 0);
    if (u) updates.push(u);
    expect(run.world.month).toBe(M);
    expect(anchorOfRow(run.world, run.world.projects.n - 1)).not.toBeNull();
    expect(updates.flatMap((x) => x.cells.map((c) => c.cellId))).not.toContain(cell);

    const re = rewound(saved, run.stream, stop, M + 2, seed);
    const refill = [...drain(re), ...fill({ ...re, through: M + 2 })];
    expect(refill.length).toBeGreaterThan(0);
    for (const x of refill) {
      expect(x.cells.map((c) => c.cellId)).not.toContain(cell);
      expect(x.removedCells).not.toContain(cell);
    }
  });

  it('removing the later project keeps the lot demolished', () => {
    const MONTHS = 240;
    // a lot whose second construction is a sim start begun 3+ months after the first construction
    let found: {
      seed: number;
      lot: ParcelId;
      day: number;
      row2: number;
      at: number; // the rewind month: on or after the first construction, 2 before the second start
      m2: number;
    } | null = null;
    for (const seed of SEEDS) {
      const rec = new Recorder();
      const w = runWorld(statics, timeline, seed, MONTHS, rec);
      const startMonth = new Map<number, number>();
      const on = new Map<ParcelId, { row: number; day: number; month: number }>();
      for (const e of rec.events) {
        if (e.kind === 'start') startMonth.set(e.row, e.month);
        if (e.kind !== 'enter' || e.stage !== 'construction') continue;
        for (const id of scheduleAt(w, statics, e.row, lastDayOf(w))?.parcelIds ?? []) {
          if (!input.parcels.index.has(id)) continue;
          const x = on.get(id);
          if (x === undefined) {
            on.set(id, { row: e.row, day: e.day, month: e.month });
            continue;
          }
          const s2 = startMonth.get(e.row);
          if (x.row !== e.row && s2 !== undefined && x.month <= s2 - 3) {
            found = { seed, lot: id, day: x.day, row2: e.row, at: s2 - 2, m2: e.month };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { seed, lot, day, row2, at, m2 } = found!;
    const { run, saved, updates } = firstFill({ seed, save: at, through: m2 + 1 });
    expect(saved.projects.n).toBeLessThanOrEqual(row2);
    expect(foldDemolitions(updates).get(lot)).toBe(day);
    const re = rewound(saved, run.stream, changingAt(at + 1, base, NO_STARTS, null), m2 + 1, seed);
    const refill = [...drain(re), ...fill({ ...re, through: m2 + 1 })];
    expect(idsOf(re.world).has(projectIdOf(run.world, row2))).toBe(false);
    expect(named(refill, lot).restore).toEqual([]);
    expect(foldDemolitions([...updates, ...refill]).get(lot)).toBe(day);
  });

  it('an emptied cell refilled before the flush is replaced, not removed (fixture-0)', () => {
    use(fixture);
    const busy = changingAt(61, base, frameOf(input, { id: 1, market: 2 }), null);
    // a cell whose projects in the first fill all began after month 60 and which holds a
    // different project 12 months into the refill
    let found: { seed: number; cell: string; added: string } | null = null;
    let want: string[] = [];
    for (const seed of SEEDS) {
      const w1 = runWorld(statics, timeline, seed, 120);
      const n60 = runWorld(statics, timeline, seed, 60).projects.n;
      const w2 = runWorld(statics, busy, seed, 72);
      const firstRows = new Map<string, number[]>();
      for (let row = 0; row < w1.projects.n; row++) {
        const a = anchorOfRow(w1, row);
        if (a !== null) (firstRows.get(a) ?? firstRows.set(a, []).get(a)!).push(row);
      }
      for (let row = n60; row < w2.projects.n && !found; row++) {
        const a = anchorOfRow(w2, row);
        if (a === null) continue;
        const rows = firstRows.get(a);
        if (!rows || rows.some((r) => r < n60)) continue;
        const first = new Set(rows.map((r) => projectIdOf(w1, r)));
        const added = projectIdOf(w2, row);
        if (first.has(added)) continue;
        found = { seed, cell: a, added };
        want = [];
        for (let r = 0; r < w2.projects.n; r++)
          if (anchorOfRow(w2, r) === a) want.push(projectIdOf(w2, r));
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { seed, cell, added } = found!;
    const { run, saved, updates } = firstFill({ seed, save: 60, through: 120 });
    expect(foldCells(updates).has(cell)).toBe(true);
    const re = rewound(saved, run.stream, busy, 72, seed);
    const refill = fill({ ...re, through: 72, flushEvery: 12 });
    expect(refill).toHaveLength(1);
    expect(refill[0].removedCells).not.toContain(cell);
    const packed = refill[0].cells.find((c) => c.cellId === cell);
    expect(packed).toBeDefined();
    // the cell holds the refill's projects only: the new one in, every first-fill project the
    // refill did not bring back out (a sim id names its lot and start count, so a first-fill
    // project restarted on its lot comes back under its id)
    expect(packed!.slotProjectIds).toContain(added);
    expect([...packed!.slotProjectIds].sort()).toEqual(want.sort());
    // and each slot's schedule is the refill's (a reused id carries no stale schedule)
    expect(packed).toEqual(freshSnapshot(re.world).cells.find((c) => c.cellId === cell));
  });

  it('the restore and the new day of one lot travel in one update', () => {
    const hit = firstConstructions(timeline, 120).find((x) => x.s <= 40 && x.c > 40);
    expect(hit).toBeDefined();
    const { row, c, day, lot } = hit!;
    const slow = changingAt(
      41,
      base,
      frameOf(input, { id: 1, speed: everyStage(2) }),
      new Int32Array(0)
    );
    const next = constructionOf(slow, row, WINDOW)!;
    expect(next).not.toBeNull();
    expect(next.day).toBeGreaterThan(day);

    // the new day known by the first flush after the rewind: one update holds both
    const a = firstFill({ save: 40, through: c + 1 });
    const ra = rewound(a.saved, a.run.stream, slow, next.c + 1);
    const together = fill({ ...ra, through: next.c, flushEvery: next.c - 40 });
    expect(together).toHaveLength(1);
    expect(together[0].restore).toContain(lot);
    expect(together[0].demolish).toContainEqual({ parcelId: lot, day: next.day });

    // flushed at once: the restore goes first, the new day in a later update
    const b = firstFill({ save: 40, through: c + 1 });
    const rb = rewound(b.saved, b.run.stream, slow, next.c + 1);
    const apart = [...drain(rb), ...fill({ ...rb, through: next.c })];
    const r = apart.findIndex((u) => (u.restore ?? []).includes(lot));
    const d = apart.findIndex((u) => u.demolish.some((x) => x.parcelId === lot));
    expect(r).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThan(r);

    for (const us of [
      [...a.updates, ...together],
      [...b.updates, ...apart]
    ]) {
      expect(foldDemolitions(us).get(lot)).toBe(next.day);
      const ctl = controllerOf(us);
      expect(hiddenOn(ctl, lot, next.day - 1)).toBe(false);
      expect(hiddenOn(ctl, lot, next.day)).toBe(true);
    }
  });
});

/** A new stream's `snapshot` of a copy of `world`. */
function freshSnapshot(world: World): TimelineUpdate {
  const fresh = createMapStream(streamDeps(input, records), WINDOW);
  return fresh.snapshot(structuredClone(world), statics);
}

/**
 * Feeds `fake` and checks each update against it first: every cell valid, and every removed cell
 * and restored lot one the map holds (a stale "sent" record would name one it does not).
 */
function strictFeeder(fake: FakeController): (us: TimelineUpdate[]) => void {
  return (us) => {
    for (const u of us) {
      for (const c of u.cells) validateTimedCell(c);
      if (u.revision !== 0) {
        for (const id of u.removedCells) expect(fake.cells.has(id)).toBe(true);
        for (const id of u.restore ?? []) expect(fake.demolished.has(id)).toBe(true);
      }
      fake.apply(u);
    }
  };
}

/** `fake` holds what a fresh stream's snapshot of `world` holds. */
function expectFreshState(fake: FakeController, world: World): void {
  const want = new FakeController();
  want.apply(freshSnapshot(world));
  expect(fake.cells).toEqual(want.cells);
  expect(fake.demolished).toEqual(want.demolished);
}

/** Same cell ids, each cell equal, same demolish list. */
function expectSameSnapshot(a: TimelineUpdate, b: TimelineUpdate): void {
  const ids = (u: TimelineUpdate) => u.cells.map((c) => c.cellId).sort();
  expect(ids(a)).toEqual(ids(b));
  const byId = new Map(b.cells.map((c) => [c.cellId, c]));
  for (const c of a.cells) expect(c).toEqual(byId.get(c.cellId));
  expect(a.demolish).toEqual(b.demolish);
}

describe('map-stream: snapshot and revisions (rules 7, 10)', () => {
  it("snapshot after a plain fill equals a fresh stream's cells", () => {
    const { run } = firstFill({ save: 60, through: 120 });
    const s = run.stream.snapshot(run.world, statics);
    expect(s.revision).toBe(0);
    expect(s.cells.length).toBeGreaterThan(0);
    expect(s.demolish.length).toBeGreaterThan(0);
    for (const c of s.cells) validateTimedCell(c);
    expectSameSnapshot(s, freshSnapshot(run.world));
  });

  it("snapshot after a rewind and refill equals a fresh stream's cells", () => {
    const { run, saved } = firstFill({ save: 60, through: 120 });
    const re = rewound(saved, run.stream, changingAt(61, base, NO_STARTS, null), 120);
    drain(re);
    fill({ ...re, through: 120 });
    const s = re.stream.snapshot(re.world, statics);
    expect(s.revision).toBe(0);
    expect(s.restore).toBeUndefined();
    expect(s.removedCells).toEqual([]);
    expectSameSnapshot(s, freshSnapshot(re.world));
  });

  it('snapshot restarts the count', () => {
    const { run } = firstFill({ save: 30, through: 60 });
    expect(run.stream.snapshot(run.world, statics).revision).toBe(0);
    const next = fill({ ...run, through: 72 });
    expect(next.length).toBeGreaterThan(0);
    expect(next.map((u) => u.revision)).toEqual(next.map((_, i) => i + 1));
  });

  it('snapshot leaves a cell waiting on chunks dirty; it is sent once ready', () => {
    const { run } = firstFill({ save: 30, through: 60 });
    const all = freshSnapshot(run.world);
    // a cell into which no project anchored elsewhere spans, so holding it back blocks no other
    const spannedInto = new Set<string>();
    for (let row = 0; row < run.world.projects.n; row++) {
      const home = anchorOfRow(run.world, row);
      if (home === null) continue;
      for (const id of scheduleAt(run.world, statics, row, lastDayOf(run.world))!.parcelIds) {
        if (!input.parcels.index.has(id)) continue;
        const c = cellOf(id);
        if (c !== home) spannedInto.add(c);
      }
    }
    const held = all.cells.find((c) => !spannedInto.has(c.cellId));
    expect(held).toBeDefined();
    const waiting = held!.cellId;
    let ready = false;
    const sdeps = streamDeps(input, records, { ready: (c) => ready || c !== waiting });
    const stream = createMapStream(sdeps, WINDOW);
    const world = structuredClone(run.world);
    const s = stream.snapshot(world, statics);
    expect(s.cells.map((c) => c.cellId)).not.toContain(waiting);
    expect(s.cells.length).toBeGreaterThan(0);
    expect(stream.flush(world, statics, Infinity)).toBeNull();
    ready = true;
    const u = stream.flush(world, statics, Infinity)!;
    expect(u.revision).toBe(1);
    expect(u.cells.map((c) => c.cellId)).toEqual([waiting]);
    expect(u.cells[0]).toEqual(held);
    expect(u.demolish).toEqual([]);
  });

  it('every update is accepted in order by a controller that needs last plus one', () => {
    const fake = new FakeController();
    const seen: TimelineUpdate[] = [];
    const feed = (us: TimelineUpdate[]) => {
      for (const u of us) {
        // every update passes validateTimedCell (spec test 7)
        for (const c of u.cells) validateTimedCell(c);
        fake.apply(u);
        seen.push(u);
      }
    };
    const { run, saved, updates } = firstFill({ save: 60, through: 120 });
    feed(updates);
    const re = rewound(saved, run.stream, changingAt(61, base, NO_STARTS, null), 132);
    feed(drain(re));
    feed(fill({ ...re, through: 120 }));
    feed([re.stream.snapshot(re.world, statics)]);
    feed(fill({ ...re, through: 132 }));
    expect(seen.filter((u) => u.revision === 0)).toHaveLength(2);
    expect(seen.at(-1)!.revision).toBeGreaterThan(0);

    const want = new FakeController();
    want.apply(freshSnapshot(re.world));
    expect(fake.cells).toEqual(want.cells);
    expect(fake.demolished).toEqual(want.demolished);
  });

  it('a rewind after a snapshot diffs against what the snapshot sent', () => {
    const fake = new FakeController();
    const feed = strictFeeder(fake);
    const { run, saved, updates } = firstFill({ save: 60, through: 120 });
    feed(updates);
    feed([run.stream.snapshot(run.world, statics)]);
    const re = rewound(saved, run.stream, changingAt(61, base, NO_STARTS, null), 120);
    const refill = [...drain(re), ...fill({ ...re, through: 120 })];
    expect(refill[0].revision).toBe(1);
    // the rewind takes back demolitions the snapshot sent
    expect(refill.flatMap((u) => u.restore ?? []).length).toBeGreaterThan(0);
    feed(refill);
    expectFreshState(fake, re.world);
  });

  it('a snapshot taken right after a rewind supersedes its pending removals and restores', () => {
    const fake = new FakeController();
    const feed = strictFeeder(fake);
    const stop = changingAt(41, base, NO_STARTS, null);
    const { run, saved, updates } = firstFill({ save: 40, through: 120 });
    feed(updates);
    // the rewind leaves restores (and dirty cells) pending; the snapshot answers before a flush
    const re = rewound(saved, run.stream, stop, 120);
    const snap = re.stream.snapshot(re.world, statics);
    expect(snap.restore).toBeUndefined();
    expect(snap.removedCells).toEqual([]);
    feed([snap]);
    expectFreshState(fake, re.world);
    feed([...drain(re), ...fill({ ...re, through: 120 })]);
    // a second rewind diffs against the snapshot's state, not the first fill's: nothing it takes
    // back is missing from the map (checked by the feeder)
    const re2 = rewound(saved, run.stream, stop, 120);
    feed([...drain(re2), ...fill({ ...re2, through: 120 })]);
    expectFreshState(fake, re2.world);
  });

  it('a cell emptied before a snapshot and dirtied again unsent is not removed (fixture-0)', () => {
    use(fixture);
    const AT = 60;
    const stop = changingAt(AT + 1, base, NO_STARTS, null);
    const { seed, cell } = emptiedCell(AT, stop);
    const fake = new FakeController();
    const feed = strictFeeder(fake);
    const { run, saved, updates } = firstFill({ seed, save: AT, through: 120 });
    feed(updates);
    expect(fake.cells.has(cell)).toBe(true);
    // the rewind leaves the cell's removal pending; the snapshot answers first, without it
    const re = rewound(saved, run.stream, stop, 120, seed);
    const snap = re.stream.snapshot(re.world, statics);
    expect(snap.cells.map((c) => c.cellId)).not.toContain(cell);
    feed([snap]);
    expect(fake.cells.has(cell)).toBe(false);
    // projects come back into the cell, unflushed, and a rewind takes them away again: the map
    // never held the cell since the snapshot, so it is dropped, not removed (the feeder checks)
    const back = rewound(saved, run.stream, timeline, 120, seed);
    while (back.world.month < 120) step(back.world, back.due, statics, timeline, seed, back.sink);
    expect(anchorsOf(back.world).has(cell)).toBe(true);
    const re2 = rewound(saved, run.stream, stop, 120, seed);
    const after = [...drain(re2), ...fill({ ...re2, through: 120 })];
    expect(after.flatMap((u) => u.removedCells)).not.toContain(cell);
    feed(after);
    expectFreshState(fake, re2.world);
  });

  it('the fast typed-array equality tells what toEqual tells', () => {
    const f = (...x: number[]) => Float32Array.from(x);
    expect(f(1, NaN, 0)).toEqual(f(1, NaN, 0));
    expect(f(1, NaN, 0)).not.toEqual(f(1, NaN, -0));
    expect(f(1, 2)).not.toEqual(f(1, 3));
    expect(f(1, 2)).not.toEqual(f(1, 2, 3));
    expect(f(1, 2)).not.toEqual(Uint8Array.of(1, 2));
    expect({ a: [f(1), Uint8Array.of(2)] }).toEqual({ a: [f(1), Uint8Array.of(2)] });
    expect({ a: [f(1), Uint8Array.of(2)] }).not.toEqual({ a: [f(1), Uint8Array.of(3)] });
  });

  it('the fake controller refuses an update out of order', () => {
    const fake = new FakeController();
    const u: TimelineUpdate = { revision: 0, cells: [], removedCells: [], demolish: [] };
    fake.apply(u);
    expect(() => fake.apply({ ...u, revision: 2 })).toThrow();
    fake.apply({ ...u, revision: 1 });
    expect(fake.revision).toBe(1);
  });

  it('a stream stepped past windowMonths with nothing changing gets exactly one complete update (fixture-0)', () => {
    use(fixture);
    // no starts from month 1: once the pipeline is through, nothing happens
    const still = oneFrame(NO_STARTS);
    const rec = new Recorder();
    runWorld(statics, still, SEED, 240, rec);
    const last = Math.max(...rec.events.map((e) => e.month));
    expect(last).toBeLessThan(230);
    const windowMonths = last + 3;
    const stream = createMapStream(streamDeps(input, records), windowMonths);
    const { world, sink } = startStream(statics, still, SEED, stream);
    const due = planDue(world, statics, still, SEED, windowMonths + 4);
    const run = { world, statics, timeline: still, seed: SEED, stream, sink, due };
    const before = [
      stream.flush(world, statics, Infinity)!,
      ...fill({ ...run, through: last + 1 })
    ];
    expect(before.length).toBeGreaterThan(0);
    for (const u of before) expect(u.complete).toBe(false);
    // the last cell change is before windowMonths; from here on nothing changes
    expect(fill({ ...run, through: windowMonths - 1 })).toEqual([]);
    const after = fill({ ...run, through: windowMonths + 1 });
    const saved = structuredClone(world);
    after.push(...fill({ ...run, through: windowMonths + 4 }));
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ cells: [], removedCells: [], demolish: [], complete: true });
    expect(after[0].revision).toBe(before.length);
    expect(stream.flush(world, statics, Infinity)).toBeNull();

    // a rewind to a month past windowMonths with nothing changed re-arms it: a host draining
    // until complete after the rewind gets exactly one
    const re = rewound(saved, stream, still, windowMonths + 4);
    const again = [...drain(re), ...fill({ ...re, through: windowMonths + 4 })];
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ cells: [], removedCells: [], demolish: [], complete: true });
    expect(again[0].revision).toBe(before.length + 1);
  });

  it('no complete update while a cell is part-warm under a tiny budget', () => {
    // a clock 10 ms per reading and a 1 ms budget: a flush does one piece of work, so cells of
    // several projects are warmed over several calls, some of which return null
    let t = 0;
    const stream = createMapStream(streamDeps(input, records, { now: () => (t += 10) }), 1);
    const { world, sink } = startStream(statics, timeline, SEED, stream);
    const due = planDue(world, statics, timeline, SEED, 1);
    step(world, due, statics, timeline, SEED, sink);
    expect(world.month).toBe(1);
    const seen: TimelineUpdate[] = [];
    let nulls = 0;
    for (let i = 0; ; i++) {
      if (i > 100_000) throw new Error('no complete update');
      const u = stream.flush(world, statics, 1);
      if (u === null) {
        nulls++;
        continue;
      }
      for (const c of u.cells) validateTimedCell(c);
      seen.push(u);
      if (u.complete) break;
    }
    expect(nulls).toBeGreaterThan(0);
    for (const u of seen.slice(0, -1)) expect(u.complete).toBe(false);
    // complete came only once every cell was sent: nothing is left, and the map is whole
    expect(stream.flush(world, statics, Infinity)).toBeNull();
    expect(foldCells(seen)).toEqual(new Map(freshSnapshot(world).cells.map((c) => [c.cellId, c])));
  });

  it('a snapshot at or past windowMonths with no ready dirty cell carries complete', () => {
    const windowMonths = 24;
    const stream = createMapStream(streamDeps(input, records), windowMonths);
    const { world, sink } = startStream(statics, timeline, SEED, stream);
    const due = planDue(world, statics, timeline, SEED, windowMonths);
    fill({ world, statics, timeline, seed: SEED, stream, sink, due, through: windowMonths - 1 });
    expect(stream.snapshot(world, statics).complete).toBe(false);
    fill({ world, statics, timeline, seed: SEED, stream, sink, due, through: windowMonths });
    expect(stream.snapshot(world, statics).complete).toBe(true);
  });
});
