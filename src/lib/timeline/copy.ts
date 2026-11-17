// New wording for the timeline page (rule 38) and the explanation texts (rule 37).
// Imported by the components that render it. The `*4` sentences duplicate texts held in
// `src/lib/sim-page/funding-copy.ts`, which `/lesscars` imports and so stays unedited.
// Task 5's `CUSTOM_TIMING_LABEL` and `PRESET_PER_POLICY` live in `lens.ts`.

import { formatPercent } from '$lib/scoreboard/format';
import type { CoverageStep } from '$lib/sim-page/funding-view';

export const FORECAST_NOTE = 'A forecast if nothing changes.';
/** The fill state (rule 32), in the header's status slot from 2xl, under the bar below it. */
export const forecastFilled = (year: number): string => `Forecast filled to ${year}`;
/** Behind each reference line's legend entry on the chart. */
export const REFERENCE_NOTE =
  'Published estimates of what the plan adds. Compare with the violet lines.';
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

/** The market sentence's closing disclaimer, which `FORECAST_NOTE` replaces. */
const MARKET_TAIL = " This holds today's market; it is not a forecast.";
/** Results' market sentence without its old closing disclaimer. */
export const marketBody = (s: string): string => s.replace(MARKET_TAIL, '');

const PER_HOME_TAIL = ', counted when the funded project completes.';
/**
 * The per-home entry's method in rule 38's wording. `MONEY_SOURCES` (hashed) keeps its own; the
 * tail that says when a displaced home is counted is replaced at render.
 */
export function perHomeMethod(method: string): string {
  const at = method.indexOf(PER_HOME_TAIL);
  return at < 0 ? method : `${method.slice(0, at)}. ${PER_HOME_SOURCE}`;
}
