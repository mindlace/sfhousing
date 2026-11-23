// The public-money sentences of the timeline page (rule 38). The `*4` sentences duplicate texts
// held in `src/lib/sim-page/funding-copy.ts`, which `/lesscars` imports and so stays unedited.

import { formatPercent } from '$lib/scoreboard/format';
import type { CoverageStep } from '$lib/sim-page/funding-view';

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

/** Behind a tap in a fund's read-only terms. */
export const TERMS_HINT = 'End this and add a new one to change terms.';

const PER_HOME_TAIL = ', counted when the funded project completes.';
/**
 * The per-home entry's method in rule 38's wording. `MONEY_SOURCES` (hashed) keeps its own; the
 * tail that says when a displaced home is counted is replaced at render.
 */
export function perHomeMethod(method: string): string {
  const at = method.indexOf(PER_HOME_TAIL);
  return at < 0 ? method : `${method.slice(0, at)}. ${PER_HOME_SOURCE}`;
}
