// map-stream's updates fed to the real `TimelineController` (spec test 3).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeTimelineDeps, type FakeTimelineDeps } from '$lib/map/test/fake-timeline-deps';
import { TimelineController } from '$lib/map/timeline-controller';
import { createMapStream } from './map-stream';
import { monthLastDay, planDue, scheduleAt, staticsOf, type Statics } from '.';
import type { PolicyTimeline } from './policy/frame';
import { benchInput } from './test/cities.node';
import { benchRecords } from './test/map-stream-cities.node';
import { streamDeps } from './test/map-stream-deps';
import { fill, startStream } from './test/map-stream-run';
import { Recorder, runWorld } from './test/run';
import { frameOf, oneFrame } from './test/timeline';
import { ORIGIN_SIM } from './types';
import type { SimInput } from '$lib/sim/scenario/types';
import type { ParcelRecord } from '$lib/data/parcel';

const SEED = 1;
const WINDOW = 480;

let input: SimInput;
let statics: Statics;
let timeline: PolicyTimeline;
let records: ParcelRecord[];

beforeAll(() => {
  input = benchInput();
  statics = staticsOf(input);
  timeline = oneFrame(frameOf(input));
  records = benchRecords();
});

let deps: FakeTimelineDeps;
beforeEach(() => {
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

describe('map-stream with the real controller', () => {
  it('with the real controller, the existing building is hidden from the construction day', () => {
    // a sim lot whose first construction starts after month 1 (bench city, seed 1)
    const rec = new Recorder();
    const pre = runWorld(statics, timeline, SEED, 120, rec);
    const lotOf = (row: number) => statics.parcelId[pre.projects.src[row]];
    const lastDay = monthLastDay(statics.asOf, pre.month);
    const built = new Set<string>(); // every lot a project has entered construction on
    let hit: { lot: string; month: number; day: number } | null = null;
    for (const e of rec.events) {
      if (e.kind !== 'enter' || e.stage !== 'construction') continue;
      const sim = pre.projects.origin[e.row] === ORIGIN_SIM;
      if (
        sim &&
        e.month >= 2 &&
        input.parcels.index.has(lotOf(e.row)) &&
        !built.has(lotOf(e.row))
      ) {
        hit = { lot: lotOf(e.row), month: e.month, day: e.day };
        break;
      }
      for (const id of scheduleAt(pre, statics, e.row, lastDay)?.parcelIds ?? []) built.add(id);
    }
    expect(hit).not.toBeNull();
    const { lot, month, day } = hit!;

    const stream = createMapStream(streamDeps(input, records), WINDOW);
    const { world, sink } = startStream(statics, timeline, SEED, stream);
    const due = planDue(world, statics, timeline, SEED, WINDOW);
    const updates = [stream.flush(world, statics, Infinity)!];
    updates.push(
      ...fill({ world, statics, timeline, seed: SEED, stream, sink, due, through: month + 1 })
    );

    const c = new TimelineController(deps, 'light');
    for (const u of updates) c.apply(u);
    expect(deps.resyncCount).toBe(0);
    c.setTime(day - 1);
    deps.flushFrame();
    converge(c);
    expect(c.demolished.has(lot)).toBe(false);
    expect(deps.replaced.has(lot)).toBe(false);
    c.setTime(day);
    deps.flushFrame();
    converge(c);
    expect(c.demolished.has(lot)).toBe(true);
    expect(deps.replaced.has(lot)).toBe(true);
  });
});
