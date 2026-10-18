import type { ParcelId } from '../../src/lib/data/parcel';
import type { ProjectRecordsInput } from './types';

/**
 * Maps candidate block-lots to current parcels. `lineage` serves active `src_parcels`
 * blklot-to-mapblklot first, then parcel-lineage; when it has nothing and the candidate is itself
 * a parcel id, the candidate is used. A mapped id absent from `parcelIds` counts as unmapped.
 * Counts are per distinct non-null candidate.
 */
export function resolveParcels(
  blklots: Iterable<string | null>,
  input: Pick<ProjectRecordsInput, 'parcelIds' | 'lineage'>
): { ids: ParcelId[]; mapped: number; unmapped: number } {
  const candidates = new Set<string>();
  for (const b of blklots) if (b) candidates.add(b);
  const ids = new Set<ParcelId>();
  let mapped = 0;
  let unmapped = 0;
  for (const b of candidates) {
    let id = input.lineage(b);
    if (id === null && input.parcelIds.has(b)) id = b;
    if (id !== null && input.parcelIds.has(id)) {
      mapped++;
      ids.add(id);
    } else {
      unmapped++;
    }
  }
  return { ids: [...ids].sort(), mapped, unmapped };
}
