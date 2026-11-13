// The world at the dataset date and the month step (spec S2, rule 16). For now the step runs
// system 3 for projects only: lots, holds and starts come with the ordinary clock.
import { seedHash } from '$lib/sim/scenario/rng';
import { emptyWorld } from './columns';
import { monthLastDay } from './months';
import { createProjects, dueMonthOf, followProject, rowStaticsOf, type Sys3 } from './pipeline';
import type { PolicyTimeline } from './policy/frame';
import type { Statics } from './statics';
import type { Due, StepSink, World } from './types';

/** The world at month 0 under `timeline.frameAt(1)`, with the events already true at the dataset date. */
export function createWorld(
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink
): World {
  const frame = timeline.frameAt(1);
  const w = emptyWorld(frame.id);
  const x: Sys3 = {
    w,
    statics,
    timeline,
    frame,
    sh: seedHash(seed),
    out,
    rs: rowStaticsOf(statics, frame.view)
  };
  createProjects(x);
  return w;
}

/** Advances `world` in place by one model month (S2). */
export function step(
  world: World,
  due: Due,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink
): void {
  const month = world.month + 1;
  const ready = timeline.readyThrough();
  if (ready < month) throw new RangeError(`step: month ${month} is past readyThrough ${ready}`);
  const frame = timeline.frameAt(month);
  const asOf = statics.asOf;
  const lastDay = monthLastDay(asOf, month);
  const x: Sys3 = {
    w: world,
    statics,
    timeline,
    frame,
    sh: seedHash(seed),
    out,
    rs: rowStaticsOf(statics, timeline.frameAt(1).view)
  };
  const put = (row: number) => {
    const m = dueMonthOf(world, asOf, row);
    if (m > 0) due.put(-1 - row, m);
  };
  const entities = due.take(month);
  // System 3: projects (entity -1 - row) in ascending row order, the reverse of `take`'s order.
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e >= 0) continue;
    followProject(x, -1 - e, lastDay, put);
  }
  world.month = month;
  world.frame = frame.id;
}
