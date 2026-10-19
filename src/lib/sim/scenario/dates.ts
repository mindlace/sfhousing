import type { Day } from '$lib/timelapse/time';

const MS_PER_DAY = 86400000;

/** Days since 1970-01-01 (UTC) for a calendar date; `m` is 1-based. */
export function dayOf(y: number, m: number, d: number): Day {
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** 'YYYY-MM-DD' for a day number. */
export function isoOf(day: Day): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The first day of the month containing `day`. */
export function firstOfMonth(day: Day): Day {
  const dt = new Date(day * MS_PER_DAY);
  return dayOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
}

/** The first day of the month `n` months after (or before, if negative) `firstDay`'s month. */
export function addMonths(firstDay: Day, n: number): Day {
  const dt = new Date(firstDay * MS_PER_DAY);
  return dayOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1 + n, 1);
}
