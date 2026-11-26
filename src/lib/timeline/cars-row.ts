// Details' Cars row on /sim (car-ownership Task 12): the plan world's cars today and at the
// playhead's month, and cars per household at both. Its words are in `copy.ts`.
import type { TimelineView } from '$lib/sim/world/score/types';

export interface CarsRow {
  /** Cars at month 0 (the dataset's month). */
  today: number;
  /** Cars at the playhead's month. */
  atPlayhead: number;
  /** Cars per household at month 0; null with no households. */
  perHouseholdToday: number | null;
  /** Cars per household at the playhead's month; null with no households. */
  perHouseholdAt: number | null;
}

const finite = (x: number | null | undefined): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;

/**
 * The row at month `i`: null without car data, before the first filled month, for a month past
 * the fill, or when either month's cars are unknown. Never NaN.
 */
export function carsRow(view: TimelineView, i: number): CarsRow | null {
  const c = view.cars;
  if (!c || view.filledThrough < 0 || i < 0 || i > view.filledThrough) return null;
  const today = finite(c.cars[0]);
  const atPlayhead = finite(c.cars[i]);
  if (today === null || atPlayhead === null) return null;
  return {
    today,
    atPlayhead,
    perHouseholdToday: finite(c.perHousehold[0]),
    perHouseholdAt: finite(c.perHousehold[i])
  };
}
