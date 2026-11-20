// The citywide view's CITY_CELL_M grid (map-citywide slice 6). Its own module so halos.ts can
// place marks on it without importing city.ts, which imports halos.ts (HALO_TOKEN). city.ts
// re-exports everything here.
import { CONSTRAINTS } from '../camera';
import { CITY_CELL_M } from './constants';

/** Metres per degree of latitude (mean Earth radius 6,371,008.8 m). */
export const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const [[WEST, SOUTH], [EAST, NORTH]] = CONSTRAINTS.maxBounds;
const D_LAT = CITY_CELL_M / M_PER_DEG;
const D_LNG = D_LAT / Math.cos((((SOUTH + NORTH) / 2) * Math.PI) / 180);

/** The CITY_CELL_M grid over `CONSTRAINTS.maxBounds`, from its south-west corner. */
export const CITY_GRID = {
  west: WEST,
  south: SOUTH,
  dLng: D_LNG,
  dLat: D_LAT,
  cols: Math.ceil((EAST - WEST) / D_LNG),
  rows: Math.ceil((NORTH - SOUTH) / D_LAT)
} as const;

/** A square's bounds: [west, south, east, north] in degrees. */
export type CityBounds = [w: number, s: number, e: number, n: number];

const clampInt = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));

/**
 * The square of a point on the CITY_CELL_M grid over CONSTRAINTS.maxBounds (row-major from the
 * south-west); outside points clamp to the edge squares.
 */
export function cityGroup(lng: number, lat: number): number {
  const col = clampInt((lng - WEST) / D_LNG, CITY_GRID.cols);
  const row = clampInt((lat - SOUTH) / D_LAT, CITY_GRID.rows);
  return row * CITY_GRID.cols + col;
}

/** The bounds of square `group`. */
export function citySquare(group: number): CityBounds {
  const col = group % CITY_GRID.cols;
  const row = (group - col) / CITY_GRID.cols;
  const w = WEST + col * D_LNG;
  const s = SOUTH + row * D_LAT;
  return [w, s, w + D_LNG, s + D_LAT];
}
