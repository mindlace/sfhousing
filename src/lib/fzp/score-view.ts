/**
 * The time-aware scoreboard as pure functions of a T8 `TimelineScore` and a month index
 * (spec §4.5). No DOM, no state: the components read these on every frame, so each is O(1) in
 * project count.
 */
import { formatCount } from '$lib/scoreboard';
import type { TimelineScore } from '$lib/sim/protocol';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import { formatShortMonthYear } from './format';
import { monthIndex } from './time';
import type { ScoreAt } from './types';
import { CALCULATING } from './copy';

export { CALCULATING };

type OpenStage = Exclude<Stage, 'complete'>;

/** Stages that can hold in-progress units, in T2 order. */
const OPEN_STAGES: OpenStage[] = STAGE_ORDER.filter((s): s is OpenStage => s !== 'complete');

/** The month index of `deadline` in the score's monthly series. */
export function deadlineIndex(score: TimelineScore, deadline: Day): number {
  return monthIndex(deadline, score.months[0], score.months.length);
}

/** The scoreboard at month index `i`. */
export function scoreAt(score: TimelineScore, i: number): ScoreAt {
  const shown = score.shown[i];
  const base = score.baseline.completedNet;
  const plan = score.planEffect[i];
  return {
    monthIndex: i,
    total: base + shown.completedNet,
    actual: base,
    pipeline: shown.completedNetPipeline,
    fresh: shown.completedNetNew,
    planCompleted: plan ? plan.completedNetNew : null,
    planEntitled: plan ? plan.entitledNew : null,
    inProgress: OPEN_STAGES.map((stage) => ({ stage, units: shown.inProgress[stage] })),
    exitedUnits: shown.exitedUnits,
    targets: score.targets.map((t) => ({
      tp: { target: t.target, fraction: t.fraction[i] },
      atDeadline: t.fraction[deadlineIndex(score, t.deadline)]
    }))
  };
}

/** The /sim header delta: "+1,234 from your policy", "−56 from your policy" (U+2212), "+0 …". */
export function fromPolicyText(n: number): string {
  return `${n < 0 ? '' : '+'}${formatCount(n)} from your policy`;
}

/** The header score's delta: "vs FZP +1,234", "vs FZP −56" (U+2212), "vs FZP +0". */
export function vsFzpText(n: number): string {
  return `vs FZP ${n < 0 ? '' : '+'}${formatCount(n)}`;
}

/** '15,234 homes built from Jun 2022 count toward the goal.' */
export function builtTowardGoalText(baseline: TimelineScore['baseline']): string {
  return `${formatCount(baseline.completedNet)} homes built from ${formatShortMonthYear(baseline.since)} count toward the goal.`;
}
