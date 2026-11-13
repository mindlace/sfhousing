import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { cellAnchorParcel, footprintParcel } from '$lib/sim/scenario/massing';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { createMapStream, MASSING_CAP } from './map-stream';
import { monthLastDay, planDue, scheduleAt, staticsOf, step, type Statics, type World } from '.';
import type { PolicyTimeline } from './policy/frame';
import { benchInput, fixtureInput } from './test/cities.node';
import { benchRecords, fixtureRecords } from './test/map-stream-cities.node';
import { streamDeps } from './test/map-stream-deps';
import { fill, startStream, type StreamSink } from './test/map-stream-run';
import { Recorder, runWorld } from './test/run';
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
    const one = test.stream.flush(test.world, bench.statics, 0)!;
    expect(one.cells.map((c) => c.cellId)).toEqual([waiting[0]]);
    const rest = test.stream.flush(test.world, bench.statics, Infinity)!;
    const restIds = rest.cells.map((c) => c.cellId);
    expect(restIds.slice(0, waiting.length - 1)).toEqual(waiting.slice(1));
    const whole = [...one.cells, ...rest.cells].find((c) => c.cellId === anchor)!;
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

  it('rewind and snapshot are not built yet', () => {
    const { world, stream } = started(bench);
    expect(() => stream.rewind(world, bench.statics)).toThrow('map-stream: not built yet');
    expect(() => stream.snapshot(world, bench.statics)).toThrow('map-stream: not built yet');
  });
});
