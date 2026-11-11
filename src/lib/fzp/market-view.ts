/** Today's market, in words (spec 4.11). Page code: not hashed into the dataset version. */
import { formatCount, formatPercent } from '$lib/scoreboard/format';
import type { Calibration } from '$lib/timelapse/types';

export const MARKET_INTRO_SENTENCE =
  "The chance of starting below is the average over 2007 to 2025. The simulation runs on today's market instead: see 'Today's market'.";

export const MARKET_HOLD_SENTENCE =
  "This round holds today's market to the end of the simulation; it does not forecast a recovery or a downturn.";

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
