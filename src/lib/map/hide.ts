// Pure, worker-safe hide mirror and slice planning.
import type { ParcelId } from '$lib/data/parcel';
import type { GeneratedUpdate } from './types';

export function applyHideDiff(
  mirror: Set<ParcelId>,
  d: { add: readonly ParcelId[]; remove: readonly ParcelId[] }
): void {
  for (const id of d.remove) mirror.delete(id);
  for (const id of d.add) mirror.add(id);
}

export interface Slice {
  cells: GeneratedUpdate['cells'];
  /** removedCells that drop in this slice; their `remove` ids ride in the same slice. */
  removed: string[];
  add: ParcelId[];
  remove: ParcelId[];
}

/** A slice closes once it holds this many hide ids (spec §4.5). */
export const SLICE_IDS = 2000;
/**
 * A slice closes once it holds this many cells (cells + removedCells). deck tessellates a
 * repacked cell on its next render at ~4.5 ms per 1500-parcel cell (measured, C5), so 4 cells
 * keep the per-frame tessellation around ≤ 20 ms and the frame gap within §4.12's 50 ms.
 */
export const MAX_CELLS_PER_SLICE = 4;

/**
 * Splits an update into slices applied one per frame. A slice closes when it reaches
 * SLICE_IDS ids or MAX_CELLS_PER_SLICE cells; a cell is never split. Each `add` rides with the
 * first cell whose packs hold it; each `remove` rides with the cell that held the parcel before
 * this update (`prevCellOf`), whether that cell is repacked (`cells`) or dropped
 * (`removedCells`). So a building is never hidden before its replacement layer exists, and an
 * existing building is restored in the same slice its generated replacement disappears.
 * Orphan adds and removes whose previous cell is unknown or untouched go in slice 0.
 */
export function planSlices(
  u: GeneratedUpdate,
  prevCellOf: (id: ParcelId) => string | undefined = () => undefined
): Slice[] {
  const { add, remove } = u.hide;
  if (
    add.length + remove.length <= SLICE_IDS &&
    u.cells.length + u.removedCells.length <= MAX_CELLS_PER_SLICE
  ) {
    return [{ cells: u.cells, removed: [...u.removedCells], add: [...add], remove: [...remove] }];
  }

  // One unit per touched cell, in update order: repacked cells, then removed cells.
  interface Unit {
    cell: GeneratedUpdate['cells'][number] | null;
    removed: string | null;
    add: ParcelId[];
    remove: ParcelId[];
  }
  const units: Unit[] = [];
  const unitOf = new Map<string, Unit>();
  for (const c of u.cells) {
    const unit: Unit = { cell: c, removed: null, add: [], remove: [] };
    units.push(unit);
    if (!unitOf.has(c.settled.cellId)) unitOf.set(c.settled.cellId, unit);
  }
  for (const id of u.removedCells) {
    const unit: Unit = { cell: null, removed: id, add: [], remove: [] };
    units.push(unit);
    if (!unitOf.has(id)) unitOf.set(id, unit);
  }

  const head: Slice = { cells: [], removed: [], add: [], remove: [] };
  if (add.length > 0) {
    const addSet = new Set(add);
    const placed = new Set<ParcelId>();
    for (const unit of units) {
      const c = unit.cell;
      if (!c) continue;
      for (const p of [c.settled, ...(c.rising ? [c.rising] : [])]) {
        for (const id of p.parcelIds) {
          if (addSet.has(id) && !placed.has(id)) {
            placed.add(id);
            unit.add.push(id);
          }
        }
      }
    }
    for (const id of add) if (!placed.has(id)) head.add.push(id);
  }
  for (const id of remove) {
    const prev = prevCellOf(id);
    const unit = prev === undefined ? undefined : unitOf.get(prev);
    (unit ? unit.remove : head.remove).push(id);
  }

  const ids = (s: Slice) => s.add.length + s.remove.length;
  const cellCount = (s: Slice) => s.cells.length + s.removed.length;
  const slices: Slice[] = [head];
  let cur = head;
  for (const unit of units) {
    if (ids(cur) >= SLICE_IDS || cellCount(cur) >= MAX_CELLS_PER_SLICE) {
      cur = { cells: [], removed: [], add: [], remove: [] };
      slices.push(cur);
    }
    if (unit.cell) cur.cells.push(unit.cell);
    if (unit.removed !== null) cur.removed.push(unit.removed);
    cur.add.push(...unit.add);
    cur.remove.push(...unit.remove);
  }
  return slices;
}
