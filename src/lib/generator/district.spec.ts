import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { unitsFor } from './bands';
import { drawComposition } from './composition-variety';
import { combineLots, generateDistrict, lotSeed } from './district';
import { layoutDistrict } from './district-layout';
import { lshape, pier, rect, type Polygon } from './fixtures/district';
import { generate, generateWith } from './generate';
import { selectTypology } from './select';
import { normaliseSite } from './site';
import type { GeneratedBuilding } from './types';
import { massedUnits } from './units';
import { drawVariety } from './variety';

const parcel = (polygon: Polygon, over: Partial<ParcelRecord> = {}): ParcelRecord => ({
  id: 'D1',
  polygon,
  labelPoint: [-122.39, 37.73],
  areaM2: 0,
  existingUnits: 0,
  existingFloorAreaM2: 0,
  existingHeightM: 0,
  landUse: 'X',
  eligible: true,
  neighborhood: 'X',
  ...over
});
const single = (p: ParcelRecord, S: number, seed: number) =>
  generateWith(p, { maxStories: S }, drawVariety(seed), 'max', drawComposition(seed));
const lotUnits = (b: GeneratedBuilding) =>
  b.lots!.reduce((s, l) => s + unitsFor(l.typology, l.floorAreaM2), 0);

const big = parcel(rect(800, 500));
const SEED = 7;
const bigAt8 = generate(big, { maxStories: 8 }, SEED, 'max')!;

describe('district massing in generate (spec §4.3 paint, §4.4)', () => {
  it('under the threshold equals main', () => {
    const p = parcel(rect(141.4, 141.4));
    const b = generate(p, { maxStories: 6 }, SEED, 'max');
    expect(b).not.toBeNull();
    expect(b).toStrictEqual(single(p, 6, SEED));
    expect(b).not.toHaveProperty('lots');
  });

  it('at the threshold it is a district', () => {
    const b = generate(parcel(rect(200, 100)), { maxStories: 6 }, SEED, 'max')!;
    expect(b.lots!.length).toBeGreaterThan(1);
  });

  it('paint fills every non-open-space lot', () => {
    // the L-shape has lots under 600 m² that the cap chain holds to a 7-story podium
    for (const [p, b] of [
      [big, bigAt8],
      [parcel(lshape), generate(parcel(lshape), { maxStories: 8 }, SEED, 'max')!]
    ] as const) {
      const layout = layoutDistrict(p.polygon, SEED);
      expect(b.lots).toHaveLength(layout.lots.length);
      // R1: each lot goes through the lot-area cap chain on its own normalised site
      layout.lots.forEach((lot, i) => {
        const A = normaliseSite(lot.polygon, drawVariety(lotSeed(SEED, lot.key)).edgeInsetM)!.A;
        expect(b.lots![i].stories).toBe(selectTypology(8, A, 0).stories);
      });
      expect(b.units).toBe(lotUnits(b));
    }
    expect(bigAt8.units).toBe(lotUnits(bigAt8));
    expect(bigAt8.parcelId).toBe('D1');
    expect(bigAt8.replacesExisting).toBe(true);
    expect(bigAt8.stories).toBe(Math.max(...bigAt8.lots!.map((l) => l.stories)));
  });

  it('parts carry lot indices in fill order', () => {
    const idx = bigAt8.parts.map((p) => p.lot!);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
    expect([...new Set(idx)]).toStrictEqual(bigAt8.lots!.map((_, i) => i));
  });

  it('district I8 rule', () => {
    const env = { maxStories: 8 };
    expect(generate({ ...big, existingUnits: 1e6 }, env, SEED, 'max')).toBeNull();
    const b = generate({ ...big, existingUnits: 1272, existingFloorAreaM2: 100 }, env, SEED, 'max');
    expect(b).not.toBeNull();
    expect(b!.units).toBeGreaterThan(1272);
    expect(b).toStrictEqual(bigAt8);
  });

  it('pier falls back to the single-building path', () => {
    const p = parcel(pier(5, 4100));
    expect(generateDistrict(p, { maxStories: 6 }, SEED)).toBe('not-district');
    const b = generate(p, { maxStories: 6 }, SEED, 'max');
    expect(b).toStrictEqual(single(p, 6, SEED));
    expect(b).not.toHaveProperty('lots');
  });

  it('massedUnits sums lots', () => {
    // at S 13, lots under 1,500 m² cap to a 12-story midrise (65 m² units), the rest are towers
    const b = generate(big, { maxStories: 13 }, SEED, 'max')!;
    expect(new Set(b.lots!.map((l) => l.typology))).toStrictEqual(new Set(['midrise', 'tower']));
    expect(massedUnits(b)).toBe(lotUnits(b));
    expect(massedUnits(b)).toBe(b.units);
    expect(massedUnits(b)).not.toBe(unitsFor(b.typology, b.floorAreaM2));
  });

  it('headline typology holds the most floor area, ties to the later typology', () => {
    const b = generate(big, { maxStories: 13 }, SEED, 'max')!;
    const area = (t: string) =>
      b.lots!.filter((l) => l.typology === t).reduce((s, l) => s + l.floorAreaM2, 0);
    expect(area(b.typology)).toBeGreaterThanOrEqual(area('midrise'));
    const lot = (typology: 'podium' | 'midrise', floorAreaM2: number): GeneratedBuilding => ({
      ...b,
      typology,
      floorAreaM2,
      parts: b.parts.slice(0, 1),
      lots: undefined
    });
    const tie = combineLots(big, [lot('midrise', 100), lot('podium', 100)], 'user', 2)!;
    expect(tie.typology).toBe('midrise');
    expect(tie.floorAreaM2).toBe(200);
    expect(tie.parts.map((p) => p.lot)).toStrictEqual([0, 1]);
    expect(combineLots(big, [], 'user', 0)).toBeNull();
  });

  it('deterministic', () => {
    expect(generate(big, { maxStories: 8 }, SEED, 'max')).toStrictEqual(bigAt8);
  });

  it('null when ineligible, bad label point or under one story', () => {
    expect(generateDistrict({ ...big, eligible: false }, { maxStories: 8 }, SEED)).toBeNull();
    expect(
      generateDistrict({ ...big, labelPoint: [NaN, 0] as never }, { maxStories: 8 }, SEED)
    ).toBeNull();
    expect(generateDistrict(big, { maxStories: 0.5 }, SEED)).toBeNull();
  });
});
