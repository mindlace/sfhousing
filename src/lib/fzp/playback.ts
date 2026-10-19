/** Playback speeds and the per-frame step (spec §4.4). All values are tier 4 UI choices. */
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { Speed } from './types';

/** Days of simulated time per second of wall time. */
export const SPEED_DAYS: Record<Speed, number> = {
  month: MONTH_DAYS,
  year: 12 * MONTH_DAYS,
  threeYears: 36 * MONTH_DAYS
};

export const DEFAULT_SPEED: Speed = 'year';

export const SPEED_LABEL: Record<Speed, string> = {
  month: '1 month/s',
  year: '1 year/s',
  threeYears: '3 years/s'
};

/** Longest frame counted, so a background tab does not make the clock jump. */
export const FRAME_CLAMP_MS = 100;

/**
 * One frame: `t += min(dt, 100 ms) x daysPerSecond`, `day = min(floor(t), horizon)`. `t` is the
 * fractional clock and stops at `horizon`, where `done` is true.
 */
export function advance(
  t: number,
  dtMs: number,
  speed: Speed,
  horizon: Day
): { t: number; day: Day; done: boolean } {
  const next = Math.min(
    t + (Math.min(Math.max(dtMs, 0), FRAME_CLAMP_MS) / 1000) * SPEED_DAYS[speed],
    horizon
  );
  return { t: next, day: Math.min(Math.floor(next), horizon), done: next >= horizon };
}
