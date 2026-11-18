// What the furthest date reached says of the goal: met by the deadline, or passed unmet (pure,
// browser-safe). Read over the months reached, so it never speaks of a month not yet seen.
import { formatShortMonthYear } from '$lib/fzp/format';
import { TODAY, goalStep, type Goal } from '$lib/goal/goal';
import { formatCount } from '$lib/scoreboard/format';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { indexOfDay } from './playhead';

export type GoalOutcome = { kind: 'reached'; on: Day } | { kind: 'missed'; short: number };

/**
 * What the furthest date reached says of the goal. Null when goalStep(goal, view) is null
 * (deadline outside the window) or the view does not cover the months read. Reached: the first
 * month in [today, min(m, deadline month)] whose measure meets the amount, m the month of
 * `reached` (TODAY at or before `asOf`). Missed: `reached` is past goal.deadline and the amount
 * was not met by it; short = goal.amount - the measure at the deadline month. One pass over the
 * rows, so it reads at most the deadline month + 1 of them.
 */
export function goalOutcome(
  goal: Goal,
  view: TimelineView | null,
  reached: Day,
  asOf: Day
): GoalOutcome | null {
  if (!view) return null;
  const step = goalStep(goal, view);
  if (!step) return null;
  const m = reached <= asOf ? TODAY : indexOfDay(view.months, reached);
  const at = Math.min(m, step.deadlineIndex);
  const pastDeadline = reached > goal.deadline;
  if (at > view.filledThrough || (pastDeadline && step.deadlineIndex > view.filledThrough)) {
    return null;
  }
  let value = 0;
  for (let i = TODAY; i <= at; i++) {
    value = goal.measure.valueAt(view, i);
    if (value >= goal.amount) return { kind: 'reached', on: view.months[i === TODAY ? 0 : i] };
  }
  // Passed the deadline unmet: `at` is the deadline month, so `value` is the measure there.
  return pastDeadline ? { kind: 'missed', short: goal.amount - value } : null;
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
