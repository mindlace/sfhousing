// /sim's map key tally: the homes in each stage group at the playhead's month. Pure.
import { STAGE_KEY, type StageGroup } from '$lib/map/key/rows';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { HeadlineOpts, PlayheadAt } from './results';

export type KeyTally = Record<StageGroup, number>;

/**
 * The homes in each group at the playhead's month: null while headlineAt would be null
 * (no view, provisional, or month i not filled). At today: completed 0, stopped 0, the four
 * in-progress groups from rows[0] (null while month 0 is not filled). Else rows[i]: in progress
 * summed per STAGE_KEY, completed = completedNet, stopped = exitedUnits. Reads one row.
 */
export function keyTally(
  view: TimelineView | null,
  at: PlayheadAt,
  opts: HeadlineOpts
): KeyTally | null {
  if (!view || opts.provisional) return null;
  const i = at.atToday ? 0 : at.index;
  if (view.filledThrough < i) return null;
  const row = view.rows[i];
  const out = {} as KeyTally;
  for (const g of STAGE_KEY) {
    let n = 0;
    for (const s of g.stages) n += row.inProgress[s];
    out[g.id] = n;
  }
  out.completed = at.atToday ? 0 : row.completedNet;
  out.stopped = at.atToday ? 0 : row.exitedUnits;
  return out;
}
