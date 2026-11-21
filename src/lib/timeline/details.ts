// Details' year table on /sim: homes from today by calendar year, up to the playhead. Pure.
import { formatShortMonthYear } from '$lib/fzp/format';
import { utcParts } from '$lib/fzp/time';
import type { TimelineView } from '$lib/sim/world/score/types';

export interface YearRow {
  year: number;
  /** The calendar month row read: the year's December, or the playhead's month in its own year. */
  index: number;
  /** '2027' for a whole year; 'May 2028' for the playhead's month. */
  label: string;
  /** rows[index].completedNet: homes completed from today, as the header counts. */
  homes: number;
  /** rows[index].completedNetPipeline. */
  pipeline: number;
  /** rows[index].completedNetNew. */
  fresh: number;
  /** planEffect[index].completedNetNew while a policy is in force, else null. */
  effect: number | null;
}

/**
 * One row per calendar year whose December (or the playhead's month, for the playhead's own year)
 * is filled and at or before month i, from today's year; effect only inForce. Nothing after the
 * playhead's month, so the last row is the header's figure at the same month. The window's months
 * are consecutive calendar months, so it steps from the first December by 12: O(years), not O(i).
 */
export function yearRows(view: TimelineView, i: number, inForce: boolean): YearRow[] {
  const last = Math.min(i, view.filledThrough);
  const out: YearRow[] = [];
  if (last < 0) return out;
  const row = (k: number, y: number, label: string): YearRow => ({
    year: y,
    index: k,
    label,
    homes: view.rows[k].completedNet,
    pipeline: view.rows[k].completedNetPipeline,
    fresh: view.rows[k].completedNetNew,
    effect: inForce ? view.planEffect[k].completedNetNew : null
  });
  const firstDec = (12 - utcParts(view.months[0]).m) % 12;
  for (let k = firstDec; k <= last; k += 12) {
    const y = utcParts(view.months[k]).y;
    out.push(row(k, y, String(y)));
  }
  // The playhead's own month, when it is filled and not a December (already listed).
  if (i === last && (i - firstDec) % 12 !== 0) {
    out.push(row(i, utcParts(view.months[i]).y, formatShortMonthYear(view.months[i])));
  }
  return out;
}

/** The table's columns; the last ("From your policy") only while a policy is in force. */
export const YEAR_COLUMNS: readonly string[] = [
  'Year',
  'Homes',
  "From today's pipeline",
  'New projects',
  'From your policy'
];
