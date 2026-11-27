import * as timeModule from '$lib/timelapse/time';
import type { Day } from '$lib/timelapse/time';
import { addMonths, firstOfMonth } from '$lib/sim/world/dates';

// Imports are bound once, here: under Vite's module runner (the tests and the cost bench) every
// use of an imported name is a getter call (docs/dev/world-core.md, Cost).
const { MONTH_DAYS } = timeModule;

/** First day of model month m (m >= 1): `asOf + floor((m - 1) * MONTH_DAYS) + 1`. */
export function monthFirstDay(asOf: Day, m: number): Day {
  return asOf + Math.floor((m - 1) * MONTH_DAYS) + 1;
}

/** Last day of model month m (m >= 1): `asOf + floor(m * MONTH_DAYS)`. */
export function monthLastDay(asOf: Day, m: number): Day {
  return asOf + Math.floor(m * MONTH_DAYS);
}

/** The model month holding `day`; 0 for `day <= asOf`. */
export function monthOfDay(asOf: Day, day: Day): number {
  if (day <= asOf) return 0;
  let m = Math.ceil((day - asOf) / MONTH_DAYS);
  if (m < 1) m = 1;
  // The division is floating point: correct by at most one step each way.
  if (day > monthLastDay(asOf, m)) m += 1;
  else if (m > 1 && day < monthFirstDay(asOf, m)) m -= 1;
  return m;
}

/**
 * The last day of the last calendar month whose last day is at or before
 * `monthLastDay(asOf, windowMonths)`; the last day of `asOf`'s own month when none is.
 */
export function windowHorizon(asOf: Day, windowMonths: number): Day {
  const limit = monthLastDay(asOf, windowMonths);
  const lastDayOf = (first: Day): Day => addMonths(first, 1) - 1;
  let h = lastDayOf(firstOfMonth(asOf));
  while (lastDayOf(h + 1) <= limit) h = lastDayOf(h + 1);
  return h;
}
