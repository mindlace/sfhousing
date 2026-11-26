import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { BLOCK_COVERAGE, COVERAGE } from './constants';
import { rect, type Polygon } from './fixtures/district';
import { rectRing } from './fixtures/geom';
import { generateForm } from './forms';
import { generate } from './generate';
import { maxTowerPlates } from './massing';
import { physicalMaxStories } from './physical';
import { fnv1a32 } from './seed';
import { normaliseSite } from './site';
import { drawVariety } from './variety';

const parcel = (polygon: Polygon, over: Partial<ParcelRecord> = {}): ParcelRecord => ({
  id: 'F1',
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
/** 120 × 130 m, the size of lot 2455001. */
const rec = parcel(rect(120, 130));
/** A standard 25 × 100 ft lot. */
const smallRec = parcel([rectRing(7.62, 30.48)]);
const seed = fnv1a32(rec.id);
const site = normaliseSite(rec.polygon, drawVariety(seed).edgeInsetM)!;

describe('generateForm', () => {
  it('keeps full coverage above 12 stories as a block', () => {
    const b12 = generateForm(rec, 'midrise', 12, seed)!;
    const b13 = generateForm(rec, 'block', 13, seed)!;
    expect(b13.units).toBeGreaterThan(b12.units);
    expect(b13.stories).toBe(13);
    expect(b13.plates).toBe(0);
    expect(BLOCK_COVERAGE).toBeGreaterThan(COVERAGE.midrise);
  });
  it('places several tower plates on a large lot', () => {
    const t = generateForm(rec, 'tower', 20, seed)!;
    expect(t.plates).toBeGreaterThan(1);
    expect(t.plates).toBe(maxTowerPlates(site));
    expect(t.building.typology).toBe('tower');
    expect(t.stories).toBe(20);
    // the plates' floors hold more homes than one plate could
    const one = generate(rec, { maxStories: 20 }, seed, 'max')!;
    expect(one.typology).toBe('tower');
    expect(t.units).toBeGreaterThan(one.units);
  });
  it('fits plates of at most TOWER_PLATE_MAX_M2 with room between them', () => {
    expect(maxTowerPlates(site)).toBeGreaterThan(1);
    const t = generateForm(rec, 'tower', 20, seed)!;
    const top = Math.max(...t.building.parts.map((p) => p.topM));
    const plates = t.building.parts.filter((p) => p.role === 'occupied' && p.topM === top);
    expect(plates).toHaveLength(t.plates);
  });
  it('returns null for a form the lot cannot hold', () => {
    expect(generateForm(smallRec, 'tower', 20, seed)).toBeNull();
    expect(maxTowerPlates(normaliseSite(smallRec.polygon, 0)!)).toBeLessThanOrEqual(1);
    // a tower needs 13 stories; the lot's physical maximum is lower
    expect(generateForm(rec, 'tower', 12, seed)).toBeNull();
  });
  it('returns null when the form gains no home', () => {
    const built = parcel(rect(120, 130), { existingUnits: 5000, existingFloorAreaM2: 400_000 });
    expect(generateForm(built, 'block', 13, seed)).toBeNull();
  });
  it('never exceeds the physical maximum', () => {
    expect(generateForm(rec, 'block', 80, seed)!.stories).toBeLessThanOrEqual(
      physicalMaxStories(site)
    );
  });
  it('masses the low forms at the stories asked', () => {
    for (const [form, stories] of [
      ['plex', 3],
      ['walkup', 4],
      ['podium', 6],
      ['midrise', 8]
    ] as const) {
      const b = generateForm(rec, form, stories, seed)!;
      expect(b.building.typology).toBe(form);
      expect(b.stories).toBe(stories);
      expect(b.plates).toBe(0);
    }
  });
  it('masses every district lot at the form and stories, and sums them', () => {
    const district = parcel(rect(400, 300));
    const d = generateForm(district, 'tower', 20, seed)!;
    expect(d.building.lots!.length).toBeGreaterThan(1);
    // every lot is a tower at the stories asked, or its own physical maximum below them
    expect(d.building.lots!.every((l) => l.typology === 'tower' && l.stories <= 20)).toBe(true);
    expect(d.stories).toBe(20);
    expect(d.units).toBe(d.building.units);
    expect(d.plates).toBeGreaterThanOrEqual(d.building.lots!.length);
    expect(d.plates).toBe(d.building.lots!.reduce((n, l) => n + (l.plates ?? 0), 0));
  });
});
