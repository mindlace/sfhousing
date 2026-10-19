// T12 lookups → the bar's chance texture (spec §4.4.3 "Upload"). Pure; no GL here.
import type { TimelineLookups } from './types';
import { PATHWAYS, STAGE_ORDER, type Stage } from '$lib/timelapse/types';

/** Rows per pathway: every stage but `complete`, in `STAGE_ORDER`. */
export const ROWS_PER_PATHWAY = STAGE_ORDER.length - 1;
/** 3 pathways × 6 stages. */
export const CHANCE_ROWS = 18;
/** WebGL2's guaranteed `MAX_TEXTURE_SIZE` (spec §4.4.3). */
export const MAX_CHANCE_LEN = 2048;

/** The texture row of a (pathway, stage): `pathwayIndex · 6 + STAGE_ORDER.indexOf(stage)`. */
export function chanceRow(pathwayIndex: number, stage: Exclude<Stage, 'complete'>): number {
  return pathwayIndex * ROWS_PER_PATHWAY + STAGE_ORDER.indexOf(stage);
}

export interface ChanceTexture {
  data: Uint8Array; // r8unorm, row-major, CHANCE_ROWS × width
  width: number;
  height: 18;
}

/**
 * Packs the chance table into one r8unorm texture: `round(c · 255)` per month, short rows padded
 * with their last value, absent rows 0 (never read). Throws a `RangeError` for a row longer than
 * `MAX_CHANCE_LEN`.
 */
export function packChanceTexture(chance: TimelineLookups['chance']): ChanceTexture {
  const rows: [row: number, values: Float32Array][] = [];
  let width = 1; // a texture needs at least one column
  PATHWAYS.forEach((p, pi) => {
    for (const stage of STAGE_ORDER) {
      if (stage === 'complete') continue;
      const values = chance[p]?.[stage];
      if (!values) continue;
      if (values.length > MAX_CHANCE_LEN) {
        throw new RangeError(
          `chance row ${p}.${stage} has ${values.length} months, above ${MAX_CHANCE_LEN}`
        );
      }
      rows.push([chanceRow(pi, stage), values]);
      width = Math.max(width, values.length);
    }
  });
  const data = new Uint8Array(CHANCE_ROWS * width);
  const q = (c: number) => Math.round(Math.min(Math.max(c, 0), 1) * 255);
  for (const [row, values] of rows) {
    if (values.length === 0) continue;
    const o = row * width;
    for (let i = 0; i < values.length; i++) data[o + i] = q(values[i]);
    data.fill(q(values[values.length - 1]), o + values.length, o + width);
  }
  return { data, width, height: CHANCE_ROWS };
}
