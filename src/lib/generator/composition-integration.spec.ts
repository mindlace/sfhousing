import { expect, it } from 'vitest';
import { generate, generateDetailed } from './generate';
import { fnv1a32 } from './seed';
import { uRing, ringArea } from './fixtures/geom';
import { drawComposition } from './composition-variety';
import { drawVariety } from './variety';
import { compositionParcel } from './fixtures/composition-parcel';
import { unitsFor } from './bands';
import { signedArea, inset } from './poly';
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

it('keeps housing capacity when a preferred tower family becomes feasible at a higher allowance', () => {
  const p = compositionParcel('rect-31', 40, 40);
  const seed = fnv1a32(p.id);
  const lower = generate(p, { maxStories: 20 }, seed, 'max')!;
  const upper = generate(p, { maxStories: 21 }, seed, 'max')!;
  expect(upper.typology).toBe(lower.typology);
  expect(upper.units).toBeGreaterThanOrEqual(lower.units);
  expect(upper.floorAreaM2).toBeGreaterThanOrEqual(lower.floorAreaM2);
});
it('uses a valid midrise fallback when a U-shaped tower reference has no six-metre core', () => {
  const p = compositionParcel('u-30', 40, 60);
  p.polygon = [uRing(40, 60, 8, 40)];
  p.areaM2 = ringArea(p.polygon[0]);
  const d = generateDetailed(p, { maxStories: 40 }, drawVariety(fnv1a32(p.id)), 'max')!;
  expect(d).not.toBeNull();
  for (const part of d.local.filter((p) => p.role === 'occupied' && p.baseM > 0)) {
    if (d.building.typology === 'tower')
      expect(inset([part.ring.map(([x, y]) => ({ x, y }))], 3).length).toBeGreaterThan(0);
  }
  expect(d.building.typology).toBe('midrise');
  expect(d.building.stories).toBe(12);
});

it('keeps seeded height sweeps monotone across family attempts and replacement-gain thresholds', () => {
  for (const [w, h] of [
    [40, 40],
    [60, 50]
  ])
    for (const existingUnits of [0, 50, 150]) {
      for (let i = 0; i < 20; i++) {
        const p = compositionParcel(`sweep-${w}-${existingUnits}-${i}`, w, h);
        p.existingUnits = existingUnits;
        p.existingFloorAreaM2 = existingUnits * 85;
        let previous: ReturnType<typeof generate> = null;
        for (let s = 5; s <= 80; s++) {
          const b = generate(p, { maxStories: s }, fnv1a32(p.id), 'max');
          if (b && previous && b.typology === previous.typology) {
            expect(b.units, `${p.id} at ${s} floors`).toBeGreaterThanOrEqual(previous.units);
            expect(b.floorAreaM2, `${p.id} at ${s} floors`).toBeGreaterThanOrEqual(
              previous.floorAreaM2
            );
          }
          previous = b;
        }
      }
    }
});

it('keeps the productive family when a less productive reference later passes replacement gain', () => {
  const p = compositionParcel('gain-U-1', 60, 50);
  p.polygon = [uRing(60, 50, 20, 30)];
  p.existingUnits = 250;
  p.existingFloorAreaM2 = 17500;
  const seed = fnv1a32(p.id);
  const lo = generate(p, { maxStories: 30 }, seed, 'max')!;
  const hi = generate(p, { maxStories: 31 }, seed, 'max')!;
  expect(hi.units).toBeGreaterThanOrEqual(lo.units);
  expect(hi.floorAreaM2).toBeGreaterThanOrEqual(lo.floorAreaM2);
});
