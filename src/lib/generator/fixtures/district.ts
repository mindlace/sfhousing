// Test-only synthetic district sites in local metres (large-site massing §4.1–4.2).
// No transcendental Math (AC4 covers this directory too).

import { lRing, rectRing, type Ring } from './geom';

export type Polygon = Ring[];

/** A `w × h` rectangle centred on the origin. */
export function rect(w: number, h: number): Polygon {
  return [rectRing(w, h)];
}

/** 800 × 600 m with a 400 × 300 m notch cut from one corner: 36 ha. */
export const lshape: Polygon = [lRing(800, 600, 400, 300)];

/** 800 × 500 m (40 ha) with a 150 × 100 m hole off centre. */
export const holed40ha: Polygon = [rectRing(800, 500), rectRing(150, 100, 100, 50)];

/** A 400 × 300 m piece and, 320 m away, a 160 × 70 m piece of less than one block. */
export const twoPieces: Polygon = [rectRing(400, 300, -300, 0), rectRing(160, 70, 300, 0)];

/** A long, thin strip `width` m across and `length` m along its long axis. */
export function pier(width: number, length: number): Polygon {
  return [rectRing(length, width)];
}
