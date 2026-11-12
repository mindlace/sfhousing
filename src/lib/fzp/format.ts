/**
 * Display formats. Every formatter reads UTC, because a Day is a UTC date: a local zone would
 * shift midnight to the previous day west of Greenwich.
 */
import type { Day } from '$lib/timelapse/time';
import { dayFromUtc } from './time';

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

/** The twelve `formatMonthYear` labels of `year`, January first. */
export function monthYearLabels(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => formatMonthYear(dayFromUtc(year, i + 1, 1)));
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

const MINUS = '−';
const decimals = (max: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max });
const wholeNumber = decimals(0);
const oneDecimal = decimals(1);
const twoDecimals = decimals(2);

/**
 * Money totals: to the nearest thousand below a million, then millions to one decimal, then
 * billions to two. The unit is chosen on the rounded value, so 999,500 is "$1 million".
 */
export function formatDollars(n: number): string {
  const a = Math.abs(n);
  let text: string;
  const thousands = Math.round(a / 1000) * 1000;
  if (thousands < 1_000_000) {
    text = `$${wholeNumber.format(thousands)}`;
  } else {
    const millions = Math.round(a / 100_000) / 10;
    text =
      millions < 1000
        ? `$${oneDecimal.format(millions)} million`
        : `$${twoDecimals.format(Math.round(a / 10_000_000) / 100)} billion`;
  }
  return n < 0 && text !== '$0' ? `${MINUS}${text}` : text;
}

/** Money per home: whole dollars, never abbreviated. */
export function formatDollarsExact(n: number): string {
  const r = Math.round(Math.abs(n));
  const text = `$${wholeNumber.format(r)}`;
  return n < 0 && r !== 0 ? `${MINUS}${text}` : text;
}

/** A share as a percent to one decimal: 0.115 is "11.5%", 0.8 is "80%". */
export function formatSourcePercent(x: number): string {
  return `${oneDecimal.format(x * 100)}%`;
}

/**
 * A log-odds shift as the change in a project's odds: `exp(shift) - 1` as a signed whole percent
 * truncated toward zero; from +1,000% it reads "more than 10 times as likely".
 */
export function formatOddsChange(shift: number): string {
  const pct = Math.round((Math.exp(shift) - 1) * 100 * 1e6) / 1e6;
  if (pct >= 1000) return 'more than 10 times as likely';
  const t = Math.trunc(pct);
  if (t === 0) return '+0%';
  return t > 0 ? `+${t}%` : `${MINUS}${Math.abs(t)}%`;
}
