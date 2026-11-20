// The citywide feed's wire checks (map-citywide slice 6): validation and the transfer list of a
// `CityDelta`. Pure and worker-safe.
import type { CityDelta } from './types';

/** Bytes a changed row costs: row 4, lngLat 8, days 12, homes 2, flags 1. */
export const CITY_DELTA_BYTES_PER_ROW = 27;

/** The highest `SLOT_FLAG` bits value (zoning | money). */
const MAX_FLAGS = 3;

/**
 * Throws RangeError: a length that is not row.length × its width, a row not ascending or
 * >= rows, rows not a non-negative integer, a flag above 3.
 */
export function validateCityDelta(d: CityDelta): void {
  if (!Number.isInteger(d.rows) || d.rows < 0) {
    throw new RangeError(`CityDelta: rows ${d.rows} is not a non-negative integer`);
  }
  const k = d.row.length;
  const widths: [string, ArrayLike<number>, number][] = [
    ['lngLat', d.lngLat, 2],
    ['days', d.days, 3],
    ['homes', d.homes, 1],
    ['flags', d.flags, 1]
  ];
  for (const [name, a, w] of widths) {
    if (a.length !== k * w) {
      throw new RangeError(`CityDelta: ${name} has ${a.length} entries, not ${k} × ${w}`);
    }
  }
  let prev = -1;
  for (let i = 0; i < k; i++) {
    const row = d.row[i];
    if (row <= prev) throw new RangeError(`CityDelta: row ${row} after ${prev} is not ascending`);
    if (row >= d.rows) throw new RangeError(`CityDelta: row ${row} is not below rows ${d.rows}`);
    if (d.flags[i] > MAX_FLAGS)
      throw new RangeError(`CityDelta: row ${row} has flags ${d.flags[i]}`);
    prev = row;
  }
}

/** The five buffers, each once. */
export function cityTransferables(d: CityDelta): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [d.row, d.lngLat, d.days, d.homes, d.flags]) out.add(a.buffer as ArrayBuffer);
  return [...out];
}
