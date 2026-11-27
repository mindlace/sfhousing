// New wording for the timeline page (rule 38) and the explanation texts (rule 37).
// Imported by the components that render it. The public-money sentences are in `money-copy.ts`.
// Task 5's `CUSTOM_TIMING_LABEL` and `PRESET_PER_POLICY` live in `lens.ts`.

import { formatMonthYear, formatShortMonthYear } from '$lib/fzp/format';
import { SPEED_NAME } from '$lib/fzp/playback';
import { utcParts } from '$lib/fzp/time';
import type { Speed } from '$lib/fzp/types';
import { formatCount } from '$lib/scoreboard/format';
import type { Day } from '$lib/timelapse/time';
import { lensOf, type ChartLens } from './chart-lens';

export const capacityNote = (year: number): string => `Capacity in ${year}.`;
export const TWIN_NOTE = 'The forecast is run twice, with and without it.';

export const CHANGE_NOT_APPLIED = "That change couldn't be applied.";
export const UPDATING = 'Updating';
/** Behind UPDATING (rule 31). */
export const STALE_NOTE = 'From before your latest change.';
/** Behind UPDATING while Play waits at the computed edge for the forecast (rule 32). */
export const WAITING_NOTE = 'Working out the months ahead.';
/** OQ-4. */
export const DATES_MOVED_NOTICE = 'Some policy dates moved to fit this data.';

/** Under a policy's name when it does not run in this game. */
export const NOT_IN_GAME = 'Not in this game';

/** The ruler's flag at the goal's deadline. */
export const GOAL_FLAG = 'Goal';
/** Play's label when it offers to replay from an edit's first changed month. */
export const playFromText = (d: Day): string => `Play from ${utcParts(d).y}`;
/** The speed button's name: '1× speed, 1 year per second'. */
export const speedName = (s: Speed): string =>
  `${s === 'year' ? '1×' : '3×'} speed, ${SPEED_NAME[s]}`;

/** 'Seen up to June 2045. Goal deadline January 2031.', each part only when given. */
export function rulerDescription(seenTo: Day | null, deadline: Day | null): string {
  const parts: string[] = [];
  if (seenTo !== null) parts.push(`Seen up to ${formatMonthYear(seenTo)}.`);
  if (deadline !== null) parts.push(`Goal deadline ${formatMonthYear(deadline)}.`);
  return parts.join(' ');
}

/** The goal step's label in the chart: '73,346 more by Jan 2031'. */
export const goalNote = (units: number, deadline: Day): string =>
  `${formatCount(units)} more by ${formatShortMonthYear(deadline)}`;

/** The chart switch's radios in Details, by lens. */
export const LENS_NAME: Record<ChartLens, string> = {
  homes: 'Homes',
  source: 'By source',
  effect: 'From your policy'
};

/**
 * The chart's sr-only caption: what is drawn in the lens (through lensOf), the goal (its
 * remainder and deadline, the in-plot note's words, which are hidden from assistive tech) only
 * while its step is drawn; only the homes lens draws the goal.
 */
export function chartCaption(
  inForce: boolean,
  goal: { units: number; deadline: Day } | null,
  lens: ChartLens = 'homes'
): string {
  const slider = 'The month slider reads out each month.';
  const shown = lensOf(lens, inForce);
  if (shown === 'effect') return `Homes from your policy against current law, by month. ${slider}`;
  if (shown === 'source')
    return (
      "Homes completed from today, by month, and those from today's pipeline. The shaded gap is " +
      `new projects. ${slider}`
    );
  const needed = goal
    ? `the homes still needed by its deadline: ${goalNote(goal.units, goal.deadline)}.`
    : '';
  const drawn = goal ? `The goal is drawn as ${needed} ` : '';
  if (!inForce)
    return goal
      ? `Homes completed from today, by month, and the goal as ${needed} ${slider}`
      : `Homes completed from today, by month. ${slider}`;
  return (
    'Homes completed from today with your policy and under current law, by month. The shaded ' +
    `gap is what your policy adds. ${drawn}${slider}`
  );
}

/** 'Apr 2040'; at === null: 'today'. */
export const byWhen = (at: Day | null): string =>
  at === null ? 'today' : formatShortMonthYear(at);

/** '12,345 homes by Apr 2040'; at === null: '0 homes by today'. Negative counts use U+2212. */
export const homesBy = (n: number, at: Day | null): string =>
  `${formatCount(n)} homes by ${byWhen(at)}`;

/** Details' Cars row (car-ownership Task 12): its term. */
export const CARS_TERM = 'Cars';

/** The Cars row's value: today's cars alone at today, else '312,000 → 318,000'. */
export const carsValue = (r: { today: number; atPlayhead: number }, atToday: boolean): string =>
  atToday ? formatCount(r.today) : `${formatCount(r.today)} → ${formatCount(r.atPlayhead)}`;

/**
 * The change in cars per household to two places, signed ('+0.02', U+2212 for a fall), then
 * ' per household'; null when either is unknown.
 */
export function carsChange(r: {
  perHouseholdToday: number | null;
  perHouseholdAt: number | null;
}): string | null {
  if (r.perHouseholdToday === null || r.perHouseholdAt === null) return null;
  const d = Math.round((r.perHouseholdAt - r.perHouseholdToday) * 100) / 100;
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)} per household`;
}
