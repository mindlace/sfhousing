// Test support: a world feeding a `MapStream`, stepped and flushed month by month. Browser-safe.
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { validateCityDelta } from '$lib/map/city-delta';
import {
  CITY_DAY,
  type CityDelta,
  type TimedPackedCell,
  type TimelineUpdate
} from '$lib/map/types';
import { validateTimedCell } from '$lib/map/timelapse/encode';
import { cellAnchorParcel } from '$lib/sim/world/massing';
import type { Day } from '$lib/timelapse/time';
import { planDue } from '../due';
import type { MapStream } from '../map-stream';
import type { PolicyTimeline } from '../policy/frame';
import type { Statics } from '../statics';
import {
  ORIGIN_PHASE,
  ORIGIN_PIPELINE,
  ORIGIN_SIM,
  type Due,
  type StepSink,
  type World,
  type WorldEvent
} from '../types';
import { createWorld, step } from '../world';

/**
 * Passes each event to `stream.onEvent`. `createWorld` sends events before the world exists, so
 * they are buffered until `attach(world)` and then replayed in order.
 */
export class StreamSink implements StepSink {
  private world: World | null = null;
  private buffered: WorldEvent[] = [];
  constructor(
    private readonly stream: MapStream,
    private readonly statics: Statics
  ) {}
  event(e: WorldEvent): void {
    if (this.world) this.stream.onEvent(e, this.world, this.statics);
    else this.buffered.push(e);
  }
  attach(world: World): void {
    this.world = world;
    const out = this.buffered;
    this.buffered = [];
    for (const e of out) this.stream.onEvent(e, world, this.statics);
  }
}

/** Creates a world whose events (those of `createWorld` included) reach `stream`. */
export function startStream(
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  stream: MapStream
): { world: World; sink: StreamSink } {
  const sink = new StreamSink(stream, statics);
  const world = createWorld(statics, timeline, seed, sink);
  sink.attach(world);
  return { world, sink };
}

/**
 * A copy of `saved` as the plan's world after an edit: `stream.rewind(copy, statics)`, then a due
 * list for `timeline` through `through`. The copy's events reach `stream` through the returned
 * sink.
 */
export function rewindTo(
  saved: World,
  o: {
    statics: Statics;
    timeline: PolicyTimeline;
    seed: number;
    stream: MapStream;
    through: number;
  }
): { world: World; due: Due; sink: StreamSink } {
  const world = structuredClone(saved);
  o.stream.rewind(world, o.statics);
  const sink = new StreamSink(o.stream, o.statics);
  sink.attach(world);
  const due = planDue(world, o.statics, o.timeline, o.seed, o.through);
  return { world, due, sink };
}

/**
 * Steps `world` through month `through`, flushing every `flushEvery` months (default 1) and after
 * the last, with `budgetMs` (default Infinity). Returns the non-null updates, each of whose cells
 * has passed `validateTimedCell`. The due list is `due`, else `planDue(…, through)`.
 */
export function fill(o: {
  world: World;
  statics: Statics;
  timeline: PolicyTimeline;
  seed: number;
  stream: MapStream;
  sink: StreamSink;
  through: number;
  flushEvery?: number;
  budgetMs?: number;
  due?: Due;
}): TimelineUpdate[] {
  const { world, statics, timeline, seed, stream, sink, through } = o;
  const every = o.flushEvery ?? 1;
  const budget = o.budgetMs ?? Infinity;
  const due = o.due ?? planDue(world, statics, timeline, seed, through);
  const out: TimelineUpdate[] = [];
  const from = world.month;
  while (world.month < through) {
    step(world, due, statics, timeline, seed, sink);
    if ((world.month - from) % every !== 0 && world.month !== through) continue;
    const u = stream.flush(world, statics, budget);
    if (u === null) continue;
    for (const c of u.cells) validateTimedCell(c);
    if (u.city) validateCityDelta(u.city);
    out.push(u);
  }
  return out;
}

/** One citywide marker as the page holds it (a row of `CityDelta`). */
export interface CityMarker {
  lng: number;
  lat: number;
  approved: number;
  started: number;
  completed: number;
  homes: number;
  existing: number;
  flags: number;
}

/** The delta's rows as markers, after `validateCityDelta`. */
export function markersOf(d: CityDelta): Map<number, CityMarker> {
  validateCityDelta(d);
  const out = new Map<number, CityMarker>();
  d.row.forEach((row, i) =>
    out.set(row, {
      lng: d.lngLat[2 * i],
      lat: d.lngLat[2 * i + 1],
      approved: d.days[3 * i + CITY_DAY.approved],
      started: d.days[3 * i + CITY_DAY.started],
      completed: d.days[3 * i + CITY_DAY.completed],
      homes: d.homes[i],
      existing: d.existing[i],
      flags: d.flags[i]
    })
  );
  return out;
}

/** The T11 parcel ids of `row` from the statics (as map-stream's `parcelIdsOf`); [] for a master. */
export function rowParcelIds(world: World, statics: Statics, row: number): ParcelId[] {
  const p = world.projects;
  const o = p.origin[row];
  if (o === ORIGIN_SIM) return [statics.parcelId[p.src[row]]];
  if (o === ORIGIN_PIPELINE) return statics.projects[p.src[row]].parcelIds;
  if (o === ORIGIN_PHASE) return statics.projects[p.src[row]].phases![p.sub[row] - 1].parcelIds;
  return [];
}

/** The rows of `world` with a T11 lot: those with a citywide marker, ascending. */
export function anchoredRows(world: World, statics: Statics, parcels: ScenarioParcels): number[] {
  const out: number[] = [];
  for (let row = 0; row < world.projects.n; row++) {
    if (cellAnchorParcel(rowParcelIds(world, statics, row), parcels) !== null) out.push(row);
  }
  return out;
}

/**
 * Accepts revision 0 at any time, else only last + 1; throws otherwise. Folds cells, removals,
 * demolish and restore into `cells` and `demolished` (parcel → day), as the map does: revision 0
 * replaces both; later, `restore` drops a lot before `demolish` adds, and the earliest day wins.
 * `markers` folds `city` as the page will: revision 0 replaces them (none without `city`); later
 * updates forget markers at or past `from` (when present) and `rows`, then write the rows they
 * carry.
 */
export class FakeController {
  cells = new Map<string, TimedPackedCell>();
  demolished = new Map<ParcelId, Day>();
  markers = new Map<number, CityMarker>();
  revision = -1;

  apply(u: TimelineUpdate): void {
    if (u.revision !== 0 && (this.revision < 0 || u.revision !== this.revision + 1)) {
      throw new Error(`FakeController: revision ${u.revision} after ${this.revision}`);
    }
    this.revision = u.revision;
    if (u.revision === 0) {
      this.cells.clear();
      this.demolished.clear();
      this.markers.clear();
    } else {
      for (const id of u.restore ?? []) this.demolished.delete(id);
    }
    if (u.city) {
      const floor = Math.min(u.city.rows, u.city.from ?? Infinity);
      for (const row of [...this.markers.keys()]) if (row >= floor) this.markers.delete(row);
      for (const [row, m] of markersOf(u.city)) this.markers.set(row, m);
    }
    for (const c of u.cells) this.cells.set(c.cellId, c);
    for (const id of u.removedCells) this.cells.delete(id);
    for (const d of u.demolish) {
      const held = this.demolished.get(d.parcelId);
      if (held === undefined || d.day < held) this.demolished.set(d.parcelId, d.day);
    }
  }
}
