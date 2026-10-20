import { describe, expect, it, vi } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { DISTRICT_MIN_M2 } from './constants';
import { generateDistrict, generateDistrictForUnits } from './district';
import { districtArea, layoutDistrict } from './district-layout';
import { rect } from './fixtures/district';
import { generate, generateWith } from './generate';
import { drawComposition } from './composition-variety';
import { drawVariety } from './variety';

// Ruling R6: a district whose lots all mass null is null; only 'not-district' (no lot) falls back
// to the single-building path. No real geometry makes every lot fail, so the per-lot `generate`
// is made to: below DISTRICT_MIN_M2 (every lot) it returns null, at or above it is the real one.
vi.mock('./generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate')>();
  return {
    ...actual,
    generate: (parcel: ParcelRecord, ...rest: [never, number, 'max']) =>
      districtArea(parcel.polygon) >= DISTRICT_MIN_M2 ? actual.generate(parcel, ...rest) : null
  };
});

const big: ParcelRecord = {
  id: 'D1',
  polygon: rect(800, 500),
  labelPoint: [-122.39, 37.73],
  areaM2: 0,
  existingUnits: 0,
  existingFloorAreaM2: 0,
  existingHeightM: 0,
  landUse: 'X',
  eligible: true,
  neighborhood: 'X'
};
const SEED = 7;

describe('every lot masses null (R6)', () => {
  it('the district is null, with no single-building fallback', () => {
    expect(layoutDistrict(big.polygon, SEED).lots.length).toBeGreaterThan(0);
    // the single-building path would have built something
    expect(
      generateWith(big, { maxStories: 8 }, drawVariety(SEED), 'max', drawComposition(SEED))
    ).not.toBeNull();
    expect(generateDistrict(big, { maxStories: 8 }, SEED)).toBeNull();
    expect(generate(big, { maxStories: 8 }, SEED, 'max')).toBeNull();
    const assembled = { anchor: big, records: [big], polygon: big.polygon };
    expect(generateDistrictForUnits(assembled, 500, SEED, null, {})).toBeNull();
  });
});
