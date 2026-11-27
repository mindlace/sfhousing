import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import type { PathD } from 'clipper2-ts';
import { BLOCK_COVERAGE, COVERAGE, TOWERS_PLATE_MAX_M2, TOWERS_SEPARATION_M } from './constants';
import { rect, type Polygon } from './fixtures/district';
import { rectRing } from './fixtures/geom';
import { generateForm } from './forms';
import { generate } from './generate';
import { massTypology, maxTowerPlates } from './massing';
import { signedArea } from './poly';
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

/** Distance from point p to segment ab. */
const segDist = (p: PathD[number], a: PathD[number], b: PathD[number]) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};
/** Gap between two disjoint convex rings: the least vertex-to-edge distance either way. */
const gap = (r: PathD, s: PathD) => {
  const one = (x: PathD, y: PathD) =>
    Math.min(...x.flatMap((p) => y.map((a, k) => segDist(p, a, y[(k + 1) % y.length]))));
  return Math.min(one(r, s), one(s, r));
};

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
  it('fits plates of at most TOWERS_PLATE_MAX_M2, TOWERS_SEPARATION_M apart', () => {
    // Planning Code: 12,000 gross square feet a floor, towers 115 ft apart
    expect(TOWERS_PLATE_MAX_M2).toBeCloseTo(1114.84, 2);
    expect(TOWERS_SEPARATION_M).toBeCloseTo(35.052, 3);
    const n = maxTowerPlates(site);
    expect(n).toBeGreaterThan(1);
    const m = massTypology(site, 'tower', 20, drawVariety(seed), { plates: n })!;
    const plates = m.parts.filter((p) => p.baseM > 0).map((p) => p.ring);
    expect(plates).toHaveLength(n);
    for (const r of plates)
      expect(Math.abs(signedArea(r))).toBeLessThanOrEqual(TOWERS_PLATE_MAX_M2 + 0.01);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        expect(gap(plates[i], plates[j])).toBeGreaterThanOrEqual(TOWERS_SEPARATION_M - 0.01);
    // the form's building draws the same plates
    const t = generateForm(rec, 'tower', 20, seed)!;
    const occupied = t.building.parts.filter((p) => p.role === 'occupied');
    const top = Math.max(...occupied.map((p) => p.topM));
    expect(occupied.filter((p) => p.topM === top)).toHaveLength(n);
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
