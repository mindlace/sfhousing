/** Today's market, in words (spec 4.11). Page code: not hashed into the dataset version. */
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import type { Calibration } from '$lib/timelapse/types';

export const MARKET_INTRO_SENTENCE =
  "The chance of starting below is the average over 2007 to 2025. The simulation runs on today's market instead: see 'Today's market'.";

export const MARKET_HOLD_SENTENCE =
  "This round holds today's market to the end of the simulation; it does not forecast a recovery or a downturn.";

/**
 * Under About's "Today's level" while today's public funding is modelled (the private level).
 * Why duplicated: `MARKET_FUNDING_SENTENCE` in `src/lib/sim-page/funding-copy.ts` says "FZP as
 * written", and `money-view.ts` still uses it, so the original is not edited.
 */
export const MARKET_FUNDING_SENTENCE4 =
  "Today's public funding is part of every run, including the comparison with current law, " +
  'and the 100% affordable homes it pays for start because of it, so nothing is counted twice; ' +
  'the comparison shows what your changes add.';

/** The share of the average that `level`'s observed starts are, from the counts. */
export function marketShare(cal: Calibration, level: 'all' | 'private'): string | null {
  const today = cal.market?.today;
  return today ? formatPercent(today.observed[level] / today.implied) : null;
}

/** The Results face's sentence on today's market, or `null` without a market model. */
export function marketSentence(cal: Calibration, level: 'all' | 'private'): string | null {
  const today = cal.market?.today;
  if (!today) return null;
  const [y0, y1] = today.years;
  const n = formatCount(today.observed[level]);
  const e = formatCount(Math.round(today.implied));
  const pct = marketShare(cal, level);
  const window = cal.initiation.provenance.window;
  const fitted = window
    ? `fitted on the city's records from ${window[0].slice(0, 4)} to ${y1}`
    : "fitted on the city's records";
  const tail = "to the end of the timeline. This holds today's market; it is not a forecast.";
  if (level === 'all') {
    return `It runs on today's market. In ${y0} to ${y1}, ${n} new projects started, where the start model, ${fitted}, expected ${e}. So every lot's chance of starting is set to about ${pct} of that average, ${tail}`;
  }
  return `It runs on today's market. In ${y0} to ${y1}, ${n} new projects started other than those proposing nearly all homes affordable, where the start model, ${fitted}, expected ${e} of every kind. So every lot's chance of starting a project without public money is set to about ${pct} of that average, ${tail}`;
}
