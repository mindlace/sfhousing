import type { ParcelId } from '$lib/data/parcel';
import { fnv1a32 } from '$lib/generator';

/** MurmurHash3 32-bit finalizer. Returns a uint32. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Draw purposes (spec 4.4.1). Stage redraws use `stageRedraw(j)`. */
export const P = {
  INIT: 1,
  INIT_DAY: 2,
  PATHWAY: 3,
  PPA: 4,
  SIZE: 5,
  STAGE: 6,
  REV: 8,
  REV_RATIO: 9,
  PHASE_GAP: 11
} as const;

/** Purpose id for the j-th stage redraw, j in 1..7. */
export function stageRedraw(j: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
  return 16 + j;
}

/** Entity id of a parcel-keyed draw stream. */
export function simEntity(parcelId: ParcelId): number {
  return fnv1a32('p:' + parcelId);
}

/** Entity id of a job-keyed draw stream. */
export function jobEntity(projectId: string): number {
  return fnv1a32('j:' + projectId);
}

/**
 * Counter-based uniform draw in (0, 1). Pure function of its arguments: no state, so the order of
 * draws never matters.
 */
export function draw(
  seed: number,
  entity: number,
  k: number,
  purpose: number,
  stageIdx: number
): number {
  let H = fmix32(seed ^ 0x5bd1e995);
  H = fmix32(H ^ entity);
  H = fmix32(H ^ Math.imul(k + 1, 0x9e3779b1));
  H = fmix32(H ^ ((purpose << 8) | stageIdx));
  return (H + 0.5) / 4294967296;
}
