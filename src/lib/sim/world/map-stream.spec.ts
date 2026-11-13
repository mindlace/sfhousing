import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { cellAnchorParcel, footprintParcel } from '$lib/sim/scenario/massing';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { createMapStream, MASSING_CAP } from './map-stream';
import {
  createWorld,
  monthLastDay,
  planDue,
  scheduleAt,
  staticsOf,
  step,
  type Statics,
  type World
} from '.';
import type { PolicyTimeline } from './policy/frame';
import { benchInput, fixtureInput } from './test/cities.node';
import { benchRecords, fixtureRecords } from './test/map-stream-cities.node';
import { streamDeps } from './test/map-stream-deps';
import { fill, startStream, StreamSink } from './test/map-stream-run';
import { Recorder, SEEDS, readAll, runWorld } from './test/run';
import { frameOf, oneFrame } from './test/timeline';
import { ORIGIN_SIM, type Due } from './types';

const SEED = 1;
const WINDOW = 480;
const CONSTRUCTION = STAGE_ORDER.indexOf('construction');
const COMPLETE = STAGE_ORDER.indexOf('complete');
const NS = STAGE_ORDER.length;

interface City {
  input: SimInput;
  statics: Statics;
  timeline: PolicyTimeline;
  records: ParcelRecord[];
}

function cityOf(input: SimInput, records: ParcelRecord[]): City {
  return { input, statics: staticsOf(input), timeline: oneFrame(frameOf(input)), records };
}

const cellOf = (input: SimInput, id: ParcelId): string => {
  const P = input.parcels;
  return P.cells[P.cell[P.index.get(id)!]].cellId;
};

/** The schedule's anchor cell, or null without a T11 parcel. */
const anchorOf = (input: SimInput, s: Schedule): string | null => {
  const a = cellAnchorParcel(s.parcelIds, input.parcels);
  return a === null ? null : cellOf(input, a);
};

/** The distinct cells of a schedule's T11 parcels. */
const cellsOf = (input: SimInput, s: Schedule): string[] => [
  ...new Set(s.parcelIds.filter((id) => input.parcels.index.has(id)).map((id) => cellOf(input, id)))
];

const lastDayOf = (world: World, statics: Statics) => monthLastDay(statics.asOf, world.month);

/** Every row's schedule read at the end of the world's month (null for masters, not yet begun). */
function schedulesNow(world: World, statics: Statics): (Schedule | null)[] {
  const day = lastDayOf(world, statics);
  return Array.from({ length: world.projects.n }, (_, row) => scheduleAt(world, statics, row, day));
}

/** The row's parcel ids as read at the end of the world's month ([] for a master). */
const parcelIdsOfRow = (world: World, statics: Statics, row: number): ParcelId[] =>
  scheduleAt(world, statics, row, lastDayOf(world, statics))?.parcelIds ?? [];

/** The latest packed version of every cell sent so far. */
function lastSent(updates: TimelineUpdate[]): Map<string, TimedPackedCell> {
  const out = new Map<string, TimedPackedCell>();
  for (const u of updates) for (const c of u.cells) out.set(c.cellId, c);
  return out;
}

/** An event that adds nothing to the row: it only marks the row's cell dirty. */
const touch = (row: number) => ({ kind: 'award' as const, row, day: 0 });

function slotOf(c: TimedPackedCell, projectId: string): number {
  return c.slotProjectIds.indexOf(projectId);
}

function findSlot(u: TimelineUpdate, projectId: string): { cell: TimedPackedCell; s: number } {
  for (const cell of u.cells) {
    const s = slotOf(cell, projectId);
    if (s >= 0) return { cell, s };
  }
  throw new Error(`no slot for ${projectId}`);
}

let bench: City;

beforeAll(() => {
  bench = cityOf(benchInput(), benchRecords());
});

