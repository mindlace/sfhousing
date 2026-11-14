// Test support: a world feeding a `MapStream`, stepped and flushed month by month. Browser-safe.
import type { ParcelId } from '$lib/data/parcel';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { validateTimedCell } from '$lib/map/timelapse/encode';
import type { Day } from '$lib/timelapse/time';
import { planDue } from '../due';
import type { MapStream } from '../map-stream';
import type { PolicyTimeline } from '../policy/frame';
import type { Statics } from '../statics';
import type { Due, StepSink, World, WorldEvent } from '../types';
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
 * A copy of `saved` as world 1 after an edit: `stream.rewind(copy, statics)`, then a due list for
 * `timeline` through `through`. The copy's events reach `stream` through the returned sink.
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
    out.push(u);
  }
  return out;
}

/**
 * Accepts revision 0 at any time, else only last + 1; throws otherwise. Folds cells, removals,
 * demolish and restore into `cells` and `demolished` (parcel → day), as the map does: revision 0
 * replaces both; later, `restore` drops a lot before `demolish` adds, and the earliest day wins.
 */
export class FakeController {
  cells = new Map<string, TimedPackedCell>();
  demolished = new Map<ParcelId, Day>();
  revision = -1;

  apply(u: TimelineUpdate): void {
    if (u.revision !== 0 && (this.revision < 0 || u.revision !== this.revision + 1)) {
      throw new Error(`FakeController: revision ${u.revision} after ${this.revision}`);
    }
    this.revision = u.revision;
    if (u.revision === 0) {
      this.cells.clear();
      this.demolished.clear();
    } else {
      for (const id of u.restore ?? []) this.demolished.delete(id);
    }
    for (const c of u.cells) this.cells.set(c.cellId, c);
    for (const id of u.removedCells) this.cells.delete(id);
    for (const d of u.demolish) {
      const held = this.demolished.get(d.parcelId);
      if (held === undefined || d.day < held) this.demolished.set(d.parcelId, d.day);
    }
  }
}
