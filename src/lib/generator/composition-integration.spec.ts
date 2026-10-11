import { expect, it } from 'vitest';
import { generateDetailed } from './generate';
import { drawComposition } from './composition-variety';
import { drawVariety } from './variety';
import { compositionParcel } from './fixtures/composition-parcel';
import { unitsFor } from './bands';
import { signedArea } from './poly';
import { fromLngLat, toLngLat } from './geo';
import { serializeComposition } from './serialize';
import { normaliseSite } from './site';
import { FTF_M } from './constants';
import type { CompositionId } from './composition-types';
for (const family of [
  'terrace',
  'divided',
  'slab',
  'shouldered',
  'offset',
  'paired'
] as CompositionId[]) {
  it(`reports occupied capacity for ${family}`, () => {
    const tower = !['terrace', 'divided'].includes(family);
    const p = compositionParcel('p', tower ? 60 : 30, tower ? 50 : 30);
    const d = generateDetailed(p, { maxStories: tower ? 40 : 6 }, drawVariety(1), 'max', {
      ...drawComposition(1),
      familyOrder: [family]
    })!;
    expect(d.building.composition).toBe(family);
    const area = d.local
      .filter((l) => l.role === 'occupied')
      .reduce(
        (a, l) =>
          a +
          signedArea(l.ring.map(([x, y]) => ({ x, y }))) *
            Math.round((l.topM - l.baseM - (l.baseM === 0 ? 1.4 : 0)) / FTF_M),
        0
      );
    expect(d.building.floorAreaM2).toBeCloseTo(area, 1);
    expect(d.building.units).toBe(unitsFor(d.building.typology, d.building.floorAreaM2));
  });
}
it('tries a reference when decorative capacity fails the gain check', () => {
  const p = compositionParcel('p', 30, 30);
  const simple = { ...drawComposition(1), familyOrder: ['simple' as const], capEnabled: false };
  const ref = generateDetailed(p, { maxStories: 6 }, drawVariety(1), 'max', simple)!;
  const existing = {
    ...p,
    existingUnits: ref.building.units - 1,
    existingFloorAreaM2: ref.building.floorAreaM2 - 1
  };
  const d = generateDetailed(existing, { maxStories: 6 }, drawVariety(1), 'max', {
    ...simple,
    familyOrder: ['terrace']
  })!;
  expect(d.building.composition).toBe('simple');
  expect(d.building.units).toBe(ref.building.units);
});
it('inverts the serialized local frame within two centimetres', () => {
  const points: [number, number][] = [
    [-200, 300],
    [12.123, -45.678]
  ];
  const label: [number, number] = [-122.4194, 37.7749];
  const result = fromLngLat(toLngLat(points, label), label);
  expect(result.every((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]) < 0.02)).toBe(
    true
  );
});
it('rejects an occupied fragment collapsed by serialization instead of keeping stale capacity', () => {
  const parcel = compositionParcel('p', 30, 30);
  const site = normaliseSite(parcel.polygon, 0.4)!;
  const region = [
    [0, 0],
    [0.00001, 0],
    [0.00001, 10]
  ].map(([x, y]) => ({ x, y }));
  expect(
    serializeComposition(
      parcel,
      site,
      {
        family: 'simple',
        typology: 'podium',
        stories: 6,
        bands: [{ firstFloor: 1, floors: 6, regions: [region] }]
      },
      [],
      0
    )
  ).toBeNull();
});
