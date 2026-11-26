import { describe, expect, it } from 'vitest';
import { CARS_CODEC, decodeCarData, encodeCarData, type CarData } from './cars-codec';

/** Two zones, one PUMA, three lots (one outside every zone), 2 types. */
function tiny(): CarData {
  const types = 2;
  const households = new Int32Array(2 * types * 4);
  households.set([3, 1, 0, 0, 2, 2, 1, 0], 0);
  households.set([0, 0, 0, 0, 5, 0, 0, 1], 8);
  return {
    zones: ['060750101011', '060750101012'],
    pumas: ['07507'],
    zonePuma: Int32Array.from([0, 0]),
    lotZone: Int32Array.from([0, -1, 1]),
    areaM2: Float64Array.from([12345.678, 0]),
    occupied: Float64Array.from([0.91, 1]),
    access: Float64Array.from([1234.5, 0.25]),
    constant: Float64Array.from([0.1, -0.2, 0.3, 0, 0, 0]),
    types,
    households
  };
}

describe('sfh-cars/1', () => {
  it('names the codec', () => {
    expect(CARS_CODEC).toBe('sfh-cars/1');
  });

  it('decode(encode(d)) equals d', () => {
    const d = tiny();
    expect(decodeCarData(encodeCarData(d), 3)).toEqual(d);
  });

  it('encodes deterministically', () => {
    expect(encodeCarData(tiny())).toEqual(encodeCarData(tiny()));
  });

  it('a lotZone length other than the parcel count throws', () => {
    expect(() => decodeCarData(encodeCarData(tiny()), 4)).toThrow(/3 lots, want 4/);
  });

  it('a wrong codec tag throws', () => {
    const bytes = encodeCarData(tiny());
    const bad = bytes.slice();
    bad[0] = 'X'.charCodeAt(0);
    expect(() => decodeCarData(bad, 3)).toThrow(/bad magic/);
    // The header's format string is checked too.
    const text = new TextDecoder().decode(bytes);
    const at = text.indexOf(CARS_CODEC);
    const renamed = bytes.slice();
    renamed[at + 'sfh-cars/'.length] = '2'.charCodeAt(0);
    expect(() => decodeCarData(renamed, 3)).toThrow(/format/);
  });

  it('rejects counts and indices out of range', () => {
    const neg = tiny();
    neg.households[0] = -1;
    expect(() => encodeCarData(neg)).toThrow(/households/);
    const zone = tiny();
    zone.lotZone[0] = 2;
    expect(() => encodeCarData(zone)).toThrow(/lotZone/);
    const puma = tiny();
    puma.zonePuma[1] = 1;
    expect(() => encodeCarData(puma)).toThrow(/zonePuma/);
    const occ = tiny();
    occ.occupied[0] = 1.5;
    expect(() => encodeCarData(occ)).toThrow(/occupied/);
    const len = tiny();
    len.households = new Int32Array(3);
    expect(() => encodeCarData(len)).toThrow(/households has 3 values, want 16/);
  });
});
