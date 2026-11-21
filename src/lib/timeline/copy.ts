// New wording for the timeline page (rule 38) and the explanation texts (rule 37).
// Imported by the components that render it. The `*4` sentences duplicate texts held in
// `src/lib/sim-page/funding-copy.ts`, which `/lesscars` imports and so stays unedited.
// Task 5's `CUSTOM_TIMING_LABEL` and `PRESET_PER_POLICY` live in `lens.ts`.

import { formatMonthYear, formatShortMonthYear } from '$lib/fzp/format';
import { SPEED_NAME } from '$lib/fzp/playback';
import { utcParts } from '$lib/fzp/time';
import type { Speed } from '$lib/fzp/types';
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import type { Day } from '$lib/timelapse/time';
import { MARKET_FUNDING_SENTENCE } from '$lib/sim-page/funding-copy';
import type { CoverageStep } from '$lib/sim-page/funding-view';
import { lensOf, type ChartLens } from './chart-lens';

export const FORECAST_NOTE = 'A forecast if nothing changes.';
/** Behind each reference line's legend entry on the chart. */
export const REFERENCE_NOTE =
  'Published estimates of what the Family Zoning Plan adds. Compare with the violet lines.';
export const capacityNote = (year: number): string => `Capacity in ${year}.`;
export const TWIN_NOTE = 'The forecast is run twice, with and without it.';

/** World-score rule 2: displaced homes count in the month their replaced start would have come. */
export const PER_HOME_SOURCE =
  'Displaced homes are counted in the month the start they replaced would have happened.';

/** The short coverage figure; its rest is `COVERAGE_CHANCE_NOTE`, behind it. */
export const coverageShortLine = (step: CoverageStep): string =>
  step.certain
    ? 'Affordable homes: fully funded'
    : `Affordable homes: ${formatPercent(step.coverage)} covered`;
/** Behind the short coverage figure when the cost is not fully covered. */
export const COVERAGE_CHANCE_NOTE = 'They start only by chance.';

// Why duplicated: funding-copy.ts says "a run", and the original may not change.
export const COVERAGE_RUN_SENTENCE4 =
  'Whether the money lasts, and how many homes it pays for, is what the forecast shows.';
// Why duplicated: funding-copy.ts says "a run", and the original may not change.
export const COVERAGE_OFF_SHORT_SENTENCE4 =
  'Switching a source off takes it out of every offer, so projects go ahead on the rest, at ' +
  'lower odds. A source that is on but has run short makes projects wait for it; how long is ' +
  'what the forecast shows.';

export const CHANGE_NOT_APPLIED = "That change couldn't be applied.";
export const UPDATING = 'Updating';
/** Behind UPDATING (rule 31). */
export const STALE_NOTE = 'From before your latest change.';
/** Behind a tap in a fund's read-only terms. */
export const TERMS_HINT = 'End this and add a new one to change terms.';
/** OQ-4. */
export const DATES_MOVED_NOTICE = 'Some policy dates moved to fit this data.';

// Why duplicated: funding-copy.ts says "FZP as written", and the original may not change.
export const MARKET_FUNDING_SENTENCE4 =
  "Today's public funding is part of every run, including the comparison with current law, " +
  'and the 100% affordable homes it pays for start because of it, so nothing is counted twice; ' +
  'the comparison shows what your changes add.';

/** The market sentence's closing disclaimer, which `FORECAST_NOTE` replaces. */
const MARKET_TAIL = " This holds today's market; it is not a forecast.";
/** Results' market sentence without its old closing disclaimer. */
export const marketBody = (s: string): string =>
  s.replace(MARKET_TAIL, '').replace(MARKET_FUNDING_SENTENCE, MARKET_FUNDING_SENTENCE4);

const PER_HOME_TAIL = ', counted when the funded project completes.';
/**
 * The per-home entry's method in rule 38's wording. `MONEY_SOURCES` (hashed) keeps its own; the
 * tail that says when a displaced home is counted is replaced at render.
 */
export function perHomeMethod(method: string): string {
  const at = method.indexOf(PER_HOME_TAIL);
  return at < 0 ? method : `${method.slice(0, at)}. ${PER_HOME_SOURCE}`;
}

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
 * while its step is drawn; the effect lens draws no goal.
 */
export function chartCaption(
  inForce: boolean,
  goal: { units: number; deadline: Day } | null,
  lens: ChartLens = 'homes'
): string {
  const slider = 'The month slider reads out each month.';
  const shown = lensOf(lens, inForce);
  if (shown === 'effect') return `Homes from your policy against current law, by month. ${slider}`;
  const needed = goal
    ? `the homes still needed by its deadline: ${goalNote(goal.units, goal.deadline)}.`
    : '';
  const drawn = goal ? `The goal is drawn as ${needed} ` : '';
  if (shown === 'source')
    return (
      "Homes completed from today, by month, and those from today's pipeline. The shaded gap is " +
      `new projects. ${drawn}${slider}`
    );
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
