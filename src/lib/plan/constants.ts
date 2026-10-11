import type { BBox } from './geometry';

export const STORIES_MIN = 1;
export const STORIES_MAX = 80; // I3
export const RADIUS_MIN_M = 5;
export const RADIUS_MAX_M = 500;
export const PATH_MAX_POINTS = 2000;
export const OPS_MAX = 5000;
export const MAX_PLAN_BYTES = 262_144; // I13's 256 KB, as UTF-8 bytes of serializePlan()
export const TITLE_MAX_CHARS = 120;
/** Includes the Farallones and Treasure Island. */
export const SF_BBOX: BBox = [-123.1738, 37.604, -122.2818, 37.9298];
export const CURRENT_SCHEMA = 1 as const;