/** A stream started on a fresh world of `city`. */
function started(
  city: City,
  o: Parameters<typeof streamDeps>[2] = {},
  windowMonths = WINDOW
): {
  world: World;
  sink: StreamSink;
  stream: ReturnType<typeof createMapStream>;
  deps: ReturnType<typeof streamDeps>;
  due: Due;
} {
  const deps = streamDeps(city.input, city.records, o);
  const stream = createMapStream(deps, windowMonths);
  const { world, sink } = startStream(city.statics, city.timeline, SEED, stream);
  const due = planDue(world, city.statics, city.timeline, SEED, WINDOW);
  return { world, sink, stream, deps, due };
}

describe('map-stream: onEvent and flush', () => {
  it('exports the massing cap', () => {
    expect(MASSING_CAP).toBe(60_000);
  });

  it('onEvent marks dirty and packs nothing', () => {
    const { world, stream, deps } = started(bench);
    expect(deps.massingCalls()).toBe(0);
    expect(stream.flush(world, bench.statics, Infinity)).not.toBeNull();
    expect(deps.massingCalls()).toBeGreaterThan(0);
  });

  it('pipeline at the dataset date goes out first (rule 12)', () => {
    const { world, stream } = started(bench);
    const u = stream.flush(world, bench.statics, Infinity)!;
    const sent = new Set(u.cells.flatMap((c) => c.slotProjectIds));
    const want = new Set<string>();
    for (let row = 0; row < world.projects.n; row++) {
      const s = scheduleAt(world, bench.statics, row, bench.statics.asOf);
      if (s && anchorOf(bench.input, s) !== null) want.add(s.projectId);
    }
    expect(want.size).toBeGreaterThan(0);
    expect(sent).toEqual(want);
    expect(u.revision).toBe(0);
  });

  it('a start, its construction and its completion', () => {
    const rec = new Recorder();
    const pre = runWorld(bench.statics, bench.timeline, SEED, 120, rec);
    const months = new Map<number, { s?: number; c?: number; e?: number; day?: number }>();
    const at = (row: number) => months.get(row) ?? months.set(row, {}).get(row)!;
    for (const e of rec.events) {
      if (pre.projects.origin[e.row] !== ORIGIN_SIM) continue;
      if (e.kind === 'start') at(e.row).s = e.month;
      if (e.kind === 'enter' && e.stage === 'construction') at(e.row).c = e.month;
      if (e.kind === 'end' && e.how === 'complete')
        Object.assign(at(e.row), { e: e.month, day: e.day });
    }
    let found: { row: number; s: number; c: number; e: number; day: number } | null = null;
    for (const [row, m] of months) {
      if (m.s === undefined || m.c === undefined || m.e === undefined) continue;
      if (1 < m.s && m.s < m.c && m.c < m.e) {
        found = { row, s: m.s, c: m.c, e: m.e, day: m.day! };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { row, s, e, day } = found!;
    const id = `sim:${bench.statics.parcelId[pre.projects.src[row]]}:${pre.projects.sub[row]}`;

    const { world, sink, stream, due } = started(bench);
    const run = {
      world,
      statics: bench.statics,
      timeline: bench.timeline,
      seed: SEED,
      stream,
      sink,
      due
    };
    stream.flush(world, bench.statics, Infinity);
    fill({ ...run, through: s - 1 });
    const [afterStart] = fill({ ...run, through: s });
    const a = findSlot(afterStart, id);
    expect(a.cell.slotEnd[2 * a.s]).toBeNaN();
    expect(a.cell.slotEnd[2 * a.s + 1]).toBe(0);
    expect(a.cell.slotStages[NS * a.s + CONSTRUCTION]).toBeNaN();
    expect(a.cell.slotStages[NS * a.s + COMPLETE]).toBeNaN();

    fill({ ...run, through: e - 1 });
    const [afterEnd] = fill({ ...run, through: e });
    const b = findSlot(afterEnd, id);
    expect(b.cell.slotEnd[2 * b.s]).toBe(day);
    expect(b.cell.slotEnd[2 * b.s + 1]).toBe(1);
  });

  it("the cell is the smallest parcel's, the pick parcel the largest (rule 2)", async () => {
    const fixture = cityOf(await fixtureInput(), fixtureRecords());
    let checked = 0;
    for (const city of [fixture, bench]) {
      const { world, sink, stream, due } = started(city);
      const updates = [stream.flush(world, city.statics, Infinity)!];
      updates.push(
        ...fill({
          world,
          statics: city.statics,
          timeline: city.timeline,
          seed: SEED,
          stream,
          sink,
          due,
          through: 24
        })
      );
      const byId = new Map(city.records.map((r) => [r.id, r]));
      for (const u of updates) {
        for (const c of u.cells) {
          c.slotProjectIds.forEach((pid, slot) => {
            if (checked > 0) return;
            const s = schedulesNow(world, city.statics).find((x) => x?.projectId === pid)!;
            const ids = s.parcelIds.filter((id) => city.input.parcels.index.has(id));
            if (new Set(ids).size < 2) return;
            expect(c.cellId).toBe(cellOf(city.input, cellAnchorParcel(ids, city.input.parcels)!));
            const recs = [...new Set(ids)].map((id) => byId.get(id)!);
            expect(c.parcelIds[slot]).toBe(footprintParcel(recs).id);
            checked++;
          });
        }
      }
      if (checked > 0) break;
    }
    expect(checked).toBe(1);
  });

  it('a cell goes whole', () => {
    const { world, sink, stream, due } = started(bench);
    const updates = [stream.flush(world, bench.statics, Infinity)!];
    updates.push(
      ...fill({
        world,
        statics: bench.statics,
        timeline: bench.timeline,
        seed: SEED,
        stream,
        sink,
        due,
        through: 12
      })
    );
    const cell = [...lastSent(updates).values()].find((c) => c.slotProjectIds.length >= 2)!;
    expect(cell).toBeDefined();
    const schedules = schedulesNow(world, bench.statics);
    const second = schedules.findIndex((s) => s?.projectId === cell.slotProjectIds[1]);
    stream.onEvent(touch(second), world, bench.statics);
    const u = stream.flush(world, bench.statics, Infinity)!;
    expect(u.cells.map((c) => c.cellId)).toEqual([cell.cellId]);
    expect(u.cells[0].slotProjectIds).toEqual(cell.slotProjectIds);
  });

  it('null when nothing changed', () => {
    const { world, sink, stream, due } = started(bench);
    stream.flush(world, bench.statics, Infinity);
    step(world, due, bench.statics, bench.timeline, SEED, sink);
    expect(stream.flush(world, bench.statics, Infinity)).not.toBeNull();
    expect(stream.flush(world, bench.statics, Infinity)).toBeNull();
  });

  it('the budget packs oldest first and keeps the rest', () => {
    let calls = 0;
    const { world, stream } = started(bench, { now: () => 10 * ++calls });
    const u0 = stream.flush(world, bench.statics, Infinity)!;
    const schedules = schedulesNow(world, bench.statics);
    // one row in each of five distinct cells, dirtied in this order
    const picked: { row: number; cell: string }[] = [];
    const used = new Set<string>();
    for (const c of u0.cells) {
      if (picked.length === 5) break;
      if (used.has(c.cellId)) continue;
      const row = schedules.findIndex((s) => s?.projectId === c.slotProjectIds[0]);
      picked.push({ row, cell: c.cellId });
      used.add(c.cellId);
    }
    expect(picked).toHaveLength(5);
    const order = [3, 0, 4, 1, 2].map((k) => picked[k]);
    for (const p of order) stream.onEvent(touch(p.row), world, bench.statics);
    const cellsOfU = (u: TimelineUpdate | null) => u!.cells.map((c) => c.cellId);
    expect(cellsOfU(stream.flush(world, bench.statics, 20))).toEqual([
      order[0].cell,
      order[1].cell
    ]);
    expect(cellsOfU(stream.flush(world, bench.statics, 20))).toEqual([
      order[2].cell,
      order[3].cell
    ]);
    expect(cellsOfU(stream.flush(world, bench.statics, 0))).toEqual([order[4].cell]);
    expect(stream.flush(world, bench.statics, 0)).toBeNull();
  });

  it('a cold cell is warmed across flushes and sent whole once', () => {
    const world = runWorld(bench.statics, bench.timeline, SEED, 60);
    const schedules = schedulesNow(world, bench.statics);
    const byCell = new Map<string, number[]>();
    schedules.forEach((s, row) => {
      const a = s && anchorOf(bench.input, s);
      if (!a) return;
      (byCell.get(a) ?? byCell.set(a, []).get(a)!).push(row);
    });
    const hit = [...byCell].find(([, rs]) => rs.length >= 3);
    expect(hit).toBeDefined();
    const [cell, rows] = hit!;

    // the cell packed in one unbounded flush, for comparison
    const whole = createMapStream(streamDeps(bench.input, bench.records), WINDOW);
    for (const r of rows) whole.onEvent(touch(r), world, bench.statics);
    const want = whole.flush(world, bench.statics, Infinity)!.cells;
    expect(want.map((c) => c.cellId)).toEqual([cell]);
    expect(want[0].slotProjectIds.length).toBeGreaterThanOrEqual(3);

    // a clock 10 ms per reading; each reading notes the massing work done before it
    let t = 0;
    let readings: { t: number; calls: number }[] = [];
    const deps = streamDeps(bench.input, bench.records, {
      now: () => {
        t += 10;
        readings.push({ t, calls: deps.massingCalls() });
        return t;
      }
    });
    const stream = createMapStream(deps, WINDOW);
    for (const r of rows) stream.onEvent(touch(r), world, bench.statics);
    const BUDGET = 15;
    const sent: TimedPackedCell[] = [];
    let nulls = 0;
    for (let i = 0; i < 1000; i++) {
      readings = [];
      const before = deps.massingCalls();
      const u = stream.flush(world, bench.statics, BUDGET);
      const after = deps.massingCalls();
      // no massing work once a reading shows the budget spent
      const over = readings.find((r) => r.t - readings[0].t >= BUDGET);
      if (over) expect(after).toBe(over.calls);
      if (u === null) {
        if (after === before) break;
        nulls++;
        continue;
      }
      sent.push(...u.cells);
    }
    expect(nulls).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
    expect(sent).toEqual(want);
  });

  it('sliced equals unsliced', () => {
    const MONTHS = 120;
    const a = started(bench);
    const updatesA = [
      a.stream.flush(a.world, bench.statics, Infinity)!,
      ...fill({
        world: a.world,
        statics: bench.statics,
        timeline: bench.timeline,
        seed: SEED,
        stream: a.stream,
        sink: a.sink,
        due: a.due,
        through: MONTHS
      })
    ];

    let t = 0;
    const b = started(bench, { now: () => (t += 10) });
    const updatesB: TimelineUpdate[] = [];
    let flushes = 0;
    let midCell = 0; // null flushes that did massing work: stopped inside a cell
    // flush with no budget until a call packs nothing and does no massing work
    const drain = () => {
      for (;;) {
        const before = b.deps.massingCalls();
        const u = b.stream.flush(b.world, bench.statics, 0);
        flushes++;
        if (u !== null) updatesB.push(u);
        else if (b.deps.massingCalls() === before) return;
        else midCell++;
      }
    };
    drain();
    while (b.world.month < MONTHS) {
      step(b.world, b.due, bench.statics, bench.timeline, SEED, b.sink);
      drain();
    }
    expect(flushes).toBeGreaterThan(updatesA.length);
    expect(midCell).toBeGreaterThan(0);

    const fold = (us: TimelineUpdate[]) => {
      const cells = new Map<string, TimedPackedCell>();
      const demolish = new Map<ParcelId, number>();
      for (const u of us) {
        for (const c of u.cells) cells.set(c.cellId, c);
        for (const d of u.demolish) demolish.set(d.parcelId, d.day);
      }
      const sorted = <V>(m: Map<string, V>) => [...m].sort(([x], [y]) => (x < y ? -1 : 1));
      return { cells: sorted(cells), demolish: sorted(demolish) };
    };
    const fa = fold(updatesA);
    const fb = fold(updatesB);
    expect(fa.cells.length).toBeGreaterThan(0);
    expect(fb.cells.map(([id]) => id)).toEqual(fa.cells.map(([id]) => id));
    fa.cells.forEach(([, c], i) => expect(fb.cells[i][1]).toEqual(c));
    expect(fb.demolish).toEqual(fa.demolish);
  });

  it('a cell needing an unloaded chunk waits and keeps its place', () => {
    // a project of the dataset date whose T11 parcels span two cells
    const probe = runWorld(bench.statics, bench.timeline, SEED, 0);
    const at0 = schedulesNow(probe, bench.statics);
    const multi = at0.find((s) => s !== null && cellsOf(bench.input, s).length >= 2)!;
    expect(multi).toBeDefined();
    const anchor = anchorOf(bench.input, multi)!;
    const other = cellsOf(bench.input, multi).find((c) => c !== anchor)!;

    let loaded = false;
    const ready = (c: string) => loaded || c !== other;
    const test = started(bench, { ready });
    const twin = started(bench);
    const go = (t: typeof test, through: number) =>
      fill({
        world: t.world,
        statics: bench.statics,
        timeline: bench.timeline,
        seed: SEED,
        stream: t.stream,
        sink: t.sink,
        due: t.due,
        through
      });

    const sent = [test.stream.flush(test.world, bench.statics, Infinity)!, ...go(test, 1)];
    const twinSent = [twin.stream.flush(twin.world, bench.statics, Infinity)!, ...go(twin, 1)];
    const sentCells = new Set(sent.flatMap((u) => u.cells.map((c) => c.cellId)));
    expect(sentCells.has(anchor)).toBe(false);
    expect(sentCells.size).toBeGreaterThan(0);
    // the cells waiting, in the order the twin first sent them (the queue's first-dirtied order)
    const waiting = [
      ...new Set(
        twinSent.flatMap((u) => u.cells.map((c) => c.cellId)).filter((c) => !sentCells.has(c))
      )
    ];
    expect(waiting).toContain(anchor);

    // the chunk arrives; month 2 dirties more cells behind the waiting ones
    loaded = true;
    step(test.world, test.due, bench.statics, bench.timeline, SEED, test.sink);
    // with no budget a cold cell is warmed a project per call: flush until the first cell goes
    const one: TimedPackedCell[] = [];
    for (let i = 0; i < 1000 && one.length === 0; i++)
      one.push(...(test.stream.flush(test.world, bench.statics, 0)?.cells ?? []));
    expect(one.map((c) => c.cellId)).toEqual([waiting[0]]);
    const rest = test.stream.flush(test.world, bench.statics, Infinity)!;
    const restIds = rest.cells.map((c) => c.cellId);
    expect(restIds.slice(0, waiting.length - 1)).toEqual(waiting.slice(1));
    const whole = [...one, ...rest.cells].find((c) => c.cellId === anchor)!;
    expect(whole.slotProjectIds).toContain(multi.projectId);
  });

  it('revisions count from 0 and complete is set (rule 7)', () => {
    const windowMonths = 24;
    const { world, sink, stream, due } = started(bench, {}, windowMonths);
    const run = {
      world,
      statics: bench.statics,
      timeline: bench.timeline,
      seed: SEED,
      stream,
      sink,
      due
    };
    const seen: { month: number; u: TimelineUpdate }[] = [];
    const first = stream.flush(world, bench.statics, Infinity)!;
    seen.push({ month: 0, u: first });
    for (let m = 1; m <= 30; m++)
      for (const u of fill({ ...run, through: m })) seen.push({ month: m, u });
    expect(seen.map((x) => x.u.revision)).toEqual(seen.map((_, i) => i));
    for (const x of seen) if (x.month < windowMonths) expect(x.u.complete).toBe(false);
    const after = seen.find((x) => x.month >= windowMonths)!;
    expect(after).toBeDefined();
    expect(after.u.complete).toBe(true);
  });

  it('massingFor runs once per revision (rule 11)', () => {
    const world = runWorld(bench.statics, bench.timeline, SEED, 60);
    const schedules = schedulesNow(world, bench.statics);
    const byCell = new Map<string, number[]>();
    schedules.forEach((s, row) => {
      const a = s && anchorOf(bench.input, s);
      if (!a) return;
      (byCell.get(a) ?? byCell.set(a, []).get(a)!).push(row);
    });
    const revs = (rows: number[]) => rows.reduce((t, r) => t + schedules[r]!.revisions.length, 0);

    // a cell with a project of two or more revisions
    const [cell, rows] = [...byCell].find(([, rs]) =>
      rs.some((r) => schedules[r]!.revisions.length > 1)
    )!;
    expect(cell).toBeDefined();
    const deps = streamDeps(bench.input, bench.records);
    const stream = createMapStream(deps, WINDOW);
    for (let k = 0; k < 3; k++) {
      for (const r of rows) stream.onEvent(touch(r), world, bench.statics);
      const u = stream.flush(world, bench.statics, Infinity)!;
      expect(u.cells.map((c) => c.cellId)).toEqual([cell]);
    }
    expect(deps.massingCalls()).toBe(revs(rows));

    // the cap: room for one massing, so a repack of two or more revisions calls it again
    expect(revs(rows)).toBeGreaterThanOrEqual(2);
    const small = streamDeps(bench.input, bench.records, { massingCap: 1 });
    const capped = createMapStream(small, WINDOW);
    for (const r of rows) capped.onEvent(touch(r), world, bench.statics);
    capped.flush(world, bench.statics, Infinity);
    expect(small.massingCalls()).toBe(revs(rows));
    for (const r of rows) capped.onEvent(touch(r), world, bench.statics);
    capped.flush(world, bench.statics, Infinity);
    expect(small.massingCalls()).toBe(2 * revs(rows));
  });

  it('every update passes validateTimedCell', () => {
    const { world, sink, stream, due } = started(bench);
    const updates = fill({
      world,
      statics: bench.statics,
      timeline: bench.timeline,
      seed: SEED,
      stream,
      sink,
      due,
      through: 24
    });
    expect(updates.reduce((n, u) => n + u.cells.length, 0)).toBeGreaterThan(0);
  });

  it('a construction month carries the lot in demolish once', () => {
    const rec = new Recorder();
    const pre = runWorld(bench.statics, bench.timeline, SEED, 120, rec);
    const firstOn = new Map<string, number>(); // lot → month of its first construction
    for (const e of rec.events) {
      if (e.kind !== 'enter' || e.stage !== 'construction') continue;
      for (const id of parcelIdsOfRow(pre, bench.statics, e.row))
        if (!firstOn.has(id)) firstOn.set(id, e.month);
    }
    // a sim row entering construction after month 1, the first on its lot, the only one that month
    const hit = rec.events.find((e) => {
      if (e.kind !== 'enter' || e.stage !== 'construction' || e.month < 2) return false;
      if (pre.projects.origin[e.row] !== ORIGIN_SIM) return false;
      const lot = bench.statics.parcelId[pre.projects.src[e.row]];
      return bench.input.parcels.index.has(lot) && firstOn.get(lot) === e.month;
    });
    expect(hit).toBeDefined();
    const { row, month: c, day } = hit!;
    const lot = bench.statics.parcelId[pre.projects.src[row]];

    const { world, sink, stream, due } = started(bench);
    const run = {
      world,
      statics: bench.statics,
      timeline: bench.timeline,
      seed: SEED,
      stream,
      sink
    };
    const before = [
      stream.flush(world, bench.statics, Infinity)!,
      ...fill({ ...run, due, through: c - 1 })
    ];
    const at = fill({ ...run, due, through: c });
    const after = fill({ ...run, due, through: c + 24 });
    const on = (us: TimelineUpdate[]) =>
      us.flatMap((u) => u.demolish.filter((d) => d.parcelId === lot));
    expect(on(before)).toEqual([]);
    expect(on(at)).toEqual([{ parcelId: lot, day }]);
    expect(on(after)).toEqual([]);
  });

  it('revision 0 carries every demolition known so far', () => {
    const deps = streamDeps(bench.input, bench.records);
    const stream = createMapStream(deps, WINDOW);
    const sink = new StreamSink(stream, bench.statics);
    const world = createWorld(bench.statics, bench.timeline, SEED, sink);
    const due = planDue(world, bench.statics, bench.timeline, SEED, 60);
    for (let m = 1; m <= 60; m++) step(world, due, bench.statics, bench.timeline, SEED, sink);
    sink.attach(world);
    const u = stream.flush(world, bench.statics, Infinity)!;
    expect(u.revision).toBe(0);

    const want = new Map<ParcelId, number>();
    for (const s of readAll(world, bench.statics, lastDayOf(world, bench.statics)).schedules) {
      const c = s.entered.construction;
      if (c === undefined) continue;
      for (const id of s.parcelIds) {
        if (!bench.input.parcels.index.has(id)) continue;
        const d = want.get(id);
        if (d === undefined || c < d) want.set(id, c);
      }
    }
    expect(want.size).toBeGreaterThan(0);
    const sortedWant = [...want.keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((parcelId) => ({ parcelId, day: want.get(parcelId)! }));
    expect(u.demolish).toEqual(sortedWant);
    expect(stream.flush(world, bench.statics, Infinity)).toBeNull();
  });

  it('two projects on one lot: the earliest construction day only', () => {
    const MONTHS = 240;
    let found: { seed: number; lot: ParcelId; day: number; through: number } | null = null;
    for (const seed of SEEDS) {
      const rec = new Recorder();
      const w = runWorld(bench.statics, bench.timeline, seed, MONTHS, rec);
      const on = new Map<ParcelId, { rows: Set<number>; day: number; month: number }>();
      for (const e of rec.events) {
        if (e.kind !== 'enter' || e.stage !== 'construction') continue;
        for (const id of parcelIdsOfRow(w, bench.statics, e.row)) {
          if (!bench.input.parcels.index.has(id)) continue;
          const x =
            on.get(id) ?? on.set(id, { rows: new Set(), day: e.day, month: e.month }).get(id)!;
          x.rows.add(e.row);
          if (x.rows.size === 2) {
            found = { seed, lot: id, day: Math.min(x.day, e.day), through: e.month + 1 };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { seed, lot, day, through } = found!;
    const deps = streamDeps(bench.input, bench.records);
    const stream = createMapStream(deps, WINDOW);
    const { world, sink } = startStream(bench.statics, bench.timeline, seed, stream);
    const due = planDue(world, bench.statics, bench.timeline, seed, WINDOW);
    const updates = [stream.flush(world, bench.statics, Infinity)!];
    updates.push(
      ...fill({
        world,
        statics: bench.statics,
        timeline: bench.timeline,
        seed,
        stream,
        sink,
        due,
        through
      })
    );
    const sent = updates.flatMap((u) => u.demolish.filter((d) => d.parcelId === lot));
    expect(sent).toEqual([{ parcelId: lot, day }]);
  });

  it('an update goes out when only demolitions are pending', () => {
    const probe = runWorld(bench.statics, bench.timeline, SEED, 0);
    const row = schedulesNow(probe, bench.statics).findIndex(
      (s) => s !== null && anchorOf(bench.input, s) !== null
    );
    const s = scheduleAt(probe, bench.statics, row, lastDayOf(probe, bench.statics))!;
    const waiting = new Set(cellsOf(bench.input, s));
    const lot = s.parcelIds.find((id) => bench.input.parcels.index.has(id))!;
    // the row's cells never load, so the event dirties a cell that cannot pack
    const { world, stream } = started(bench, { ready: (c) => !waiting.has(c) });
    stream.flush(world, bench.statics, Infinity);
    expect(stream.flush(world, bench.statics, Infinity)).toBeNull();
    stream.onEvent({ kind: 'enter', row, day: -1, stage: 'construction' }, world, bench.statics);
    const u = stream.flush(world, bench.statics, Infinity)!;
    expect(u).not.toBeNull();
    expect(u.cells).toEqual([]);
    expect(u.demolish).toContainEqual({ parcelId: lot, day: -1 });
    expect(stream.flush(world, bench.statics, Infinity)).toBeNull();
  });

  it('rewind and snapshot are not built yet', () => {
    const { world, stream } = started(bench);
    expect(() => stream.rewind(world, bench.statics)).toThrow('map-stream: not built yet');
    expect(() => stream.snapshot(world, bench.statics)).toThrow('map-stream: not built yet');
  });
});
