import { describe, expect, it } from 'vitest';
import gen from './fixtures/generated-small.json';
import parcels from './fixtures/parcels-small.json';
import { packCell, concatPacks, emptyPack, packTransferables, type PackInput } from './pack';
import { encodeAppearance } from './appearance';
import { TYPOLOGY_ORDER } from './types';
import type { GeneratedBuilding } from '$lib/generator';
import type { ParcelRecord } from '$lib/data/parcel';

const items: PackInput[] = (gen as unknown as GeneratedBuilding[]).map((b, i) => ({
  building: b,
  existingUnits: (parcels as unknown as ParcelRecord[])[i].existingUnits
}));
const signedArea = (pos: Float64Array, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) {
    const j = i + 1 < b ? i + 1 : a;
    s += pos[2 * i] * pos[2 * j + 1] - pos[2 * j] * pos[2 * i + 1];
  }
  return s / 2;
};

describe('packCell (U1)', () => {
  const p = packCell('50_25', items);
  it('startIndices monotonic, last = vertex count', () => {
    expect(p.startIndices.length).toBe(p.partCount + 1);
    for (let k = 1; k < p.startIndices.length; k++)
      expect(p.startIndices[k]).toBeGreaterThan(p.startIndices[k - 1]);
    expect(p.startIndices[p.partCount]).toBe(p.positions.length / 2);
  });
  it('rings are closed exactly once and CW', () => {
    // deck gets these with _normalize: false and draws no wall from a ring's last vertex, so the
    // closing vertex is what puts a wall on the last edge.
    expect(p.partCount).toBeGreaterThan(0);
    for (let k = 0; k < p.partCount; k++) {
      const a = p.startIndices[k],
        b = p.startIndices[k + 1];
      expect(b - a).toBeGreaterThanOrEqual(4);
      const first = [p.positions[2 * a], p.positions[2 * a + 1]];
      const last = [p.positions[2 * (b - 1)], p.positions[2 * (b - 1) + 1]];
      const beforeLast = [p.positions[2 * (b - 2)], p.positions[2 * (b - 2) + 1]];
      expect(last).toEqual(first);
      expect(beforeLast).not.toEqual(first);
      expect(signedArea(p.positions, a, b)).toBeLessThan(0);
    }
  });
  it('partSlot and parcelMeta match the source buildings', () => {
    const sorted = [...items].sort((x, y) => (x.building.parcelId < y.building.parcelId ? -1 : 1));
    expect(p.parcelIds).toEqual(sorted.map((i) => i.building.parcelId));
    let k = 0;
    sorted.forEach((it, s) => {
      const b = it.building;
      expect([...p.parcelMeta.slice(4 * s, 4 * s + 4)]).toEqual([
        b.units,
        it.existingUnits,
        b.stories,
        TYPOLOGY_ORDER.indexOf(b.typology)
      ]);
      for (const part of b.parts) {
        expect(p.partSlot[k]).toBe(s);
        expect(p.partTopM[k]).toBeCloseTo(part.topM, 4);
        expect(p.partTypology[k]).toBe(TYPOLOGY_ORDER.indexOf(b.typology));
        expect(p.partAppearance[k]).toBe(encodeAppearance(part.role, part.tone));
        k++;
      }
    });
    expect(k).toBe(p.partCount);
  });
  it('byte-identical on repeat and independent of input order', () => {
    const q = packCell('50_25', [...items].reverse());
    for (const key of [
      'parcelMeta',
      'startIndices',
      'positions',
      'partTopM',
      'partSlot',
      'partTypology',
      'partAppearance'
    ] as const)
      expect(Buffer.from(q[key].buffer).equals(Buffer.from(p[key].buffer))).toBe(true);
  });
  it('CCW input with a closing vertex is normalised', () => {
    const b = {
      ...items[0].building,
      parts: [
        {
          footprint: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0]
          ] as [number, number][],
          role: 'occupied' as const,
          tone: 0 as const,
          baseM: 0,
          topM: 9
        }
      ]
    };
    const r = packCell('c', [{ building: b, existingUnits: 0 }]);
    expect([...r.positions]).toEqual([0, 1, 1, 1, 1, 0, 0, 0, 0, 1]);
    expect(signedArea(r.positions, 0, 5)).toBeLessThan(0);
  });
  it('an open input ring is closed', () => {
    const part = { ...items[0].building.parts[0], baseM: 0, topM: 9 };
    const b = {
      ...items[0].building,
      parts: [
        {
          ...part,
          footprint: [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0]
          ] as [number, number][]
        }
      ]
    };
    const r = packCell('c', [{ building: b, existingUnits: 0 }]);
    expect([...r.startIndices]).toEqual([0, 5]);
    expect([...r.positions]).toEqual([0, 0, 0, 1, 1, 1, 1, 0, 0, 0]);
  });
  it('a building with no parts contributes a slot and no parts', () => {
    const r = packCell('c', [{ building: { ...items[0].building, parts: [] }, existingUnits: 1 }]);
    expect(r.parcelIds).toHaveLength(1);
    expect(r.partCount).toBe(0);
    expect([...r.startIndices]).toEqual([0]);
  });
  it('duplicate parcelId throws', () => {
    expect(() => packCell('c', [items[0], items[0]])).toThrow();
  });
  it('unknown typology throws', () => {
    const bad = {
      ...items[0],
      building: { ...items[0].building, composition: 'simple', typology: 'castle' }
    };
    expect(() => packCell('c', [bad as unknown as PackInput])).toThrow(/unknown typology castle/);
  });
  it('concatPacks remaps slots and keeps geometry', () => {
    const a = packCell('c', items.slice(0, 6)),
      b = packCell('c', items.slice(6));
    const c = concatPacks(a, b);
    expect([...c.partAppearance]).toEqual([...a.partAppearance, ...b.partAppearance]);
    expect(c.partCount).toBe(a.partCount + b.partCount);
    expect(c.parcelIds).toEqual([...a.parcelIds, ...b.parcelIds]);
    expect(c.partSlot[a.partCount]).toBe(b.partSlot[0] + a.parcelIds.length);
    expect(c.startIndices[c.partCount]).toBe(c.positions.length / 2);
    expect(concatPacks(emptyPack('c'), a).partCount).toBe(a.partCount);
  });
  it('packTransferables lists every buffer', () => {
    expect(packTransferables(p)).toHaveLength(7);
  });
});
it('coalesces identical consecutive occupied slabs without changing parcel totals', () => {
  const part = items[0].building.parts[0];
  const building: GeneratedBuilding = {
    ...items[0].building,
    parts: [
      { ...part, role: 'occupied', tone: 0, baseM: 0, topM: 10 },
      { ...part, role: 'occupied', tone: 0, baseM: 10, topM: 20 }
    ]
  };
  const pack = packCell('a', [{ building, existingUnits: 0 }]);
  expect(pack.partCount).toBe(1);
  expect(pack.partTopM[0]).toBe(20);
  expect(pack.parcelMeta[0]).toBe(building.units);
});

