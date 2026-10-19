/**
 * Calendar helpers for the FZP scrubber (design doc §4.4). Pure integer arithmetic over
 * `Date.UTC`, so the result never depends on the browser time zone.
 */
import type { Day } from '$lib/timelapse/time';

const MS_PER_DAY = 86_400_000;

/** The Day for a UTC calendar date; `m` is 1-12. */
export function dayFromUtc(y: number, m: number, d: number): Day {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** The UTC calendar date of a Day; `m` is 1-12. */
export function utcParts(day: Day): { y: number; m: number; d: number } {
  const date = new Date(day * MS_PER_DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** The end of the scrubber: 2050-12-31 (OD-T4), Day 29,584. */
export const HORIZON: Day = dayFromUtc(2050, 12, 31);

/** The default 2045 marker day when the data has no reference falling in 2045. */
export const YEAR_2045: Day = dayFromUtc(2045, 1, 1);

/** The first of the day's month. */
export function monthStart(day: Day): Day {
  const { y, m } = utcParts(day);
  return dayFromUtc(y, m, 1);
}

/** The first-of-month strictly after `day`, clamped to `horizon`. */
export function nextMonth(day: Day, horizon: Day): Day {
  const { y, m } = utcParts(day);
  return Math.min(dayFromUtc(y, m + 1, 1), horizon);
}

/** The first-of-month strictly before `day`, clamped up to `asOf`. */
export function prevMonth(day: Day, asOf: Day): Day {
  const { y, m } = utcParts(day);
  const start = dayFromUtc(y, m, 1);
  return Math.max(start < day ? start : dayFromUtc(y, m - 1, 1), asOf);
}

/** Twelve months back or forward from the current month start, clamped to [asOf, horizon]. */
export function shiftYear(day: Day, dir: 1 | -1, asOf: Day, horizon: Day): Day {
  const { y, m } = utcParts(day);
  return Math.min(Math.max(dayFromUtc(y + dir, m, 1), asOf), horizon);
}

/**
 * Index of the day's calendar month in a monthly series starting at `month0`, clamped to
 * `[0, length - 1]`. Arithmetic, O(1) (spec §4.4).
 */
export function monthIndex(day: Day, month0: Day, length: number): number {
  const a = utcParts(day);
  const b = utcParts(month0);
  const i = (a.y - b.y) * 12 + (a.m - b.m);
  return Math.min(Math.max(i, 0), length - 1);
}
