import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { validateCityDelta } from '$lib/map/city-delta';
import { CITY_DAY, type CityDelta } from '$lib/map/types';
import { cellAnchorParcel } from '$lib/sim/scenario/massing';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { createCityFeed, type CityFeedDeps } from './city-feed';
import { addProject, emptyWorld, pushRev } from './columns';
import { monthLastDay, scheduleAt, staticsOf, type Statics } from '.';
import { fixtureInput } from './test/cities.node';
import { FakeController, markersOf, rowParcelIds } from './test/map-stream-run';
import { horizonMonth, runWorld } from './test/run';
import { frameOf, oneFrame } from './test/timeline';
import {
  END_COMPLETE,
  END_EXIT,
  NO_DAY,
  ORIGIN_MASTER,
  ORIGIN_PIPELINE,
  ORIGIN_SIM,
  type World
} from './types';

const NS = STAGE_ORDER.length;
const ASOF = 20_000;
const LATE = 40_000;

// T11 holds L0, L1, L2 (not L3); label points are given to 1e-7, read back as float32
const PARCELS = {
  index: new Map<ParcelId, number>([
    ['L0', 0],
    ['L1', 1],
    ['L2', 2]
  ]),
  labelPoint: Float64Array.from([-122.4101234, 37.7501234, -122.42, 37.76, -122.43, 37.77])
} as unknown as ScenarioParcels;

const STATICS = {
  asOf: ASOF,
  parcelId: ['L0', 'L1', 'L2', 'L3'],
  rank: new Uint32Array(4),
  projects: [{ id: 'P1', parcelIds: ['L3', 'L2'], multiPhase: false }],
  districtMaxStories: null
} as unknown as Statics;

/** Per row of the little world: its T11 anchor lot (null: a master or no T11 parcel). */
type Anchors = (ParcelId | null)[];

function enter(w: World, row: number, stage: Stage, day: number): void {
  w.projects.entered[row * NS + STAGE_ORDER.indexOf(stage)] = day;
}

function simRow(w: World, lot: number): number {
  const p = w.projects;
  const row = addProject(p);
  p.origin[row] = ORIGIN_SIM;
  p.src[row] = lot;
  p.sub[row] = 1;
  return row;
}

/**
 * Row 0: L0, approved by its permit (20,090) before entitlement (20,100), construction 20,200,
 * complete 20,500, 70,000 homes. Row 1: L1, filed only, 12 homes. Row 2: a master. Row 3: L3,
 * not in T11. Row 4: pipeline P1 on L3 and L2 (anchor L2), exited after construction, 40 homes.
 */
function little(): { world: World; anchors: Anchors; flags: number[] } {
  const w = emptyWorld(0);
  const p = w.projects;
  const r0 = simRow(w, 0);
  enter(w, r0, 'filed', 20_010);
  enter(w, r0, 'entitled', 20_100);
  enter(w, r0, 'permitIssued', 20_090);
  enter(w, r0, 'construction', 20_200);
  enter(w, r0, 'complete', 20_500);
  p.endKind[r0] = END_COMPLETE;
  p.endDay[r0] = 20_500;
  pushRev(p, r0, 20_010, 70_000, 40);
  const r1 = simRow(w, 1);
  enter(w, r1, 'filed', 20_020);
  pushRev(p, r1, 20_020, 12, 3);
  const r2 = addProject(p);
  p.origin[r2] = ORIGIN_MASTER;
  p.src[r2] = 0;
  enter(w, r2, 'filed', 20_000);
  const r3 = simRow(w, 3);
  enter(w, r3, 'filed', 20_030);
  pushRev(p, r3, 20_030, 5, 2);
  const r4 = addProject(p);
  p.origin[r4] = ORIGIN_PIPELINE;
  p.src[r4] = 0;
  enter(w, r4, 'entitled', 19_000);
  enter(w, r4, 'construction', 20_300);
  p.endKind[r4] = END_EXIT;
  p.endDay[r4] = 20_400;
  p.endStage[r4] = STAGE_ORDER.indexOf('construction');
  p.outcome[r4] = 1;
  pushRev(p, r4, 19_000, 40, 4);
  return { world: w, anchors: ['L0', 'L1', null, null, 'L2'], flags: [1, 2, 0, 0, 3] };
}

function feedOf(anchors: Anchors, flags: number[]) {
  const deps: CityFeedDeps = {
    parcels: PARCELS,
    anchorOf: (_w, _st, row) => anchors[row] ?? null,
    flagsOf: (_w, _st, row) => flags[row] ?? 0
  };
  return createCityFeed(deps);
}

