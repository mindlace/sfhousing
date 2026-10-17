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
 * Encodes an open-ended window end: 3.0e38 rounded to the nearest Float32, so the same value
 * lives in JS doubles and in Float32Array buffers. Finite (below Float32 max, about 3.4e38).
 */
export const OPEN_DAY = Math.fround(3.0e38);

/**
 * Length of the "dying" display after a project exits: 90 days of red, then 180 days of fade.
 * Display only (tier 4); read by render's uniforms.
 */
export const DYING_DAYS = 270;