describe('packCell district lots', () => {
  const sq = (x: number): [number, number][] => [
    [x, 37.77],
    [x, 37.771],
    [x + 0.001, 37.771],
    [x + 0.001, 37.77]
  ];
  const part = (footprint: [number, number][], baseM: number, topM: number, lot: number) => ({
    footprint,
    role: 'occupied' as const,
    tone: 0 as const,
    baseM,
    topM,
    lot
  });
  const district = (parts: GeneratedBuilding['parts']): GeneratedBuilding => ({
    ...(gen as unknown as GeneratedBuilding[])[0],
    typology: 'podium',
    parts,
    lots: [
      { typology: 'podium', stories: 5, floorAreaM2: 500 },
      { typology: 'tower', stories: 10, floorAreaM2: 500 }
    ]
  });

  it('a district colours each lot by its own typology', () => {
    const b = district([part(sq(-122.42), 0, 15, 0), part(sq(-122.418), 0, 30, 1)]);
    const p = packCell('c', [{ building: b, existingUnits: 0 }]);
    expect(Array.from(p.partTypology)).toEqual([
      TYPOLOGY_ORDER.indexOf('podium'),
      TYPOLOGY_ORDER.indexOf('tower')
    ]);
    expect(p.parcelMeta[3]).toBe(TYPOLOGY_ORDER.indexOf('podium'));
  });

  it('identical stacked parts of different lots are not merged', () => {
    const b = district([part(sq(-122.42), 0, 15, 0), part(sq(-122.42), 15, 30, 1)]);
    expect(packCell('c', [{ building: b, existingUnits: 0 }]).partCount).toBe(2);
  });
});
