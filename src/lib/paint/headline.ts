/**
 * Paint's header headline: the room the painted plan makes, as /sim's two-line header reads it.
 * Line 1 is the capacity ('Room for 47,335 homes'); line 2 its share of the goal. Undated: room
 * for homes has no clock.
 */
import { GOAL_BASE, goalAmountName, type GoalBase } from '$lib/goal/goal';
import { formatCompactCount, formatCount, formatPercent } from '$lib/scoreboard';
import type { HeadlineText } from '$lib/timeline/results';

/** From this count the number is compact, so the row fits a phone beside "Autosave off". */
const COMPACT_FROM = 1_000_000;

/** 'Room for 47,335 homes'; from 1,000,000 'Room for 1.2M homes'. */
export function roomFor(net: number): string {
  return `Room for ${net >= COMPACT_FROM ? formatCompactCount(net) : formatCount(net)} homes`;
}

/**
 * '57% of the goal' | 'Goal reached' (net at or over the amount); null when the goal's measure
 * is not a count of homes.
 */
export function capacityGoalText(net: number, goal: GoalBase = GOAL_BASE): string | null {
  if (goal.measure.id !== 'homesCompleted') return null;
  return net >= goal.amount ? 'Goal reached' : `${formatPercent(net / goal.amount)} of the goal`;
}

export function paintHeadline(net: number, goal: GoalBase = GOAL_BASE): HeadlineText {
  const goalPart = capacityGoalText(net, goal);
  return {
    main: roomFor(net),
    effect: null,
    goal: goalPart,
    goalName: goalPart === null ? null : goalAmountName(goal)
  };
}
