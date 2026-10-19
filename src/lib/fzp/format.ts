/**
 * Display formats. Every formatter reads UTC, because a Day is a UTC date: a local zone would
 * shift midnight to the previous day west of Greenwich.
 */
import type { Day } from '$lib/timelapse/time';

const MS_PER_DAY = 86_400_000;

const monthYear = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});
const shortMonthYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});
const fullDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
});

const at = (day: Day) => new Date(day * MS_PER_DAY);

/** "March 2031" */
export function formatMonthYear(day: Day): string {
  return monthYear.format(at(day));
}

/** "Mar 2031" */
export function formatShortMonthYear(day: Day): string {
  return shortMonthYear.format(at(day));
}

/** "Mar 4, 2031" */
export function formatDate(day: Day): string {
  return fullDate.format(at(day));
}

/** Recorded dates show the day; projected dates show only the month. */
export function formatCardDate(day: Day, asOf: Day): string {
  return day <= asOf ? formatDate(day) : formatShortMonthYear(day);
}

/** A probability as a whole percent, never "0%" or "100%" (nothing is certain). */
export function formatChance(p: number): string {
  const r = Math.round(p * 100);
  if (r < 1) return 'under 1%';
  if (r > 99) return 'over 99%';
  return `${r}%`;
}
