/**
 * Shared time rules for the FZP timelapse (design doc T1). Pure; no imports, so the data
 * pipeline, the worker and the renderer can all use it.
 */

/** Integer days since 1970-01-01 UTC. All schedule times use it. Exact in Float32. */
export type Day = number;

/** Mean Gregorian month in days (365.2425 / 12). */
export const MONTH_DAYS = 30.436875;

/**
 * The single months-in-stage rule, used by every table index (calibration tables, the chance
 * lookup, the progress bar and the project card).
 */
export function monthsIn(enteredDay: Day, day: Day): number {
  return Math.floor((day - enteredDay) / MONTH_DAYS);
}

/**
 * The day offset from stage entry of month index n (0-based, month n + 1 in stage) at position
 * frac in [0, 1) through it: month n's days are [ceil(n * MONTH_DAYS), ceil((n + 1) * MONTH_DAYS)),
 * spread uniformly, so `monthsIn(0, day) === n`.
 */
export function monthDay(n: number, frac: number): number {
  const first = Math.ceil(n * MONTH_DAYS);
  const width = Math.ceil((n + 1) * MONTH_DAYS) - first;
  return first + Math.min(Math.floor(frac * width), width - 1);
}

/**
 * The integer day offset from stage entry for x >= 0 real months in stage: month floor(x) + 1,
 * at the day x's fraction falls on (the sampler's day rule as a function of x). Non-decreasing,
 * and `monthsIn(0, stageDay(x)) === Math.floor(x)`.
 */
export function stageDay(months: number): number {
  const n = Math.floor(months);
  return monthDay(n, months - n);
}

/**
 * The real months in stage at the start of integer day `day` >= 0: (k - 1) + (day - first) /
 * (end - first) with k = monthsIn(0, day) + 1 and [first, end) month k's days. Where rounding
 * would put that value a hair before `day` (frac * width just under an integer), it is raised by
 * the fewest ulps that make `stageDay` land on `day`. Strictly increasing, and
 * `stageDay(stageMonths(d)) === d` for every integer d in [0, 2^24).
 */
export function stageMonths(day: number): number {
  const n = monthsIn(0, day);
  const first = Math.ceil(n * MONTH_DAYS);
  const end = Math.ceil((n + 1) * MONTH_DAYS);
  let x = n + (day - first) / (end - first);
  while (stageDay(x) < day) x = nextUp(x);
  return x;
}

const BITS = new Float64Array(1);
const WORDS = new BigUint64Array(BITS.buffer);

/** The least double above a finite x >= 0. */
function nextUp(x: number): number {
  BITS[0] = x;
  WORDS[0] += 1n;
  return BITS[0];
}

/**
 * Encodes an open-ended window end: 3.0e38 rounded to the nearest Float32, so the same value
 * lives in JS doubles and in Float32Array buffers. Finite (below Float32 max, about 3.4e38).
 */
export const OPEN_DAY = Math.fround(3.0e38);

/**
 * Length of the "dying" display after a project exits: 90 days of red, then 180 days of fade.
 * Display only (tier 4); read by render's uniforms.
 */
export const DYING_DAYS = 270;
