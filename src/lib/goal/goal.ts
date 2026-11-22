/**
 * The goal the main screen reads, from one place: a name, a measure, an amount, a deadline and
 * the day the measure counts from. Its amount and start come from GOAL_BASE (RHNA's 82,069 homes,
 * counted from 30 Jun 2022); its deadline is the end of the model window (defaultGoal(asOf)).
 */
import { formatShortMonthYear } from '$lib/fzp/format';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { windowHorizon } from '$lib/sim/world/months';
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
  /** Display name: 'Goal'. */
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

/** A goal without its deadline: what stays fixed while the deadline follows the dataset date. */
export type GoalBase = Omit<Goal, 'deadline'>;

/** The goal's amount and start: RHNA's homes, counted from 30 Jun 2022. */
export const GOAL_BASE: GoalBase = {
  id: 'goal',
  name: 'Goal',
  measure: HOMES_COMPLETED,
  amount: RHNA_UNITS,
  countsFrom: dayFromUtc(2022, 6, 30)
};

/** GOAL_BASE due at the last whole calendar month of the model window from `asOf`. */
export function defaultGoal(asOf: Day): Goal {
  return { ...GOAL_BASE, deadline: windowHorizon(asOf, WINDOW_MONTHS) };
}

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

/** The month the goal reads for playhead month `i`: min(i, deadline month), TODAY when the
 *  deadline is before months[0]. */
function readMonth(goal: Goal, view: TimelineView, i: number): number {
  const deadline = monthOffset(goal.deadline, view.months[0]);
  return deadline < 0 ? TODAY : Math.min(i, deadline, view.lastIndex);
}

/** Null when `i` (or the month it must read) is past view.filledThrough. */
export function readGoal(goal: Goal, view: TimelineView, i: number): GoalReading | null {
  if (i > view.filledThrough) return null;
  const at = readMonth(goal, view, i);
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

/** 'Goal: 82,069 homes'. */
export function goalAmountName(goal: GoalBase): string {
  return `${goal.name}: ${formatCount(goal.amount)} ${goal.measure.unit}`;
}

/** 'Goal: 82,069 homes by Sep 2066'. */
export function goalName(goal: Goal): string {
  return `${goalAmountName(goal)} by ${formatShortMonthYear(goal.deadline)}`;
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

/** The buffer over the goal the state asks for: at least 15% more capacity. */
export const BUFFER_SHARE = 0.15;

/** floor(goal.amount × (1 + BUFFER_SHARE)): 94,379 for the goal (M1_TARGETS' buffer). */
export function bufferAmount(goal: GoalBase): number {
  return Math.floor(goal.amount * (1 + BUFFER_SHARE));
}

/** One goal row: the goal or its buffer, at one month (/sim) or over Paint's capacity. */
export interface GoalRowData {
  id: 'goal' | 'buffer';
  /** goal.name | `${goal.name} + 15%`. */
  label: string;
  amount: number;
  /** The measure the row reads. */
  value: number;
  /** value / amount, uncapped. */
  fraction: number;
  /** The remainder's suffix or note (goalRowNote); null on Paint. */
  note: string | null;
  /** The fraction at the deadline's month, shown only while the playhead is before it and the
   *  furthest month reached is at or past it; else null. */
  atDeadline: number | null;
}

/** 'by Jan 2031' before the deadline's month, 'Held at Jan 2031' from it on (and at today:
 *  'by …'); null without a deadline month. */
export function goalRowNote(
  goal: Goal,
  index: number,
  deadlineIndex: number | null,
  atToday: boolean
): string | null {
  if (deadlineIndex === null) return null;
  const date = formatShortMonthYear(goal.deadline);
  return atToday || index < deadlineIndex ? `by ${date}` : `Held at ${date}`;
}

/** 'At the deadline: 74%'. */
export const atDeadlineText = (fraction: number): string =>
  `At the deadline: ${formatPercent(fraction)}`;

/** The two rows' labels and amounts. */
function rowsOf(goal: GoalBase): { id: GoalRowData['id']; label: string; amount: number }[] {
  return [
    { id: 'goal', label: goal.name, amount: goal.amount },
    {
      id: 'buffer',
      label: `${goal.name} + ${Math.round(BUFFER_SHARE * 100)}%`,
      amount: bufferAmount(goal)
    }
  ];
}

/**
 * /sim's two rows at the playhead, under the header's rule: at today both read TODAY (so the
 * goal row is the header's percentage exactly); otherwise month min(index, deadline month). The
 * goal row's fraction is readGoal's. Null when readGoal is (month not filled).
 */
export function goalRows(
  goal: Goal,
  view: TimelineView,
  at: { index: number; atToday: boolean },
  reachedMonth: number
): GoalRowData[] | null {
  const i = at.atToday ? TODAY : at.index;
  const reading = readGoal(goal, view, i);
  if (!reading) return null;
  const value = goal.measure.valueAt(view, readMonth(goal, view, i));
  const deadline = monthOffset(goal.deadline, view.months[0]);
  // A deadline before the window has passed: the rows read today, so they claim no date.
  const note = goalRowNote(goal, at.index, deadline < 0 ? null : deadline, at.atToday);
  const preview =
    deadline >= 0 &&
    deadline <= view.filledThrough &&
    (at.atToday || at.index < deadline) &&
    reachedMonth >= deadline;
  const atDeadline = preview ? goal.measure.valueAt(view, deadline) : null;
  return rowsOf(goal).map((r) => ({
    ...r,
    value,
    fraction: r.id === 'goal' ? reading.fraction : value / r.amount,
    note,
    atDeadline: atDeadline === null ? null : atDeadline / r.amount
  }));
}

/**
 * The rows' shared track full-scale, as the scoreboard's trackMax reads targets:
 * max(1, ceil(largest fraction × 2) / 2). 1 for no rows.
 */
export function goalTrackMax(rows: readonly GoalRowData[]): number {
  const largest = Math.max(0, ...rows.map((r) => r.fraction));
  return Math.max(1, Math.ceil(largest * 2) / 2);
}

/** Paint's two rows: capacity `net` over each amount; no note, no atDeadline. */
export function capacityRows(net: number, goal: GoalBase = GOAL_BASE): GoalRowData[] {
  return rowsOf(goal).map((r) => ({
    ...r,
    value: net,
    fraction: net / r.amount,
    note: null,
    atDeadline: null
  }));
}
