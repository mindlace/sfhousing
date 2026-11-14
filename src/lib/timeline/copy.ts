// New wording for the timeline page (rule 38) and the explanation texts (rule 37).
// Imported by the components that render it. The `*4` sentences duplicate texts held in
// `src/lib/sim-page/funding-copy.ts`, which `/lesscars` imports and so stays unedited.
// Task 5's `CUSTOM_TIMING_LABEL` and `PRESET_PER_POLICY` live in `lens.ts`.

export const FORECAST_NOTE = 'A forecast if nothing changes.';
export const RANGE_NOTE = 'Chance only. A few large sites carry most of it.';
export const CITY_NOTE = 'One of 48 simulated cities.';
export const capacityNote = (year: number): string => `Capacity in ${year}.`;
export const TWIN_NOTE = 'Each simulated city is run twice, with and without it.';

/** World-score rule 2: displaced homes count in the month their replaced start would have come. */
export const PER_HOME_SOURCE =
  'Displaced homes are counted in the month the start they replaced would have happened.';

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
