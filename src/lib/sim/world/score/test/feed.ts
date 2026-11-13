// Test support: feeding one world's events to a `WorldSeries` in each order the runner may use.
// Browser-safe.
import type { SimInput } from '$lib/sim/scenario/types';
import { createWorld, planDue, step } from '../../index';
import type { PolicyTimeline } from '../../policy/frame';
import type { Statics } from '../../statics';
import { frameOf, oneFrame } from '../../test/timeline';
import type { StepSink, World, WorldEvent } from '../../types';
import { scoreStaticsOf } from '../statics';
import type { ScoreStatics, WorldSeries, WorldSeriesData } from '../types';

/**
 * `live`: creation events added once `createWorld` returns, then each step's inside the sink.
 * `buffered`: each step's events added after the step. `after`: every event added against the
 * final world, month by month. Every mode calls `stepped(m)` after month m's events.
 */
export type FeedMode = 'live' | 'buffered' | 'after';

/** Score statics for `input` under one frame, compared with the plan. */
export function testStatics(input: SimInput, windowMonths: number): ScoreStatics {
  return scoreStaticsOf(input, oneFrame(frameOf(input)), 'plan', windowMonths, {
    units: 0,
    since: input.asOf,
    provenance: { tier: 0, label: 'test', sources: [], method: 'test' }
  });
}

/** Runs a world through month `through`, feeding `series` in `mode`; returns the world. */
export function feedWorld(
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number,
  series: WorldSeries,
  mode: FeedMode,
  opts: { saveAt?: number; onSave?: (d: WorldSeriesData) => void } = {}
): World {
  let world: World | null = null;
  let buffer: WorldEvent[] = [];
  const byMonth: WorldEvent[][] = [[]];
  let month = 0;
  let live = false;
  const sink: StepSink = {
    event(e) {
      if (mode === 'after') byMonth[month].push(e);
      else if (live) series.add(e, world!, statics);
      else buffer.push(e);
    }
  };
  const flush = () => {
    for (const e of buffer) series.add(e, world!, statics);
    buffer = [];
  };
  const stepped = (m: number) => {
    series.stepped(m);
    if (opts.saveAt === m) opts.onSave?.(series.data());
  };
  world = createWorld(statics, timeline, seed, sink);
  if (mode !== 'after') flush();
  live = mode === 'live';
  const due = planDue(world, statics, timeline, seed, through);
  for (let m = 1; m <= through; m++) {
    month = m;
    byMonth.push([]);
    step(world, due, statics, timeline, seed, sink);
    if (mode === 'buffered') flush();
    if (mode !== 'after') stepped(m);
  }
  if (mode === 'after') {
    for (let m = 0; m <= through; m++) {
      for (const e of byMonth[m]) series.add(e, world, statics);
      if (m > 0) stepped(m);
    }
  }
  return world;
}
