import type { Day } from '$lib/timelapse/time';

import type { GoalOutcome } from '$lib/timeline/outcome';

export type Level = 1 | 2 | 3 | 4 | 5;
export const LAST_LEVEL: Level = 5;

/** What the months reached so far show: `{ kind: 'reached'; on }` or `{ kind: 'missed'; short }`. */
export type Result = GoalOutcome;

/** The result to beat: the day a banked result reached the goal. */
export interface Bar {
  on: Day;
}

/**
 * True when `seen` reached the goal and `seen.on` is in an earlier calendar month than `bar.on`.
 * False in every other case: a tie never beats, and a missed result never beats.
 */
export function beats(seen: Result, bar: Bar): boolean {
  void seen;
  void bar;
  throw new Error('not implemented');
}

/** Paint is won: capacity is at least the goal's amount. */
export function paintWon(net: number, amount: number): boolean {
  void net;
  void amount;
  throw new Error('not implemented');
}
