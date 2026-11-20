import { describe, expect, it } from 'vitest';
import { CITY_DELTA_BYTES_PER_ROW, cityTransferables, validateCityDelta } from './city-delta';
import { CITY_DAY, type CityDelta } from './types';

/** A delta of `rows` rows whose changed rows are `changed`, every field the right length. */
function deltaOf(rows: number, changed: number[]): CityDelta {
  const k = changed.length;
  return {
    rows,
    row: Int32Array.from(changed),
    lngLat: new Float32Array(2 * k).fill(-122.4),
    days: new Float32Array(3 * k).fill(NaN),
    homes: new Uint16Array(k).fill(12),
    flags: new Uint8Array(k).fill(3)
  };
}

describe('city-delta', () => {
  it('names the three days and 27 bytes a row', () => {
    expect(CITY_DAY).toEqual({ approved: 0, started: 1, completed: 2 });
    const d = deltaOf(1, [0]);
    const bytes =
      d.row.byteLength +
      d.lngLat.byteLength +
      d.days.byteLength +
      d.homes.byteLength +
      d.flags.byteLength;
    expect(bytes).toBe(CITY_DELTA_BYTES_PER_ROW);
  });

  it('validateCityDelta accepts a well-formed delta and an empty one (rows 0, no rows)', () => {
    expect(() => validateCityDelta(deltaOf(10, [0, 3, 9]))).not.toThrow();
    expect(() => validateCityDelta(deltaOf(0, []))).not.toThrow();
    expect(() => validateCityDelta(deltaOf(5, []))).not.toThrow();
  });

  it.each([
    ['lngLat', (d: CityDelta) => (d.lngLat = new Float32Array(3))],
    ['days', (d: CityDelta) => (d.days = new Float32Array(5))],
    ['homes', (d: CityDelta) => (d.homes = new Uint16Array(1))],
    ['flags', (d: CityDelta) => (d.flags = new Uint8Array(3))]
  ] as const)('rejects %s of the wrong length', (_name, spoil) => {
    const d = deltaOf(4, [1, 2]);
    spoil(d);
    expect(() => validateCityDelta(d)).toThrow(RangeError);
  });

  it('rejects rows not ascending, a row at or past rows, a negative rows, a flag above 3', () => {
    expect(() => validateCityDelta(deltaOf(4, [2, 1]))).toThrow(RangeError);
    expect(() => validateCityDelta(deltaOf(4, [1, 1]))).toThrow(RangeError);
    expect(() => validateCityDelta(deltaOf(4, [1, 4]))).toThrow(RangeError);
    expect(() => validateCityDelta(deltaOf(4, [-1, 2]))).toThrow(RangeError);
    expect(() => validateCityDelta(deltaOf(-1, []))).toThrow(RangeError);
    expect(() => validateCityDelta(deltaOf(1.5, []))).toThrow(RangeError);
    const d = deltaOf(4, [1]);
    d.flags[0] = 4;
    expect(() => validateCityDelta(d)).toThrow(RangeError);
  });

  it('cityTransferables lists the five buffers, each once', () => {
    const d = deltaOf(4, [0, 1]);
    const t = cityTransferables(d);
    expect(t).toHaveLength(5);
    expect(new Set(t).size).toBe(5);
    expect(new Set(t)).toEqual(
      new Set([d.row.buffer, d.lngLat.buffer, d.days.buffer, d.homes.buffer, d.flags.buffer])
    );
  });

  it('cityTransferables lists a buffer shared by two fields once', () => {
    const buf = new ArrayBuffer(8 + 8);
    const d: CityDelta = {
      rows: 2,
      row: new Int32Array(buf, 0, 2),
      lngLat: new Float32Array(4),
      days: new Float32Array(6),
      homes: new Uint16Array(2),
      flags: new Uint8Array(buf, 8, 2)
    };
    const t = cityTransferables(d);
    expect(t).toHaveLength(4);
    expect(new Set(t).size).toBe(4);
  });
});
