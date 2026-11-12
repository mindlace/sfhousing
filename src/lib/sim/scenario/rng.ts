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

/**
 * Draw purposes (spec 4.4.1). A stage step draws its kind on `STAGE` and its time on `STAGE_TIME`
 * (paired-draw fix). 17-23 are the retired in-flight stage redraws and are never reused; 7 and 10
 * are the affordable latent's (`INIT_AFFORDABLE`, `INIT_DAY_AFFORDABLE`).
 */
export const P = {
  INIT: 1,
  INIT_DAY: 2,
  PATHWAY: 3,
  PPA: 4,
  SIZE: 5,
  STAGE: 6,
  INIT_AFFORDABLE: 7,
  REV: 8,
  REV_RATIO: 9,
  INIT_DAY_AFFORDABLE: 10,
  PHASE_GAP: 11,
  STAGE_TIME: 12
} as const;

/** Entity id of a parcel-keyed draw stream. */
export function simEntity(parcelId: ParcelId): number {
  return fnv1a32('p:' + parcelId);
}

/** Entity id of a job-keyed draw stream. */
export function jobEntity(projectId: string): number {
  return fnv1a32('j:' + projectId);
}

/** The first mix of `draw`, which depends on the seed only (the engine computes it once a run). */
export function seedHash(seed: number): number {
  return fmix32(seed ^ 0x5bd1e995);
}

/** The next two mixes of `draw`: one `(entity, k)` stream under a seed's `seedHash`. */
export function streamOf(seedH: number, entity: number, k: number): number {
  return fmix32(fmix32(seedH ^ entity) ^ Math.imul(k + 1, 0x9e3779b1));
}

/** The last mix of `draw` on a `streamOf` stream: `draw(seed, entity, k, purpose, stageIdx)`. */
export function drawOn(stream: number, purpose: number, stageIdx: number): number {
  return (fmix32(stream ^ ((purpose << 8) | stageIdx)) + 0.5) / 4294967296;
}

/**
 * Counter-based uniform draw in (0, 1). Pure function of its arguments: no state, so the order of
 * draws never matters. The engine hoists the parts shared by a run (`seedHash`) and by one
 * project (`streamOf`); the composition is this same sequence of mixes.
 */
export function draw(
  seed: number,
  entity: number,
  k: number,
  purpose: number,
  stageIdx: number
): number {
  return drawOn(streamOf(seedHash(seed), entity, k), purpose, stageIdx);
}
