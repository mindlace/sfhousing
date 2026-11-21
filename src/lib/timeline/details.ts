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
 * playhead's month, so the last row is the header's figure at the same month.
 */
export function yearRows(view: TimelineView, i: number, inForce: boolean): YearRow[] {
  const last = Math.min(i, view.filledThrough);
  const out: YearRow[] = [];
  for (let k = 0; k <= last; k++) {
    const { y, m } = utcParts(view.months[k]);
    if (m !== 12 && k !== i) continue;
    const row = view.rows[k];
    out.push({
      year: y,
      index: k,
      label: m === 12 ? String(y) : formatShortMonthYear(view.months[k]),
      homes: row.completedNet,
      pipeline: row.completedNetPipeline,
      fresh: row.completedNetNew,
      effect: inForce ? view.planEffect[k].completedNetNew : null
    });
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
