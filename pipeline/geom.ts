// Geometry types for the building-boxes pipeline. Task 5 adds the functions.
import type { Ring } from './lib/rings.js';

export type { Ring };

/** Axis-aligned box in EPSG:7131 metres (x east, y north). */
export interface Bbox7131 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
