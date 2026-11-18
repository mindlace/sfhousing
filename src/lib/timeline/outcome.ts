// What the furthest date reached says of the goal: met by the deadline, or passed unmet (pure,
// browser-safe). Read over the months reached, so it never speaks of a month not yet seen.
import { formatShortMonthYear } from '$lib/fzp/format';
import { TODAY, goalStep, readGoal, type Goal } from '$lib/goal/goal';
import { formatCount } from '$lib/scoreboard/format';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { indexOfDay } from './playhead';

export type GoalOutcome = { kind: 'reached'; on: Day } | { kind: 'missed'; short: number };

/**
 * The goal has a step in this view but the view does not yet cover the months read (a refill is
 * under way): an outcome null for this reason is not an answer, so a caller holds the last one.
 */
export function awaitsView(
  goal: Goal,
  view: TimelineView | null,
  reached: Day,
  asOf: Day
): boolean {
  if (!view) return false;
  const step = goalStep(goal, view);
  if (!step) return false;
  const at = Math.min(monthReached(view, reached, asOf), step.deadlineIndex);
  return (
    at > view.filledThrough || (reached > goal.deadline && step.deadlineIndex > view.filledThrough)
  );
}

/** The month of `reached` in the view (TODAY at or before `asOf`). */
function monthReached(view: TimelineView, reached: Day, asOf: Day): number {
  return reached <= asOf ? TODAY : indexOfDay(view.months, reached);
}

/**
 * What the furthest date reached says of the goal. Null when goalStep(goal, view) is null
 * (deadline outside the window) or the view does not cover the months read (`awaitsView`).
 * Reached: `readGoal(goal, view, min(m, deadline month)).reachedOn`, m the month of `reached`
 * (TODAY at or before `asOf`), so it agrees with the header's "Goal reached". Missed: `reached` is
 * past goal.deadline and the amount was not met by it; short = goal.amount - the measure at the
 * deadline month. Reads the rows up to the deadline month, plus a few repeat reads.
 */
export function goalOutcome(
  goal: Goal,
  view: TimelineView | null,
  reached: Day,
  asOf: Day
): GoalOutcome | null {
  if (!view || !goalStep(goal, view) || awaitsView(goal, view, reached, asOf)) return null;
  const step = goalStep(goal, view)!;
  const at = Math.min(monthReached(view, reached, asOf), step.deadlineIndex);
  const reading = readGoal(goal, view, at);
  if (reading === null) return null;
  if (reading.reachedOn !== null) return { kind: 'reached', on: reading.reachedOn };
  if (reached <= goal.deadline) return null;
  return { kind: 'missed', short: goal.amount - goal.measure.valueAt(view, step.deadlineIndex) };
}

/** 'Goal reached in Mar 2029, by the Jan 2031 deadline.' | 'Goal missed by 3,313 homes. …' */
export function outcomeText(o: GoalOutcome, goal: Goal, inForce: boolean): string {
  if (o.kind === 'reached') {
    return `Goal reached in ${formatShortMonthYear(o.on)}, by the ${formatShortMonthYear(goal.deadline)} deadline.`;
  }
  const step = inForce ? 'Change the policy' : 'Add a policy';
  return `Goal missed by ${formatCount(o.short)} ${goal.measure.unit}. ${step} and play again.`;
}

/** 'reached:{on}' | 'missed:{short}': one notice per distinct outcome per visit. */
export function outcomeKey(o: GoalOutcome): string {
  return o.kind === 'reached' ? `reached:${o.on}` : `missed:${o.short}`;
}
