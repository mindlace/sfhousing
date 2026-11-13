import { MONTH_DAYS, type Day } from '$lib/timelapse/time';

/** The first day of model month m (1-based) after the dataset date `asOf`. */
export function monthFirstDay(asOf: Day, m: number): Day {
  return asOf + Math.floor((m - 1) * MONTH_DAYS) + 1;
}

/** The last day of model month m (1-based) after the dataset date `asOf`. */
export function monthLastDay(asOf: Day, m: number): Day {
  return asOf + Math.floor(m * MONTH_DAYS);
}

/** The model month holding `day`; 0 for a day on or before `asOf`. */
export function monthOfDay(asOf: Day, day: Day): number {
  if (day <= asOf) return 0;
  let m = Math.floor((day - asOf) / MONTH_DAYS);
  while (monthLastDay(asOf, m) < day) m++;
  while (m > 1 && monthFirstDay(asOf, m) > day) m--;
  return m;
}
