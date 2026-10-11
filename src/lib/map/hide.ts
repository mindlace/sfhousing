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
  add: ParcelId[];
  remove: ParcelId[];
}

export const SLICE_IDS = 2000;

export function planSlices(u: GeneratedUpdate): Slice[] {
  const { add, remove } = u.hide;
  if (add.length + remove.length <= SLICE_IDS) {
    return [{ cells: u.cells, add: [...add], remove: [...remove] }];
  }
  const addSet = new Set(add);
  const found = new Set<ParcelId>();
  const perCell: ParcelId[][] = u.cells.map((c) => {
    const ids: ParcelId[] = [];
    const seen = new Set<ParcelId>();
    for (const p of [c.settled, ...(c.rising ? [c.rising] : [])]) {
      for (const id of p.parcelIds) {
        if (addSet.has(id) && !seen.has(id) && !found.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    for (const id of ids) found.add(id);
    return ids;
  });
  const slices: Slice[] = [
    { cells: [], add: add.filter((id) => !found.has(id)), remove: [...remove] }
  ];
  let cur = slices[0];
  u.cells.forEach((c, i) => {
    if (cur.add.length >= SLICE_IDS && cur.cells.length > 0) {
      cur = { cells: [], add: [], remove: [] };
      slices.push(cur);
    }
    cur.cells.push(c);
    cur.add.push(...perCell[i]);
  });
  return slices;
}
