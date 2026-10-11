import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from './parcel';
import {
  ChunkFormatError,
  decodeParcelChunk,
  encodeParcelChunk,
  ringsAreaM2
} from './parcel-chunk';

// Local stand-in for plan-model's grid-20x20 fixture (that module lives on another branch):
// 400 parcels, label points on a 10 m grid from a fixed Mission origin, every 7th ineligible.
function grid20x20(): ParcelRecord[] {
  const recs: ParcelRecord[] = [];
  for (let i = 0; i < 400; i++) {
    const r = Math.floor(i / 20),
      c = i % 20;
    recs.push({
      id: `9${String(r).padStart(3, '0')}${String(c).padStart(3, '0')}`,
      polygon: [
        [
          [-4, -4],
          [4, -4],
          [4, 4],
          [-4, 4]
        ]
      ],
      labelPoint: [
        Math.round((-122.4195 + c * 0.000113) * 1e7) / 1e7,
        Math.round((37.76 + r * 0.00009) * 1e7) / 1e7
      ],
      areaM2: 64,
      existingUnits: i % 5,
      existingFloorAreaM2: Math.round(i * 12.3 * 10) / 10,
      existingHeightM: Math.round((3 + (i % 9)) * 10) / 10,
      landUse: i % 3 === 0 ? 'MIXRES' : 'RESIDENT',
      eligible: i % 7 !== 0,
      neighborhood: r < 10 ? 'Mission' : 'Noe Valley'
    });
  }
  return recs;
}

