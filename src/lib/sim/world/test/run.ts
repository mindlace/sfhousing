// Test support: running a world to a month, recording its events, and reading every row as
// today's engine lists them. Browser-safe.
import { HORIZON } from '$lib/fzp/time';
import type { Master } from '$lib/sim/scenario/simulate';
import type { Schedule } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { planDue } from '../due';
import { monthOfDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import { masterAt, scheduleAt } from '../read';
import type { Statics } from '../statics';
import type { StepSink, World, WorldEvent } from '../types';
import { createWorld, step } from '../world';

export const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
export const LIVE_SEEDS = Array.from({ length: 5 }, (_, i) => i + 1);

/** The model month holding `HORIZON`. */
export function horizonMonth(asOf: Day): number {
  return monthOfDay(asOf, HORIZON);
}

/** Every event with the month of the call that sent it (0 during `createWorld`). */
export class Recorder implements StepSink {
  events: (WorldEvent & { month: number })[] = [];
  month = 0;
  event(e: WorldEvent): void {
    this.events.push({ ...e, month: this.month });
  }
}

const NOWHERE: StepSink = { event() {} };

/**
 * Creates a world and steps it through month `through` with a due list planned once (or rebuilt
 * every `rebuildEvery` months). A `Recorder` gets each call's month before the call.
 */
export function runWorld(
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number,
  out: StepSink = NOWHERE,
  opts: {
    rebuildEvery?: number;
    plan?: typeof planDue;
    step?: typeof step;
    create?: typeof createWorld;
  } = {}
): World {
  const plan = opts.plan ?? planDue;
  const stepOf = opts.step ?? step;
  const create = opts.create ?? createWorld;
  if (out instanceof Recorder) out.month = 0;
  const w = create(statics, timeline, seed, out);
  let due = plan(w, statics, timeline, seed, through);
  for (let m = 1; m <= through; m++) {
    if (opts.rebuildEvery && m > 1 && (m - 1) % opts.rebuildEvery === 0) {
      due = plan(w, statics, timeline, seed, through);
    }
    if (out instanceof Recorder) out.month = m;
    stepOf(w, due, statics, timeline, seed, out);
  }
  return w;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every row read on `day`, ordered as `simulateDetailed` orders them (simulate.ts:49-52). */
export function readAll(
  world: World,
  statics: Statics,
  day: Day
): { schedules: Schedule[]; masters: Master[] } {
  const pipeline: Schedule[] = [];
  const simulated: Schedule[] = [];
  const masters: Master[] = [];
  for (let row = 0; row < world.projects.n; row++) {
    const m = masterAt(world, statics, row, day);
    if (m) {
      masters.push(m);
      continue;
    }
    const s = scheduleAt(world, statics, row, day);
    if (s) (s.origin === 'pipeline' ? pipeline : simulated).push(s);
  }
  pipeline.sort((a, b) => cmp(a.projectId, b.projectId));
  simulated.sort((a, b) => cmp(a.projectId, b.projectId));
  masters.sort((a, b) => cmp(a.masterId, b.masterId));
  return { schedules: [...pipeline, ...simulated], masters };
}
