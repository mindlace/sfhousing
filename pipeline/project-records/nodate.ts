/**
 * DQ-2 (spec 4.2 step 10): a pipeline-only row with no valid `current_status_date` is linked by
 * parcel to the open Planning record on its lot, or dropped. Runs after every graph project's
 * 4.6 end is known, because candidates are the projects whose end, computed without the row, is
 * `open`. Pure: the caller applies the result (rules `pr.pipeline.status-date-linked` and
 * `pr.pipeline.no-status-date`).
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';
import type { LinkedProject, PipelineRow, Prj } from './types';

/** A graph project the caller may join a row to; `open` is its 4.6 end computed without the row. */
export interface NoDateTarget {
  proj: LinkedProject;
  open: boolean;
}

/** A pipeline-only row with no valid status date, with its `CASE:` project id. */
export interface NoDateRow {
  id: string;
  row: PipelineRow;
}

export interface NoDateResult<T extends NoDateTarget> {
  /** Rows joined to `target` through its anchor PRJ `recordId`, in row order. */
  linked: { from: NoDateRow; target: T; recordId: string }[];
  /** Rows left out, in row order, each with its build warning. */
  dropped: { from: NoDateRow; warning: string }[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Later wins: a null open day loses to any day. */
function laterOpen(a: Day | null, b: Day | null): boolean {
  if (a === null) return false;
  return b === null || a > b;
}

/** The id a pipeline row is named by in `sources` (spec 4.8): `case_no ?? bpa_no`. */
export function rowKey(r: PipelineRow): string {
  return r.caseNo ?? r.bpaNo ?? `pipeline row ${r.idx}`;
}

/**
 * Candidates are the anchor PRJs of open graph projects whose own block-lot, or a block-lot of one
 * of their children (by `parent_id`), resolves to a parcel the row's `blklot` resolves to. The
 * latest `open_date` wins, ties to the smallest `record_id`; when split projects share the winning
 * PRJ, the smallest project id holds it (spec silent; implementation choice). A row is dropped when
 * it has no candidate, or when that project already holds a pipeline row, including one linked
 * earlier in this pass (rows go in `idx` order).
 */
export function linkNoDateRows<T extends NoDateTarget>(
  rows: readonly NoDateRow[],
  targets: readonly T[],
  resolve: (blklots: string[]) => ParcelId[]
): NoDateResult<T> {
  const byParcel = new Map<ParcelId, Prj[]>();
  const holders = new Map<string, T[]>();
  for (const t of targets) {
    if (!t.open || t.proj.kind !== 'graph') continue;
    for (const a of t.proj.anchors) {
      const list = holders.get(a.recordId);
      if (list) list.push(t);
      else holders.set(a.recordId, [t]);
      if (list) continue; // the PRJ's lots are already indexed
      const blklots = new Set<string>();
      if (a.blklot !== null) blklots.add(a.blklot);
      for (const c of t.proj.children) {
        if (c.parentId === a.recordId && c.blklot !== null) blklots.add(c.blklot);
      }
      for (const id of resolve([...blklots].sort(cmp))) {
        const prjs = byParcel.get(id);
        if (prjs) prjs.push(a);
        else byParcel.set(id, [a]);
      }
    }
  }
  for (const list of holders.values()) list.sort((x, y) => cmp(x.proj.id, y.proj.id));

  // The key of the first pipeline row each target holds, before and during this pass.
  const held = new Map<T, string>();
  for (const t of targets) {
    if (t.proj.pipelineRows.length > 0) held.set(t, rowKey(t.proj.pipelineRows[0]));
  }

  const out: NoDateResult<T> = { linked: [], dropped: [] };
  const ordered = [...rows].sort((x, y) => x.row.idx - y.row.idx);
  for (const from of ordered) {
    const { row } = from;
    const name = rowKey(row);
    let best: Prj | null = null;
    const ids = row.blklot === null ? [] : resolve([row.blklot]);
    for (const id of ids) {
      for (const a of byParcel.get(id) ?? []) {
        if (
          best === null ||
          laterOpen(a.openDay, best.openDay) ||
          (a.openDay === best.openDay && cmp(a.recordId, best.recordId) < 0)
        ) {
          best = a;
        }
      }
    }
    if (best === null) {
      out.dropped.push({
        from,
        warning: `${name}: no status date and no open Planning record on its lot; dropped`
      });
      continue;
    }
    const target = holders.get(best.recordId)![0];
    const other = held.get(target);
    if (other !== undefined) {
      out.dropped.push({
        from,
        warning: `${name}: no status date and winner ${best.recordId} already holds pipeline row ${other}; dropped`
      });
      continue;
    }
    held.set(target, name);
    out.linked.push({ from, target, recordId: best.recordId });
  }
  return out;
}