/** The delta's rows as plain records, for readable assertions. */
function rowsOf(d: CityDelta) {
  validateCityDelta(d);
  return Array.from(d.row, (row, i) => ({
    row,
    lng: d.lngLat[2 * i],
    lat: d.lngLat[2 * i + 1],
    approved: d.days[3 * i + CITY_DAY.approved],
    started: d.days[3 * i + CITY_DAY.started],
    completed: d.days[3 * i + CITY_DAY.completed],
    homes: d.homes[i],
    flags: d.flags[i]
  }));
}

const f32 = Math.fround;

describe('city-feed', () => {
  it("snapshot holds one marker per row with a lot, at its anchor lot's label point", () => {
    const { world, anchors, flags } = little();
    const d = feedOf(anchors, flags).snapshot(world, STATICS, LATE);
    expect(d.rows).toBe(5);
    const rows = rowsOf(d);
    expect(rows.map((r) => r.row)).toEqual([0, 1, 4]);
    expect(rows[0].lng).toBe(f32(-122.4101234));
    expect(rows[0].lat).toBe(f32(37.7501234));
    expect([rows[2].lng, rows[2].lat]).toEqual([f32(-122.43), f32(37.77)]);
  });

  it('approved is the first of entitled and permitIssued; started is construction; completed a complete end; NaN otherwise', () => {
    const { world, anchors, flags } = little();
    const [r0, r1, r4] = rowsOf(feedOf(anchors, flags).snapshot(world, STATICS, LATE));
    expect([r0.approved, r0.started, r0.completed]).toEqual([20_090, 20_200, 20_500]);
    expect(r1.approved).toBeNaN();
    expect(r1.started).toBeNaN();
    expect(r1.completed).toBeNaN();
    // an exit is no completion
    expect([r4.approved, r4.started]).toEqual([19_000, 20_300]);
    expect(r4.completed).toBeNaN();
    // read on a day before construction: nothing dated after it
    const [early] = rowsOf(feedOf(anchors, flags).snapshot(world, STATICS, 20_150));
    expect(early.approved).toBe(20_090);
    expect(early.started).toBeNaN();
    expect(early.completed).toBeNaN();
  });

  it("homes is the final revision's units, capped at 65535; flags are flagsOf's", () => {
    const { world, anchors, flags } = little();
    pushRev(world.projects, 1, 20_400, 30, 4);
    const [r0, r1, r4] = rowsOf(feedOf(anchors, flags).snapshot(world, STATICS, LATE));
    expect(r0.homes).toBe(65_535);
    expect(r1.homes).toBe(30);
    expect(r4.homes).toBe(40);
    expect([r0.flags, r1.flags, r4.flags]).toEqual([1, 2, 3]);
  });

  it('a row not begun on the day has NaN days, no homes and no flags', () => {
    const { world, anchors, flags } = little();
    const [r0] = rowsOf(feedOf(anchors, flags).snapshot(world, STATICS, 20_000));
    expect(r0.row).toBe(0);
    expect(r0.approved).toBeNaN();
    expect(r0.started).toBeNaN();
    expect(r0.completed).toBeNaN();
    expect(r0.homes).toBe(0);
    expect(r0.flags).toBe(0);
  });

  it('a master row and a row with no T11 parcel carry no marker', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    for (let row = 0; row < 5; row++) feed.touch(row);
    expect(rowsOf(feed.take(world, STATICS, LATE)!).map((r) => r.row)).toEqual([0, 1, 4]);
    const rows = rowsOf(feed.snapshot(world, STATICS, LATE)).map((r) => r.row);
    expect(rows).not.toContain(2);
    expect(rows).not.toContain(3);
  });

  it('take sends only rows touched since the last take, ascending; null when none is pending', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    expect(feed.pending()).toBe(false);
    expect(feed.take(world, STATICS, LATE)).toBeNull();
    feed.touch(4);
    feed.touch(0);
    feed.touch(4);
    expect(feed.pending()).toBe(true);
    const a = feed.take(world, STATICS, LATE)!;
    expect(a.rows).toBe(5);
    expect(Array.from(a.row)).toEqual([0, 4]);
    expect(feed.pending()).toBe(false);
    expect(feed.take(world, STATICS, LATE)).toBeNull();
    // a touched row whose marker is as sent says nothing; a changed one is sent
    pushRev(world.projects, 1, 20_400, 31, 4);
    feed.touch(0);
    feed.touch(1);
    const b = feed.take(world, STATICS, LATE)!;
    expect(Array.from(b.row)).toEqual([1]);
    expect(b.homes[0]).toBe(31);
    feed.touch(0);
    expect(feed.take(world, STATICS, LATE)).toBeNull();
  });

  it('a new row is sent with the rows count that holds it', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    const r5 = simRow(world, 1);
    enter(world, r5, 'filed', 20_600);
    pushRev(world.projects, r5, 20_600, 8, 2);
    anchors.push('L1');
    feed.touch(r5);
    const d = feed.take(world, STATICS, LATE)!;
    expect(d.rows).toBe(6);
    expect(rowsOf(d)).toEqual([
      {
        row: 5,
        lng: f32(-122.42),
        lat: f32(37.76),
        approved: NaN,
        started: NaN,
        completed: NaN,
        homes: 8,
        flags: 0
      }
    ]);
  });

  it('rewind: rows past n are dropped (rows === n) and rows whose marker changed are resent; unchanged rows are not', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    // the restored world: rows 4 on gone, row 0 not yet complete, row 1's flags changed
    const restored = structuredClone(world);
    restored.projects.n = 4;
    restored.projects.endKind[0] = 0;
    restored.projects.entered[0 * NS + STAGE_ORDER.indexOf('complete')] = NO_DAY;
    flags[1] = 0;
    feed.rewind(restored, STATICS, LATE);
    expect(feed.pending()).toBe(true);
    const d = feed.take(restored, STATICS, LATE)!;
    expect(d.rows).toBe(4);
    expect(d.from).toBe(4);
    const rows = rowsOf(d);
    expect(rows.map((r) => r.row)).toEqual([0, 1]);
    expect(rows[0].completed).toBeNaN();
    expect(rows[0].started).toBe(20_200);
    expect(rows[1].flags).toBe(0);
    expect(feed.take(restored, STATICS, LATE)).toBeNull();
  });

  it('a rewind that changes only a flag resends that row only', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    flags[4] = 1;
    feed.rewind(world, STATICS, LATE);
    const d = feed.take(world, STATICS, LATE)!;
    expect(d.rows).toBe(5);
    expect(rowsOf(d).map((r) => [r.row, r.flags])).toEqual([[4, 1]]);
  });

  it('a rewind that changes only a day resends that row only', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    const restored = structuredClone(world);
    restored.projects.entered[4 * NS + STAGE_ORDER.indexOf('construction')] = 20_310;
    feed.rewind(restored, STATICS, LATE);
    const d = feed.take(restored, STATICS, LATE)!;
    expect(rowsOf(d).map((r) => [r.row, r.started])).toEqual([[4, 20_310]]);
  });

  it('a rewind that only removes rows, with nothing else pending, sends from = rows = n and no marker', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    const restored = structuredClone(world);
    restored.projects.n = 2;
    feed.rewind(restored, STATICS, LATE);
    expect(feed.pending()).toBe(true);
    const d = feed.take(restored, STATICS, LATE)!;
    expect(d.rows).toBe(2);
    expect(d.from).toBe(2);
    expect(d.row).toHaveLength(0);
    expect(feed.take(restored, STATICS, LATE)).toBeNull();
  });

  it('rows re-created between the rewind and the take: the floor goes out and the page matches a snapshot', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    const page = new FakeController();
    page.apply({
      revision: 0,
      cells: [],
      removedCells: [],
      demolish: [],
      city: feed.snapshot(world, STATICS, LATE)
    });
    expect(page.markers.has(4)).toBe(true);
    // restored to 4 rows; the refill then re-creates row 4 with no T11 lot (touched) and row 5
    // on L1 that no event has touched yet, before the first flush
    const restored = structuredClone(world);
    restored.projects.n = 4;
    feed.rewind(restored, STATICS, LATE);
    const r4 = simRow(restored, 3);
    enter(restored, r4, 'filed', 20_700);
    const r5 = simRow(restored, 1);
    enter(restored, r5, 'filed', 20_800);
    pushRev(restored.projects, r5, 20_800, 9, 2);
    anchors[4] = null;
    anchors[5] = 'L1';
    feed.touch(r4);
    const d = feed.take(restored, STATICS, LATE)!;
    expect(d.from).toBe(4);
    expect(d.rows).toBe(6);
    expect(Array.from(d.row)).toEqual([5]);
    page.apply({ revision: 1, cells: [], removedCells: [], demolish: [], city: d });
    expect(page.markers.has(4)).toBe(false);
    const fresh = feedOf(anchors, flags).snapshot(restored, STATICS, LATE);
    expect(page.markers).toEqual(markersOf(fresh));
    expect(feed.take(restored, STATICS, LATE)).toBeNull();
  });

  it('a surviving row whose marker becomes null after a rewind is withdrawn: the floor drops to it', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    const page = new FakeController();
    page.apply({
      revision: 0,
      cells: [],
      removedCells: [],
      demolish: [],
      city: feed.snapshot(world, STATICS, LATE)
    });
    expect(page.markers.has(1)).toBe(true);
    // Same rows; row 1 loses its T11 lot (a future re-split, say).
    anchors[1] = null;
    feed.rewind(world, STATICS, LATE);
    const d = feed.take(world, STATICS, LATE)!;
    expect(d.from).toBe(1);
    expect(d.rows).toBe(5);
    // Every row past the floor that still has a marker is resent.
    expect(Array.from(d.row)).toEqual([4]);
    page.apply({ revision: 1, cells: [], removedCells: [], demolish: [], city: d });
    expect(page.markers.has(1)).toBe(false);
    expect(page.markers).toEqual(markersOf(feedOf(anchors, flags).snapshot(world, STATICS, LATE)));
    expect(feed.take(world, STATICS, LATE)).toBeNull();
    // The row coming back later is sent again (it is no longer held as sent).
    anchors[1] = 'L1';
    feed.touch(1);
    expect(Array.from(feed.take(world, STATICS, LATE)!.row)).toEqual([1]);
  });

  it('two rewinds before one take keep the lower floor', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    const low = structuredClone(world);
    low.projects.n = 2;
    feed.rewind(low, STATICS, LATE);
    const high = structuredClone(world);
    high.projects.n = 4;
    feed.rewind(high, STATICS, LATE);
    const d = feed.take(high, STATICS, LATE)!;
    expect(d.from).toBe(2);
    expect(d.rows).toBe(4);
    // rows 2 and 3 have no lot: nothing to resend past the floor
    expect(Array.from(d.row)).toEqual([]);
    // and the other order
    const again = feedOf(anchors, flags);
    again.snapshot(world, STATICS, LATE);
    again.rewind(high, STATICS, LATE);
    again.rewind(low, STATICS, LATE);
    expect(again.take(low, STATICS, LATE)!.from).toBe(2);
  });

  it('a take with no rewind before it carries no from', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    pushRev(world.projects, 1, 20_400, 31, 4);
    feed.touch(1);
    expect(feed.take(world, STATICS, LATE)!.from).toBeUndefined();
    expect(feed.snapshot(world, STATICS, LATE).from).toBeUndefined();
  });

  it('a rewind drops pending touches of rows past n', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    feed.touch(4);
    const restored = structuredClone(world);
    restored.projects.n = 4;
    feed.rewind(restored, STATICS, LATE);
    const d = feed.take(restored, STATICS, LATE)!;
    expect(d.rows).toBe(4);
    expect(d.row).toHaveLength(0);
  });

  it('a rewind that changes nothing and keeps n leaves nothing pending', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.snapshot(world, STATICS, LATE);
    feed.rewind(structuredClone(world), STATICS, LATE);
    expect(feed.pending()).toBe(false);
    expect(feed.take(world, STATICS, LATE)).toBeNull();
  });

  it('snapshot supersedes pending touches', () => {
    const { world, anchors, flags } = little();
    const feed = feedOf(anchors, flags);
    feed.touch(0);
    feed.touch(4);
    const d = feed.snapshot(world, STATICS, LATE);
    expect(Array.from(d.row)).toEqual([0, 1, 4]);
    expect(feed.pending()).toBe(false);
    expect(feed.take(world, STATICS, LATE)).toBeNull();
  });

  it('on a fixture world stepped to the horizon, every marker equals scheduleAt of its row', async () => {
    const input = await fixtureInput();
    const statics = staticsOf(input);
    const H = horizonMonth(input.asOf);
    const world = runWorld(statics, oneFrame(frameOf(input)), 1, H);
    const P = input.parcels;
    const anchorOf = (row: number) => cellAnchorParcel(rowParcelIds(world, statics, row), P);
    const feed = createCityFeed({
      parcels: P,
      anchorOf: (_w, _st, row) => anchorOf(row),
      flagsOf: () => 0
    });
    const day = monthLastDay(statics.asOf, world.month);
    const d = feed.snapshot(world, statics, day);
    validateCityDelta(d);
    expect(d.rows).toBe(world.projects.n);
    const want: number[] = [];
    for (let row = 0; row < world.projects.n; row++) if (anchorOf(row) !== null) want.push(row);
    expect(want.length).toBeGreaterThan(0);
    expect(Array.from(d.row)).toEqual(want);
    let completed = 0;
    for (const m of rowsOf(d)) {
      const s = scheduleAt(world, statics, m.row, day);
      const at = P.index.get(anchorOf(m.row)!)!;
      expect([m.lng, m.lat]).toEqual([f32(P.labelPoint[2 * at]), f32(P.labelPoint[2 * at + 1])]);
      const e = s?.entered ?? {};
      const approved = Math.min(e.entitled ?? Infinity, e.permitIssued ?? Infinity);
      const done = s?.end.kind === 'complete' ? s.end.day : NaN;
      if (!Number.isNaN(done)) completed++;
      expect([m.approved, m.started, m.completed]).toEqual([
        approved === Infinity ? NaN : approved,
        e.construction ?? NaN,
        done
      ]);
      const units = s === null ? 0 : (s.revisions.at(-1)?.units ?? 0);
      expect(m.homes).toBe(Math.min(65_535, Math.max(0, units)));
    }
    expect(completed).toBeGreaterThan(0);
  });
});
