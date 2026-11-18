/**
 * The goal the main screen reads, from one place: a name, a measure, an amount, a deadline and
 * the day the measure counts from. Built today from the state housing target.
 */
import { formatShortMonthYear } from '$lib/fzp/format';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import { RHNA_DEADLINE } from '$lib/sim/scenario/score';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';

/** The month index meaning "at the dataset date", before any simulated month. */
export const TODAY = -1;

export interface GoalMeasure {
  /** Only 'homesCompleted' today; a later measure adds its own id. */
  id: 'homesCompleted';
  /** The amount's unit in the goal's name: 'homes'. */
  unit: string;
  /**
   * The measure at the end of calendar month i of `view` (0 <= i <= view.filledThrough), or at
   * the dataset date for i === TODAY, counted from the goal's `countsFrom`.
   */
  valueAt(view: TimelineView, i: number): number;
}

export interface Goal {
  id: string;
  /** Display name: 'State target'. */
  name: string;
  measure: GoalMeasure;
  amount: number;
  deadline: Day;
  /** The day the measure counts from (the dataset's baseline.since must match). */
  countsFrom: Day;
}

/** baseline.completedNet + (i === TODAY ? 0 : rows[i].completedNet). */
export const HOMES_COMPLETED: GoalMeasure = {
  id: 'homesCompleted',
  unit: 'homes',
  valueAt: (view, i) => view.baseline.completedNet + (i === TODAY ? 0 : view.rows[i].completedNet)
};

const RHNA_UNITS = M1_TARGETS.find((t) => t.id === 'rhna')!.units;

/** The state housing target: RHNA 2023-2031, counted from 30 Jun 2022. */
export const STATE_TARGET: Goal = {
  id: 'state-target',
  name: 'State target',
  measure: HOMES_COMPLETED,
  amount: RHNA_UNITS,
  deadline: RHNA_DEADLINE,
  countsFrom: dayFromUtc(2022, 6, 30)
};

/** The goal in force. The main screen reads this, never STATE_TARGET or a target id. */
export const GOAL: Goal = STATE_TARGET;

export interface GoalReading {
  /** valueAt(at) / amount, uncapped, where at = min(i, deadline month); TODAY when the deadline
   *  is before months[0]. */
  fraction: number;
  /** months[m] for the first m in [TODAY, at] whose value reaches the amount (TODAY reads as
   *  months[0]); null when none does. */
  reachedOn: Day | null;
}

/** The raw month offset of `day` from `month0` (not clamped). */
function monthOffset(day: Day, month0: Day): number {
  const a = utcParts(day);
  const b = utcParts(month0);
  return (a.y - b.y) * 12 + (a.m - b.m);
}

/** Null when `i` (or the month it must read) is past view.filledThrough. */
export function readGoal(goal: Goal, view: TimelineView, i: number): GoalReading | null {
  if (i > view.filledThrough) return null;
  const deadline = monthOffset(goal.deadline, view.months[0]);
  const at = deadline < 0 ? TODAY : Math.min(i, deadline, view.lastIndex);
  const value = goal.measure.valueAt(view, at);
  let reachedOn: Day | null = null;
  for (let m = TODAY; m <= at; m++) {
    if (goal.measure.valueAt(view, m) >= goal.amount) {
      reachedOn = view.months[m === TODAY ? 0 : m];
      break;
    }
  }
  return { fraction: value / goal.amount, reachedOn };
}

/** '68% of the goal' (formatPercent) | 'Goal reached, Mar 2029'. */
export function goalText(r: GoalReading): string {
  return r.reachedOn === null
    ? `${formatPercent(r.fraction)} of the goal`
    : `Goal reached, ${formatShortMonthYear(r.reachedOn)}`;
}

/** 'State target: 82,069 homes by Jan 2031'. */
export function goalName(goal: Goal): string {
  return `${goal.name}: ${formatCount(goal.amount)} ${goal.measure.unit} by ${formatShortMonthYear(goal.deadline)}`;
}

/**
 * The homes chart's step: { deadlineIndex, units: amount - valueAt(view, TODAY) }. Null when the
 * measure is not 'homesCompleted' or the deadline's month is outside [0, view.lastIndex].
 */
export function goalStep(
  goal: Goal,
  view: TimelineView
): { deadlineIndex: number; units: number } | null {
  if (goal.measure.id !== 'homesCompleted') return null;
  const deadlineIndex = monthOffset(goal.deadline, view.months[0]);
  if (deadlineIndex < 0 || deadlineIndex > view.lastIndex) return null;
  return { deadlineIndex, units: goal.amount - goal.measure.valueAt(view, TODAY) };
}