const sortById = (rs: ParcelRecord[]) =>
  [...rs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

describe('parcel chunk codec', () => {
  it('round-trips grid-20x20 exactly', () => {
    const recs = grid20x20();
    const json = encodeParcelChunk('fixture-0', '50_25', [...recs].reverse());
    expect(decodeParcelChunk(json)).toEqual(sortById(recs));
    expect(decodeParcelChunk(JSON.parse(json))).toEqual(sortById(recs));
  });

  it('is byte-deterministic and whitespace-free', () => {
    const a = encodeParcelChunk('fixture-0', '50_25', grid20x20());
    const b = encodeParcelChunk('fixture-0', '50_25', [...grid20x20()].reverse());
    expect(a).toBe(b);
    // Whitespace-free means no insignificant whitespace: the canonical form is JSON.stringify of the parse.
    // (A plain /\s/ check is wrong here: the dictionary string "Noe Valley" contains a space.)
    expect(JSON.stringify(JSON.parse(a))).toBe(a);
    expect(JSON.parse(a).format).toBe('sfh-parcels/1');
  });

  it('sorts dictionaries and ids with JS < on strings', () => {
    const base = grid20x20().slice(0, 3);
    base[0] = { ...base[0], id: '8711023C', landUse: 'VACANT' };
    base[1] = { ...base[1], id: '0026T001A', landUse: 'CIE' };
    base[2] = { ...base[2], id: '10', landUse: 'RESIDENT' };
    const c = JSON.parse(encodeParcelChunk('fixture-0', '0_0', base));
    expect(c.id).toEqual(['0026T001A', '10', '8711023C']);
    expect(c.dict.landUse).toEqual(['CIE', 'RESIDENT', 'VACANT']);
  });

  it('computes areaM2 by shoelace with holes negative', () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ];
    const hole: [number, number][] = [
      [2, 2],
      [2, 4],
      [4, 4],
      [4, 2]
    ];
    expect(ringsAreaM2([outer, hole])).toBe(96);
  });

  it('property: decode(encode(r)) == r after quantisation', () => {
    const coord = fc
      .double({ min: -500, max: 500, noNaN: true })
      .map((v) => Math.round(v * 100) / 100);
    const rect = fc
      .tuple(
        coord,
        coord,
        fc.double({ min: 1, max: 50, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true })
      )
      .map(([x, y, w, h]) => {
        // + 0 normalises -0 to +0: JSON cannot carry -0, and the two are the same coordinate.
        const q = (v: number) => Math.round(v * 100) / 100 + 0;
        return [
          [q(x), q(y)],
          [q(x + w), q(y)],
          [q(x + w), q(y + h)],
          [q(x), q(y + h)]
        ] as [number, number][];
      })
      .filter((r) => r[0][0] !== r[1][0] && r[0][1] !== r[2][1]);
    const rec = fc.record({
      id: fc.stringMatching(/^[0-9]{4}[0-9A-Z]{3,5}$/),
      polygon: fc.array(rect, { minLength: 1, maxLength: 3 }),
      lng: fc.double({ min: -122.53, max: -122.34, noNaN: true }),
      lat: fc.double({ min: 37.69, max: 37.84, noNaN: true }),
      units: fc.nat(2000),
      fa: fc.double({ min: 0, max: 1e6, noNaN: true }),
      h: fc.double({ min: 0, max: 340, noNaN: true }),
      lu: fc.constantFrom('RESIDENT', 'MIXRES', 'OPENSPACE', 'NONE', 'UNKNOWN'),
      nh: fc.constantFrom('Mission', 'Noe Valley', 'Castro/Upper Market')
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(rec, { selector: (r) => r.id, minLength: 1, maxLength: 30 }),
        (rs) => {
          const recs: ParcelRecord[] = rs.map((r) => ({
            id: r.id,
            polygon: r.polygon,
            labelPoint: [Math.round(r.lng * 1e7) / 1e7, Math.round(r.lat * 1e7) / 1e7],
            areaM2: ringsAreaM2(r.polygon),
            existingUnits: r.units,
            existingFloorAreaM2: Math.round(r.fa * 10) / 10,
            existingHeightM: Math.round(r.h * 10) / 10,
            landUse: r.lu,
            eligible: !['OPENSPACE', 'NONE'].includes(r.lu),
            neighborhood: r.nh
          }));
          const out = decodeParcelChunk(encodeParcelChunk('fixture-0', '0_0', recs));
          const exp = sortById(recs);
          expect(out.map((o) => ({ ...o, areaM2: 0 }))).toEqual(
            exp.map((o) => ({ ...o, areaM2: 0 }))
          );
          out.forEach((o, i) =>
            expect(Math.abs(o.areaM2 - exp[i].areaM2)).toBeLessThanOrEqual(0.01)
          );
        }
      )
    );
  });

  it('ignores unknown top-level keys', () => {
    const c = JSON.parse(encodeParcelChunk('fixture-0', '0_0', grid20x20().slice(0, 2)));
    c.yearBuilt = [1900, 1910];
    expect(decodeParcelChunk(c)).toHaveLength(2);
  });

  describe('malformed input throws ChunkFormatError', () => {
    const good = () => JSON.parse(encodeParcelChunk('fixture-0', '0_0', grid20x20().slice(0, 2)));
    const cases: [string, (c: Record<string, unknown>) => unknown][] = [
      ['unknown format', (c) => ({ ...c, format: 'sfh-parcels/2' })],
      ['units length', (c) => ({ ...c, units: [1] })],
      ['label length', (c) => ({ ...c, label: [1, 2, 3] })],
      ['xy length', (c) => ({ ...c, xy: (c.xy as number[]).slice(1) })],
      ['non-array column', (c) => ({ ...c, height: 'x' })],
      ['dict index out of range', (c) => ({ ...c, lu: [0, 99] })],
      ['elig not 0/1', (c) => ({ ...c, elig: [0, 2] })],
      ['not an object', () => 42],
      ['bad JSON string', () => '{"format":"sfh-parcels/1",']
    ];
    for (const [name, mutate] of cases) {
      it(name, () => {
        expect(() => decodeParcelChunk(mutate(good()))).toThrow(ChunkFormatError);
      });
    }
  });
});
